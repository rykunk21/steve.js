const axios = require('axios');
const { parse } = require('node-html-parser');
const logger = require('../../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Client for interacting with ESPN Core API and scraping betting odds
 * Supports NFL, NBA, NHL, NCAA Basketball, and NCAA Football
 */
class ESPNAPIClient {
  constructor(config = {}) {
    this.baseUrl = 'https://sports.core.api.espn.com/v2/sports';
    this.timeout = config.timeout || 15000; // 15 seconds
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000; // 1 second

    // Cache directory and settings
    this.cacheDir = config.cacheDir || path.join(process.cwd(), 'data', 'sports-cache');
    this.cacheTimeout = config.cacheTimeout || 300000; // 5 minutes

    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = config.minRequestInterval || 500; // 500ms between requests

    // Daily query limits to avoid overuse
    this.dailyQueryLimit = config.dailyQueryLimit || 50; // 50 queries per sport per day
    this.queryCountFile = path.join(this.cacheDir, 'daily-queries.json');

    // Supported sports mapping to ESPN API
    this.sportsEndpoints = {
      'nfl': {
        id: 'football',
        league: 'nfl',
        name: 'NFL',
        hasScheduleEndpoint: true,
        hasOddsEndpoint: true
      },
      'nba': {
        id: 'basketball',
        league: 'nba',
        name: 'NBA',
        hasScheduleEndpoint: true,
        hasOddsEndpoint: true
      },
      'nhl': {
        id: 'hockey',
        league: 'nhl',
        name: 'NHL',
        hasScheduleEndpoint: true,
        hasOddsEndpoint: true
      },
      'ncaa_basketball': {
        id: 'basketball',
        league: 'mens-college-basketball',
        name: 'NCAA Basketball',
        hasScheduleEndpoint: true,
        hasOddsEndpoint: true
      },
      'ncaa_football': {
        id: 'football',
        league: 'college-football',
        name: 'NCAA Football',
        hasScheduleEndpoint: true,
        hasOddsEndpoint: true
      }
    };

    this.initializeCache();
  }

  /**
   * Initialize cache directory and daily query tracking
   */
  async initializeCache() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      logger.info('Sports cache directory initialized', { cacheDir: this.cacheDir });
    } catch (error) {
      logger.error('Failed to initialize cache directory', { error: error.message });
    }
  }

  /**
   * Get available sports
   * @returns {Array} - Array of available sports
   */
  getAvailableSports() {
    return Object.entries(this.sportsEndpoints).map(([key, config]) => ({
      key,
      title: config.name,
      hasScheduleEndpoint: config.hasScheduleEndpoint,
      hasOddsEndpoint: config.hasOddsEndpoint
    }));
  }

  /**
   * Scrape NCAA Basketball schedule from ESPN HTML page
   * This gets ALL games for today, bypassing API limits
   * @returns {Promise<Array>} - Array of game objects
   */
  async scrapeNCAABasketballSchedule() {
    try {
      logger.info('Scraping NCAA Basketball schedule from ESPN HTML');
      
      const url = 'https://www.espn.com/mens-college-basketball/schedule';
      const response = await this.makeRequest(url);
      const html = response.data;
      
      const root = parse(html);
      const games = [];
      
      // Use the specific selector for the schedule table
      const table = root.querySelector('#fittPageContainer > div.pageContent > div.page-container.cf > div > div > div:nth-child(1) > section > div > div:nth-child(4) > div > div > div:nth-child(1) > div.flex > div > div.Table__Scroller > table');
      
      if (!table) {
        logger.warn('Could not find schedule table with specific selector, trying fallback selectors');
        
        // Try fallback selectors
        const fallbackSelectors = [
          '.Table__Scroller table',
          'table.Table',
          '.ScheduleTables table',
          'table'
        ];
        
        let foundTable = null;
        for (const selector of fallbackSelectors) {
          foundTable = root.querySelector(selector);
          if (foundTable) {
            logger.info('Found table with fallback selector', { selector });
            break;
          }
        }
        
        if (!foundTable) {
          logger.error('No schedule table found with any selector');
          return games;
        }
      }
      
      // Get all rows from tbody
      const tbody = table ? table.querySelector('tbody') : null;
      if (!tbody) {
        logger.warn('No tbody found in table');
        return games;
      }
      
      const gameRows = tbody.querySelectorAll('tr');
      logger.info('Found game rows in schedule table', { count: gameRows.length });
      
      for (const row of gameRows) {
        try {
          // Skip header rows
          const headerCell = row.querySelector('th');
          if (headerCell) continue;
          
          // Extract game information
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) continue;
          
          // First cell typically contains matchup info
          const matchupCell = cells[0];
          const teamLinks = matchupCell.querySelectorAll('a[href*="/team/"]');
          
          if (teamLinks.length < 2) {
            logger.debug('Row does not have 2 team links, skipping');
            continue;
          }
          
          const awayTeam = teamLinks[0].text.trim();
          const homeTeam = teamLinks[1].text.trim();
          
          // Get game ID from any game link
          let gameId = null;
          const gameLink = row.querySelector('a[href*="/game/"]');
          if (gameLink) {
            const href = gameLink.getAttribute('href');
            const idMatch = href.match(/gameId[\/=](\d+)/);
            if (idMatch) {
              gameId = idMatch[1];
            }
          }
          
          // Get time from cells (usually in second or third cell)
          let gameTime = null;
          for (const cell of cells) {
            const cellText = cell.text.trim();
            // Look for time patterns like "7:00 PM" or "12:00 PM"
            if (cellText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)) {
              gameTime = cellText;
              break;
            }
          }
          
          if (!awayTeam || !homeTeam) {
            logger.debug('Missing team names, skipping row');
            continue;
          }
          
          // Create game object
          const game = {
            id: gameId || `${awayTeam.replace(/\s+/g, '_')}_at_${homeTeam.replace(/\s+/g, '_')}`,
            sport: 'ncaa_basketball',
            displayName: `${awayTeam} at ${homeTeam}`,
            shortName: `${awayTeam} @ ${homeTeam}`,
            date: this.parseGameTime(gameTime),
            status: 'scheduled',
            teams: {
              away: {
                name: awayTeam,
                abbreviation: this.extractTeamAbbreviation(awayTeam)
              },
              home: {
                name: homeTeam,
                abbreviation: this.extractTeamAbbreviation(homeTeam)
              }
            },
            venue: null,
            espnUrl: gameId ? `https://www.espn.com/mens-college-basketball/game/_/gameId/${gameId}` : null,
            commenceTime: this.parseGameTime(gameTime)
          };
          
          games.push(game);
          
          logger.debug('Parsed game', {
            awayTeam,
            homeTeam,
            gameTime,
            gameId
          });
          
        } catch (error) {
          logger.debug('Failed to parse game row', { error: error.message });
        }
      }
      
      logger.info('Successfully scraped NCAA Basketball schedule', {
        gamesFound: games.length
      });
      
      return games;
      
    } catch (error) {
      logger.error('Failed to scrape NCAA Basketball schedule', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Parse game time string to Date object
   * @param {string} timeStr - Time string like "7:00 PM"
   * @returns {Date} - Parsed date
   */
  parseGameTime(timeStr) {
    if (!timeStr) return new Date();
    
    const today = new Date();
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const period = timeMatch[3].toUpperCase();
      
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }
      
      const gameDate = new Date(today);
      gameDate.setHours(hours, minutes, 0, 0);
      
      return gameDate;
    }
    
    return today;
  }

  /**
   * Extract team abbreviation from team name
   * @param {string} teamName - Full team name
   * @returns {string} - Abbreviated name
   */
  extractTeamAbbreviation(teamName) {
    // Simple abbreviation: take first 4 letters of last word
    const words = teamName.trim().split(/\s+/);
    const lastWord = words[words.length - 1];
    return lastWord.substring(0, 4).toUpperCase();
  }

  /**
   * Get upcoming games for a specific sport
   * @param {string} sport - Sport key (nfl, nba, nhl, ncaa_basketball, ncaa_football)
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Array of game objects
   */
  async getUpcomingGames(sport, options = {}) {
    try {
      const sportConfig = this.sportsEndpoints[sport.toLowerCase()];
      if (!sportConfig) {
        throw new Error(`Unsupported sport: ${sport}. Supported sports: ${Object.keys(this.sportsEndpoints).join(', ')}`);
      }

      // For NCAA basketball, use the Scoreboard API which has better coverage
      if (sport === 'ncaa_basketball') {
        logger.info('Using ESPN Scoreboard API for NCAA Basketball to get complete schedule');
        
        const today = new Date();
        const todayFormatted = this.formatDate(today);
        
        // Use the public scoreboard API
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.id}/${sportConfig.league}/scoreboard`;
        const params = {
          dates: todayFormatted,
          limit: 500, // Increased limit to handle busy NCAA basketball days
          groups: 50 // Get all Division I conferences
        };
        
        logger.info('Fetching NCAA basketball from Scoreboard API', { url, params });
        
        const response = await this.makeRequest(url, { params });
        
        // Scoreboard API returns events directly
        const events = response.data.events || [];
        
        // Check if response includes pagination info
        const hasMoreGames = response.data.page && response.data.page.totalPages > 1;
        const currentPage = response.data.page?.number || 1;
        const totalPages = response.data.page?.totalPages || 1;
        const totalItems = response.data.page?.totalItems || events.length;
        
        // Log detailed response info to verify we're getting all games
        logger.info('Scoreboard API response details', { 
          eventsReturned: events.length,
          requestedLimit: params.limit,
          totalItems: totalItems,
          currentPage: currentPage,
          totalPages: totalPages,
          hasMoreGames: hasMoreGames,
          possiblyTruncated: events.length >= params.limit,
          responseKeys: Object.keys(response.data)
        });
        
        // Warn if we're hitting the limit or if there are more pages
        if (events.length >= params.limit * 0.9) {
          logger.warn('NCAA Basketball game count approaching limit - may not have all games', {
            eventsReturned: events.length,
            limit: params.limit,
            totalItems: totalItems
          });
        }
        
        if (hasMoreGames) {
          logger.warn('Scoreboard API indicates more games available on additional pages', {
            currentPage: currentPage,
            totalPages: totalPages,
            eventsOnThisPage: events.length,
            totalItems: totalItems
          });
        }
        
        // Transform scoreboard events to our format
        const games = events.map(event => {
          const competition = event.competitions?.[0];
          const competitors = competition?.competitors || [];
          
          const homeTeam = competitors.find(c => c.homeAway === 'home');
          const awayTeam = competitors.find(c => c.homeAway === 'away');
          
          // Extract betting odds from ESPN API
          const odds = this.extractOddsFromCompetition(competition);
          
          return {
            id: event.id,
            sport: 'ncaa_basketball',
            name: event.name,
            shortName: event.shortName,
            date: new Date(event.date),
            status: event.status?.type?.name || 'scheduled',
            teams: {
              home: homeTeam ? {
                id: homeTeam.team?.id,
                name: homeTeam.team?.displayName,
                abbreviation: homeTeam.team?.abbreviation,
                logo: homeTeam.team?.logo,
                score: homeTeam.score,
                color: homeTeam.team?.color
              } : null,
              away: awayTeam ? {
                id: awayTeam.team?.id,
                name: awayTeam.team?.displayName,
                abbreviation: awayTeam.team?.abbreviation,
                logo: awayTeam.team?.logo,
                score: awayTeam.score,
                color: awayTeam.team?.color
              } : null
            },
            venue: competition?.venue?.fullName,
            espnUrl: `https://www.espn.com/mens-college-basketball/game/_/gameId/${event.id}`,
            displayName: event.shortName || event.name,
            commenceTime: new Date(event.date),
            odds: odds // Include extracted odds data
          };
        });
        
        // Cache the results
        await this.cacheScheduleData(sport, games);
        
        logger.info('Successfully fetched NCAA basketball games', { count: games.length });
        
        return games;
      }

      // For other sports, use the API
      // Check if we can make a schedule query today
      if (!this.canMakeScheduleQuery(sport)) {
        logger.warn('Daily schedule query limit reached', { sport });
        // Try to return cached data
        const cachedData = await this.getCachedSchedule(sport);
        if (cachedData) {
          return cachedData;
        }
        throw new Error(`Daily query limit reached for ${sport} schedule. Try again tomorrow.`);
      }

      await this.enforceRateLimit();

      const today = new Date();
      // Only fetch today's games by using the same date for start and end
      const todayFormatted = this.formatDate(today);

      const url = `${this.baseUrl}/${sportConfig.id}/leagues/${sportConfig.league}/events`;
      const params = {
        dates: todayFormatted, // Single date to get only today's games
        limit: options.limit || 100 // Increase limit to get more games for busy days
      };

      logger.info('Fetching upcoming games from ESPN API', {
        sport,
        url,
        params
      });

      const response = await this.makeRequest(url, { params });
      
      // Log pagination info to understand API limits
      logger.info('ESPN API response metadata', {
        sport,
        itemCount: response.data.items?.length || 0,
        count: response.data.count,
        pageIndex: response.data.pageIndex,
        pageSize: response.data.pageSize,
        pageCount: response.data.pageCount,
        hasNextPage: !!response.data.nextPage
      });
      
      // Collect all items from all pages
      let allItems = [...(response.data.items || [])];
      let currentData = response.data;
      
      // Fetch additional pages if they exist (up to 5 pages to avoid excessive requests)
      let pagesFetched = 1;
      const maxPages = 5;
      
      while (currentData.nextPage && pagesFetched < maxPages) {
        try {
          logger.info('Fetching next page of games', {
            sport,
            currentPage: pagesFetched,
            nextPageUrl: currentData.nextPage.$ref
          });
          
          await this.enforceRateLimit();
          const nextResponse = await this.makeRequest(currentData.nextPage.$ref);
          currentData = nextResponse.data;
          
          if (currentData.items) {
            allItems = allItems.concat(currentData.items);
            pagesFetched++;
            
            logger.info('Fetched additional page', {
              sport,
              page: pagesFetched,
              itemsOnPage: currentData.items.length,
              totalItemsSoFar: allItems.length
            });
          }
        } catch (error) {
          logger.warn('Failed to fetch next page, stopping pagination', {
            sport,
            page: pagesFetched + 1,
            error: error.message
          });
          break;
        }
      }
      
      logger.info('Completed fetching all pages', {
        sport,
        totalPages: pagesFetched,
        totalItems: allItems.length
      });
      
      // Create a modified response data with all items
      const combinedData = {
        ...response.data,
        items: allItems
      };
      
      const games = await this.normalizeESPNGameData(combinedData, sport);

      // Cache the results
      await this.cacheScheduleData(sport, games);

      // Increment query count
      await this.incrementQueryCount(sport, 'schedule');

      logger.info('Successfully fetched upcoming games', {
        sport,
        gameCount: games.length
      });

      return games;

    } catch (error) {
      logger.error('Failed to fetch upcoming games', {
        sport,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get betting odds for a specific game by scraping HTML
   * @param {string} sport - Sport key
   * @param {string} gameId - ESPN game ID
   * @returns {Promise<Object>} - Betting odds object
   */
  async getGameOdds(sport, gameId) {
    try {
      const sportConfig = this.sportsEndpoints[sport.toLowerCase()];
      if (!sportConfig) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      // Check if we can make an odds query today
      if (!this.canMakeOddsQuery(sport)) {
        logger.warn('Daily odds query limit reached', { sport, gameId });
        throw new Error(`Daily query limit reached for ${sport} odds. Try again tomorrow.`);
      }

      await this.enforceRateLimit();

      // ESPN game page URL for scraping odds
      const gameUrl = `https://www.espn.com/${sportConfig.id}/${sportConfig.league}/game/_/gameId/${gameId}`;

      logger.info('Scraping betting odds from ESPN', {
        sport,
        gameId,
        gameUrl
      });

      const response = await this.makeRequest(gameUrl);
      const odds = this.parseOddsFromHTML(response.data, gameId);

      // Increment query count
      await this.incrementQueryCount(sport, 'odds');

      logger.info('Successfully scraped betting odds', {
        sport,
        gameId,
        hasOdds: !!odds
      });

      return odds;

    } catch (error) {
      logger.error('Failed to scrape game odds', {
        sport,
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Parse betting odds from ESPN HTML
   * @param {string} html - HTML content
   * @param {string} gameId - Game ID for context
   * @returns {Object} - Parsed odds object
   */
  parseOddsFromHTML(html, gameId) {
    try {
      const root = parse(html);

      // Look for betting odds sections in ESPN HTML
      const oddsSection = root.querySelector('.odds-section, .betting-odds, [data-module="Odds"]');

      if (!oddsSection) {
        logger.debug('No odds section found in HTML', { gameId });
        return null;
      }

      const odds = {
        gameId,
        moneyline: {},
        spread: {},
        total: {},
        lastUpdated: new Date(),
        source: 'ESPN'
      };

      // Parse moneyline odds
      const moneylineElements = oddsSection.querySelectorAll('.moneyline, [data-bet-type="moneyline"]');
      moneylineElements.forEach(element => {
        const team = element.getAttribute('data-team') || this.extractTeamFromElement(element);
        const value = this.extractOddsValue(element.textContent);
        if (team && value) {
          odds.moneyline[team] = value;
        }
      });

      // Parse spread odds
      const spreadElements = oddsSection.querySelectorAll('.spread, [data-bet-type="spread"]');
      spreadElements.forEach(element => {
        const team = element.getAttribute('data-team') || this.extractTeamFromElement(element);
        const spread = this.extractSpreadValue(element.textContent);
        const oddsValue = this.extractOddsValue(element.textContent);
        if (team && spread !== null) {
          odds.spread[team] = { spread, odds: oddsValue };
        }
      });

      // Parse total (over/under) odds
      const totalElements = oddsSection.querySelectorAll('.total, [data-bet-type="total"]');
      if (totalElements.length > 0) {
        const totalText = totalElements[0].textContent;
        const totalValue = this.extractTotalValue(totalText);
        const overOdds = this.extractOddsValue(totalText, 'over');
        const underOdds = this.extractOddsValue(totalText, 'under');

        if (totalValue !== null) {
          odds.total = {
            value: totalValue,
            over: overOdds,
            under: underOdds
          };
        }
      }

      return Object.keys(odds.moneyline).length > 0 ||
        Object.keys(odds.spread).length > 0 ||
        odds.total.value ? odds : null;

    } catch (error) {
      logger.error('Failed to parse odds from HTML', {
        gameId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Extract team name from HTML element
   * @param {Object} element - HTML element
   * @returns {string} - Team name
   */
  extractTeamFromElement(element) {
    // Look for team indicators in class names or nearby elements
    const classList = element.getAttribute('class') || '';
    const parentClass = element.parentNode?.getAttribute('class') || '';

    if (classList.includes('home') || parentClass.includes('home')) {
      return 'home';
    }
    if (classList.includes('away') || parentClass.includes('away')) {
      return 'away';
    }

    return null;
  }

  /**
   * Extract odds value from text
   * @param {string} text - Text containing odds
   * @param {string} type - Type of odds (optional)
   * @returns {number} - Odds value
   */
  extractOddsValue(text, type = null) {
    if (!text) return null;

    // Look for American odds format (+150, -110, etc.)
    const oddsMatch = text.match(/([+-]\d+)/g);
    if (oddsMatch) {
      if (type === 'over' && oddsMatch.length > 1) {
        return parseInt(oddsMatch[0]);
      }
      if (type === 'under' && oddsMatch.length > 1) {
        return parseInt(oddsMatch[1]);
      }
      return parseInt(oddsMatch[0]);
    }

    return null;
  }

  /**
   * Extract spread value from text
   * @param {string} text - Text containing spread
   * @returns {number} - Spread value
   */
  extractSpreadValue(text) {
    if (!text) return null;

    // Look for spread format (-3.5, +7, etc.)
    const spreadMatch = text.match(/([+-]?\d+\.?\d*)/);
    if (spreadMatch) {
      return parseFloat(spreadMatch[1]);
    }

    return null;
  }

  /**
   * Extract total value from text
   * @param {string} text - Text containing total
   * @returns {number} - Total value
   */
  extractTotalValue(text) {
    if (!text) return null;

    // Look for total format (O 45.5, U 45.5, etc.)
    const totalMatch = text.match(/(?:O|U|Over|Under)?\s*(\d+\.?\d*)/i);
    if (totalMatch) {
      return parseFloat(totalMatch[1]);
    }

    return null;
  }

  /**
   * Normalize ESPN game data
   * @param {Object} espnData - Raw ESPN API response
   * @param {string} sport - Sport type
   * @returns {Promise<Array>} - Normalized game objects
   */
  async normalizeESPNGameData(espnData, sport) {
    if (!espnData || !espnData.items) {
      logger.warn('Invalid ESPN game data format received', { espnData });
      return [];
    }

    const games = [];

    // Process games in parallel batches for better performance
    const maxConcurrent = 3; // Limit concurrent requests to avoid overwhelming API
    
    for (let i = 0; i < espnData.items.length; i += maxConcurrent) {
      const batch = espnData.items.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(async (item) => {
        try {
          // Resolve the full game data from $ref URL
          const gameData = await this.resolveESPNReference(item.$ref);
          if (!gameData) return null;

          // Extract betting odds from competition data
          const competition = gameData.competitions?.[0];
          const odds = this.extractOddsFromCompetition(competition);
          
          const normalizedGame = {
            id: gameData.id,
            sport: sport,
            name: gameData.name,
            shortName: gameData.shortName,
            date: new Date(gameData.date),
            status: gameData.status?.type?.name || 'scheduled',
            competitions: gameData.competitions || [],
            // Extract team information
            teams: await this.extractTeamInfo(gameData.competitions),
            venue: gameData.competitions?.[0]?.venue?.fullName,
            // Additional ESPN-specific fields
            espnUrl: `https://www.espn.com/${this.sportsEndpoints[sport].id}/${this.sportsEndpoints[sport].league}/game/_/gameId/${gameData.id}`,
            displayName: this.createDisplayName(gameData),
            commenceTime: new Date(gameData.date),
            odds: odds // Include extracted odds data
          };

          return normalizedGame;

        } catch (error) {
          logger.warn('Failed to normalize ESPN game data', {
            itemRef: item.$ref,
            error: error.message
          });
          return null;
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Add successful results
      batchResults.forEach(game => {
        if (game) games.push(game);
      });
    }

    return games;
  }

  /**
   * Resolve ESPN $ref URL to get full data
   * @param {string} refUrl - ESPN $ref URL
   * @returns {Promise<Object>} - Resolved data
   */
  async resolveESPNReference(refUrl) {
    try {
      await this.enforceRateLimit();
      const response = await this.makeRequest(refUrl);
      return response.data;
    } catch (error) {
      logger.warn('Failed to resolve ESPN reference', {
        refUrl,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Extract team information from competitions
   * @param {Array} competitions - ESPN competitions array
   * @returns {Promise<Object>} - Team information
   */
  async extractTeamInfo(competitions) {
    if (!competitions || competitions.length === 0) {
      return { home: null, away: null };
    }

    const competition = competitions[0];
    const competitors = competition.competitors || [];

    const teams = { home: null, away: null };

    for (const competitor of competitors) {
      try {
        const teamData = competitor.team ?
          await this.resolveESPNReference(competitor.team.$ref) : null;

        if (teamData) {
          const teamInfo = {
            id: teamData.id,
            name: teamData.displayName,
            abbreviation: teamData.abbreviation,
            logo: teamData.logos?.[0]?.href,
            color: teamData.color,
            score: competitor.score
          };

          if (competitor.homeAway === 'home') {
            teams.home = teamInfo;
          } else {
            teams.away = teamInfo;
          }
        }
      } catch (error) {
        logger.warn('Failed to extract team info', {
          competitor: competitor.id,
          error: error.message
        });
      }
    }

    return teams;
  }

  /**
   * Create display name for game
   * @param {Object} gameData - ESPN game data
   * @returns {string} - Display name
   */
  createDisplayName(gameData) {
    if (gameData.shortName) {
      return gameData.shortName;
    }
    if (gameData.name) {
      return gameData.name;
    }
    return `Game ${gameData.id}`;
  }

  /**
   * Make HTTP request with retry logic
   * @param {string} url - Request URL
   * @param {Object} config - Axios config
   * @returns {Promise<Object>} - Response data
   */
  async makeRequest(url, config = {}) {
    let lastError;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await axios({
          url,
          timeout: this.timeout,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          ...config
        });

        if (response.status === 200) {
          return response;
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      } catch (error) {
        lastError = error;

        logger.warn('ESPN API request failed', {
          attempt,
          maxAttempts: this.retryAttempts,
          url: url.substring(0, 100) + '...',
          error: error.message
        });

        // Don't retry on client errors (4xx)
        if (error.response?.status >= 400 && error.response?.status < 500) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Enforce rate limiting between requests
   */
  async enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      logger.debug('Rate limiting: waiting before next request', { waitTime });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Format date for ESPN API using local timezone
   * @param {Date} date - Date to format
   * @returns {string} - Formatted date (YYYYMMDD)
   */
  formatDate(date) {
    // Use local date instead of UTC to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() is 0-based
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Check if we can make a schedule query today
   * @param {string} sport - Sport key
   * @returns {boolean} - Whether we can make a query
   */
  canMakeScheduleQuery(sport) {
    const queryCount = this.getDailyQueryCount(sport);
    return queryCount.schedule < this.dailyQueryLimit;
  }

  /**
   * Check if we can make an odds query today
   * @param {string} sport - Sport key
   * @returns {boolean} - Whether we can make a query
   */
  canMakeOddsQuery(sport) {
    const queryCount = this.getDailyQueryCount(sport);
    return queryCount.odds < this.dailyQueryLimit;
  }

  /**
   * Get daily query count for a sport
   * @param {string} sport - Sport key
   * @returns {Object} - Query counts
   */
  getDailyQueryCount(sport) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const queryData = this.loadQueryData();

      if (!queryData[today]) {
        queryData[today] = {};
      }

      if (!queryData[today][sport]) {
        queryData[today][sport] = { schedule: 0, odds: 0 };
      }

      return queryData[today][sport];
    } catch (error) {
      logger.warn('Failed to get daily query count', { sport, error: error.message });
      return { schedule: 0, odds: 0 };
    }
  }

  /**
   * Get daily query status for all sports
   * @returns {Object} - Query status for all sports
   */
  getDailyQueryStatus() {
    const status = {};

    Object.keys(this.sportsEndpoints).forEach(sport => {
      const queryCount = this.getDailyQueryCount(sport);
      status[sport] = {
        canQuerySchedule: queryCount.schedule < this.dailyQueryLimit,
        canQueryOdds: queryCount.odds < this.dailyQueryLimit,
        scheduleQueries: queryCount.schedule,
        oddsQueries: queryCount.odds,
        limit: this.dailyQueryLimit
      };
    });

    return status;
  }

  /**
   * Increment query count
   * @param {string} sport - Sport key
   * @param {string} type - Query type (schedule or odds)
   */
  async incrementQueryCount(sport, type) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const queryData = this.loadQueryData();

      if (!queryData[today]) {
        queryData[today] = {};
      }

      if (!queryData[today][sport]) {
        queryData[today][sport] = { schedule: 0, odds: 0 };
      }

      queryData[today][sport][type]++;

      await this.saveQueryData(queryData);

      logger.debug('Incremented query count', {
        sport,
        type,
        newCount: queryData[today][sport][type]
      });

    } catch (error) {
      logger.error('Failed to increment query count', {
        sport,
        type,
        error: error.message
      });
    }
  }

  /**
   * Load query data from file
   * @returns {Object} - Query data
   */
  loadQueryData() {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.queryCountFile)) {
        const data = fs.readFileSync(this.queryCountFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.warn('Failed to load query data', { error: error.message });
    }

    return {};
  }

  /**
   * Save query data to file
   * @param {Object} queryData - Query data to save
   */
  async saveQueryData(queryData) {
    try {
      await fs.writeFile(this.queryCountFile, JSON.stringify(queryData, null, 2));
    } catch (error) {
      logger.error('Failed to save query data', { error: error.message });
    }
  }

  /**
   * Cache schedule data
   * @param {string} sport - Sport key
   * @param {Array} games - Games data
   */
  async cacheScheduleData(sport, games) {
    try {
      const cacheFile = path.join(this.cacheDir, `${sport}-schedule.json`);
      const cacheData = {
        timestamp: Date.now(),
        sport,
        games
      };

      await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));

      logger.debug('Cached schedule data', {
        sport,
        gameCount: games.length,
        cacheFile
      });

    } catch (error) {
      logger.error('Failed to cache schedule data', {
        sport,
        error: error.message
      });
    }
  }

  /**
   * Get cached schedule data
   * @param {string} sport - Sport key
   * @returns {Promise<Array|null>} - Cached games or null
   */
  async getCachedSchedule(sport) {
    try {
      const cacheFile = path.join(this.cacheDir, `${sport}-schedule.json`);
      const data = await fs.readFile(cacheFile, 'utf8');
      const cacheData = JSON.parse(data);

      // Check if cache is still valid
      if (Date.now() - cacheData.timestamp < this.cacheTimeout) {
        logger.debug('Using cached schedule data', {
          sport,
          gameCount: cacheData.games.length
        });
        return cacheData.games;
      }

    } catch (error) {
      logger.debug('No valid cached schedule data found', {
        sport,
        error: error.message
      });
    }

    return null;
  }

  /**
   * Clear old cache files
   * @param {number} maxAgeHours - Maximum age in hours (default: 24)
   */
  async clearOldCache(maxAgeHours = 24) {
    try {
      const files = await fs.readdir(this.cacheDir);
      const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          logger.debug('Deleted old cache file', { file });
        }
      }

    } catch (error) {
      logger.error('Failed to clear old cache', { error: error.message });
    }
  }

  /**
   * Fast team info extraction without additional API calls
   * @param {Array} competitions - ESPN competitions array
   * @returns {Object} - Team information
   */
  extractTeamInfoFast(competitions) {
    if (!competitions || competitions.length === 0) {
      return { home: null, away: null };
    }

    const competition = competitions[0];
    const competitors = competition.competitors || [];
    
    const teams = { home: null, away: null };
    
    competitors.forEach(competitor => {
      try {
        // Use embedded team data instead of making additional API calls
        const teamData = competitor.team;
        
        if (teamData) {
          const teamInfo = {
            id: teamData.id,
            name: teamData.displayName || teamData.name,
            abbreviation: teamData.abbreviation,
            logo: teamData.logos?.[0]?.href || teamData.logo,
            color: teamData.color,
            score: competitor.score
          };
          
          if (competitor.homeAway === 'home') {
            teams.home = teamInfo;
          } else {
            teams.away = teamInfo;
          }
        }
      } catch (error) {
        logger.debug('Failed to extract team info fast', {
          competitor: competitor.id,
          error: error.message
        });
      }
    });
    
    return teams;
  }

  /**
   * Extract betting odds from ESPN competition data
   * @param {Object} competition - Competition object from ESPN API
   * @returns {Object|null} - Extracted odds data or null if not available
   */
  extractOddsFromCompetition(competition) {
    if (!competition || !competition.odds || competition.odds.length === 0) {
      return null;
    }

    try {
      // ESPN typically provides odds from ESPN BET or other providers
      // We'll use the first provider's odds (usually ESPN BET)
      const oddsData = competition.odds[0];
      
      const extracted = {
        provider: oddsData.provider?.name || 'ESPN BET',
        spread: null,
        spreadOdds: {
          home: null,
          away: null
        },
        moneyline: {
          home: null,
          away: null
        },
        total: null,
        totalOdds: {
          over: null,
          under: null
        }
      };

      // Extract spread data
      if (oddsData.spread !== undefined && oddsData.spread !== null) {
        extracted.spread = oddsData.spread;
      }

      // Extract point spread odds
      if (oddsData.pointSpread) {
        if (oddsData.pointSpread.home?.close) {
          extracted.spreadOdds.home = {
            line: oddsData.pointSpread.home.close.line,
            odds: oddsData.pointSpread.home.close.odds
          };
        }
        if (oddsData.pointSpread.away?.close) {
          extracted.spreadOdds.away = {
            line: oddsData.pointSpread.away.close.line,
            odds: oddsData.pointSpread.away.close.odds
          };
        }
      }

      // Extract moneyline odds
      if (oddsData.moneyline) {
        if (oddsData.moneyline.home?.close) {
          extracted.moneyline.home = oddsData.moneyline.home.close.odds;
        }
        if (oddsData.moneyline.away?.close) {
          extracted.moneyline.away = oddsData.moneyline.away.close.odds;
        }
      }

      // Extract over/under total
      if (oddsData.overUnder !== undefined && oddsData.overUnder !== null) {
        extracted.total = oddsData.overUnder;
      }

      // Extract total odds
      if (oddsData.total) {
        if (oddsData.total.over?.close) {
          extracted.totalOdds.over = {
            line: oddsData.total.over.close.line,
            odds: oddsData.total.over.close.odds
          };
        }
        if (oddsData.total.under?.close) {
          extracted.totalOdds.under = {
            line: oddsData.total.under.close.line,
            odds: oddsData.total.under.close.odds
          };
        }
      }

      // Log successful extraction
      logger.debug('Extracted odds from ESPN', {
        provider: extracted.provider,
        hasSpread: extracted.spread !== null,
        hasMoneyline: extracted.moneyline.home !== null || extracted.moneyline.away !== null,
        hasTotal: extracted.total !== null
      });

      return extracted;

    } catch (error) {
      logger.warn('Failed to extract odds from competition', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get games by date range for NCAA Basketball
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Array of game objects
   */
  async getGamesByDateRange(startDate, endDate, options = {}) {
    try {
      const sport = options.sport || 'ncaa_basketball';
      const sportConfig = this.sportsEndpoints[sport];

      if (!sportConfig) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      logger.info('Fetching games by date range', {
        sport,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      // Format dates for ESPN API (YYYYMMDD)
      const startFormatted = this.formatDate(startDate);
      const endFormatted = this.formatDate(endDate);

      // Build date range string (YYYYMMDD-YYYYMMDD)
      const dateRange = startFormatted === endFormatted 
        ? startFormatted 
        : `${startFormatted}-${endFormatted}`;

      const url = `${this.baseUrl}/${sportConfig.id}/leagues/${sportConfig.league}/events`;
      const params = {
        dates: dateRange,
        limit: options.limit || 300 // Higher limit for date ranges
      };

      logger.debug('ESPN API request', { url, params });

      await this.enforceRateLimit();
      const response = await this.makeRequest(url, { params });

      // Collect all items from all pages
      let allItems = [...(response.data.items || [])];
      let currentData = response.data;

      // Fetch additional pages if they exist
      let pagesFetched = 1;
      const maxPages = options.maxPages || 10;

      while (currentData.nextPage && pagesFetched < maxPages) {
        try {
          logger.debug('Fetching next page', {
            page: pagesFetched + 1,
            totalSoFar: allItems.length
          });

          await this.enforceRateLimit();
          const nextResponse = await this.makeRequest(currentData.nextPage.$ref);
          currentData = nextResponse.data;

          if (currentData.items) {
            allItems = allItems.concat(currentData.items);
            pagesFetched++;
          }
        } catch (error) {
          logger.warn('Failed to fetch next page', {
            page: pagesFetched + 1,
            error: error.message
          });
          break;
        }
      }

      logger.info('Fetched games from ESPN', {
        sport,
        totalGames: allItems.length,
        pagesFetched
      });

      // Resolve game details
      const games = [];
      for (const item of allItems) {
        try {
          await this.enforceRateLimit();
          const gameResponse = await this.makeRequest(item.$ref);
          const event = gameResponse.data;

          // Extract basic game info
          const competition = event.competitions?.[0];
          const competitors = competition?.competitors || [];

          const homeCompetitor = competitors.find(c => c.homeAway === 'home');
          const awayCompetitor = competitors.find(c => c.homeAway === 'away');

          // Extract team details from competitor data (no need to resolve $ref)
          const homeTeam = homeCompetitor?.team;
          const awayTeam = awayCompetitor?.team;

          games.push({
            id: event.id,
            uid: event.uid,
            date: event.date,
            name: event.name,
            shortName: event.shortName,
            season: event.season,
            status: event.status,
            homeTeam: homeTeam ? {
              id: homeTeam.id,
              name: homeTeam.displayName || homeTeam.name,
              abbreviation: homeTeam.abbreviation,
              logo: homeTeam.logos?.[0]?.href || homeTeam.logo,
              score: homeCompetitor?.score,
              color: homeTeam.color
            } : null,
            awayTeam: awayTeam ? {
              id: awayTeam.id,
              name: awayTeam.displayName || awayTeam.name,
              abbreviation: awayTeam.abbreviation,
              logo: awayTeam.logos?.[0]?.href || awayTeam.logo,
              score: awayCompetitor?.score,
              color: awayTeam.color
            } : null,
            venue: competition?.venue?.fullName,
            neutralSite: competition?.neutralSite || false,
            completed: event.status?.type?.completed || false
          });
        } catch (error) {
          logger.warn('Failed to resolve game details', {
            gameRef: item.$ref,
            error: error.message
          });
        }
      }

      logger.info('Resolved game details', {
        sport,
        totalGames: games.length
      });

      return games;

    } catch (error) {
      logger.error('Failed to fetch games by date range', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get today's games for a specific sport
   * @param {string} sport - Sport key (nfl, nba, nhl, ncaa_basketball, ncaa_football)
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Array of today's game objects
   */
  async getTodaysGames(sport, options = {}) {
    try {
      logger.info('Fetching today\'s games', { sport });
      
      // Use getUpcomingGames which already filters for today's games
      const games = await this.getUpcomingGames(sport, options);
      
      // Filter to only today's games (in case API returns games from other days)
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
      
      const todaysGames = games.filter(game => {
        const gameDate = new Date(game.date);
        return gameDate >= todayStart && gameDate < todayEnd;
      });
      
      logger.info('Filtered to today\'s games', {
        sport,
        totalGames: games.length,
        todaysGames: todaysGames.length
      });
      
      return todaysGames;
      
    } catch (error) {
      logger.error('Failed to fetch today\'s games', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Test connection to ESPN API
   * @returns {Promise<boolean>} - Whether connection is successful
   */
  async testConnection() {
    try {
      const testUrl = `${this.baseUrl}/football/leagues/nfl`;
      await this.makeRequest(testUrl);
      logger.info('ESPN API connection test successful');
      return true;
    } catch (error) {
      logger.error('ESPN API connection test failed', {
        error: error.message
      });
      return false;
    }
  }
}

module.exports = ESPNAPIClient;