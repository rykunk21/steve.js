const logger = require('../../utils/logger');

/**
 * Service for discovering and mapping ESPN game IDs to StatBroadcast game IDs
 * Uses three-tier approach: cache → discovery → manual mapping
 */
class GameIdDiscoveryService {
  constructor(gameIdMappingRepository, statBroadcastClient) {
    this.gameIdMappingRepo = gameIdMappingRepository;
    this.statBroadcastClient = statBroadcastClient;
    
    // Team name normalization mappings
    this.teamAbbreviations = {
      'unc': 'north carolina',
      'usc': 'southern california',
      'lsu': 'louisiana state',
      'tcu': 'texas christian',
      'smu': 'southern methodist',
      'byu': 'brigham young',
      'vcu': 'virginia commonwealth',
      'ucf': 'central florida',
      'uconn': 'connecticut',
      'unlv': 'nevada las vegas'
    };
  }

  /**
   * Normalize team name for matching
   * Handles variations, abbreviations, and special characters
   * @param {string} teamName - Team name to normalize
   * @returns {string} - Normalized team name
   */
  normalizeTeamName(teamName) {
    if (!teamName) return '';
    
    // Convert to lowercase
    let normalized = teamName.toLowerCase();
    
    // Handle "St." at the end (State abbreviation) BEFORE removing special characters
    // Match word boundary + "st." at end or before another word
    normalized = normalized.replace(/\s+st\.\s*$/g, ' state');
    
    // Remove special characters (keep letters, numbers, spaces)
    normalized = normalized.replace(/[^a-z0-9\s]/g, '');
    
    // Trim whitespace
    normalized = normalized.trim();
    
    // Replace multiple spaces with single space
    normalized = normalized.replace(/\s+/g, ' ');
    
    // Check if it's a known abbreviation
    if (this.teamAbbreviations[normalized]) {
      return this.teamAbbreviations[normalized];
    }
    
    return normalized;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns value between 0.0 (no match) and 1.0 (exact match)
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} - Similarity score
   */
  calculateSimilarity(str1, str2) {
    // Normalize both strings
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    // Exact match
    if (s1 === s2) return 1.0;
    
    // Check for substring match (give bonus)
    if (s1.includes(s2) || s2.includes(s1)) {
      return 0.85;
    }
    
    // Calculate Levenshtein distance
    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    if (maxLength === 0) return 1.0;
    
    // Convert distance to similarity (0-1 scale)
    const similarity = 1 - (distance / maxLength);
    
    return Math.max(0, similarity);
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} - Edit distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    // Initialize matrix
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    // Fill matrix
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Discover StatBroadcast game ID for an ESPN game
   * Three-tier approach: cache → discovery → manual
   * @param {Object} espnGame - ESPN game object
   * @returns {Promise<Object|null>} - Discovery result with statbroadcastGameId, confidence, source
   */
  async discoverGameId(espnGame) {
    try {
      // Tier 1: Check cache
      const cached = await this.gameIdMappingRepo.getMapping(espnGame.id);
      if (cached) {
        logger.info('Found cached game ID mapping', {
          espnGameId: espnGame.id,
          statbroadcastGameId: cached.statbroadcastGameId
        });
        
        return {
          statbroadcastGameId: cached.statbroadcastGameId,
          confidence: cached.confidence,
          source: 'cache'
        };
      }
      
      // Tier 2: Discovery via search
      const homeTeam = espnGame.homeTeam?.displayName || espnGame.homeTeam?.name;
      const awayTeam = espnGame.awayTeam?.displayName || espnGame.awayTeam?.name;
      const date = espnGame.date;
      
      const candidates = await this.searchStatBroadcast(homeTeam, awayTeam, date);
      
      if (!candidates || candidates.length === 0) {
        logger.warn('No StatBroadcast candidates found', {
          espnGameId: espnGame.id,
          homeTeam,
          awayTeam,
          date
        });
        return null;
      }
      
      // Match the best candidate
      const match = this.matchGame(espnGame, candidates);
      
      if (!match) {
        logger.warn('No confident match found', {
          espnGameId: espnGame.id,
          homeTeam,
          awayTeam,
          candidateCount: candidates.length
        });
        return null;
      }
      
      // Save to cache
      await this.gameIdMappingRepo.saveMapping({
        espnGameId: espnGame.id,
        statbroadcastGameId: match.gameId,
        homeTeam,
        awayTeam,
        gameDate: date,
        confidence: match.confidence,
        matchMethod: 'discovery'
      });
      
      logger.info('Discovered and cached game ID mapping', {
        espnGameId: espnGame.id,
        statbroadcastGameId: match.gameId,
        confidence: match.confidence
      });
      
      return {
        statbroadcastGameId: match.gameId,
        confidence: match.confidence,
        source: 'discovery'
      };
      
    } catch (error) {
      logger.error('Failed to discover game ID', {
        espnGameId: espnGame.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Search StatBroadcast for games matching criteria
   * @param {string} homeTeam - Home team name
   * @param {string} awayTeam - Away team name
   * @param {string} date - Game date
   * @returns {Promise<Array>} - Array of candidate games
   */
  async searchStatBroadcast(homeTeam, awayTeam, date) {
    try {
      const results = await this.statBroadcastClient.searchGames({
        date,
        homeTeam: this.normalizeTeamName(homeTeam),
        awayTeam: this.normalizeTeamName(awayTeam)
      });
      
      return results;
    } catch (error) {
      logger.error('StatBroadcast search failed', {
        homeTeam,
        awayTeam,
        date,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Match ESPN game to StatBroadcast candidates
   * Uses string similarity scoring
   * @param {Object} espnGame - ESPN game object
   * @param {Array} candidates - Array of StatBroadcast game candidates
   * @returns {Object|null} - Best match with gameId and confidence, or null
   */
  matchGame(espnGame, candidates) {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    
    const espnHome = this.normalizeTeamName(
      espnGame.homeTeam?.displayName || espnGame.homeTeam?.name
    );
    const espnAway = this.normalizeTeamName(
      espnGame.awayTeam?.displayName || espnGame.awayTeam?.name
    );
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const candidate of candidates) {
      const sbHome = this.normalizeTeamName(candidate.homeTeam);
      const sbAway = this.normalizeTeamName(candidate.awayTeam);
      
      // Calculate similarity for both teams
      const homeSimilarity = this.calculateSimilarity(espnHome, sbHome);
      const awaySimilarity = this.calculateSimilarity(espnAway, sbAway);
      
      // Combined score (average of both)
      let combinedScore = (homeSimilarity + awaySimilarity) / 2;
      
      // Bonus if both teams match well (> 0.7)
      if (homeSimilarity > 0.7 && awaySimilarity > 0.7) {
        combinedScore += 0.1;
      }
      
      // Cap at 1.0
      combinedScore = Math.min(1.0, combinedScore);
      
      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestMatch = {
          gameId: candidate.id,
          confidence: combinedScore,
          homeSimilarity,
          awaySimilarity
        };
      }
    }
    
    // Only return if confidence meets threshold
    if (bestMatch && bestMatch.confidence >= 0.7) {
      return bestMatch;
    }
    
    return null;
  }

  /**
   * Manually set a game ID mapping (for manual overrides)
   * @param {string} espnGameId - ESPN game ID
   * @param {string} statbroadcastGameId - StatBroadcast game ID
   * @param {Object} metadata - Additional metadata (homeTeam, awayTeam, gameDate)
   * @returns {Promise<Object>} - Saved mapping
   */
  async setManualMapping(espnGameId, statbroadcastGameId, metadata = {}) {
    try {
      if (!espnGameId || !statbroadcastGameId) {
        throw new Error('Both espnGameId and statbroadcastGameId are required');
      }

      const mapping = {
        espnGameId,
        statbroadcastGameId,
        homeTeam: metadata.homeTeam || 'Unknown',
        awayTeam: metadata.awayTeam || 'Unknown',
        gameDate: metadata.gameDate || new Date().toISOString().split('T')[0],
        confidence: 1.0, // Manual mappings have maximum confidence
        matchMethod: 'manual'
      };

      await this.gameIdMappingRepo.saveMapping(mapping);

      logger.info('Manual game ID mapping saved', {
        espnGameId,
        statbroadcastGameId,
        homeTeam: mapping.homeTeam,
        awayTeam: mapping.awayTeam
      });

      return mapping;
    } catch (error) {
      logger.error('Failed to set manual mapping', {
        espnGameId,
        statbroadcastGameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all low-confidence mappings for review
   * @param {number} threshold - Confidence threshold (default 0.7)
   * @returns {Promise<Array>} - Array of low-confidence mappings
   */
  async getLowConfidenceMappings(threshold = 0.7) {
    try {
      // This would require a new repository method to query by confidence
      // For now, we'll log that this needs implementation
      logger.warn('getLowConfidenceMappings not fully implemented - requires repository enhancement');
      return [];
    } catch (error) {
      logger.error('Failed to get low-confidence mappings', {
        threshold,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = GameIdDiscoveryService;
