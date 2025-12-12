const logger = require('../../utils/logger');

/**
 * Builds game representations for neural network input
 * Concatenates team features with contextual information
 */
class GameRepresentationBuilder {
  constructor(featureExtractor) {
    this.featureExtractor = featureExtractor;
    
    // Expected dimensions
    this.teamFeatureDim = 15; // From FeatureExtractor
    this.contextualFeatureDim = 5; // home/away, neutral, days since season start, day of week (2 dims)
    this.totalDim = this.teamFeatureDim * 2 + this.contextualFeatureDim; // 35 dimensions
  }

  /**
   * Build game representation from team features and game context
   * @param {Array} homeTeamFeatures - Home team feature vector (15 dims)
   * @param {Array} awayTeamFeatures - Away team feature vector (15 dims)
   * @param {Object} gameContext - Game contextual information
   * @returns {Array} - Game representation vector (35 dims)
   */
  buildRepresentation(homeTeamFeatures, awayTeamFeatures, gameContext) {
    // Validate inputs
    if (!homeTeamFeatures || homeTeamFeatures.length !== this.teamFeatureDim) {
      throw new Error(`Invalid home team features: expected ${this.teamFeatureDim} dimensions`);
    }

    if (!awayTeamFeatures || awayTeamFeatures.length !== this.teamFeatureDim) {
      throw new Error(`Invalid away team features: expected ${this.teamFeatureDim} dimensions`);
    }

    // Extract contextual features
    const contextualFeatures = this.extractContextualFeatures(gameContext);

    // Concatenate: [home features, away features, contextual features]
    const representation = [
      ...homeTeamFeatures,
      ...awayTeamFeatures,
      ...contextualFeatures
    ];

    logger.debug('Built game representation', {
      homeTeamId: gameContext.homeTeamId,
      awayTeamId: gameContext.awayTeamId,
      dimensions: representation.length,
      isNeutralSite: gameContext.isNeutralSite,
      daysSinceSeasonStart: contextualFeatures[2]
    });

    return representation;
  }

  /**
   * Extract contextual features from game information
   * @param {Object} gameContext - Game context
   * @returns {Array} - Contextual feature vector (5 dims)
   */
  extractContextualFeatures(gameContext) {
    // Feature 1: Home/Away indicator (1 = home has advantage, 0 = neutral)
    const homeIndicator = gameContext.isNeutralSite ? 0.5 : 1.0;

    // Feature 2: Neutral site indicator (1 = neutral, 0 = not neutral)
    const neutralSiteIndicator = gameContext.isNeutralSite ? 1.0 : 0.0;

    // Feature 3: Days since season start (normalized to [0, 1])
    const daysSinceSeasonStart = this.calculateDaysSinceSeasonStart(
      gameContext.gameDate,
      gameContext.seasonStartDate
    );
    const normalizedDays = Math.min(1.0, daysSinceSeasonStart / 150); // ~5 months

    // Features 4-5: Day of week encoding (sin/cos for cyclical encoding)
    const dayOfWeek = this.getDayOfWeek(gameContext.gameDate);
    const dayOfWeekSin = Math.sin(2 * Math.PI * dayOfWeek / 7);
    const dayOfWeekCos = Math.cos(2 * Math.PI * dayOfWeek / 7);

    return [
      homeIndicator,
      neutralSiteIndicator,
      normalizedDays,
      (dayOfWeekSin + 1) / 2, // Normalize to [0, 1]
      (dayOfWeekCos + 1) / 2  // Normalize to [0, 1]
    ];
  }

  /**
   * Calculate days since season start
   * @param {Date|string} gameDate - Game date
   * @param {Date|string} seasonStartDate - Season start date
   * @returns {number} - Days since season start
   */
  calculateDaysSinceSeasonStart(gameDate, seasonStartDate) {
    const game = gameDate instanceof Date ? gameDate : new Date(gameDate);
    const seasonStart = seasonStartDate instanceof Date 
      ? seasonStartDate 
      : new Date(seasonStartDate || this.getDefaultSeasonStart(game));

    const diffTime = game - seasonStart;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return Math.max(0, diffDays);
  }

  /**
   * Get default season start date based on game date
   * @param {Date} gameDate - Game date
   * @returns {Date} - Default season start date
   */
  getDefaultSeasonStart(gameDate) {
    const year = gameDate.getFullYear();
    const month = gameDate.getMonth();

    // NCAA basketball season typically starts in November
    if (month >= 10) { // November or later
      return new Date(year, 10, 1); // November 1st of current year
    } else {
      return new Date(year - 1, 10, 1); // November 1st of previous year
    }
  }

  /**
   * Get day of week (0 = Sunday, 6 = Saturday)
   * @param {Date|string} date - Date
   * @returns {number} - Day of week
   */
  getDayOfWeek(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.getDay();
  }

  /**
   * Build representations for multiple games (batch processing)
   * @param {Array} games - Array of game objects with team features and context
   * @returns {Array} - Array of game representations
   */
  buildBatch(games) {
    return games.map(game => {
      return this.buildRepresentation(
        game.homeTeamFeatures,
        game.awayTeamFeatures,
        game.context
      );
    });
  }

  /**
   * Build game representation from team IDs and historical data
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Array} homeTeamGames - Home team historical games
   * @param {Array} awayTeamGames - Away team historical games
   * @param {Object} gameContext - Game context
   * @returns {Array} - Game representation vector
   */
  async buildFromTeamHistory(homeTeamId, awayTeamId, homeTeamGames, awayTeamGames, gameContext) {
    // Extract features for both teams
    const homeFeatures = this.featureExtractor.extractFeatures(homeTeamGames, homeTeamId);
    const awayFeatures = this.featureExtractor.extractFeatures(awayTeamGames, awayTeamId);

    // Build representation
    return this.buildRepresentation(homeFeatures, awayFeatures, {
      ...gameContext,
      homeTeamId,
      awayTeamId
    });
  }

  /**
   * Get total dimension of game representation
   * @returns {number} - Total dimensions
   */
  getDimension() {
    return this.totalDim;
  }

  /**
   * Validate game representation
   * @param {Array} representation - Game representation vector
   * @returns {boolean} - Whether representation is valid
   */
  validateRepresentation(representation) {
    if (!Array.isArray(representation)) {
      return false;
    }

    if (representation.length !== this.totalDim) {
      return false;
    }

    // Check that all values are numbers in [0, 1]
    return representation.every(val => 
      typeof val === 'number' && 
      !isNaN(val) && 
      val >= 0 && 
      val <= 1
    );
  }

  /**
   * Split representation back into components
   * @param {Array} representation - Game representation vector
   * @returns {Object} - Components (home features, away features, contextual)
   */
  splitRepresentation(representation) {
    if (representation.length !== this.totalDim) {
      throw new Error(`Invalid representation length: expected ${this.totalDim}, got ${representation.length}`);
    }

    return {
      homeFeatures: representation.slice(0, this.teamFeatureDim),
      awayFeatures: representation.slice(this.teamFeatureDim, this.teamFeatureDim * 2),
      contextualFeatures: representation.slice(this.teamFeatureDim * 2)
    };
  }
}

module.exports = GameRepresentationBuilder;
