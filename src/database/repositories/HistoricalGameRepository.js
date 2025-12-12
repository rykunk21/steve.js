const BaseRepository = require('./BaseRepository');
const logger = require('../../utils/logger');

/**
 * Repository for historical game data
 * Stores complete game results for model training and validation
 */
class HistoricalGameRepository extends BaseRepository {
  constructor() {
    super('historical_games');
  }

  /**
   * Convert snake_case database columns to camelCase
   * @private
   */
  _toCamelCase(game) {
    if (!game) return null;
    
    return {
      id: game.id,
      sport: game.sport,
      season: game.season,
      gameDate: game.game_date,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeScore: game.home_score,
      awayScore: game.away_score,
      isNeutralSite: game.is_neutral_site === 1,
      homeFieldGoalPct: game.home_field_goal_pct,
      awayFieldGoalPct: game.away_field_goal_pct,
      homeThreePointPct: game.home_three_point_pct,
      awayThreePointPct: game.away_three_point_pct,
      homeFreeThrowPct: game.home_free_throw_pct,
      awayFreeThrowPct: game.away_free_throw_pct,
      homeRebounds: game.home_rebounds,
      awayRebounds: game.away_rebounds,
      homeTurnovers: game.home_turnovers,
      awayTurnovers: game.away_turnovers,
      homeAssists: game.home_assists,
      awayAssists: game.away_assists,
      preGameSpread: game.pre_game_spread,
      preGameTotal: game.pre_game_total,
      preGameHomeML: game.pre_game_home_ml,
      preGameAwayML: game.pre_game_away_ml,
      spreadResult: game.spread_result,
      totalResult: game.total_result,
      createdAt: game.created_at,
      dataSource: game.data_source,
      statbroadcastGameId: game.statbroadcast_game_id,
      hasPlayByPlay: game.has_play_by_play === 1,
      processedAt: game.processed_at,
      backfilled: game.backfilled === 1,
      backfillDate: game.backfill_date,
      transitionProbabilities: game.transition_probabilities ? JSON.parse(game.transition_probabilities) : null
    };
  }

  /**
   * Save a complete game result with box scores and betting outcomes
   * @param {Object} gameData - Basic game information
   * @param {Object} boxScore - Box score statistics
   * @param {Object} bettingOutcome - Betting lines and results
   * @returns {Promise<void>}
   */
  async saveGameResult(gameData, boxScore = {}, bettingOutcome = {}) {
    try {
      const sql = `
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          is_neutral_site,
          home_field_goal_pct, away_field_goal_pct,
          home_three_point_pct, away_three_point_pct,
          home_free_throw_pct, away_free_throw_pct,
          home_rebounds, away_rebounds,
          home_turnovers, away_turnovers,
          home_assists, away_assists,
          pre_game_spread, pre_game_total,
          pre_game_home_ml, pre_game_away_ml,
          spread_result, total_result,
          data_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      // Format date as ISO string for SQLite
      const gameDate = gameData.gameDate instanceof Date 
        ? gameData.gameDate.toISOString().split('T')[0]
        : gameData.gameDate;

      const params = [
        gameData.id,
        gameData.sport,
        gameData.season,
        gameDate,
        gameData.homeTeamId,
        gameData.awayTeamId,
        gameData.homeScore,
        gameData.awayScore,
        gameData.isNeutralSite ? 1 : 0,
        boxScore.homeFieldGoalPct || null,
        boxScore.awayFieldGoalPct || null,
        boxScore.homeThreePointPct || null,
        boxScore.awayThreePointPct || null,
        boxScore.homeFreeThrowPct || null,
        boxScore.awayFreeThrowPct || null,
        boxScore.homeRebounds || null,
        boxScore.awayRebounds || null,
        boxScore.homeTurnovers || null,
        boxScore.awayTurnovers || null,
        boxScore.homeAssists || null,
        boxScore.awayAssists || null,
        bettingOutcome.preGameSpread || null,
        bettingOutcome.preGameTotal || null,
        bettingOutcome.preGameHomeML || null,
        bettingOutcome.preGameAwayML || null,
        bettingOutcome.spreadResult || null,
        bettingOutcome.totalResult || null,
        gameData.dataSource || 'manual'
      ];

      const result = await this.db.run(sql, params);

      logger.info('Saved historical game result', {
        gameId: gameData.id,
        sport: gameData.sport,
        season: gameData.season,
        lastID: result.lastID,
        changes: result.changes
      });
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Game ${gameData.id} already exists in historical database`);
      }
      logger.error('Failed to save game result', {
        gameId: gameData.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get a game by ID
   * @param {string} gameId - Game ID
   * @returns {Promise<Object|null>}
   */
  async getGameById(gameId) {
    try {
      const sql = 'SELECT * FROM historical_games WHERE id = ?';
      const game = await this.db.get(sql, [gameId]);
      
      logger.debug('getGameById result', {
        gameId,
        found: !!game,
        game: game
      });
      
      return this._toCamelCase(game);
    } catch (error) {
      logger.error('Failed to get game by ID', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all games for a team in a season
   * @param {string} teamId - Team ID
   * @param {number} season - Season year
   * @param {number} limit - Maximum number of games to return
   * @returns {Promise<Array>}
   */
  async getTeamGameHistory(teamId, season, limit = 100) {
    try {
      const sql = `
        SELECT * FROM historical_games
        WHERE (home_team_id = ? OR away_team_id = ?)
          AND season = ?
        ORDER BY game_date DESC
        LIMIT ?
      `;

      const games = await this.db.all(sql, [teamId, teamId, season, limit]);
      return games.map(game => this._toCamelCase(game));
    } catch (error) {
      logger.error('Failed to get team game history', {
        teamId,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get head-to-head history between two teams
   * @param {string} team1Id - First team ID
   * @param {string} team2Id - Second team ID
   * @param {number} limit - Maximum number of games to return
   * @returns {Promise<Array>}
   */
  async getHeadToHeadHistory(team1Id, team2Id, limit = 10) {
    try {
      const sql = `
        SELECT * FROM historical_games
        WHERE (home_team_id = ? AND away_team_id = ?)
           OR (home_team_id = ? AND away_team_id = ?)
        ORDER BY game_date DESC
        LIMIT ?
      `;

      const games = await this.db.all(sql, [team1Id, team2Id, team2Id, team1Id, limit]);
      return games.map(game => this._toCamelCase(game));
    } catch (error) {
      logger.error('Failed to get head-to-head history', {
        team1Id,
        team2Id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get games within a date range for a sport
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} sport - Sport key
   * @returns {Promise<Array>}
   */
  async getGamesByDateRange(startDate, endDate, sport) {
    try {
      // Format dates as ISO strings for SQLite
      const start = startDate instanceof Date 
        ? startDate.toISOString().split('T')[0]
        : startDate;
      const end = endDate instanceof Date 
        ? endDate.toISOString().split('T')[0]
        : endDate;

      const sql = `
        SELECT * FROM historical_games
        WHERE game_date >= ? AND game_date <= ?
          AND sport = ?
        ORDER BY game_date ASC
      `;

      const games = await this.db.all(sql, [start, end, sport]);
      return games.map(game => this._toCamelCase(game));
    } catch (error) {
      logger.error('Failed to get games by date range', {
        startDate,
        endDate,
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get betting outcomes for a team in a season
   * @param {string} teamId - Team ID
   * @param {number} season - Season year
   * @returns {Promise<Array>}
   */
  async getBettingOutcomes(teamId, season) {
    try {
      const sql = `
        SELECT * FROM historical_games
        WHERE (home_team_id = ? OR away_team_id = ?)
          AND season = ?
          AND pre_game_spread IS NOT NULL
        ORDER BY game_date DESC
      `;

      const games = await this.db.all(sql, [teamId, teamId, season]);
      return games.map(game => this._toCamelCase(game));
    } catch (error) {
      logger.error('Failed to get betting outcomes', {
        teamId,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all games for a season (for opponent-adjusted metrics)
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @returns {Promise<Array>}
   */
  async getSeasonGames(sport, season) {
    try {
      const sql = `
        SELECT * FROM historical_games
        WHERE sport = ? AND season = ?
        ORDER BY game_date ASC
      `;

      const games = await this.db.all(sql, [sport, season]);
      return games.map(game => this._toCamelCase(game));
    } catch (error) {
      logger.error('Failed to get season games', {
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Save game with full StatBroadcast data
   * @param {Object} game - Complete game data
   * @returns {Promise<void>}
   */
  async saveGame(game) {
    try {
      const sql = `
        INSERT INTO historical_games (
          id, statbroadcast_game_id,
          sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          is_neutral_site, data_source,
          has_play_by_play, processed_at,
          backfilled, backfill_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          statbroadcast_game_id = excluded.statbroadcast_game_id,
          has_play_by_play = excluded.has_play_by_play,
          processed_at = excluded.processed_at
      `;

      const gameDate = game.game_date instanceof Date 
        ? game.game_date.toISOString().split('T')[0]
        : game.game_date;

      const params = [
        game.game_id || game.espn_game_id, // Use game_id or espn_game_id as the id
        game.statbroadcast_game_id,
        game.sport || 'mens-college-basketball',
        game.season || new Date().getFullYear(),
        gameDate,
        game.home_team,
        game.away_team,
        game.home_score,
        game.away_score,
        game.is_neutral_site ? 1 : 0,
        game.data_source,
        game.has_play_by_play ? 1 : 0,
        game.processed_at,
        game.backfilled ? 1 : 0,
        game.backfill_date
      ];

      await this.db.run(sql, params);

      logger.info('Saved game with StatBroadcast data', {
        gameId: game.game_id || game.espn_game_id,
        sbId: game.statbroadcast_game_id,
        hasPlayByPlay: game.has_play_by_play
      });
    } catch (error) {
      logger.error('Failed to save game', {
        gameId: game.game_id || game.espn_game_id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get games by date range (without sport filter for reconciliation)
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>}
   */
  async getGamesByDateRange(startDate, endDate) {
    try {
      const start = startDate instanceof Date 
        ? startDate.toISOString().split('T')[0]
        : startDate;
      const end = endDate instanceof Date 
        ? endDate.toISOString().split('T')[0]
        : endDate;

      const sql = `
        SELECT * FROM historical_games
        WHERE game_date >= ? AND game_date <= ?
        ORDER BY game_date ASC
      `;

      const games = await this.db.all(sql, [start, end]);
      return games.map(game => this._toCamelCase(game));
    } catch (error) {
      logger.error('Failed to get games by date range', {
        startDate,
        endDate,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update transition probabilities for a game
   * @param {string} gameId - Game ID
   * @param {Object} probabilities - Transition probabilities object
   * @returns {Promise<void>}
   */
  async updateTransitionProbabilities(gameId, probabilities) {
    try {
      const probabilitiesJson = JSON.stringify(probabilities);

      const sql = `
        UPDATE historical_games
        SET transition_probabilities = ?
        WHERE id = ?
      `;

      await this.db.run(sql, [probabilitiesJson, gameId]);

      logger.info('Updated transition probabilities', {
        gameId
      });
    } catch (error) {
      logger.error('Failed to update transition probabilities', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get games with play-by-play data but no transition probabilities
   * @param {number} limit - Maximum number of games to return
   * @returns {Promise<Array>}
   */
  async getGamesNeedingTransitionProbabilities(limit = 100) {
    try {
      const sql = `
        SELECT * FROM historical_games
        WHERE has_play_by_play = 1
          AND statbroadcast_game_id IS NOT NULL
          AND transition_probabilities IS NULL
        ORDER BY game_date ASC
        LIMIT ?
      `;

      const games = await this.db.all(sql, [limit]);
      return games.map(game => this._toCamelCase(game));
    } catch (error) {
      logger.error('Failed to get games needing transition probabilities', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get games with transition probabilities
   * @param {number} limit - Maximum number of games to return
   * @returns {Promise<Array>}
   */
  async getGamesWithTransitionProbabilities(limit = 100) {
    try {
      const sql = `
        SELECT * FROM historical_games
        WHERE transition_probabilities IS NOT NULL
        ORDER BY game_date DESC
        LIMIT ?
      `;

      const games = await this.db.all(sql, [limit]);
      return games.map(game => {
        const camelGame = this._toCamelCase(game);
        // Parse transition probabilities JSON
        if (game.transition_probabilities) {
          camelGame.transitionProbabilities = JSON.parse(game.transition_probabilities);
        }
        return camelGame;
      });
    } catch (error) {
      logger.error('Failed to get games with transition probabilities', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Delete all games (for testing)
   * @returns {Promise<void>}
   */
  async deleteAll() {
    try {
      await this.db.run('DELETE FROM historical_games');
      logger.info('Deleted all historical games');
    } catch (error) {
      logger.error('Failed to delete all games', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = HistoricalGameRepository;
