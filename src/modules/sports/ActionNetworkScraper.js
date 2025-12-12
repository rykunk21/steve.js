const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const logger = require('../../utils/logger');
const BettingSnapshot = require('../../database/models/BettingSnapshot');

/**
 * ActionNetwork scraper for betting odds data
 * Uses Puppeteer for browser automation to bypass anti-bot protection
 */
class ActionNetworkScraper {
  constructor(config = {}) {
    this.baseUrl = 'https://www.actionnetwork.com';
    this.timeout = config.timeout || 30000;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 2000;
    
    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = 2000; // 2 seconds between requests for Puppeteer
    
    // Sport-specific URL mappings
    this.sportUrls = {
      'nfl': '/nfl/odds',
      'nba': '/nba/odds', 
      'nhl': '/nhl/odds',
      'ncaa_basketball': '/ncaab/odds',
      'ncaa_football': '/ncaaf/odds'
    };

    // Puppeteer configuration
    this.puppeteerConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    };

    this.browser = null;
  }

  /**
   * Initialize browser instance
   */
  async initBrowser() {
    if (!this.browser) {
      try {
        logger.debug('Launching Puppeteer browser');
        this.browser = await puppeteer.launch(this.puppeteerConfig);
      } catch (error) {
        logger.error('Failed to launch browser', { error: error.message });
        throw error;
      }
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        logger.debug('Browser closed');
      } catch (error) {
        logger.warn('Error closing browser', { error: error.message });
      }
    }
  }

  /**
   * Get ActionNetwork dropdown value for sport
   * @param {string} sport - Our sport key
   * @returns {string} - ActionNetwork dropdown value
   */
  getSportDropdownValue(sport) {
    const sportMapping = {
      'nfl': 'football',
      'nba': 'basketball',
      'nhl': 'hockey',
      'ncaa_basketball': 'basketball_ncaab',
      'ncaa_football': 'football_ncaaf'
    };
    
    return sportMapping[sport] || 'football';
  }

  /**
   * Rate limit requests to avoid being blocked
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetch HTML content from ActionNetwork using Puppeteer
   * @param {string} sport - Sport key
   * @returns {Promise<string>} - HTML content
   */
  async fetchOddsPage(sport) {
    if (!this.sportUrls[sport]) {
      throw new Error(`Unsupported sport: ${sport}`);
    }

    const url = this.baseUrl + this.sportUrls[sport];
    
    logger.info('ActionNetwork URL for sport', { sport, url, sportUrls: this.sportUrls });
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      let page = null;
      
      try {
        await this.rateLimit();
        
        logger.debug('Fetching odds page with Puppeteer', { sport, url, attempt });
        
        const browser = await this.initBrowser();
        page = await browser.newPage();
        
        // Listen to console logs from the page
        page.on('console', msg => {
          logger.debug('Browser console:', { text: msg.text() });
        });
        
        // Set user agent and viewport
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate to the page
        await page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: this.timeout 
        });
        
        // Wait for the page to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Select "All Markets" from the dropdown to get all betting data
        try {
          logger.debug('Looking for market selector dropdown');
          
          // Try to find the select element using multiple strategies
          const selectResult = await page.evaluate(() => {
            // Strategy 1: Try the specific selector
            let select = document.querySelector('#__next > div > main > div > div.css-ypzpyc.e1c6k2a70 > div.odds-tools-sub-nav__primary-filters-container > div > div:nth-child(2) > select');
            
            // Strategy 2: Find any select in the filters area
            if (!select) {
              select = document.querySelector('div.odds-tools-sub-nav__primary-filters-container select');
            }
            
            // Strategy 3: Find select with options containing market names
            if (!select) {
              const allSelects = document.querySelectorAll('select');
              for (const s of allSelects) {
                for (const option of s.options) {
                  if (option.text.toLowerCase().includes('spread') || 
                      option.text.toLowerCase().includes('total') ||
                      option.text.toLowerCase().includes('all')) {
                    select = s;
                    break;
                  }
                }
                if (select) break;
              }
            }
            
            if (!select) {
              return { found: false, error: 'Select element not found' };
            }
            
            // Find the "All Markets" option
            let allMarketsOption = null;
            for (let i = 0; i < select.options.length; i++) {
              const option = select.options[i];
              const text = option.text.toLowerCase();
              console.log(`Option ${i}: "${option.text}" (value: ${option.value})`);
              
              if (text.includes('all') || text.includes('total markets')) {
                allMarketsOption = {
                  value: option.value,
                  text: option.text,
                  index: i
                };
                break;
              }
            }
            
            if (!allMarketsOption) {
              return { 
                found: true, 
                hasAllMarkets: false, 
                optionCount: select.options.length,
                options: Array.from(select.options).map(o => o.text)
              };
            }
            
            // Select the option
            select.value = allMarketsOption.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            
            return { 
              found: true, 
              hasAllMarkets: true, 
              selected: allMarketsOption 
            };
          });
          
          logger.debug('Market selector result', selectResult);
          
          if (selectResult.found && selectResult.hasAllMarkets) {
            logger.info('Successfully selected "All Markets" option', { 
              option: selectResult.selected 
            });
            
            // Wait for the table to reload with all markets
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else if (selectResult.found && !selectResult.hasAllMarkets) {
            logger.warn('Market selector found but no "All Markets" option', {
              availableOptions: selectResult.options
            });
          } else {
            logger.warn('Market selector dropdown not found, using default view');
          }
        } catch (dropdownError) {
          logger.warn('Error selecting "All Markets" dropdown', { error: dropdownError.message });
          // Continue anyway - we'll try to parse whatever is displayed
        }
        
        // Wait for the odds table to load
        await page.waitForSelector('table', { timeout: 10000 });
        
        // Give extra time for JavaScript to fully render the odds
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Extract game data directly from the page using page.evaluate
        const gameData = await page.evaluate(() => {
          const games = [];
          
          // Use the specific tbody selector to get all rows
          const tbody = document.querySelector('#__next > div > main > div > div.css-uoagtb.evtr8is0 > div > div > table > tbody');
          
          if (!tbody) {
            console.log('ERROR: Could not find tbody element');
            return [];
          }
          
          const rows = tbody.rows;
          console.log('Found rows in tbody:', rows.length);
          
          // NEW table structure (as of Nov 2024):
          // Row N: Game data with teams and all odds (10 cells)
          // Row N+1: Time info (1 cell)
          // Pattern: "Notre DameND662RutgersRUTG661" in first cell
          // Strategy: Find rows with 10 cells and team pattern, skip time rows
          
          const rowsArray = Array.from(rows);
          
          // CORRECT PARSING STRATEGY: 
          // Row i+0: Team names (4 spans) + Spread data in column 2
          // Row i+1: Total (over/under) data in column 2  
          // Row i+2: Moneyline data in column 2
          // Row i+3: Empty or time row
          // Pattern repeats every ~4 rows (with some empty rows)
          
          for (let i = 0; i < rowsArray.length; i++) {
            try {
              // Look for team row (has 4 spans)
              const teamRow = rowsArray[i];
              if (!teamRow || teamRow.querySelector('th')) continue;
              
              const teamCells = teamRow.querySelectorAll('td');
              if (teamCells.length !== 10) continue;
              
              // Check if this is a team row by looking for 4 spans
              const firstCell = teamCells[0];
              const spans = firstCell.querySelectorAll('span');
              
              if (spans.length < 4) continue; // Not a team row, skip
              
              // Extract team data from 4-span structure
              const awayTeam = spans[0].textContent.trim();
              const awayAbbr = spans[1].textContent.trim();
              const homeTeam = spans[2].textContent.trim();
              const homeAbbr = spans[3].textContent.trim();
              
              if (!awayTeam || !awayAbbr || !homeTeam || !homeAbbr) continue;
              
              // Extract spread from column 2 of team row
              const spreadData = teamCells[2] ? teamCells[2].textContent.trim() : '';
              
              // Row i+1: Total (over/under)
              let totalData = '';
              if (i + 1 < rowsArray.length) {
                const totalRow = rowsArray[i + 1];
                const totalCells = totalRow.querySelectorAll('td');
                if (totalCells.length >= 3) {
                  totalData = totalCells[2] ? totalCells[2].textContent.trim() : '';
                }
              }
              
              // Row i+2: Moneyline
              let moneylineData = '';
              if (i + 2 < rowsArray.length) {
                const mlRow = rowsArray[i + 2];
                const mlCells = mlRow.querySelectorAll('td');
                if (mlCells.length >= 3) {
                  moneylineData = mlCells[2] ? mlCells[2].textContent.trim() : '';
                }
              }
              
              // Create game ID
              const gameId = `${awayAbbr.toLowerCase()}_at_${homeAbbr.toLowerCase()}`;
              
              games.push({
                awayTeam,
                homeTeam,
                awayAbbr,
                homeAbbr,
                gameId,
                spreadBest: spreadData,
                totalBest: totalData,
                moneylineBest: moneylineData
              });
              
              console.log(`Parsed game ${games.length}: ${awayTeam} (${awayAbbr}) @ ${homeTeam} (${homeAbbr})`);
              
            } catch (error) {
              console.log('Error parsing game row:', error.message);
            }
          }
          
          console.log('Extracted games:', games.length);
          return games;
        });
        
        await page.close();
        
        if (gameData && gameData.length > 0) {
          logger.info('Successfully extracted game data from page', { 
            sport, 
            gamesFound: gameData.length,
            attempt 
          });
          return gameData;
        } else {
          throw new Error('No game data extracted from page');
        }
        
      } catch (error) {
        if (page) {
          try {
            await page.close();
          } catch (closeError) {
            logger.warn('Error closing page', { error: closeError.message });
          }
        }
        
        logger.warn('Failed to fetch odds page', {
          sport,
          url,
          attempt,
          error: error.message,
          isLastAttempt: attempt === this.retryAttempts
        });
        
        if (attempt === this.retryAttempts) {
          throw new Error(`Failed to fetch odds after ${this.retryAttempts} attempts: ${error.message}`);
        }
        
        // Exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Parse betting odds from HTML content
   * @param {string} html - HTML content
   * @param {string} sport - Sport key
   * @returns {Promise<BettingSnapshot[]>} - Array of betting snapshots
   */
  async parseOddsFromHtml(html, sport) {
    try {
      const $ = cheerio.load(html);
      const snapshots = [];
      const scrapedAt = new Date();
      
      logger.debug('Starting HTML parsing for odds', { sport });
      
      // Use the specific ActionNetwork odds table selector
      const oddsTableSelector = '#__next > div > main > div > div.css-uoagtb.evtr8is0 > div > div.best-odds__table.css-fir6fb.e1ujzcpo1 > table';
      const oddsTable = $(oddsTableSelector);
      
      if (oddsTable.length === 0) {
        logger.warn('Main odds table not found, trying fallback selectors', { sport });
        
        // Fallback selectors
        const fallbackSelectors = [
          '.best-odds__table table',
          'table.best-odds',
          'div[class*="best-odds"] table',
          'table tbody tr',
          '.odds-table tbody tr'
        ];
        
        let gameElements = $();
        
        for (const selector of fallbackSelectors) {
          if (selector.includes('table') && !selector.includes('tr')) {
            // Table selector - get rows from it
            const table = $(selector);
            if (table.length > 0) {
              gameElements = table.find('tbody tr');
              logger.debug('Found table with fallback selector', { 
                selector, 
                tableCount: table.length,
                rowCount: gameElements.length 
              });
              break;
            }
          } else {
            // Row selector
            gameElements = $(selector);
            if (gameElements.length > 0) {
              logger.debug('Found game elements with fallback selector', { 
                selector, 
                count: gameElements.length 
              });
              break;
            }
          }
        }
        
        if (gameElements.length === 0) {
          logger.warn('No game elements found with any selector', { sport });
          return snapshots;
        }
        
      } else {
        logger.info('Found main odds table', { sport });
        
        // Get all rows from the odds table
        const allRows = oddsTable.find('tbody tr');
        logger.debug('Found total rows in odds table', { 
          sport,
          totalRows: allRows.length 
        });
        
        if (allRows.length === 0) {
          logger.warn('No rows found in odds table', { sport });
          return snapshots;
        }
        
        // Filter to only game rows (skip date/time rows and other non-game rows)
        const gameRows = [];
        allRows.each((index, element) => {
          const $element = $(element);
          const cells = $element.find('td');
          
          // Game rows should have multiple cells (13 in ActionNetwork)
          // Date/time rows typically have only 1 cell
          if (cells.length > 5) {
            const firstCellText = cells.first().text().trim();
            
            // Game rows contain team names, not dates
            // Look for patterns like "RamsLA451JaguarsJAC452"
            if (firstCellText.match(/[A-Z][a-z]+[A-Z]{2,3}\d*[A-Z][a-z]+[A-Z]{2,3}\d*/)) {
              gameRows.push(element);
            }
          }
        });
        
        logger.debug('Filtered to game rows', { 
          sport,
          totalRows: allRows.length,
          gameRows: gameRows.length 
        });
        
        if (gameRows.length === 0) {
          logger.warn('No game rows found after filtering', { sport });
          return snapshots;
        }
        
        // Parse each game row
        gameRows.forEach((element, index) => {
          try {
            const gameData = this.parseGameElement($, element, sport, scrapedAt);
            if (gameData) {
              snapshots.push(gameData);
              logger.debug('Successfully parsed game row', {
                sport,
                index,
                gameId: gameData.gameId
              });
            }
          } catch (error) {
            logger.warn('Failed to parse game element', {
              sport,
              index,
              error: error.message
            });
          }
        });
      }
      
      logger.info('Completed HTML parsing for odds', {
        sport,
        totalSnapshots: snapshots.length
      });
      
      return snapshots;
      
    } catch (error) {
      logger.error('Failed to parse odds from HTML', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Parse odds from raw text when structured HTML isn't available
   * @param {string} text - Raw text content
   * @param {string} sport - Sport key
   * @param {Date} scrapedAt - Scraping timestamp
   * @returns {BettingSnapshot[]} - Array of betting snapshots
   */
  parseOddsFromText(text, sport, scrapedAt) {
    const snapshots = [];
    
    try {
      // Look for patterns like "RamsLA451JaguarsJAC452-3.5-110+3.5-110"
      // This suggests: Rams vs Jaguars, spread -3.5/-110, +3.5/-110
      const gamePattern = /([A-Z][a-z]+[A-Z]{2,3}\d*[A-Z][a-z]+[A-Z]{2,3}\d*)([-+]?\d+\.?\d*)([-+]\d+)([-+]?\d+\.?\d*)([-+]\d+)/g;
      
      let match;
      while ((match = gamePattern.exec(text)) !== null) {
        const [fullMatch, teams, spread1, odds1, spread2, odds2] = match;
        
        // Try to extract team names from the combined string
        const teamMatch = teams.match(/([A-Z][a-z]+)([A-Z]{2,3})(\d*)([A-Z][a-z]+)([A-Z]{2,3})(\d*)/);
        
        if (teamMatch) {
          const [, team1Name, team1Abbr, , team2Name, team2Abbr] = teamMatch;
          
          const gameId = `${team1Abbr.toLowerCase()}_at_${team2Abbr.toLowerCase()}`;
          
          const snapshot = new BettingSnapshot({
            gameId,
            sport,
            scrapedAt,
            spreadLine: parseFloat(spread1),
            awaySpreadOdds: parseInt(odds1),
            homeSpreadOdds: parseInt(odds2),
            source: 'ActionNetwork',
            sportsbook: 'Consensus'
          });
          
          snapshots.push(snapshot);
          
          logger.debug('Parsed game from text', {
            gameId,
            teams: `${team1Name} ${team1Abbr} @ ${team2Name} ${team2Abbr}`,
            spread: spread1,
            odds: `${odds1}/${odds2}`
          });
        }
      }
      
    } catch (error) {
      logger.warn('Failed to parse odds from text', { error: error.message });
    }
    
    return snapshots;
  }

  /**
   * Parse individual game element for betting data
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {Element} element - Game element
   * @param {string} sport - Sport key
   * @param {Date} scrapedAt - Scraping timestamp
   * @returns {BettingSnapshot|null} - Betting snapshot or null
   */
  parseGameElement($, element, sport, scrapedAt) {
    const $element = $(element);
    
    // Extract team names to create a game ID
    const teamNames = this.extractTeamNames($, $element);
    if (!teamNames.home || !teamNames.away) {
      logger.debug('Could not extract team names from element');
      return null;
    }
    
    // Create a simple game ID from team names
    const gameId = `${teamNames.away.toLowerCase().replace(/\s+/g, '_')}_at_${teamNames.home.toLowerCase().replace(/\s+/g, '_')}`;
    
    // Extract betting lines
    const bettingData = this.extractBettingLines($, $element, sport);
    
    if (!bettingData.hasAnyData) {
      logger.debug('No betting data found in element', { gameId });
      return null;
    }
    
    // Create betting snapshot
    const snapshot = new BettingSnapshot({
      gameId,
      sport,
      scrapedAt,
      homeMoneyline: bettingData.homeMoneyline,
      awayMoneyline: bettingData.awayMoneyline,
      spreadLine: bettingData.spreadLine,
      homeSpreadOdds: bettingData.homeSpreadOdds,
      awaySpreadOdds: bettingData.awaySpreadOdds,
      totalLine: bettingData.totalLine,
      overOdds: bettingData.overOdds,
      underOdds: bettingData.underOdds,
      source: 'ActionNetwork',
      sportsbook: bettingData.sportsbook || 'Consensus'
    });
    
    logger.debug('Created betting snapshot', {
      gameId,
      sport,
      hasMoneyline: !!(bettingData.homeMoneyline && bettingData.awayMoneyline),
      hasSpread: !!(bettingData.spreadLine !== null),
      hasTotal: !!(bettingData.totalLine !== null)
    });
    
    return snapshot;
  }

  /**
   * Extract team names from game element
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {Cheerio} $element - Game element
   * @returns {Object} - Team names object
   */
  extractTeamNames($, $element) {
    // ActionNetwork table structure - teams are in the first column
    const firstCell = $element.find('td').first();
    
    if (firstCell.length > 0) {
      const cellText = firstCell.text().trim();
      
      // ActionNetwork pattern: "RamsLA451JaguarsJAC452"
      // Pattern: TeamName + Abbreviation + Number + TeamName + Abbreviation + Number
      const actionNetworkPattern = /^([A-Z][a-z]+)([A-Z]{2,3})(\d+)([A-Z][a-z]+)([A-Z]{2,3})(\d+)$/;
      const match = cellText.match(actionNetworkPattern);
      
      if (match) {
        const [, awayTeamName, awayAbbr, , homeTeamName, homeAbbr] = match;
        return {
          away: awayAbbr,  // Use abbreviation for consistency
          home: homeAbbr,
          awayFullName: awayTeamName,
          homeFullName: homeTeamName
        };
      }
      
      // Fallback: Look for standard patterns like "TEAM1 @ TEAM2" or "TEAM1 vs TEAM2"
      const vsPattern = /([A-Z]{2,4})\s*(?:@|vs|at)\s*([A-Z]{2,4})/i;
      const vsMatch = cellText.match(vsPattern);
      
      if (vsMatch) {
        return {
          away: vsMatch[1].trim(),
          home: vsMatch[2].trim()
        };
      }
      
      // Alternative pattern: look for two team abbreviations
      const teamAbbrevs = cellText.match(/\b[A-Z]{2,4}\b/g);
      if (teamAbbrevs && teamAbbrevs.length >= 2) {
        return {
          away: teamAbbrevs[0],
          home: teamAbbrevs[1]
        };
      }
      
      // Try to extract team names and abbreviations separately
      // Pattern for team names followed by abbreviations
      const teamNamePattern = /([A-Z][a-z]+)([A-Z]{2,4})/g;
      const teamMatches = [];
      let teamMatch;
      
      while ((teamMatch = teamNamePattern.exec(cellText)) !== null) {
        teamMatches.push({
          name: teamMatch[1],
          abbr: teamMatch[2]
        });
      }
      
      if (teamMatches.length >= 2) {
        return {
          away: teamMatches[0].abbr,
          home: teamMatches[1].abbr,
          awayFullName: teamMatches[0].name,
          homeFullName: teamMatches[1].name
        };
      }
    }
    
    // Fallback: look in all cells for team names
    const allCells = $element.find('td');
    let teams = [];
    
    allCells.each((i, cell) => {
      const cellText = $(cell).text().trim();
      const teamMatch = cellText.match(/\b[A-Z]{2,4}\b/);
      if (teamMatch && teams.length < 2) {
        teams.push(teamMatch[0]);
      }
    });
    
    if (teams.length >= 2) {
      return {
        away: teams[0],
        home: teams[1]
      };
    }
    
    return {
      away: null,
      home: null
    };
  }

  /**
   * Extract betting lines from game element
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {Cheerio} $element - Game element
   * @param {string} sport - Sport key
   * @returns {Object} - Betting data object
   */
  extractBettingLines($, $element, sport) {
    const bettingData = {
      homeMoneyline: null,
      awayMoneyline: null,
      spreadLine: null,
      homeSpreadOdds: null,
      awaySpreadOdds: null,
      totalLine: null,
      overOdds: null,
      underOdds: null,
      sportsbook: null,
      hasAnyData: false
    };
    
    // Extract moneyline odds
    const moneylineData = this.extractMoneyline($, $element);
    if (moneylineData.home && moneylineData.away) {
      bettingData.homeMoneyline = moneylineData.home;
      bettingData.awayMoneyline = moneylineData.away;
      bettingData.hasAnyData = true;
    }
    
    // Extract spread/puck line
    const spreadData = this.extractSpread($, $element, sport);
    if (spreadData.line !== null) {
      bettingData.spreadLine = spreadData.line;
      bettingData.homeSpreadOdds = spreadData.homeOdds;
      bettingData.awaySpreadOdds = spreadData.awayOdds;
      bettingData.hasAnyData = true;
    }
    
    // Extract totals (over/under)
    const totalData = this.extractTotal($, $element);
    if (totalData.line !== null) {
      bettingData.totalLine = totalData.line;
      bettingData.overOdds = totalData.overOdds;
      bettingData.underOdds = totalData.underOdds;
      bettingData.hasAnyData = true;
    }
    
    // Try to extract sportsbook name
    bettingData.sportsbook = this.extractSportsbook($, $element);
    
    return bettingData;
  }

  /**
   * Extract moneyline odds
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {Cheerio} $element - Game element
   * @returns {Object} - Moneyline data
   */
  extractMoneyline($, $element) {
    // ActionNetwork table structure - scan all cells for moneyline odds
    const cells = $element.find('td');
    const odds = [];
    
    cells.each((i, cell) => {
      const cellText = $(cell).text().trim();
      
      // Look for moneyline odds patterns (usually +/- followed by 3 digits)
      const oddsMatches = cellText.match(/([+\-]\d{3,4})/g);
      if (oddsMatches) {
        oddsMatches.forEach(match => {
          const parsedOdds = this.parseOdds(match);
          if (parsedOdds) {
            odds.push(parsedOdds);
          }
        });
      }
    });
    
    // If we found at least 2 odds values, assume first is away, second is home
    if (odds.length >= 2) {
      return { 
        away: odds[0], 
        home: odds[1] 
      };
    }
    
    // Fallback: look for specific moneyline indicators
    const moneylineSelectors = [
      '[data-testid="book-cell__odds"]',
      '.moneyline',
      '.ml',
      '[data-bet-type="moneyline"]'
    ];
    
    for (const selector of moneylineSelectors) {
      const elements = $element.find(selector);
      if (elements.length >= 2) {
        const awayOdds = this.parseOdds($(elements[0]).text());
        const homeOdds = this.parseOdds($(elements[1]).text());
        
        if (awayOdds && homeOdds) {
          return { away: awayOdds, home: homeOdds };
        }
      }
    }
    
    return { away: null, home: null };
  }

  /**
   * Extract spread/puck line data
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {Cheerio} $element - Game element
   * @param {string} sport - Sport key
   * @returns {Object} - Spread data
   */
  extractSpread($, $element, sport) {
    const cells = $element.find('td');
    let spreadLine = null;
    const spreadOdds = [];
    
    // Look through all cells for spread patterns
    cells.each((i, cell) => {
      const cellText = $(cell).text().trim();
      
      // Look for spread line patterns (e.g., "-3.5", "+7", "-1.5")
      const spreadMatch = cellText.match(/([+\-]\d+\.?\d*)/);
      if (spreadMatch) {
        const potentialSpread = parseFloat(spreadMatch[1]);
        
        // Spread lines are typically between -50 and +50
        if (Math.abs(potentialSpread) <= 50 && spreadLine === null) {
          spreadLine = potentialSpread;
        }
      }
      
      // Look for odds associated with spreads (usually -110, +105, etc.)
      const oddsMatches = cellText.match(/([+\-]\d{2,4})/g);
      if (oddsMatches) {
        oddsMatches.forEach(match => {
          const parsedOdds = this.parseOdds(match);
          if (parsedOdds && Math.abs(parsedOdds) >= 100) { // Typical odds range
            spreadOdds.push(parsedOdds);
          }
        });
      }
    });
    
    // If we found a spread line and at least 2 odds, return the data
    if (spreadLine !== null && spreadOdds.length >= 2) {
      return {
        line: spreadLine,
        awayOdds: spreadOdds[0],
        homeOdds: spreadOdds[1]
      };
    }
    
    // Fallback: look for specific spread selectors
    const spreadSelectors = [
      '[data-testid="book-cell__odds"]',
      '.spread',
      '.point-spread',
      '.puck-line',
      '[data-bet-type="spread"]'
    ];
    
    for (const selector of spreadSelectors) {
      const elements = $element.find(selector);
      if (elements.length >= 2) {
        const firstText = $(elements[0]).text();
        const spreadValue = this.parseSpreadLine(firstText);
        
        if (spreadValue !== null) {
          const awayOdds = this.parseOdds($(elements[0]).text());
          const homeOdds = this.parseOdds($(elements[1]).text());
          
          return {
            line: spreadValue,
            awayOdds,
            homeOdds
          };
        }
      }
    }
    
    return { line: null, awayOdds: null, homeOdds: null };
  }

  /**
   * Extract total (over/under) data
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {Cheerio} $element - Game element
   * @returns {Object} - Total data
   */
  extractTotal($, $element) {
    const cells = $element.find('td');
    let totalLine = null;
    const totalOdds = [];
    
    // Look through all cells for total patterns
    cells.each((i, cell) => {
      const cellText = $(cell).text().trim();
      
      // Look for total line patterns (e.g., "45.5", "220", "6.5")
      // Totals are usually positive numbers without +/- signs
      const totalMatch = cellText.match(/\b(\d+\.?\d*)\b/);
      if (totalMatch) {
        const potentialTotal = parseFloat(totalMatch[1]);
        
        // Total lines are typically between 30 and 300 depending on sport
        if (potentialTotal >= 30 && potentialTotal <= 300 && totalLine === null) {
          // Additional validation: make sure it's not an odds value
          if (!cellText.includes('+') && !cellText.includes('-')) {
            totalLine = potentialTotal;
          }
        }
      }
      
      // Look for odds associated with totals
      const oddsMatches = cellText.match(/([+\-]\d{2,4})/g);
      if (oddsMatches) {
        oddsMatches.forEach(match => {
          const parsedOdds = this.parseOdds(match);
          if (parsedOdds && Math.abs(parsedOdds) >= 100) {
            totalOdds.push(parsedOdds);
          }
        });
      }
    });
    
    // If we found a total line and at least 2 odds, return the data
    if (totalLine !== null && totalOdds.length >= 2) {
      return {
        line: totalLine,
        overOdds: totalOdds[0],
        underOdds: totalOdds[1]
      };
    }
    
    // Fallback: look for specific total selectors
    const totalSelectors = [
      '[data-testid="book-cell__odds"]',
      '.total',
      '.over-under',
      '.ou',
      '[data-bet-type="total"]'
    ];
    
    for (const selector of totalSelectors) {
      const elements = $element.find(selector);
      if (elements.length >= 2) {
        const firstText = $(elements[0]).text();
        const totalValue = this.parseTotalLine(firstText);
        
        if (totalValue !== null) {
          const overOdds = this.parseOdds($(elements[0]).text());
          const underOdds = this.parseOdds($(elements[1]).text());
          
          return {
            line: totalValue,
            overOdds,
            underOdds
          };
        }
      }
    }
    
    return { line: null, overOdds: null, underOdds: null };
  }

  /**
   * Extract sportsbook name
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {Cheerio} $element - Game element
   * @returns {string|null} - Sportsbook name
   */
  extractSportsbook($, $element) {
    const sportsbookSelectors = [
      '.sportsbook',
      '.book',
      '.provider',
      '[data-sportsbook]'
    ];
    
    for (const selector of sportsbookSelectors) {
      const sportsbook = $element.find(selector).first().text().trim();
      if (sportsbook) {
        return sportsbook;
      }
    }
    
    return null;
  }

  /**
   * Parse odds string to integer
   * @param {string} oddsText - Odds text
   * @returns {number|null} - Parsed odds or null
   */
  parseOdds(oddsText) {
    if (!oddsText) return null;
    
    // Remove non-numeric characters except +, -, and decimal point
    const cleaned = oddsText.replace(/[^\d+\-\.]/g, '');
    
    // Match American odds format (+150, -110, etc.)
    const oddsMatch = cleaned.match(/^([+\-]?\d+)$/);
    
    if (oddsMatch) {
      return parseInt(oddsMatch[1], 10);
    }
    
    return null;
  }

  /**
   * Parse spread line from text
   * @param {string} spreadText - Spread text
   * @returns {number|null} - Parsed spread line or null
   */
  parseSpreadLine(spreadText) {
    if (!spreadText) return null;
    
    // Match spread format (-3.5, +7, etc.)
    const spreadMatch = spreadText.match(/([+\-]?\d+(?:\.\d+)?)/);
    
    if (spreadMatch) {
      return parseFloat(spreadMatch[1]);
    }
    
    return null;
  }

  /**
   * Parse total line from text
   * @param {string} totalText - Total text
   * @returns {number|null} - Parsed total line or null
   */
  parseTotalLine(totalText) {
    if (!totalText) return null;
    
    // Match total format (45.5, 220, etc.)
    const totalMatch = totalText.match(/(\d+(?:\.\d+)?)/);
    
    if (totalMatch) {
      return parseFloat(totalMatch[1]);
    }
    
    return null;
  }

  /**
   * Scrape betting odds for a specific sport
   * @param {string} sport - Sport key
   * @returns {Promise<BettingSnapshot[]>} - Array of betting snapshots
   */
  async scrapeOdds(sport) {
    try {
      logger.info('Starting odds scraping', { sport });
      
      const gameData = await this.fetchOddsPage(sport);
      const snapshots = await this.parseGameData(gameData, sport);
      
      logger.info('Completed odds scraping', {
        sport,
        snapshotsFound: snapshots.length
      });
      
      return snapshots;
      
    } catch (error) {
      logger.error('Failed to scrape odds', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Parse game data extracted from Puppeteer into BettingSnapshots
   * @param {Array} gameData - Array of game objects from page.evaluate
   * @param {string} sport - Sport key
   * @returns {Promise<BettingSnapshot[]>} - Array of betting snapshots
   */
  async parseGameData(gameData, sport) {
    const snapshots = [];
    const scrapedAt = new Date();
    
    for (const game of gameData) {
      try {
        // Use the game ID from extracted data (uses team abbreviations)
        const gameId = game.gameId || `${game.awayTeam.substring(0, 3).toLowerCase()}_at_${game.homeTeam.substring(0, 3).toLowerCase()}`;
        
        // Parse odds from the three "Best" columns (one from each row)
        const odds = this.parseOddsFromBestColumns(game.spreadBest, game.totalBest, game.moneylineBest);
        
        if (!odds.hasAnyData) continue;
        
        const snapshot = new BettingSnapshot({
          gameId,
          sport,
          scrapedAt,
          homeMoneyline: odds.homeMoneyline,
          awayMoneyline: odds.awayMoneyline,
          spreadLine: odds.spreadLine,
          homeSpreadOdds: odds.homeSpreadOdds,
          awaySpreadOdds: odds.awaySpreadOdds,
          totalLine: odds.totalLine,
          overOdds: odds.overOdds,
          underOdds: odds.underOdds,
          source: 'ActionNetwork',
          sportsbook: 'Consensus'
        });
        
        snapshots.push(snapshot);
        
      } catch (error) {
        logger.debug('Failed to parse game data', { 
          game: game.awayTeam + ' @ ' + game.homeTeam,
          error: error.message 
        });
      }
    }
    
    return snapshots;
  }

  /**
   * Parse odds from the "Best" columns extracted from 3 rows
   * In "All Markets" view, each game spans 3 rows with cell[2] containing the best odds
   * Row 1 cell[2]: Spread data
   * Row 2 cell[2]: Total data
   * Row 3 cell[2]: Moneyline data
   * @param {string} spreadText - Text from spread row cell[2]
   * @param {string} totalText - Text from total row cell[2]
   * @param {string} moneylineText - Text from moneyline row cell[2]
   * @returns {Object} - Parsed odds data
   */
  parseOddsFromBestColumns(spreadText, totalText, moneylineText) {
    const odds = {
      homeMoneyline: null,
      awayMoneyline: null,
      spreadLine: null,
      homeSpreadOdds: null,
      awaySpreadOdds: null,
      totalLine: null,
      overOdds: null,
      underOdds: null,
      hasAnyData: false
    };
    
    logger.debug('Parsing Best columns from ActionNetwork', {
      spreadText: spreadText.substring(0, 100),
      totalText: totalText.substring(0, 100),
      moneylineText: moneylineText.substring(0, 100)
    });
    
    // Parse spread from cell 2 (Best Spread)
    // Format: "+20.5-105-20.5-115" (away spread, away odds, home spread, home odds)
    const spreadMatches = spreadText.match(/([+\-]\d+\.?\d*)/g);
    if (spreadMatches && spreadMatches.length >= 4) {
      const awaySpread = parseFloat(spreadMatches[0]);
      const awaySpreadOdds = parseInt(spreadMatches[1]);
      const homeSpread = parseFloat(spreadMatches[2]);
      const homeSpreadOdds = parseInt(spreadMatches[3]);
      
      // Use home spread as the line (negative = home favored)
      odds.spreadLine = homeSpread;
      odds.awaySpreadOdds = awaySpreadOdds;
      odds.homeSpreadOdds = homeSpreadOdds;
      odds.hasAnyData = true;
      
      logger.debug('Parsed spread', {
        awaySpread,
        awaySpreadOdds,
        homeSpread,
        homeSpreadOdds
      });
    }
    
    // Parse total from cell 5 (Best Total)
    // Format: "O140.5-110U140.5-110" or "140.5-110140.5-110"
    const totalMatches = totalText.match(/(\d+\.?\d*)/g);
    const totalOddsMatches = totalText.match(/([+\-]\d{3,4})/g);
    
    if (totalMatches && totalMatches.length >= 1 && totalOddsMatches && totalOddsMatches.length >= 2) {
      const totalLine = parseFloat(totalMatches[0]);
      
      if (totalLine >= 30 && totalLine <= 300) {
        odds.totalLine = totalLine;
        odds.overOdds = parseInt(totalOddsMatches[0]);
        odds.underOdds = parseInt(totalOddsMatches[1]);
        odds.hasAnyData = true;
        
        logger.debug('Parsed total', {
          totalLine,
          overOdds: odds.overOdds,
          underOdds: odds.underOdds
        });
      }
    }
    
    // Parse moneyline from cell 8 (Best Moneyline)
    // Format: "+1800-4000" (away ML, home ML)
    const moneylineMatches = moneylineText.match(/([+\-]\d{3,5})/g);
    if (moneylineMatches && moneylineMatches.length >= 2) {
      odds.awayMoneyline = parseInt(moneylineMatches[0]);
      odds.homeMoneyline = parseInt(moneylineMatches[1]);
      odds.hasAnyData = true;
      
      logger.debug('Parsed moneyline', {
        awayMoneyline: odds.awayMoneyline,
        homeMoneyline: odds.homeMoneyline
      });
    }
    
    return odds;
  }

  /**
   * Scrape odds for multiple sports
   * @param {string[]} sports - Array of sport keys
   * @returns {Promise<Object>} - Results by sport
   */
  async scrapeMultipleSports(sports) {
    const results = {};
    
    try {
      await this.initBrowser();
      
      for (const sport of sports) {
        try {
          results[sport] = await this.scrapeOdds(sport);
          
          // Add delay between sports to be respectful
          if (sports.indexOf(sport) < sports.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
        } catch (error) {
          logger.error('Failed to scrape sport', { sport, error: error.message });
          results[sport] = [];
        }
      }
      
    } finally {
      await this.closeBrowser();
    }
    
    return results;
  }

  /**
   * Cleanup method to ensure browser is closed
   */
  async cleanup() {
    await this.closeBrowser();
  }
}

module.exports = ActionNetworkScraper;