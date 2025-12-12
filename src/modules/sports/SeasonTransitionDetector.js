const logger = require('../../utils/logger');

/**
 * Season Transition Detector
 * 
 * Detects when a new basketball season begins and manages season boundaries
 * Tracks current season in team statistical representations
 * 
 * Key Features:
 * - Detects season transitions based on game dates
 * - Tracks current season for each team
 * - Provides season boundary logic for basketball (typically November start)
 * - Logs season transitions for monitoring
 */
class SeasonTransitionDetector {
  constructor(options = {}) {
    // Season configuration
    this.seasonStartMonth = options.seasonStartMonth !== undefined ? options.seasonStartMonth : 10; // November (0-indexed)
    this.seasonStartDay = options.seasonStartDay || 1; // November 1st
    this.seasonEndMonth = options.seasonEndMonth !== undefined ? options.seasonEndMonth : 2; // March (0-indexed)
    this.seasonEndDay = options.seasonEndDay || 31; // March 31st
    
    // Logging configuration
    this.logTransitions = options.logTransitions !== false; // Default true
    
    logger.info('Initialized SeasonTransitionDetector', {
      seasonStartMonth: this.seasonStartMonth + 1, // Display as 1-indexed
      seasonStartDay: this.seasonStartDay,
      seasonEndMonth: this.seasonEndMonth + 1,
      seasonEndDay: this.seasonEndDay
    });
  }

  /**
   * Determine the season for a given date
   * Basketball seasons span calendar years (e.g., 2024-25 season)
   * @param {Date} date - Game date
   * @returns {string} - Season string (e.g., "2024-25")
   */
  getSeasonForDate(date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }

    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed
    const day = date.getDate();

    // Basketball season typically runs November to March
    // November-December games are in the first half of the season
    // January-March games are in the second half of the season
    
    if (month > this.seasonStartMonth || 
        (month === this.seasonStartMonth && day >= this.seasonStartDay)) {
      // November or later in the year -> start of new season
      return `${year}-${(year + 1).toString().slice(-2)}`;
    } else if (month < this.seasonEndMonth || 
               (month === this.seasonEndMonth && day <= this.seasonEndDay)) {
      // January-March -> second half of season that started previous year
      return `${year - 1}-${year.toString().slice(-2)}`;
    } else {
      // April-October -> off-season, use previous season
      return `${year - 1}-${year.toString().slice(-2)}`;
    }
  }

  /**
   * Check if a date represents a season transition
   * @param {Date} currentDate - Current game date
   * @param {string} lastKnownSeason - Last known season (e.g., "2023-24")
   * @returns {Object} - {isTransition: boolean, newSeason: string, previousSeason: string}
   */
  checkSeasonTransition(currentDate, lastKnownSeason) {
    const currentSeason = this.getSeasonForDate(currentDate);
    const isTransition = lastKnownSeason ? lastKnownSeason !== currentSeason : false;

    const result = {
      isTransition,
      newSeason: currentSeason,
      previousSeason: lastKnownSeason,
      transitionDate: isTransition ? currentDate : null
    };

    if (isTransition && this.logTransitions) {
      logger.info('Season transition detected', {
        previousSeason: lastKnownSeason,
        newSeason: currentSeason,
        transitionDate: currentDate.toISOString(),
        gameDate: currentDate.toDateString()
      });
    }

    return result;
  }

  /**
   * Get the current season based on today's date
   * @returns {string} - Current season string
   */
  getCurrentSeason() {
    return this.getSeasonForDate(new Date());
  }

  /**
   * Check if a given date is in the current season
   * @param {Date} date - Date to check
   * @returns {boolean} - True if date is in current season
   */
  isCurrentSeason(date) {
    const currentSeason = this.getCurrentSeason();
    const dateSeason = this.getSeasonForDate(date);
    return currentSeason === dateSeason;
  }

  /**
   * Get season start date for a given season
   * @param {string} season - Season string (e.g., "2024-25")
   * @returns {Date} - Season start date
   */
  getSeasonStartDate(season) {
    const [startYear] = season.split('-');
    const year = parseInt(startYear, 10);
    
    return new Date(year, this.seasonStartMonth, this.seasonStartDay);
  }

  /**
   * Get season end date for a given season
   * @param {string} season - Season string (e.g., "2024-25")
   * @returns {Date} - Season end date
   */
  getSeasonEndDate(season) {
    const [startYear] = season.split('-');
    const endYear = parseInt(startYear, 10) + 1;
    
    return new Date(endYear, this.seasonEndMonth, this.seasonEndDay);
  }

  /**
   * Check if a date falls within a specific season's boundaries
   * @param {Date} date - Date to check
   * @param {string} season - Season string (e.g., "2024-25")
   * @returns {boolean} - True if date is within season boundaries
   */
  isDateInSeason(date, season) {
    const seasonStart = this.getSeasonStartDate(season);
    const seasonEnd = this.getSeasonEndDate(season);
    
    return date >= seasonStart && date <= seasonEnd;
  }

  /**
   * Get all seasons between two dates
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array<string>} - Array of season strings
   */
  getSeasonsBetweenDates(startDate, endDate) {
    const seasons = new Set();
    
    // Start from the first date and iterate through each month
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const season = this.getSeasonForDate(current);
      seasons.add(season);
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }
    
    return Array.from(seasons).sort();
  }

  /**
   * Calculate days since season start for a given date
   * @param {Date} date - Date to check
   * @returns {number} - Days since season start (negative if before season start)
   */
  getDaysSinceSeasonStart(date) {
    const season = this.getSeasonForDate(date);
    const seasonStart = this.getSeasonStartDate(season);
    
    const diffTime = date.getTime() - seasonStart.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  /**
   * Get season progress as a percentage (0-100)
   * @param {Date} date - Date to check
   * @returns {number} - Season progress percentage
   */
  getSeasonProgress(date) {
    const season = this.getSeasonForDate(date);
    const seasonStart = this.getSeasonStartDate(season);
    const seasonEnd = this.getSeasonEndDate(season);
    
    if (date < seasonStart) return 0;
    if (date > seasonEnd) return 100;
    
    const totalDays = seasonEnd.getTime() - seasonStart.getTime();
    const elapsedDays = date.getTime() - seasonStart.getTime();
    
    return Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  }

  /**
   * Check if we're in the early part of a season (first 25% of season)
   * @param {Date} date - Date to check
   * @returns {boolean} - True if in early season
   */
  isEarlySeason(date) {
    return this.getSeasonProgress(date) <= 25;
  }

  /**
   * Check if we're in the late part of a season (last 25% of season)
   * @param {Date} date - Date to check
   * @returns {boolean} - True if in late season
   */
  isLateSeason(date) {
    return this.getSeasonProgress(date) >= 75;
  }

  /**
   * Check if we're in postseason (March Madness typically)
   * @param {Date} date - Date to check
   * @returns {boolean} - True if likely postseason
   */
  isPostseason(date) {
    const month = date.getMonth(); // 0-indexed
    const day = date.getDate();
    
    // March Madness typically runs mid-March to early April
    return (month === 2 && day >= 15) || (month === 3 && day <= 10); // March 15 - April 10
  }

  /**
   * Get season metadata for a given season
   * @param {string} season - Season string (e.g., "2024-25")
   * @returns {Object} - Season metadata
   */
  getSeasonMetadata(season) {
    const startDate = this.getSeasonStartDate(season);
    const endDate = this.getSeasonEndDate(season);
    const currentDate = new Date();
    
    return {
      season,
      startDate,
      endDate,
      isCurrentSeason: this.isCurrentSeason(currentDate),
      isFutureSeason: startDate > currentDate,
      isPastSeason: endDate < currentDate,
      durationDays: Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
      progress: this.isCurrentSeason(currentDate) ? this.getSeasonProgress(currentDate) : null
    };
  }

  /**
   * Validate season string format
   * @param {string} season - Season string to validate
   * @returns {boolean} - True if valid format
   */
  isValidSeasonFormat(season) {
    if (typeof season !== 'string') return false;
    
    const pattern = /^\d{4}-\d{2}$/;
    if (!pattern.test(season)) return false;
    
    const [startYear, endYearShort] = season.split('-');
    const startYearNum = parseInt(startYear, 10);
    const endYearNum = parseInt(`20${endYearShort}`, 10);
    
    // End year should be start year + 1
    return endYearNum === startYearNum + 1;
  }

  /**
   * Parse season string to get start and end years
   * @param {string} season - Season string (e.g., "2024-25")
   * @returns {Object} - {startYear: number, endYear: number}
   */
  parseSeasonString(season) {
    if (!this.isValidSeasonFormat(season)) {
      throw new Error(`Invalid season format: ${season}. Expected format: YYYY-YY`);
    }
    
    const [startYear, endYearShort] = season.split('-');
    const startYearNum = parseInt(startYear, 10);
    const endYearNum = parseInt(`20${endYearShort}`, 10);
    
    return {
      startYear: startYearNum,
      endYear: endYearNum
    };
  }

  /**
   * Get configuration object
   * @returns {Object} - Current configuration
   */
  getConfiguration() {
    return {
      seasonStartMonth: this.seasonStartMonth,
      seasonStartDay: this.seasonStartDay,
      seasonEndMonth: this.seasonEndMonth,
      seasonEndDay: this.seasonEndDay,
      logTransitions: this.logTransitions
    };
  }

  /**
   * Update configuration
   * @param {Object} config - New configuration options
   */
  updateConfiguration(config) {
    if (config.seasonStartMonth !== undefined) {
      this.seasonStartMonth = config.seasonStartMonth;
    }
    if (config.seasonStartDay !== undefined) {
      this.seasonStartDay = config.seasonStartDay;
    }
    if (config.seasonEndMonth !== undefined) {
      this.seasonEndMonth = config.seasonEndMonth;
    }
    if (config.seasonEndDay !== undefined) {
      this.seasonEndDay = config.seasonEndDay;
    }
    if (config.logTransitions !== undefined) {
      this.logTransitions = config.logTransitions;
    }

    logger.info('Updated SeasonTransitionDetector configuration', config);
  }
}

module.exports = SeasonTransitionDetector;