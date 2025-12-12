const ActionNetworkScraper = require('./ActionNetworkScraper');
const BettingSnapshotRepository = require('../../database/repositories/BettingSnapshotRepository');
const logger = require('../../utils/logger');
const cron = require('node-cron');

/**
 * OddsTracker manages automated betting line scraping and storage
 */
class OddsTracker {
  constructor(database) {
    this.db = database;
    this.scraper = new ActionNetworkScraper();
    this.snapshotRepo = new BettingSnapshotRepository(database);
    this.scheduledJobs = new Map();
    this.isInitialized = false;
    
    // Supported sports
    this.supportedSports = ['nfl', 'nba', 'nhl', 'ncaa_basketball', 'ncaa_football'];
    
    // Scraping schedule configuration
    this.scrapingSchedules = {
      // Multiple times daily for active betting
      morning: '0 8 * * *',    // 8 AM
      midday: '0 12 * * *',    // 12 PM
      afternoon: '0 16 * * *', // 4 PM
      evening: '0 20 * * *',   // 8 PM
      night: '0 23 * * *'      // 11 PM
    };
  }

  /**
   * Initialize the odds tracker
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Ensure betting snapshots table exists
      await this.snapshotRepo.createTable();
      
      // Schedule automated scraping
      this.scheduleAutomatedScraping();
      
      this.isInitialized = true;
      logger.info('OddsTracker initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize OddsTracker', { error: error.message });
      throw error;
    }
  }

  /**
   * Schedule automated odds scraping
   */
  scheduleAutomatedScraping() {
    Object.entries(this.scrapingSchedules).forEach(([name, schedule]) => {
      const job = cron.schedule(schedule, async () => {
        logger.info('Running scheduled odds scraping', { schedule: name });
        await this.scrapeAllSports();
      }, {
        scheduled: false,
        timezone: 'America/New_York'
      });

      this.scheduledJobs.set(name, job);
      job.start();
      
      logger.info('Scheduled odds scraping job', { name, schedule });
    });
  }

  /**
   * Scrape odds for all supported sports
   * @returns {Promise<Object>} - Scraping results
   */
  async scrapeAllSports() {
    try {
      logger.info('Starting automated odds scraping for all sports');
      
      const results = {
        success: [],
        failed: [],
        totalSnapshots: 0,
        startTime: new Date()
      };
      
      for (const sport of this.supportedSports) {
        try {
          const sportResult = await this.scrapeSport(sport);
          results.success.push({
            sport,
            snapshots: sportResult.snapshots,
            movements: sportResult.movements
          });
          results.totalSnapshots += sportResult.snapshots;
          
        } catch (error) {
          logger.error('Failed to scrape sport during automated run', {
            sport,
            error: error.message
          });
          results.failed.push({ sport, error: error.message });
        }
        
        // Add delay between sports to be respectful
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      results.endTime = new Date();
      results.duration = results.endTime - results.startTime;
      
      logger.info('Completed automated odds scraping', {
        successfulSports: results.success.length,
        failedSports: results.failed.length,
        totalSnapshots: results.totalSnapshots,
        durationMs: results.duration
      });
      
      return results;
      
    } catch (error) {
      logger.error('Failed automated odds scraping', { error: error.message });
      throw error;
    }
  }

  /**
   * Scrape odds for a specific sport and store in database
   * @param {string} sport - Sport key
   * @returns {Promise<Object>} - Scraping result
   */
  async scrapeSport(sport) {
    try {
      logger.info('Starting odds scraping for sport', { sport });
      
      // Scrape current odds
      const snapshots = await this.scraper.scrapeOdds(sport);
      
      if (snapshots.length === 0) {
        logger.warn('No betting snapshots found for sport', { sport });
        return { snapshots: 0, movements: [] };
      }
      
      const movements = [];
      let savedSnapshots = 0;
      
      // Process each snapshot
      for (const snapshot of snapshots) {
        try {
          // Get previous snapshot for movement detection
          const previousSnapshot = await this.snapshotRepo.getPreviousSnapshot(
            snapshot.gameId,
            snapshot.sport,
            snapshot.scrapedAt
          );
          
          // Detect line movements
          if (previousSnapshot) {
            const movement = snapshot.detectMovement(previousSnapshot);
            if (movement.hasMovement) {
              movements.push({
                gameId: snapshot.gameId,
                sport: snapshot.sport,
                movements: movement.movements,
                significantMovements: movement.significantMovements
              });
              
              logger.info('Detected line movement', {
                gameId: snapshot.gameId,
                sport: snapshot.sport,
                significantMovements: movement.significantMovements
              });
            }
          }
          
          // Save snapshot to database
          await this.snapshotRepo.save(snapshot);
          savedSnapshots++;
          
        } catch (error) {
          logger.error('Failed to process betting snapshot', {
            gameId: snapshot.gameId,
            sport: snapshot.sport,
            error: error.message
          });
        }
      }
      
      logger.info('Completed odds scraping for sport', {
        sport,
        totalSnapshots: snapshots.length,
        savedSnapshots,
        movements: movements.length
      });
      
      return {
        snapshots: savedSnapshots,
        movements
      };
      
    } catch (error) {
      logger.error('Failed to scrape sport odds', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get latest betting snapshot for a game
   * @param {string} gameId - Game ID
   * @param {string} sport - Sport key
   * @returns {Promise<BettingSnapshot|null>} - Latest snapshot or null
   */
  async getLatestOdds(gameId, sport) {
    try {
      return await this.snapshotRepo.getLatestForGame(gameId, sport);
    } catch (error) {
      logger.error('Failed to get latest odds', { gameId, sport, error: error.message });
      return null;
    }
  }

  /**
   * Get betting history for a game
   * @param {string} gameId - Game ID
   * @param {string} sport - Sport key
   * @param {number} limit - Maximum snapshots to return
   * @returns {Promise<BettingSnapshot[]>} - Array of snapshots
   */
  async getBettingHistory(gameId, sport, limit = 20) {
    try {
      return await this.snapshotRepo.getHistoryForGame(gameId, sport, limit);
    } catch (error) {
      logger.error('Failed to get betting history', { gameId, sport, error: error.message });
      return [];
    }
  }

  /**
   * Get recent line movements across all games
   * @param {string} sport - Sport key
   * @param {number} hoursBack - Hours to look back for movements
   * @returns {Promise<Array>} - Array of recent movements
   */
  async getRecentMovements(sport, hoursBack = 24) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - hoursBack);
      
      const snapshots = await this.snapshotRepo.getSnapshotsForDate(sport, new Date());
      const movements = [];
      
      // Group snapshots by game
      const gameSnapshots = {};
      snapshots.forEach(snapshot => {
        if (!gameSnapshots[snapshot.gameId]) {
          gameSnapshots[snapshot.gameId] = [];
        }
        gameSnapshots[snapshot.gameId].push(snapshot);
      });
      
      // Detect movements for each game
      Object.entries(gameSnapshots).forEach(([gameId, gameSnaps]) => {
        if (gameSnaps.length < 2) return;
        
        // Sort by scraped time
        gameSnaps.sort((a, b) => new Date(a.scrapedAt) - new Date(b.scrapedAt));
        
        // Compare latest with previous
        const latest = gameSnaps[gameSnaps.length - 1];
        const previous = gameSnaps[gameSnaps.length - 2];
        
        if (new Date(latest.scrapedAt) >= cutoffDate) {
          const movement = latest.detectMovement(previous);
          if (movement.hasMovement) {
            movements.push({
              gameId,
              sport,
              latest,
              previous,
              movements: movement.movements,
              significantMovements: movement.significantMovements,
              timestamp: latest.scrapedAt
            });
          }
        }
      });
      
      // Sort by timestamp (most recent first)
      movements.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return movements;
      
    } catch (error) {
      logger.error('Failed to get recent movements', { sport, error: error.message });
      return [];
    }
  }

  /**
   * Manual odds scraping trigger
   * @param {string} sport - Sport key (optional, scrapes all if not provided)
   * @returns {Promise<Object>} - Scraping results
   */
  async manualScrape(sport = null) {
    try {
      if (sport) {
        logger.info('Manual odds scraping triggered for sport', { sport });
        const result = await this.scrapeSport(sport);
        return { [sport]: result };
      } else {
        logger.info('Manual odds scraping triggered for all sports');
        return await this.scrapeAllSports();
      }
    } catch (error) {
      logger.error('Manual odds scraping failed', { sport, error: error.message });
      throw error;
    }
  }

  /**
   * Mark stale odds and clean up old data
   * @returns {Promise<Object>} - Cleanup results
   */
  async performMaintenance() {
    try {
      logger.info('Starting odds tracker maintenance');
      
      // Mark stale snapshots (older than 6 hours)
      const staleCount = await this.snapshotRepo.markStaleSnapshots(6);
      
      // Optional: Clean up very old snapshots (older than 1 year)
      // Uncomment if storage becomes an issue
      // const cleanedCount = await this.snapshotRepo.cleanupOldSnapshots(365);
      
      logger.info('Completed odds tracker maintenance', {
        staleSnapshots: staleCount
        // cleanedSnapshots: cleanedCount
      });
      
      return {
        staleSnapshots: staleCount
        // cleanedSnapshots: cleanedCount
      };
      
    } catch (error) {
      logger.error('Failed odds tracker maintenance', { error: error.message });
      throw error;
    }
  }

  /**
   * Get odds tracking statistics
   * @param {string} sport - Sport key
   * @param {number} daysBack - Days to analyze
   * @returns {Promise<Object>} - Statistics
   */
  async getTrackingStats(sport, daysBack = 7) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);
      
      const stats = await this.snapshotRepo.getBettingStats(sport, startDate, endDate);
      
      return {
        ...stats,
        scrapingSchedules: Object.keys(this.scrapingSchedules).length,
        isTracking: this.isInitialized,
        supportedSports: this.supportedSports
      };
      
    } catch (error) {
      logger.error('Failed to get tracking stats', { sport, error: error.message });
      throw error;
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopScheduledJobs() {
    for (const [name, job] of this.scheduledJobs) {
      job.stop();
      logger.info('Stopped scheduled odds scraping job', { name });
    }
    this.scheduledJobs.clear();
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopScheduledJobs();
    this.isInitialized = false;
    logger.info('OddsTracker cleanup completed');
  }
}

module.exports = OddsTracker;