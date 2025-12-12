/**
 * BettingSnapshot model for storing historical betting line data
 */
class BettingSnapshot {
  constructor(data = {}) {
    this.id = data.id || null;
    this.gameId = data.gameId || null;
    this.sport = data.sport || null;
    this.scrapedAt = data.scrapedAt || new Date();
    
    // Team information (for matching purposes)
    this.awayTeamName = data.awayTeamName || null;
    this.awayTeamAbbr = data.awayTeamAbbr || null;
    this.homeTeamName = data.homeTeamName || null;
    this.homeTeamAbbr = data.homeTeamAbbr || null;
    
    // Moneyline odds
    this.homeMoneyline = data.homeMoneyline || null;
    this.awayMoneyline = data.awayMoneyline || null;
    
    // Spread/Puck line (NHL uses puck line instead of spread)
    this.spreadLine = data.spreadLine || null; // e.g., -3.5, +1.5
    this.homeSpreadOdds = data.homeSpreadOdds || null;
    this.awaySpreadOdds = data.awaySpreadOdds || null;
    
    // Over/Under totals
    this.totalLine = data.totalLine || null; // e.g., 45.5, 6.5
    this.overOdds = data.overOdds || null;
    this.underOdds = data.underOdds || null;
    
    // Metadata
    this.source = data.source || 'ActionNetwork';
    this.sportsbook = data.sportsbook || null; // Primary sportsbook for this line
    this.isStale = data.isStale || false;
    
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  /**
   * Validate the betting snapshot data
   * @returns {Object} - Validation result with isValid and errors
   */
  validate() {
    const errors = [];

    if (!this.gameId) {
      errors.push('Game ID is required');
    }

    if (!this.sport) {
      errors.push('Sport is required');
    }

    if (!this.scrapedAt) {
      errors.push('Scraped timestamp is required');
    }

    // At least one betting line should be present
    const hasMoneyline = this.homeMoneyline && this.awayMoneyline;
    const hasSpread = this.spreadLine !== null && this.homeSpreadOdds && this.awaySpreadOdds;
    const hasTotal = this.totalLine !== null && this.overOdds && this.underOdds;

    if (!hasMoneyline && !hasSpread && !hasTotal) {
      errors.push('At least one complete betting line (moneyline, spread, or total) is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert to database-ready object
   * @returns {Object} - Database object
   */
  toDatabase() {
    return {
      id: this.id,
      game_id: this.gameId,
      sport: this.sport,
      scraped_at: this.scrapedAt,
      home_moneyline: this.homeMoneyline,
      away_moneyline: this.awayMoneyline,
      spread_line: this.spreadLine,
      home_spread_odds: this.homeSpreadOdds,
      away_spread_odds: this.awaySpreadOdds,
      total_line: this.totalLine,
      over_odds: this.overOdds,
      under_odds: this.underOdds,
      source: this.source,
      sportsbook: this.sportsbook,
      is_stale: this.isStale,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  /**
   * Create from database row
   * @param {Object} row - Database row
   * @returns {BettingSnapshot} - BettingSnapshot instance
   */
  static fromDatabase(row) {
    return new BettingSnapshot({
      id: row.id,
      gameId: row.game_id,
      sport: row.sport,
      scrapedAt: row.scraped_at,
      homeMoneyline: row.home_moneyline,
      awayMoneyline: row.away_moneyline,
      spreadLine: row.spread_line,
      homeSpreadOdds: row.home_spread_odds,
      awaySpreadOdds: row.away_spread_odds,
      totalLine: row.total_line,
      overOdds: row.over_odds,
      underOdds: row.under_odds,
      source: row.source,
      sportsbook: row.sportsbook,
      isStale: row.is_stale,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  /**
   * Check if this snapshot represents a significant line movement
   * @param {BettingSnapshot} previousSnapshot - Previous snapshot to compare against
   * @returns {Object} - Movement analysis
   */
  detectMovement(previousSnapshot) {
    if (!previousSnapshot) {
      return { hasMovement: false, movements: [] };
    }

    const movements = [];
    const SIGNIFICANT_SPREAD_MOVEMENT = 0.5; // 0.5 point movement
    const SIGNIFICANT_TOTAL_MOVEMENT = 0.5; // 0.5 point movement
    const SIGNIFICANT_MONEYLINE_MOVEMENT = 10; // 10 point movement

    // Check spread movement
    if (this.spreadLine !== null && previousSnapshot.spreadLine !== null) {
      const spreadDiff = Math.abs(this.spreadLine - previousSnapshot.spreadLine);
      if (spreadDiff >= SIGNIFICANT_SPREAD_MOVEMENT) {
        movements.push({
          type: 'spread',
          from: previousSnapshot.spreadLine,
          to: this.spreadLine,
          difference: this.spreadLine - previousSnapshot.spreadLine,
          isSignificant: true
        });
      }
    }

    // Check total movement
    if (this.totalLine !== null && previousSnapshot.totalLine !== null) {
      const totalDiff = Math.abs(this.totalLine - previousSnapshot.totalLine);
      if (totalDiff >= SIGNIFICANT_TOTAL_MOVEMENT) {
        movements.push({
          type: 'total',
          from: previousSnapshot.totalLine,
          to: this.totalLine,
          difference: this.totalLine - previousSnapshot.totalLine,
          isSignificant: true
        });
      }
    }

    // Check moneyline movement (home team)
    if (this.homeMoneyline && previousSnapshot.homeMoneyline) {
      const homeMLDiff = Math.abs(this.homeMoneyline - previousSnapshot.homeMoneyline);
      if (homeMLDiff >= SIGNIFICANT_MONEYLINE_MOVEMENT) {
        movements.push({
          type: 'home_moneyline',
          from: previousSnapshot.homeMoneyline,
          to: this.homeMoneyline,
          difference: this.homeMoneyline - previousSnapshot.homeMoneyline,
          isSignificant: true
        });
      }
    }

    // Check moneyline movement (away team)
    if (this.awayMoneyline && previousSnapshot.awayMoneyline) {
      const awayMLDiff = Math.abs(this.awayMoneyline - previousSnapshot.awayMoneyline);
      if (awayMLDiff >= SIGNIFICANT_MONEYLINE_MOVEMENT) {
        movements.push({
          type: 'away_moneyline',
          from: previousSnapshot.awayMoneyline,
          to: this.awayMoneyline,
          difference: this.awayMoneyline - previousSnapshot.awayMoneyline,
          isSignificant: true
        });
      }
    }

    return {
      hasMovement: movements.length > 0,
      movements,
      significantMovements: movements.filter(m => m.isSignificant).length
    };
  }

  /**
   * Generate progress bar for spread visualization
   * @param {number} maxSpread - Maximum spread for scaling (default: 14)
   * @returns {string} - Progress bar string
   */
  generateSpreadProgressBar(maxSpread = 14) {
    if (this.spreadLine === null) {
      return '▓▓▓▓▓▓▓▓▓▓'; // Default bar if no spread
    }

    const barLength = 10;
    const spread = this.spreadLine;
    
    // Calculate percentage (50% = pick'em, >50% = home favored, <50% = away favored)
    // Clamp spread to maxSpread for visualization
    const clampedSpread = Math.max(-maxSpread, Math.min(maxSpread, spread));
    const percentage = 50 + (clampedSpread / maxSpread) * 50;
    
    // Convert to bar position (0-10)
    const position = Math.round((percentage / 100) * barLength);
    const filledBars = Math.max(0, Math.min(barLength, position));
    
    const filled = '█'.repeat(filledBars);
    const empty = '░'.repeat(barLength - filledBars);
    
    return filled + empty;
  }

  /**
   * Format odds for display
   * @param {number} odds - American odds
   * @returns {string} - Formatted odds string
   */
  static formatOdds(odds) {
    if (!odds) return 'N/A';
    
    if (odds > 0) {
      return `+${odds}`;
    } else {
      return `${odds}`;
    }
  }

  /**
   * Get display summary of current lines
   * @returns {Object} - Display-ready betting information
   */
  getDisplaySummary() {
    return {
      moneyline: {
        home: BettingSnapshot.formatOdds(this.homeMoneyline),
        away: BettingSnapshot.formatOdds(this.awayMoneyline)
      },
      spread: {
        line: this.spreadLine !== null ? (this.spreadLine > 0 ? `+${this.spreadLine}` : `${this.spreadLine}`) : 'N/A',
        homeOdds: BettingSnapshot.formatOdds(this.homeSpreadOdds),
        awayOdds: BettingSnapshot.formatOdds(this.awaySpreadOdds),
        progressBar: this.generateSpreadProgressBar()
      },
      total: {
        line: this.totalLine !== null ? `${this.totalLine}` : 'N/A',
        overOdds: BettingSnapshot.formatOdds(this.overOdds),
        underOdds: BettingSnapshot.formatOdds(this.underOdds)
      },
      metadata: {
        source: this.source,
        sportsbook: this.sportsbook,
        scrapedAt: this.scrapedAt,
        isStale: this.isStale
      }
    };
  }
}

module.exports = BettingSnapshot;