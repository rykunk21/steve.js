const logger = require('../../utils/logger');

/**
 * Generates visual spread bars using Discord emoji squares
 */
class SpreadBarGenerator {
  constructor() {
    this.TOTAL_SQUARES = 16; // iOS Discord compatible width
    this.MAX_SPREAD = 21; // Maximum spread for scaling
  }

  /**
   * Generate visual spread bar with team colors
   * @param {Object} awayTeam - Away team object
   * @param {Object} homeTeam - Home team object
   * @param {number} spread - Point spread (negative = home favored)
   * @param {string} awayColor - Away team emoji color
   * @param {string} homeColor - Home team emoji color
   * @returns {Object} - { bar, awaySquares, homeSquares, favorite }
   */
  generateSpreadBar(awayTeam, homeTeam, spread, awayColor, homeColor) {
    try {
      // Handle pick'em or missing spread
      if (spread === null || spread === undefined || spread === 0) {
        return {
          bar: this.renderBar(awayColor, 8, homeColor, 8),
          awaySquares: 8,
          homeSquares: 8,
          favorite: null,
          spreadText: 'PICK\'EM'
        };
      }

      // Calculate square distribution
      const distribution = this.calculateSquareDistribution(spread);
      
      // Determine favorite
      const isFavoriteHome = spread < 0;
      const favorite = isFavoriteHome ? 'home' : 'away';
      const absSpread = Math.abs(spread);

      // Generate bar
      const bar = this.renderBar(
        awayColor,
        distribution.awaySquares,
        homeColor,
        distribution.homeSquares
      );

      // Generate spread text
      const favoriteTeam = isFavoriteHome ? homeTeam : awayTeam;
      const favoriteAbbrev = favoriteTeam.abbreviation || favoriteTeam.name;
      const spreadText = `${favoriteAbbrev} -${absSpread}`;

      return {
        bar,
        awaySquares: distribution.awaySquares,
        homeSquares: distribution.homeSquares,
        favorite,
        spreadText
      };

    } catch (error) {
      logger.error('Failed to generate spread bar', {
        spread,
        error: error.message
      });
      
      // Return neutral bar on error
      return {
        bar: this.renderBar(awayColor, 8, homeColor, 8),
        awaySquares: 8,
        homeSquares: 8,
        favorite: null,
        spreadText: 'N/A'
      };
    }
  }

  /**
   * Calculate square distribution based on spread
   * Uses exponential scaling for extreme spreads
   * @param {number} spread - Point spread (negative = home favored)
   * @returns {Object} - { awaySquares, homeSquares }
   */
  calculateSquareDistribution(spread) {
    const absSpread = Math.abs(spread);
    const isFavoriteHome = spread < 0;

    // Calculate percentage using exponential scaling
    let percentage;
    
    if (absSpread <= 7) {
      // Linear scaling for moderate spreads (50-70% range)
      // This keeps 3-7 point spreads visually distinguishable
      percentage = 0.5 + (absSpread / this.MAX_SPREAD) * 0.5;
    } else {
      // Exponential scaling for large spreads (70-93% range)
      // This allows 15-1 splits for very large spreads
      const normalized = (absSpread - 7) / (this.MAX_SPREAD - 7);
      percentage = 0.7 + (Math.pow(normalized, 1.5) * 0.23);
    }

    // Cap at 93.75% (15 of 16 squares)
    percentage = Math.min(percentage, 0.9375);

    // Calculate square counts
    const favoriteSquares = Math.round(this.TOTAL_SQUARES * percentage);
    const underdogSquares = this.TOTAL_SQUARES - favoriteSquares;

    return {
      awaySquares: isFavoriteHome ? underdogSquares : favoriteSquares,
      homeSquares: isFavoriteHome ? favoriteSquares : underdogSquares
    };
  }

  /**
   * Render the visual bar with emoji squares
   * @param {string} awayColor - Away team emoji
   * @param {number} awaySquares - Number of away squares
   * @param {string} homeColor - Home team emoji
   * @param {number} homeSquares - Number of home squares
   * @returns {string} - Rendered bar
   */
  renderBar(awayColor, awaySquares, homeColor, homeSquares) {
    const awayPart = awayColor.repeat(awaySquares);
    const homePart = homeColor.repeat(homeSquares);
    return `${awayPart}${homePart}`;
  }

  /**
   * Generate complete spread visualization with labels
   * @param {Object} awayTeam - Away team object
   * @param {Object} homeTeam - Home team object
   * @param {number} spread - Point spread
   * @param {string} awayColor - Away team emoji color
   * @param {string} homeColor - Home team emoji color
   * @returns {string} - Complete visualization with labels
   */
  generateSpreadVisualization(awayTeam, homeTeam, spread, awayColor, homeColor) {
    const barData = this.generateSpreadBar(awayTeam, homeTeam, spread, awayColor, homeColor);
    
    const awayAbbrev = awayTeam.abbreviation || awayTeam.name;
    const homeAbbrev = homeTeam.abbreviation || homeTeam.name;

    // Format: AWAY ← [BAR] → HOME | FAVORITE -SPREAD
    return `${awayAbbrev} ← ${barData.bar} → ${homeAbbrev} | ${barData.spreadText}`;
  }
}

module.exports = SpreadBarGenerator;
