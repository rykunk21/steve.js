const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');

/**
 * Fetches basketball-only schedules from StatBroadcast using Puppeteer
 * Handles JavaScript-rendered content and sport filtering
 */
class BasketballScheduleFetcher {
  constructor() {
    this.baseUrl = 'https://www.statbroadcast.com';
    this.browser = null;
    this.browserPromise = null;
  }

  /**
   * Initialize Puppeteer browser
   * @private
   */
  async initBrowser() {
    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = (async () => {
      try {
        logger.info('Initializing Puppeteer browser for basketball schedules');
        
        this.browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
          ]
        });

        logger.info('Puppeteer browser initialized');
        
        return this.browser;
      } catch (error) {
        logger.error('Failed to initialize Puppeteer browser', {
          error: error.message
        });
        this.browserPromise = null;
        throw error;
      }
    })();

    return this.browserPromise;
  }

  /**
   * Get Men's Basketball schedule for a team
   * @param {string} gid - StatBroadcast team GID
   * @param {Object} options - Filter options
   * @param {string} options.startDate - Start date filter (YYYY-MM-DD)
   * @param {string} options.endDate - End date filter (YYYY-MM-DD)
   * @returns {Promise<Array>} - Array of game objects
   */
  async getBasketballSchedule(gid, options = {}) {
    let page = null;
    
    try {
      const url = `${this.baseUrl}/events/schedule.php?gid=${gid}`;
      
      logger.info('Fetching basketball schedule with Puppeteer', { gid, url });

      // Initialize browser if needed
      if (!this.browser) {
        await this.initBrowser();
      }

      page = await this.browser.newPage();
      
      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

      // Navigate to schedule page
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // Wait for the table to load
      await page.waitForSelector('#eventCalendar', { timeout: 10000 });

      // Select Men's Basketball from the sport filter
      try {
        // Wait for the sport selector
        await page.waitForSelector('#sports', { timeout: 5000 });
        
        // Select Men's Basketball (value: "M;bbgame")
        await page.select('#sports', 'M;bbgame');
        
        logger.debug('Selected Men\'s Basketball filter', { gid });
        
        // Wait for table to update after selection
        await page.waitForTimeout(2000);
        
      } catch (selectError) {
        logger.warn('Failed to select basketball filter, continuing with all sports', {
          gid,
          error: selectError.message
        });
      }

      // Extract game data from the table
      const games = await page.evaluate(() => {
        const gameData = [];
        const rows = document.querySelectorAll('#eventCalendar tbody tr');
        
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 4) return;
          
          // Extract date from first cell (MM-DD-YY format)
          const dateText = cells[0].textContent.trim();
          
          // Extract game link from the stats button
          const statsLink = cells[3].querySelector('a');
          if (!statsLink) return;
          
          const href = statsLink.getAttribute('href');
          if (!href) return;
          
          // Extract game ID from href (e.g., http://statb.us/b/613202)
          const gameIdMatch = href.match(/statb\.us\/[bv]\/(?:[^\/]+\/)?(\d+)/);
          if (!gameIdMatch) return;
          
          const gameId = gameIdMatch[1];
          
          // Extract opponent/event info from second cell
          const eventText = cells[1].textContent.trim();
          
          // Extract sport from third cell
          const sportText = cells[2].textContent.trim();
          
          // Extract location from fifth cell
          const locationText = cells.length > 4 ? cells[4].textContent.trim() : '';
          
          gameData.push({
            gameId,
            date: dateText,
            event: eventText,
            sport: sportText,
            location: locationText,
            href
          });
        });
        
        return gameData;
      });

      // Parse dates to ISO format
      const gamesWithParsedDates = games.map(game => ({
        ...game,
        date: this.parseDateDash(game.date) || game.date
      }));

      // Apply date filters if provided
      let filteredGames = gamesWithParsedDates;
      
      if (options.startDate || options.endDate) {
        filteredGames = gamesWithParsedDates.filter(game => {
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

      logger.info('Fetched basketball schedule', {
        gid,
        totalGames: games.length,
        filteredGames: filteredGames.length
      });

      await page.close();
      return filteredGames;

    } catch (error) {
      logger.error('Failed to fetch basketball schedule', {
        gid,
        error: error.message,
        stack: error.stack
      });
      
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }
      
      // Return empty array for graceful degradation
      return [];
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
   * Close Puppeteer browser
   */
  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        this.browserPromise = null;
        logger.info('Puppeteer browser closed');
      } catch (error) {
        logger.error('Failed to close Puppeteer browser', {
          error: error.message
        });
      }
    }
  }
}

module.exports = BasketballScheduleFetcher;
