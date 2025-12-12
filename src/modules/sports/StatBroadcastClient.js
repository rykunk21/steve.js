const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');

/**
 * Client for interacting with StatBroadcast
 * Fetches team schedules and game XML data
 */
class StatBroadcastClient {
  constructor() {
    this.baseUrl = 'https://www.statbroadcast.com';
    this.archiveUrl = 'http://archive.statbroadcast.com';
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000; // 1 second between requests
    this.browser = null;
    this.browserPromise = null;
  }

  /**
   * Initialize Puppeteer browser instance
   * @private
   * @returns {Promise<Browser>} - Puppeteer browser instance
   */
  async getBrowser() {
    // Return existing browser if already initialized
    if (this.browser) {
      return this.browser;
    }

    // If browser is being initialized, wait for it
    if (this.browserPromise) {
      return this.browserPromise;
    }

    // Initialize browser
    this.browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }).then(browser => {
      this.browser = browser;
      this.browserPromise = null;
      
      logger.debug('Puppeteer browser initialized');
      
      return browser;
    }).catch(error => {
      this.browserPromise = null;
      throw error;
    });

    return this.browserPromise;
  }

  /**
   * Close Puppeteer browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.debug('Puppeteer browser closed');
    }
  }

  /**
   * Rate limiting: wait if needed before making request
   * @private
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Make HTTP GET request
   * @private
   * @param {string} url - URL to fetch
   * @returns {Promise<string>} - Response body
   */
  async httpGet(url) {
    await this.rateLimit();

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const req = protocol.get(url, (res) => {
        // Handle redirects (302, 301) as errors - invalid GID
        if (res.statusCode === 302 || res.statusCode === 301) {
          // Consume the response to prevent hanging
          res.resume();
          reject(new Error(`Invalid resource (redirect): ${url}`));
          return;
        }
        
        // Handle other non-200 status codes
        if (res.statusCode !== 200) {
          // Consume the response to prevent hanging
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      
      req.on('error', reject);
    });
  }

  /**
   * Get team schedule from StatBroadcast using Puppeteer
   * @param {string} gid - StatBroadcast team GID
   * @param {Object} options - Filter options
   * @param {string} options.season - Season (e.g., '2024-25')
   * @param {string} options.startDate - Start date filter (YYYY-MM-DD)
   * @param {string} options.endDate - End date filter (YYYY-MM-DD)
   * @returns {Promise<Array>} - Array of game objects
   */
  async getTeamSchedule(gid, options = {}) {
    let page = null;
    
    try {
      const url = `${this.baseUrl}/events/schedule.php?gid=${gid}`;
      
      logger.info('Fetching team schedule', { gid, url });

      await this.rateLimit();

      // Get browser instance
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Set a reasonable timeout
      page.setDefaultTimeout(30000);

      // Navigate to schedule page
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // Wait for the table to load (it's dynamically populated)
      try {
        await page.waitForSelector('#eventCalendar tbody tr', { timeout: 10000 });
      } catch (error) {
        // Table might be empty or not exist
        logger.debug('No schedule table found', { gid });
      }

      // Extract the HTML after JavaScript has rendered
      const html = await page.content();
      
      // Close the page
      await page.close();
      page = null;

      // Parse the rendered HTML
      const games = this.parseScheduleHTML(html);

      // Apply date filters if provided
      let filteredGames = games;
      
      if (options.startDate || options.endDate) {
        filteredGames = games.filter(game => {
          if (!game.date) return false;
          
          const gameDate = new Date(game.date);
          
          if (options.startDate && gameDate < new Date(options.startDate)) {
            return false;
          }
          
          if (options.endDate && gameDate > new Date(options.endDate)) {
            return false;
          }
          
          return true;
        });
      }

      logger.info('Fetched team schedule', {
        gid,
        totalGames: games.length,
        filteredGames: filteredGames.length
      });

      return filteredGames;

    } catch (error) {
      // Clean up page if it's still open
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }

      logger.error('Failed to fetch team schedule', {
        gid,
        error: error.message
      });
      
      // Return empty array instead of throwing for graceful degradation
      // Handle 404, redirects (invalid GID), and other fetch errors
      if (error.message.includes('HTTP 404') || 
          error.message.includes('Invalid resource') ||
          error.message.includes('redirect') ||
          error.message.includes('net::ERR_')) {
        return [];
      }
      
      throw error;
    }
  }

  /**
   * Parse schedule HTML to extract game information
   * @param {string} html - HTML content
   * @returns {Array} - Array of game objects
   */
  parseScheduleHTML(html) {
    try {
      const $ = cheerio.load(html);
      const games = [];
      const seenIds = new Set();

      // StatBroadcast schedule pages have links with game IDs in various formats
      // We'll extract all game IDs and their context
      $('a').each((i, elem) => {
        const href = $(elem).attr('href');
        
        if (!href) return;

        // Extract game ID from various URL patterns
        const gameId = this.extractGameIdFromUrl(href);
        
        if (gameId && !seenIds.has(gameId)) {
          seenIds.add(gameId);
          
          // Try to extract date and opponent from surrounding context
          const row = $(elem).closest('tr');
          const gameInfo = this.extractGameInfoFromRow(row, $);
          
          games.push({
            gameId,
            date: gameInfo.date,
            opponent: gameInfo.opponent,
            href
          });
        }
      });

      return games;

    } catch (error) {
      logger.error('Failed to parse schedule HTML', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Extract game ID from URL
   * @private
   * @param {string} href - URL to parse
   * @returns {string|null} - Game ID or null
   */
  extractGameIdFromUrl(href) {
    // Pattern 1: ?id=123456
    let match = href.match(/[?&]id=(\d+)/);
    if (match) return match[1];
    
    // Pattern 2: /events/statbroadcast.com?id=123456
    match = href.match(/statbroadcast\.com[?&]id=(\d+)/);
    if (match) return match[1];
    
    // Pattern 3: http://statb.us/b/123456 or http://statb.us/v/team/123456
    match = href.match(/statb\.us\/[bv]\/(?:[^\/]+\/)?(\d+)/);
    if (match) return match[1];
    
    return null;
  }

  /**
   * Extract game information from table row
   * @private
   * @param {Object} row - Cheerio row element
   * @param {Object} $ - Cheerio instance
   * @returns {Object} - Game info with date and opponent
   */
  extractGameInfoFromRow(row, $) {
    const cells = row.find('td');
    let date = null;
    let opponent = null;
    
    cells.each((j, cell) => {
      const text = $(cell).text().trim();
      
      // Try to parse date (MM-DD-YY format)
      if (!date && text.match(/\d{1,2}-\d{1,2}-\d{2}/)) {
        date = this.parseDateDash(text);
      }
      // Try to parse date (MM/DD/YYYY format)
      else if (!date && text.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
        date = this.parseDate(text);
      }
      
      // Look for opponent (vs/@ patterns)
      if (!opponent && text.match(/^(vs|@)\s+/i)) {
        opponent = text.replace(/^(vs|@)\s+/i, '').trim();
      }
    });
    
    return { date, opponent };
  }

  /**
   * Parse date string to ISO format
   * @private
   * @param {string} dateStr - Date string (e.g., "11/18/2024")
   * @returns {string|null} - ISO date string or null
   */
  parseDate(dateStr) {
    try {
      // Handle MM/DD/YYYY format
      const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (match) {
        let [, month, day, year] = match;
        
        // Handle 2-digit year
        if (year.length === 2) {
          year = '20' + year;
        }
        
        const date = new Date(year, month - 1, day);
        return date.toISOString().split('T')[0];
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse date string in MM-DD-YY format to ISO format
   * @private
   * @param {string} dateStr - Date string (e.g., "11-18-24")
   * @returns {string|null} - ISO date string or null
   */
  parseDateDash(dateStr) {
    try {
      // Handle MM-DD-YY format
      const match = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{2})/);
      if (match) {
        let [, month, day, year] = match;
        
        // Handle 2-digit year
        year = '20' + year;
        
        const date = new Date(year, month - 1, day);
        return date.toISOString().split('T')[0];
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch game XML from archive
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<string>} - XML content
   */
  async fetchGameXML(gameId) {
    try {
      const url = `${this.archiveUrl}/${gameId}.xml`;
      
      logger.debug('Fetching game XML', { gameId, url });

      const xml = await this.httpGet(url);

      logger.debug('Fetched game XML', {
        gameId,
        size: xml.length
      });

      return xml;

    } catch (error) {
      logger.error('Failed to fetch game XML', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Search for games by date and team names
   * This is a placeholder implementation that searches team schedules
   * @param {Object} criteria - Search criteria
   * @param {string} criteria.date - Game date (YYYY-MM-DD)
   * @param {string} criteria.homeTeam - Home team name (optional)
   * @param {string} criteria.awayTeam - Away team name (optional)
   * @returns {Promise<Array>} - Array of candidate games
   */
  async searchGames(criteria) {
    try {
      // This is a simplified implementation
      // In a real scenario, you would need to:
      // 1. Have a mapping of team names to StatBroadcast GIDs
      // 2. Search multiple team schedules
      // 3. Match games by date
      
      logger.debug('Searching StatBroadcast games', criteria);

      // For now, return empty array
      // The actual implementation would require team GID lookups
      // which is handled by the TeamRepository in the reconciliation flow
      return [];

    } catch (error) {
      logger.error('Failed to search StatBroadcast games', {
        criteria,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = StatBroadcastClient;
