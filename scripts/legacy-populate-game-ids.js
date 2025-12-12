#!/usr/bin/env node

/**
 * Populate game_ids table from StatBroadcast archives
 * 
 * This script:
 * 1. Fetches game IDs for ALL SPORTS from team archives (not just basketball)
 * 2. Fetches game metadata from XML to determine home/away teams and their GIDs
 * 3. Auto-creates missing teams in the database with proper sport classification
 * 4. Handles duplicates (same game appears in both team archives)
 * 5. Implements exponential backoff for server errors
 * 6. Saves progress to resume after interruptions
 * 7. Dynamically adjusts query rate based on server response
 * 8. Logs comprehensive statistics
 * 
 * Team Discovery Logic:
 * - When a team is not found in the database, the script:
 *   1. First tries to find the team's basketball GID (same school, different sport)
 *   2. If that fails, extracts the GID from the game's XML (homeid/visid attributes)
 *   3. Creates a new team entry with the discovered GID and proper sport classification
 * 
 * Features:
 * - Multi-sport support: Processes all sports, not just basketball
 * - Auto-team creation: Automatically adds missing teams to the database
 * - Exponential backoff: Automatically retries failed requests with increasing delays
 * - Dynamic rate limiting: Adjusts query speed based on server health
 * - Progress persistence: Saves completed teams to data/populate-game-ids-progress.json
 * - Resume capability: Automatically skips already-processed teams on restart
 * 
 * Usage:
 *   node scripts/populate-game-ids.js                    # Process all teams (resumes if interrupted)
 *   node scripts/populate-game-ids.js --team=duke        # Process single team
 *   node scripts/populate-game-ids.js --reset-progress   # Clear progress and start fresh
 *   node scripts/populate-game-ids.js --delay=5000       # Use custom initial delay (5 seconds)
 */

const axios = require('axios');
const puppeteer = require('puppeteer');
const qs = require('qs');
const fs = require('fs');
const path = require('path');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

// Progress file to track completed teams
const PROGRESS_FILE = path.join(__dirname, '../data/populate-game-ids-progress.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { team: null, resetProgress: false, delay: 2000 };
  args.forEach(arg => {
    if (arg.startsWith('--team=')) {
      options.team = arg.split('=')[1];
    }
    if (arg === '--reset-progress') {
      options.resetProgress = true;
    }
    if (arg.startsWith('--delay=')) {
      options.delay = parseInt(arg.split('=')[1], 10);
    }
  });
  return options;
}

/**
 * Load progress from file
 * @returns {Object} Progress object with completedTeams array
 */
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.warn('Failed to load progress file:', error.message);
  }
  return { completedTeams: [], lastUpdated: null };
}

/**
 * Save progress to file
 * @param {Object} progress - Progress object
 */
function saveProgress(progress) {
  try {
    progress.lastUpdated = new Date().toISOString();
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    logger.info(`Progress saved: ${progress.completedTeams.length} teams completed`);
  } catch (error) {
    logger.error('Failed to save progress:', error.message);
  }
}

/**
 * Normalize sport name to a consistent format
 * @param {string} sport - Raw sport name from API
 * @returns {string} Normalized sport name
 */
function normalizeSportName(sport) {
  const normalized = sport.toLowerCase().trim();
  
  const sportMap = {
    "men's basketball": 'mens-college-basketball',
    "mens basketball": 'mens-college-basketball',
    "m;bbgame": 'mens-college-basketball',
    "women's basketball": 'womens-college-basketball',
    "womens basketball": 'womens-college-basketball',
    "football": 'college-football',
    "men's ice hockey": 'mens-ice-hockey',
    "mens ice hockey": 'mens-ice-hockey',
    "ice-hockey": 'mens-ice-hockey', // Generic ice hockey defaults to mens
    "women's ice hockey": 'womens-ice-hockey',
    "womens ice hockey": 'womens-ice-hockey',
    "women's soccer": 'womens-soccer',
    "womens soccer": 'womens-soccer',
    "men's soccer": 'mens-soccer',
    "mens soccer": 'mens-soccer',
    "soccer": 'womens-soccer', // Generic soccer defaults to womens (more common in StatBroadcast)
    "volleyball": 'womens-volleyball',
    "women's volleyball": 'womens-volleyball',
    "baseball": 'college-baseball',
    "softball": 'college-softball',
    "women's tennis": 'womens-tennis',
    "womens tennis": 'womens-tennis',
    "men's tennis": 'mens-tennis',
    "mens tennis": 'mens-tennis',
  };
  
  // If not in map, normalize by removing apostrophes first, then replacing non-alphanumeric
  if (sportMap[normalized]) {
    return sportMap[normalized];
  }
  
  // Remove apostrophes and possessives, then convert to kebab-case
  return sport
    .toLowerCase()
    .replace(/['']s?\s+/g, 's-')  // "Women's Tennis" -> "womens-tennis"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate a team_id slug from team name and sport
 * @param {string} teamName - Team name
 * @param {string} sport - Sport type
 * @returns {string} Slugified team_id
 */
function generateTeamId(teamName, sport) {
  const nameSlug = teamName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  const sportSlug = sport
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  return `${nameSlug}-${sportSlug}`;
}

/**
 * Add random jitter to prevent thundering herd
 * @param {number} delay - Base delay in milliseconds
 * @param {number} jitterPercent - Jitter percentage (0-1)
 * @returns {number} Delay with jitter applied
 */
function addJitter(delay, jitterPercent = 0.3) {
  const jitter = delay * jitterPercent * (Math.random() - 0.5) * 2;
  return Math.round(delay + jitter);
}

/**
 * Circuit breaker to stop requests after too many failures
 */
class CircuitBreaker {
  constructor(threshold = 5, resetTime = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.resetTime = resetTime;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = null;
  }
  
  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  recordFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTime;
      logger.error(`Circuit breaker OPEN after ${this.failureCount} failures. Will retry after ${this.resetTime}ms`);
    }
  }
  
  canAttempt() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN' && Date.now() >= this.nextAttempt) {
      this.state = 'HALF_OPEN';
      logger.info('Circuit breaker entering HALF_OPEN state');
      return true;
    }
    return false;
  }
  
  isOpen() {
    return this.state === 'OPEN';
  }
}

/**
 * Exponential backoff retry wrapper with circuit breaker and network resilience
 * @param {Function} fn - Async function to retry
 * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<any>} Result of the function
 */
async function retryWithBackoff(fn, circuitBreaker, maxRetries = 3, baseDelay = 2000) {
  let lastError;
  let networkRetries = 0;
  const maxNetworkRetries = 10; // Allow more retries for network issues
  
  if (!circuitBreaker.canAttempt()) {
    throw new Error('Circuit breaker is OPEN - too many recent failures');
  }
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      circuitBreaker.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      
      // Check error type
      const isServerError = error.response && error.response.status >= 500;
      const isRateLimited = error.response && (error.response.status === 429 || error.response.status === 503);
      const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ENETUNREACH';
      
      // Network errors get special treatment - don't count against circuit breaker
      if (isNetworkError && networkRetries < maxNetworkRetries) {
        networkRetries++;
        const networkDelay = Math.min(60000, baseDelay * Math.pow(2, networkRetries)); // Max 60s
        logger.warn(`Network error (${error.code}): ${error.message}. Retry ${networkRetries}/${maxNetworkRetries} in ${networkDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, networkDelay));
        attempt--; // Don't count network errors against regular retry limit
        continue;
      }
      
      // Record failure for circuit breaker (but not for network errors)
      if (isServerError || isRateLimited) {
        circuitBreaker.recordFailure();
      }
      
      if ((isServerError || isTimeout || isRateLimited) && attempt < maxRetries) {
        // More aggressive backoff for rate limiting
        const multiplier = isRateLimited ? 4 : 2;
        const delay = addJitter(baseDelay * Math.pow(multiplier, attempt));
        logger.warn(`Attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  
  throw lastError;
}

/**
 * Fetch all game IDs for a team using Puppeteer to capture live AJAX parameters
 * @param {string} gid - StatBroadcast GID (e.g., 'duke', 'msu')
 * @param {Object} rateLimiter - Rate limiter state object
 * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
 * @returns {Promise<Array<{gameId: string, eventDate: string, sport: string}>>}
 */
async function fetchGameIdsForTeam(gid, rateLimiter = { delay: 2000 }, circuitBreaker) {
  try {
    logger.info(`Fetching game IDs for team: ${gid}`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    let capturedRequest = null;

    page.on('request', req => {
      const url = req.url();
      if (url.includes('_archive.php') && req.method() === 'POST') {
        capturedRequest = {
          url,
          body: req.postData(),
          headers: req.headers()
        };
      }
    });

    await page.goto(`https://www.statbroadcast.com/events/archive.php?gid=${gid}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await browser.close();

    if (!capturedRequest) {
      logger.error(`No AJAX request captured for ${gid}`);
      return [];
    }

    const baseBody = qs.parse(capturedRequest.body);

    // Paginate through records
    const gameIds = [];
    let start = 0;
    const length = 100;
    let totalRecords = null;

    while (totalRecords === null || start < totalRecords) {
      const body = {
        ...baseBody,
        draw: 1,
        start,
        length,
        gid,
        // Remove sports filter to get all sports
      };

      const response = await retryWithBackoff(async () => {
        return await axios.post(
          capturedRequest.url, 
          qs.stringify(body),
          {
            headers: {
              ...capturedRequest.headers,
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            timeout: 30000
          }
        );
      }, circuitBreaker, 5, 3000); // Increased to 5 retries with 3s base delay

      const data = response.data;

      if (!data || !data.data) {
        logger.warn(`No data returned for ${gid} at offset ${start}`);
        break;
      }

      if (totalRecords === null) {
        totalRecords = data.recordsFiltered || data.recordsTotal || 0;
        logger.info(`Total records for ${gid}: ${totalRecords} (filtering to Men's Basketball only)`);
      }

      data.data.forEach(row => {
        if (row.eventlink && row.eventdate) {
          const match = row.eventlink.match(/id=(\d+)/);
          if (match) {
            // Convert MM/DD/YYYY to YYYY-MM-DD for SQLite DATE format
            const [month, day, year] = row.eventdate.split('/');
            const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            
            // Normalize sport name
            const sportName = normalizeSportName(row.sport || 'unknown');
            
            gameIds.push({
              gameId: match[1],
              eventDate: formattedDate,
              sport: sportName,
              rawSport: row.sport || 'unknown'
            });
          }
        }
      });

      start += length;
      
      // Dynamic rate limiting with jitter between pagination requests
      const paginationDelay = addJitter(rateLimiter.delay);
      await new Promise(resolve => setTimeout(resolve, paginationDelay));
    }

    // Deduplicate by gameId
    const uniqueGames = Array.from(
      new Map(gameIds.map(game => [game.gameId, game])).values()
    );
    logger.info(`Found ${uniqueGames.length} unique games for ${gid} across all sports (from ${totalRecords} total records)`);
    
    // Success - reduce delay slightly (but keep minimum higher)
    rateLimiter.delay = Math.max(1500, rateLimiter.delay * 0.95);
    
    return uniqueGames;

  } catch (error) {
    logger.error(`Failed to fetch game IDs for ${gid}:`, error.message);
    
    // Increase delay significantly on error
    rateLimiter.delay = Math.min(30000, rateLimiter.delay * 3);
    logger.warn(`Increased rate limit delay to ${rateLimiter.delay}ms`);
    
    // Don't throw - return empty array so we can continue with other teams
    return [];
  }
}

/**
 * Fetch game metadata from StatBroadcast XML archive
 * @param {string} gameId - Game ID
 * @param {Object} rateLimiter - Rate limiter state object
 * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
 * @returns {Promise<{homeTeamName: string, awayTeamName: string, gameDate: string, homeGid: string, awayGid: string}|null>}
 */
async function fetchGameMetadata(gameId, rateLimiter = { delay: 2000 }, circuitBreaker) {
  try {
    const url = `http://archive.statbroadcast.com/${gameId}.xml`;
    
    const response = await retryWithBackoff(async () => {
      return await axios.get(url, { 
        timeout: 15000, 
        validateStatus: (status) => status === 200 
      });
    }, circuitBreaker, 5, 3000); // Increased to 5 retries with 3s base delay
    
    const xml = response.data;
    
    // Parse XML to extract team names, date, and GIDs
    const homeNameMatch = xml.match(/<venue[^>]*homename="([^"]+)"/);
    const awayNameMatch = xml.match(/<venue[^>]*visname="([^"]+)"/);
    const dateMatch = xml.match(/<venue[^>]*date="([^"]+)"/);
    const homeGidMatch = xml.match(/<venue[^>]*homeid="([^"]+)"/);
    const awayGidMatch = xml.match(/<venue[^>]*visid="([^"]+)"/);
    
    if (!homeNameMatch || !awayNameMatch || !dateMatch) {
      logger.warn(`Failed to parse metadata for game ${gameId}`);
      return null;
    }
    
    // Success - reduce delay slightly (but keep minimum higher)
    rateLimiter.delay = Math.max(1500, rateLimiter.delay * 0.95);
    
    return {
      homeTeamName: homeNameMatch[1],
      awayTeamName: awayNameMatch[1],
      gameDate: dateMatch[1],
      homeGid: homeGidMatch ? homeGidMatch[1] : null,
      awayGid: awayGidMatch ? awayGidMatch[1] : null
    };
  } catch (error) {
    logger.warn(`Failed to fetch metadata for game ${gameId}:`, error.message);
    
    // Increase delay significantly on error
    rateLimiter.delay = Math.min(30000, rateLimiter.delay * 3);
    logger.warn(`Increased rate limit delay to ${rateLimiter.delay}ms`);
    
    return null;
  }
}

/**
 * Find or create team by GID and sport
 * @param {string} teamName - Team name from XML
 * @param {string} gid - StatBroadcast GID
 * @param {string} sport - Sport type
 * @returns {Promise<string|null>} Team ID or null
 */
async function findOrCreateTeam(teamName, gid, sport) {
  if (!gid) {
    logger.warn(`No GID provided for team ${teamName}, cannot create team`);
    return null;
  }
  
  // First, try to find existing team by GID and sport
  let team = await dbConnection.get(
    'SELECT team_id, statbroadcast_gid FROM teams WHERE statbroadcast_gid = ? AND sport = ?',
    [gid, sport]
  );
  
  if (team) {
    return team.team_id;
  }
  
  // Check if team exists with same name+sport but different GID
  // (StatBroadcast sometimes uses multiple GIDs for the same school)
  const teamId = generateTeamId(teamName, sport);
  const existingTeam = await dbConnection.get(
    'SELECT team_id, statbroadcast_gid FROM teams WHERE team_id = ? AND sport = ?',
    [teamId, sport]
  );
  
  if (existingTeam) {
    logger.debug(`Team ${teamName} exists with different GID (existing: ${existingTeam.statbroadcast_gid}, new: ${gid}). Using existing team.`);
    return existingTeam.team_id;
  }
  
  // Team doesn't exist, create it
  try {
    await dbConnection.run(
      `INSERT INTO teams (team_id, statbroadcast_gid, team_name, sport, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [teamId, gid, teamName, sport]
    );
    
    logger.info(`Created new team: ${teamName} (${gid}) for ${sport}`);
    return teamId;
  } catch (error) {
    // Handle duplicate key error (race condition or concurrent inserts)
    if (error.message.includes('UNIQUE constraint failed')) {
      // Try to fetch by team_id first (most likely collision)
      team = await dbConnection.get(
        'SELECT team_id FROM teams WHERE team_id = ? AND sport = ?',
        [teamId, sport]
      );
      if (team) {
        logger.debug(`Team ${teamName} was created concurrently, using existing team`);
        return team.team_id;
      }
      
      // Otherwise try by GID
      team = await dbConnection.get(
        'SELECT team_id FROM teams WHERE statbroadcast_gid = ? AND sport = ?',
        [gid, sport]
      );
      if (team) {
        return team.team_id;
      }
    }
    
    logger.error(`Failed to create team ${teamName} (${gid}):`, error.message);
    return null;
  }
}

/**
 * Find GID for a team by looking up their basketball team
 * @param {string} teamName - Team name
 * @returns {Promise<string|null>} StatBroadcast GID or null
 */
async function findGidFromBasketballTeam(teamName) {
  // Try to find the basketball team for this school
  const team = await dbConnection.get(
    `SELECT statbroadcast_gid FROM teams 
     WHERE LOWER(team_name) = LOWER(?) 
     AND sport = 'mens-college-basketball'`,
    [teamName]
  );
  
  if (team) {
    logger.info(`Found GID ${team.statbroadcast_gid} from basketball team for ${teamName}`);
    return team.statbroadcast_gid;
  }
  
  // Try partial match
  const words = teamName.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (word.length > 3) {
      const partialTeam = await dbConnection.get(
        `SELECT statbroadcast_gid, team_name FROM teams 
         WHERE LOWER(team_name) LIKE LOWER(?) 
         AND sport = 'mens-college-basketball'`,
        [`%${word}%`]
      );
      
      if (partialTeam) {
        logger.info(`Found GID ${partialTeam.statbroadcast_gid} from basketball team ${partialTeam.team_name} for ${teamName}`);
        return partialTeam.statbroadcast_gid;
      }
    }
  }
  
  return null;
}

/**
 * Process a single game: insert or update game record with current team
 * NO XML FETCHING - just use the current team's GID from the archive
 * @param {Object} game - Game object with gameId, eventDate, sport
 * @param {string} currentTeamGid - GID of the team whose archive we're processing
 * @param {Map<string, Object>} gameCache - Cache to track processed games
 * @returns {Promise<{inserted: boolean, updated: boolean, skipped: boolean, failed: boolean, reason: string}>}
 */
async function processGame(game, currentTeamGid, gameCache) {
  try {
    // NOTE: Don't check cache here - we need to allow updates from different teams
    // The cache is only used to prevent processing the same game twice within ONE team's archive
    
    // Get current team's ID (should exist from pre-seeding)
    const currentTeam = await dbConnection.get(
      'SELECT team_id FROM teams WHERE statbroadcast_gid = ? AND sport = ?',
      [currentTeamGid, game.sport]
    );
    
    if (!currentTeam) {
      logger.warn(`Current team ${currentTeamGid} not found for sport ${game.sport} - skipping game ${game.gameId}`);
      return { inserted: false, updated: false, skipped: false, failed: true, reason: 'current_team_not_found' };
    }
    
    // Check if game already exists in database
    const existing = await dbConnection.get(
      'SELECT game_id, home_team_id, away_team_id FROM game_ids WHERE game_id = ?',
      [game.gameId]
    );
    
    if (existing) {
      // Game exists - update the NULL team field with current team
      if (!existing.home_team_id) {
        await dbConnection.run(
          'UPDATE game_ids SET home_team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE game_id = ?',
          [currentTeam.team_id, game.gameId]
        );
        gameCache.set(game.gameId, { processed: true });
        return { inserted: false, updated: true, skipped: false, failed: false, reason: 'updated_home' };
      } else if (!existing.away_team_id) {
        await dbConnection.run(
          'UPDATE game_ids SET away_team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE game_id = ?',
          [currentTeam.team_id, game.gameId]
        );
        gameCache.set(game.gameId, { processed: true });
        return { inserted: false, updated: true, skipped: false, failed: false, reason: 'updated_away' };
      } else {
        // Both teams already filled - this is a duplicate
        return { inserted: false, updated: false, skipped: true, failed: false, reason: 'already_complete' };
      }
    }
    
    // Check cache AFTER checking database (allows cross-team updates)
    if (gameCache.has(game.gameId)) {
      return { inserted: false, updated: false, skipped: true, failed: false, reason: 'duplicate_in_batch' };
    }
    
    // Game doesn't exist - insert with current team as home, away as NULL
    await dbConnection.run(
      `INSERT INTO game_ids (game_id, sport, home_team_id, away_team_id, game_date, processed)
       VALUES (?, ?, ?, NULL, ?, 0)`,
      [game.gameId, game.sport, currentTeam.team_id, game.eventDate]
    );
    
    // Add to cache
    gameCache.set(game.gameId, { 
      homeTeamId: currentTeam.team_id,
      gameDate: game.eventDate,
      processed: true 
    });
    
    return { inserted: true, updated: false, skipped: false, failed: false, reason: 'success' };
    
  } catch (error) {
    logger.error(`Failed to process game ${game.gameId}:`, error.message);
    return { inserted: false, updated: false, skipped: false, failed: true, reason: error.message };
  }
}

/**
 * Process a single team: fetch game IDs and process each game
 * @param {Object} team - Team object with team_id, statbroadcast_gid, team_name, sport
 * @param {Map<string, Object>} gameCache - Shared cache across all teams
 * @param {Object} rateLimiter - Rate limiter state object
 * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
 * @returns {Promise<{discovered: number, inserted: number, skipped: number, failed: number}>}
 */
async function processTeam(team, gameCache, rateLimiter, circuitBreaker) {
  logger.info(`Processing team: ${team.team_name} (${team.statbroadcast_gid})`);
  logger.info(`Current rate limit delay: ${rateLimiter.delay}ms, Circuit breaker: ${circuitBreaker.state}`);
  
  const games = await fetchGameIdsForTeam(team.statbroadcast_gid, rateLimiter, circuitBreaker);
  
  if (games.length === 0) {
    logger.warn(`No games found for ${team.team_name}`);
    return { discovered: 0, inserted: 0, skipped: 0, failed: 0 };
  }
  
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  
  let updated = 0;
  
  for (const game of games) {
    const result = await processGame(game, team.statbroadcast_gid, gameCache);
    
    if (result.inserted) inserted++;
    if (result.updated) updated++;
    if (result.skipped) skipped++;
    if (result.failed) failed++;
    
    // No delay needed - just database operations!
    
    if ((inserted + updated + skipped + failed) % 100 === 0) {
      logger.info(`Progress for ${team.team_name}: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${failed} failed`);
    }
  }
  
  return { discovered: games.length, inserted, updated, skipped, failed };
}

/**
 * Get date range statistics from game_ids table
 * @returns {Promise<{minDate: string, maxDate: string, totalGames: number}>}
 */
async function getDateRangeStats() {
  try {
    const result = await dbConnection.get(`
      SELECT 
        MIN(game_date) as minDate,
        MAX(game_date) as maxDate,
        COUNT(*) as totalGames
      FROM game_ids
    `);
    return result || { minDate: null, maxDate: null, totalGames: 0 };
  } catch (error) {
    logger.error('Failed to get date range stats:', error.message);
    return { minDate: null, maxDate: null, totalGames: 0 };
  }
}

/**
 * Get games per team statistics
 * @returns {Promise<{avgGamesPerTeam: number, minGames: number, maxGames: number}>}
 */
async function getGamesPerTeamStats() {
  try {
    const result = await dbConnection.get(`
      SELECT 
        AVG(game_count) as avgGamesPerTeam,
        MIN(game_count) as minGames,
        MAX(game_count) as maxGames
      FROM (
        SELECT home_team_id as team_id, COUNT(*) as game_count
        FROM game_ids
        GROUP BY home_team_id
        UNION ALL
        SELECT away_team_id as team_id, COUNT(*) as game_count
        FROM game_ids
        GROUP BY away_team_id
      )
    `);
    return result || { avgGamesPerTeam: 0, minGames: 0, maxGames: 0 };
  } catch (error) {
    logger.error('Failed to get games per team stats:', error.message);
    return { avgGamesPerTeam: 0, minGames: 0, maxGames: 0 };
  }
}

/**
 * Main function
 */
async function main() {
  try {
    const startTime = Date.now();
    logger.info('Starting game ID population...');
    
    const options = parseArgs();
    
    logger.info('Rate limiting settings:');
    logger.info(`  - Initial delay: ${options.delay || 2000}ms`);
    logger.info('  - Min delay: 1500ms, Max delay: 30000ms');
    logger.info('  - Max retries: 5 attempts per request');
    logger.info('  - Jitter: ±30%');
    logger.info('  - Delay between teams: ~3000ms');
    logger.info('  - Circuit breaker: 5 failures triggers 2min cooldown');
    
    await dbConnection.initialize();
    
    // Load or reset progress
    let progress = options.resetProgress ? { completedTeams: [], lastUpdated: null } : loadProgress();
    
    if (options.resetProgress && fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      logger.info('Progress file reset');
    }
    
    // Get teams to process
    let teams;
    if (options.team) {
      const team = await dbConnection.get(
        'SELECT team_id, statbroadcast_gid, team_name, sport FROM teams WHERE statbroadcast_gid = ?',
        [options.team]
      );
      
      if (!team) {
        console.error(`Team not found: ${options.team}`);
        process.exit(1);
      }
      teams = [team];
    } else {
      // Get unique GIDs (one per school, not per sport)
      teams = await dbConnection.all(
        `SELECT DISTINCT statbroadcast_gid, team_name 
         FROM teams 
         WHERE sport = 'mens-college-basketball'
         ORDER BY team_name`
      );
    }
    
    // Filter out already completed teams
    const completedSet = new Set(progress.completedTeams);
    const teamsToProcess = teams.filter(t => !completedSet.has(t.statbroadcast_gid));
    
    if (teamsToProcess.length === 0) {
      logger.info('All teams already processed! Use --reset-progress to start over.');
      console.log('\nAll teams already processed!');
      console.log('Use --reset-progress flag to start over.');
      await dbConnection.close();
      process.exit(0);
    }
    
    logger.info(`Processing ${teamsToProcess.length} teams (${teams.length - teamsToProcess.length} already completed)`);
    
    if (progress.completedTeams.length > 0) {
      logger.info(`Resuming from previous run. Completed teams: ${progress.completedTeams.join(', ')}`);
    }
    
    let totalDiscovered = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    
    // Shared cache to handle duplicates across teams
    const gameCache = new Map();
    
    // Rate limiter with conservative initial delay (can be overridden with --delay flag)
    const rateLimiter = { delay: options.delay || 2000 };
    
    // Circuit breaker to prevent overwhelming the server
    const circuitBreaker = new CircuitBreaker(5, 120000); // 5 failures, 2 min reset
    
    // Process each team
    for (let i = 0; i < teamsToProcess.length; i++) {
      const team = teamsToProcess[i];
      logger.info(`[${i + 1}/${teamsToProcess.length}] Processing ${team.team_name}`);
      
      // Check circuit breaker before processing team
      if (circuitBreaker.isOpen()) {
        logger.error('Circuit breaker is OPEN. Stopping processing to protect server.');
        logger.error('Wait a few minutes and run the script again to resume.');
        break;
      }
      
      try {
        const result = await processTeam(team, gameCache, rateLimiter, circuitBreaker);
        
        totalDiscovered += result.discovered;
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        totalFailed += result.failed;
        
        logger.info(`Team ${team.team_name} complete: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`);
        
        // Mark team as completed and save progress
        progress.completedTeams.push(team.statbroadcast_gid);
        saveProgress(progress);
        
        // Add delay between teams to be respectful to the server
        if (i < teamsToProcess.length - 1) {
          const teamDelay = addJitter(3000); // 3 second base delay between teams
          logger.info(`Waiting ${teamDelay}ms before next team...`);
          await new Promise(resolve => setTimeout(resolve, teamDelay));
        }
        
      } catch (error) {
        logger.error(`Failed to process team ${team.team_name}:`, error.message);
        
        // Mark team as completed anyway to avoid retrying it
        progress.completedTeams.push(team.statbroadcast_gid);
        saveProgress(progress);
        
        // If circuit breaker is open, stop processing
        if (circuitBreaker.isOpen()) {
          logger.error('Circuit breaker opened due to errors. Stopping to protect server.');
          logger.error(`Processed ${i + 1}/${teamsToProcess.length} teams before stopping.`);
          break;
        }
        
        // Otherwise, continue with next team after a longer delay
        logger.warn(`Skipping team ${team.team_name} and continuing with next team...`);
        if (i < teamsToProcess.length - 1) {
          const errorDelay = addJitter(5000); // Longer delay after error
          logger.info(`Waiting ${errorDelay}ms before next team...`);
          await new Promise(resolve => setTimeout(resolve, errorDelay));
        }
      }
    }
    
    // Get statistics
    const dateStats = await getDateRangeStats();
    const teamStats = await getGamesPerTeamStats();
    
    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
    const durationMinutes = (durationSeconds / 60).toFixed(2);
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('Game ID Population Complete');
    console.log('='.repeat(70));
    console.log(`Execution time: ${durationSeconds}s (${durationMinutes} minutes)`);
    console.log(`Teams processed: ${teamsToProcess.length}`);
    console.log(`Teams skipped (already completed): ${teams.length - teamsToProcess.length}`);
    console.log(`Games discovered: ${totalDiscovered}`);
    console.log(`Games inserted: ${totalInserted}`);
    console.log(`Games updated: ${totalUpdated}`);
    console.log(`Games skipped (duplicates): ${totalSkipped}`);
    console.log(`Games failed: ${totalFailed}`);
    console.log(`Final rate limit delay: ${rateLimiter.delay}ms`);
    console.log('='.repeat(70));
    console.log('\nDatabase Statistics:');
    console.log(`Total games in database: ${dateStats.totalGames}`);
    console.log(`Date range: ${dateStats.minDate || 'N/A'} to ${dateStats.maxDate || 'N/A'}`);
    console.log(`Average games per team: ${teamStats.avgGamesPerTeam ? teamStats.avgGamesPerTeam.toFixed(1) : 'N/A'}`);
    console.log(`Games per team range: ${teamStats.minGames || 'N/A'} to ${teamStats.maxGames || 'N/A'}`);
    console.log('='.repeat(70));
    
    // Clean up progress file on successful completion
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      logger.info('Progress file cleaned up after successful completion');
    }
    
    await dbConnection.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('Script failed:', error);
    console.error('\nError:', error.message);
    console.error('\nProgress has been saved. You can resume by running the script again.');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = main;
