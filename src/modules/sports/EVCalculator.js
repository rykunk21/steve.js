const logger = require('../../utils/logger');

/**
 * Expected Value Calculator for betting opportunities
 * Compares simulated probabilities against market-implied probabilities
 * to identify positive expected value (+EV) betting opportunities
 */
class EVCalculator {
  constructor(config = {}) {
    this.minEVThreshold = config.minEVThreshold || 0.05; // 5% minimum edge
  }

  /**
   * Calculate expected value for all betting markets
   * @param {Object} simulationResults - Results from MCMC simulation
   * @param {Object} bettingOdds - Current betting odds
   * @param {Object} gameData - Game information
   * @returns {Array} - Array of betting opportunities
   */
  calculateEV(simulationResults, bettingOdds, gameData) {
    const opportunities = [];

    try {
      // 1. Moneyline EV
      if (bettingOdds.homeMoneyline && bettingOdds.awayMoneyline) {
        const homeML = this.calculateMoneylineEV(
          simulationResults.homeWinProb,
          bettingOdds.homeMoneyline,
          'Home',
          gameData.teams.home
        );

        const awayML = this.calculateMoneylineEV(
          simulationResults.awayWinProb,
          bettingOdds.awayMoneyline,
          'Away',
          gameData.teams.away
        );

        if (homeML.ev >= this.minEVThreshold) opportunities.push(homeML);
        if (awayML.ev >= this.minEVThreshold) opportunities.push(awayML);
      }

      // 2. Spread EV
      if (bettingOdds.spreadLine !== null && bettingOdds.spreadLine !== undefined) {
        const spreadEV = this.calculateSpreadEV(
          simulationResults,
          bettingOdds,
          gameData
        );

        if (spreadEV && Math.abs(spreadEV.ev) >= this.minEVThreshold) {
          opportunities.push(spreadEV);
        }
      }

      // 3. Total EV
      if (bettingOdds.totalLine !== null && bettingOdds.totalLine !== undefined) {
        const totalEV = this.calculateTotalEV(
          simulationResults,
          bettingOdds,
          gameData
        );

        if (totalEV && Math.abs(totalEV.ev) >= this.minEVThreshold) {
          opportunities.push(totalEV);
        }
      }

      logger.debug('Calculated EV for all markets', {
        opportunitiesFound: opportunities.length,
        minThreshold: this.minEVThreshold
      });

    } catch (error) {
      logger.error('Failed to calculate EV', {
        error: error.message
      });
    }

    return opportunities;
  }

  /**
   * Calculate moneyline expected value
   * @param {number} winProb - Simulated win probability
   * @param {number} odds - American odds
   * @param {string} side - 'Home' or 'Away'
   * @param {Object} team - Team information
   * @returns {Object} - Moneyline EV opportunity
   */
  calculateMoneylineEV(winProb, odds, side, team) {
    const impliedProb = this.oddsToImpliedProbability(odds);
    const ev = winProb - impliedProb;

    return {
      type: 'moneyline',
      side: side,
      team: team.abbreviation || team.name,
      pick: `${team.abbreviation || team.name} ML ${this.formatOdds(odds)}`,
      simulatedProb: winProb,
      impliedProb: impliedProb,
      ev: ev,
      evPercent: (ev * 100).toFixed(1),
      odds: odds,
      confidence: this.calculateConfidence(ev)
    };
  }

  /**
   * Calculate spread expected value
   * @param {Object} simulationResults - Simulation results
   * @param {Object} bettingOdds - Betting odds
   * @param {Object} gameData - Game data
   * @returns {Object|null} - Spread EV opportunity
   */
  calculateSpreadEV(simulationResults, bettingOdds, gameData) {
    try {
      const spreadValue = Math.abs(bettingOdds.spreadLine);
      const margins = simulationResults.margins;

      // Determine which team is favored
      const isFavoriteHome = bettingOdds.spreadLine < 0;
      const favoriteTeam = isFavoriteHome ? gameData.teams.home : gameData.teams.away;
      const underdogTeam = isFavoriteHome ? gameData.teams.away : gameData.teams.home;

      // Count how many simulations covered the spread
      let favoriteCoverCount = 0;
      for (const margin of margins) {
        if (isFavoriteHome) {
          // Home is favorite - need to win by more than spread
          if (margin > spreadValue) favoriteCoverCount++;
        } else {
          // Away is favorite - need to win by more than spread (negative margin)
          if (margin < -spreadValue) favoriteCoverCount++;
        }
      }

      const favoriteCoverProb = favoriteCoverCount / margins.length;
      const underdogCoverProb = 1 - favoriteCoverProb;

      // Get odds for each side
      const favoriteOdds = isFavoriteHome ? 
        (bettingOdds.homeSpreadOdds || -110) : 
        (bettingOdds.awaySpreadOdds || -110);
      
      const underdogOdds = isFavoriteHome ? 
        (bettingOdds.awaySpreadOdds || -110) : 
        (bettingOdds.homeSpreadOdds || -110);

      // Calculate EV for both sides
      const favoriteImpliedProb = this.oddsToImpliedProbability(favoriteOdds);
      const underdogImpliedProb = this.oddsToImpliedProbability(underdogOdds);

      const favoriteEV = favoriteCoverProb - favoriteImpliedProb;
      const underdogEV = underdogCoverProb - underdogImpliedProb;

      // Return the side with better EV
      if (Math.abs(favoriteEV) > Math.abs(underdogEV)) {
        return {
          type: 'spread',
          side: 'Favorite',
          team: favoriteTeam.abbreviation || favoriteTeam.name,
          pick: `${favoriteTeam.abbreviation || favoriteTeam.name} ${bettingOdds.spreadLine} (${this.formatOdds(favoriteOdds)})`,
          simulatedProb: favoriteCoverProb,
          impliedProb: favoriteImpliedProb,
          ev: favoriteEV,
          evPercent: (favoriteEV * 100).toFixed(1),
          odds: favoriteOdds,
          spread: bettingOdds.spreadLine,
          confidence: this.calculateConfidence(favoriteEV)
        };
      } else {
        const underdogSpread = isFavoriteHome ? 
          `+${spreadValue}` : 
          `+${spreadValue}`;
        
        return {
          type: 'spread',
          side: 'Underdog',
          team: underdogTeam.abbreviation || underdogTeam.name,
          pick: `${underdogTeam.abbreviation || underdogTeam.name} ${underdogSpread} (${this.formatOdds(underdogOdds)})`,
          simulatedProb: underdogCoverProb,
          impliedProb: underdogImpliedProb,
          ev: underdogEV,
          evPercent: (underdogEV * 100).toFixed(1),
          odds: underdogOdds,
          spread: underdogSpread,
          confidence: this.calculateConfidence(underdogEV)
        };
      }

    } catch (error) {
      logger.warn('Failed to calculate spread EV', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Calculate total (over/under) expected value
   * @param {Object} simulationResults - Simulation results
   * @param {Object} bettingOdds - Betting odds
   * @param {Object} gameData - Game data
   * @returns {Object|null} - Total EV opportunity
   */
  calculateTotalEV(simulationResults, bettingOdds, gameData) {
    try {
      const totalValue = bettingOdds.totalLine;
      const homeScores = simulationResults.homeScores;
      const awayScores = simulationResults.awayScores;

      // Calculate combined scores
      const combinedScores = homeScores.map((h, i) => h + awayScores[i]);

      // Count overs and unders
      const overCount = combinedScores.filter(s => s > totalValue).length;
      const underCount = combinedScores.filter(s => s < totalValue).length;

      const overProb = overCount / combinedScores.length;
      const underProb = underCount / combinedScores.length;

      // Get odds
      const overOdds = bettingOdds.overOdds || -110;
      const underOdds = bettingOdds.underOdds || -110;

      // Calculate implied probabilities
      const overImpliedProb = this.oddsToImpliedProbability(overOdds);
      const underImpliedProb = this.oddsToImpliedProbability(underOdds);

      // Calculate EV for both sides
      const overEV = overProb - overImpliedProb;
      const underEV = underProb - underImpliedProb;

      // Return the side with better EV
      if (Math.abs(overEV) > Math.abs(underEV)) {
        return {
          type: 'total',
          side: 'Over',
          pick: `Over ${totalValue} (${this.formatOdds(overOdds)})`,
          simulatedProb: overProb,
          impliedProb: overImpliedProb,
          ev: overEV,
          evPercent: (overEV * 100).toFixed(1),
          odds: overOdds,
          total: totalValue,
          confidence: this.calculateConfidence(overEV)
        };
      } else {
        return {
          type: 'total',
          side: 'Under',
          pick: `Under ${totalValue} (${this.formatOdds(underOdds)})`,
          simulatedProb: underProb,
          impliedProb: underImpliedProb,
          ev: underEV,
          evPercent: (underEV * 100).toFixed(1),
          odds: underOdds,
          total: totalValue,
          confidence: this.calculateConfidence(underEV)
        };
      }

    } catch (error) {
      logger.warn('Failed to calculate total EV', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Convert American odds to implied probability
   * @param {number} americanOdds - American odds (e.g., -110, +150)
   * @returns {number} - Implied probability (0-1)
   */
  oddsToImpliedProbability(americanOdds) {
    if (americanOdds < 0) {
      // Favorite: -200 = 200/(200+100) = 0.667
      return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
    } else {
      // Underdog: +150 = 100/(150+100) = 0.400
      return 100 / (americanOdds + 100);
    }
  }

  /**
   * Format American odds for display
   * @param {number} odds - American odds
   * @returns {string} - Formatted odds
   */
  formatOdds(odds) {
    if (odds > 0) {
      return `+${odds}`;
    } else {
      return `${odds}`;
    }
  }

  /**
   * Calculate confidence level based on EV magnitude
   * @param {number} ev - Expected value
   * @returns {string} - Confidence level
   */
  calculateConfidence(ev) {
    const absEV = Math.abs(ev);
    
    if (absEV >= 0.15) return 'Very High';
    if (absEV >= 0.10) return 'High';
    if (absEV >= 0.05) return 'Medium';
    return 'Low';
  }

  /**
   * Sort opportunities by expected value
   * @param {Array} opportunities - Array of betting opportunities
   * @returns {Array} - Sorted opportunities (highest EV first)
   */
  sortByEV(opportunities) {
    return opportunities.sort((a, b) => Math.abs(b.ev) - Math.abs(a.ev));
  }

  /**
   * Format opportunities for display
   * @param {Array} opportunities - Array of betting opportunities
   * @returns {Array} - Formatted opportunities
   */
  formatOpportunities(opportunities) {
    return opportunities.map(opp => ({
      pick: opp.pick,
      type: opp.type,
      ev: `+${opp.evPercent}%`,
      simulatedProb: `${(opp.simulatedProb * 100).toFixed(1)}%`,
      impliedProb: `${(opp.impliedProb * 100).toFixed(1)}%`,
      confidence: opp.confidence
    }));
  }
}

module.exports = EVCalculator;
