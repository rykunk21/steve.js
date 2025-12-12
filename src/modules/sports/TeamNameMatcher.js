const logger = require('../../utils/logger');

/**
 * TeamNameMatcher - Matches ESPN games to Action Network games using fuzzy string matching
 * 
 * This module handles the challenge of matching games between two data sources that use
 * different team naming conventions (e.g., "Kansas" vs "KU", "Miami (FL)" vs "Miami")
 */
class TeamNameMatcher {
  /**
   * Normalize a team name for comparison
   * Converts to lowercase, removes special characters, and trims whitespace
   * 
   * @param {string} name - Team name to normalize
   * @returns {string} Normalized team name
   */
  normalizeTeamName(name) {
    if (!name || typeof name !== 'string') {
      return '';
    }

    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns a score between 0.0 (no match) and 1.0 (exact match)
   * Includes substring matching bonus for partial matches
   * 
   * @param {string} str1 - First string to compare
   * @param {string} str2 - Second string to compare
   * @returns {number} Similarity score between 0.0 and 1.0
   */
  calculateSimilarity(str1, str2) {
    const s1 = this.normalizeTeamName(str1);
    const s2 = this.normalizeTeamName(str2);

    // Handle empty strings
    if (!s1 || !s2) {
      return 0.0;
    }

    // Exact match
    if (s1 === s2) {
      return 1.0;
    }

    // Substring match bonus
    if (s1.includes(s2) || s2.includes(s1)) {
      const longer = Math.max(s1.length, s2.length);
      const shorter = Math.min(s1.length, s2.length);
      // Base score of 0.85 plus bonus based on length ratio
      return 0.85 + (0.15 * (shorter / longer));
    }

    // Levenshtein distance calculation
    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    // Convert distance to similarity score
    return Math.max(0, 1 - (distance / maxLength));
  }

  /**
   * Calculate Levenshtein distance between two strings
   * This is the minimum number of single-character edits needed to change one string into another
   * 
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} Edit distance
   */
  levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;

    // Create a 2D array for dynamic programming
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    // Initialize first column and row
    for (let i = 0; i <= len1; i++) {
      matrix[i][0] = i;
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Match ESPN games to Action Network games using fuzzy string matching
   * 
   * @param {Array} espnGames - Array of ESPN game objects with awayTeam and homeTeam properties
   * @param {Array} actionNetworkGames - Array of Action Network game objects with awayTeam and homeTeam properties
   * @returns {Array} Array of matched pairs with confidence scores
   */
  matchGames(espnGames, actionNetworkGames) {
    const matches = [];
    const usedActionNetworkIndices = new Set();

    logger.info(`Starting game matching: ${espnGames.length} ESPN games, ${actionNetworkGames.length} Action Network games`);

    for (const espnGame of espnGames) {
      let bestMatch = null;
      let bestScore = 0;
      let bestIndex = -1;

      // Try to match with each Action Network game
      for (let i = 0; i < actionNetworkGames.length; i++) {
        // Skip if already matched
        if (usedActionNetworkIndices.has(i)) {
          continue;
        }

        const anGame = actionNetworkGames[i];

        // Calculate similarity for both teams
        const awayScore = this.calculateSimilarity(
          espnGame.awayTeam?.name || espnGame.awayTeam?.abbreviation || '',
          anGame.awayTeam?.name || anGame.awayTeam?.abbreviation || ''
        );
        const homeScore = this.calculateSimilarity(
          espnGame.homeTeam?.name || espnGame.homeTeam?.abbreviation || '',
          anGame.homeTeam?.name || anGame.homeTeam?.abbreviation || ''
        );

        // Calculate combined score (average of both teams)
        const combinedScore = (awayScore + homeScore) / 2;

        // Add bonus if both teams score high (high confidence match)
        const bonus = (awayScore > 0.7 && homeScore > 0.7) ? 0.1 : 0;
        const totalScore = Math.min(1.0, combinedScore + bonus);

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestMatch = {
            espnGame,
            anGame,
            confidence: totalScore,
            awayScore,
            homeScore
          };
          bestIndex = i;
        }
      }

      // Only accept matches above confidence threshold
      if (bestMatch && bestMatch.confidence >= 0.7) {
        usedActionNetworkIndices.add(bestIndex);
        matches.push(bestMatch);
        
        logger.info(`Match found: ${espnGame.awayTeam?.abbreviation || espnGame.awayTeam?.name} @ ${espnGame.homeTeam?.abbreviation || espnGame.homeTeam?.name} ` +
                   `<-> ${bestMatch.anGame.awayTeam?.abbreviation || bestMatch.anGame.awayTeam?.name} @ ${bestMatch.anGame.homeTeam?.abbreviation || bestMatch.anGame.homeTeam?.name} ` +
                   `(confidence: ${bestMatch.confidence.toFixed(3)})`);
      } else {
        logger.warn(`No match found for ESPN game: ${espnGame.awayTeam?.abbreviation || espnGame.awayTeam?.name} @ ${espnGame.homeTeam?.abbreviation || espnGame.homeTeam?.name} ` +
                   `(best score: ${bestScore.toFixed(3)})`);
      }
    }

    // Log summary metrics
    const totalGames = espnGames.length;
    const matchedGames = matches.length;
    const unmatchedGames = totalGames - matchedGames;
    
    logger.info(`Matching complete: ${matchedGames}/${totalGames} games matched (${unmatchedGames} unmatched)`);

    return matches;
  }

  /**
   * Generate a detailed match report for debugging and admin review
   * 
   * @param {Array} espnGames - Array of ESPN game objects
   * @param {Array} actionNetworkGames - Array of Action Network game objects
   * @param {Array} matches - Array of matched pairs from matchGames()
   * @returns {Object} Detailed match report with metrics and failed matches
   */
  generateMatchReport(espnGames, actionNetworkGames, matches) {
    const totalGames = espnGames.length;
    const matchedGames = matches.length;
    const unmatchedGames = totalGames - matchedGames;

    // Find unmatched ESPN games
    const matchedEspnGames = new Set(matches.map(m => m.espnGame));
    const unmatchedEspnGames = espnGames.filter(game => !matchedEspnGames.has(game));

    // Find unused Action Network games
    const matchedAnGames = new Set(matches.map(m => m.anGame));
    const unusedAnGames = actionNetworkGames.filter(game => !matchedAnGames.has(game));

    const report = {
      metrics: {
        totalEspnGames: totalGames,
        totalActionNetworkGames: actionNetworkGames.length,
        matchedGames,
        unmatchedGames,
        unusedActionNetworkGames: unusedAnGames.length,
        matchRate: totalGames > 0 ? (matchedGames / totalGames * 100).toFixed(1) + '%' : '0%'
      },
      successfulMatches: matches.map(m => ({
        espnTeams: `${m.espnGame.awayTeam?.abbreviation || m.espnGame.awayTeam?.name} @ ${m.espnGame.homeTeam?.abbreviation || m.espnGame.homeTeam?.name}`,
        anTeams: `${m.anGame.awayTeam?.abbreviation || m.anGame.awayTeam?.name} @ ${m.anGame.homeTeam?.abbreviation || m.anGame.homeTeam?.name}`,
        confidence: m.confidence.toFixed(3),
        awayScore: m.awayScore.toFixed(3),
        homeScore: m.homeScore.toFixed(3)
      })),
      failedMatches: unmatchedEspnGames.map(game => ({
        espnTeams: `${game.awayTeam?.abbreviation || game.awayTeam?.name} @ ${game.homeTeam?.abbreviation || game.homeTeam?.name}`,
        espnAwayFull: game.awayTeam?.name || '',
        espnHomeFull: game.homeTeam?.name || '',
        espnAwayAbbr: game.awayTeam?.abbreviation || '',
        espnHomeAbbr: game.homeTeam?.abbreviation || ''
      })),
      unusedActionNetworkGames: unusedAnGames.map(game => ({
        anTeams: `${game.awayTeam?.abbreviation || game.awayTeam?.name} @ ${game.homeTeam?.abbreviation || game.homeTeam?.name}`,
        anAwayFull: game.awayTeam?.name || '',
        anHomeFull: game.homeTeam?.name || '',
        anAwayAbbr: game.awayTeam?.abbreviation || '',
        anHomeAbbr: game.homeTeam?.abbreviation || ''
      }))
    };

    return report;
  }
}

module.exports = TeamNameMatcher;
