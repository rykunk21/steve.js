const xml2js = require('xml2js');
const logger = require('../../utils/logger');

/**
 * Parser for StatBroadcast XML game data
 * Extracts complete game information including metadata, statistics, and play-by-play
 */
class XMLGameParser {
  constructor() {
    this.parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      trim: true
    });
  }

  /**
   * Helper method to ensure value is an array
   * @param {*} value - Value to convert to array
   * @returns {Array} - Array representation of value
   * @private
   */
  _ensureArray(value) {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  /**
   * Parse StatBroadcast XML game data
   * @param {string} xmlData - Raw XML string
   * @returns {Promise<Object>} - Parsed game data
   */
  async parseGameXML(xmlData) {
    try {
      // Validate input
      if (xmlData === null || xmlData === undefined) {
        throw new Error('Invalid XML data: must be a non-empty string');
      }

      if (typeof xmlData !== 'string' || xmlData.trim() === '') {
        throw new Error('Invalid XML data: must be a non-empty string');
      }

      logger.debug('Starting XML parsing', {
        dataLength: xmlData.length
      });

      // Parse XML
      const parsed = await this.parser.parseStringPromise(xmlData);
      
      if (!parsed || !parsed.bbgame) {
        throw new Error('Invalid XML structure: missing bbgame root');
      }

      const game = parsed.bbgame;

      logger.debug('XML parsed successfully, extracting components');

      // Extract all components
      const metadata = this.extractMetadata(game);
      logger.debug('Metadata extracted', {
        gameId: metadata.gameId,
        date: metadata.date
      });

      const status = this.extractStatus(game);
      logger.debug('Status extracted', {
        complete: status.complete,
        period: status.period
      });

      const teams = this.extractTeams(game);
      logger.debug('Teams extracted', {
        visitor: teams.visitor?.name,
        home: teams.home?.name,
        visitorScore: teams.visitor?.score,
        homeScore: teams.home?.score
      });

      const playByPlay = this.extractPlayByPlay(game);
      logger.debug('Play-by-play extracted', {
        totalPlays: playByPlay.length
      });

      return {
        metadata,
        status,
        teams,
        playByPlay
      };

    } catch (error) {
      logger.error('Failed to parse game XML', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Extract game metadata from venue element
   * @param {Object} game - Parsed game object
   * @returns {Object} - Game metadata
   */
  extractMetadata(game) {
    const venue = game.venue || {};

    return {
      gameId: venue.gameid || null,
      statBroadcastId: venue.sbid || null,
      competitionId: venue.competitionid || null,
      competitionName: venue.competitionname || null,
      date: venue.date || null,
      location: venue.location || null,
      time: venue.time || null,
      startTime: venue.start || null,
      endTime: venue.end || null,
      duration: venue.duration || null,
      attendance: venue.attend || '0',
      neutralGame: venue.neutralgame || 'N',
      postseason: venue.postseason || 'N',
      visitorId: venue.visid || null,
      visitorName: venue.visname || null,
      homeId: venue.homeid || null,
      homeName: venue.homename || null,
      officials: venue.officials?.text || null,
      notes: venue.notes || null
    };
  }

  /**
   * Extract game status
   * @param {Object} game - Parsed game object
   * @returns {Object} - Game status
   */
  extractStatus(game) {
    const status = game.status || {};

    return {
      complete: status.complete === 'Y',
      period: parseInt(status.period) || 0,
      periodType: status.periodtype || null,
      clock: status.clock || null,
      running: status.running || null,
      gameStatus: status.gamestatus || null
    };
  }

  /**
   * Extract team data
   * @param {Object} game - Parsed game object
   * @returns {Object} - Teams data
   */
  extractTeams(game) {
    const teams = this._ensureArray(game.team);
    
    const visitor = teams.find(t => t && t.vh === 'V');
    const home = teams.find(t => t && t.vh === 'H');

    return {
      visitor: visitor ? this.extractTeamData(visitor) : null,
      home: home ? this.extractTeamData(home) : null
    };
  }

  /**
   * Extract complete team data
   * @param {Object} team - Team object
   * @returns {Object} - Complete team data
   */
  extractTeamData(team) {
    const linescore = team.linescore || {};
    const totals = team.totals || {};
    const stats = totals.stats || {};
    const special = totals.special || {};

    return {
      id: team.id,
      name: team.name,
      record: team.record || '',
      score: parseInt(linescore.score) || 0,
      stats: this.extractTeamStats(stats),
      advancedMetrics: this.extractAdvancedMetrics(special),
      derivedMetrics: this.calculateDerivedMetrics(stats),
      periodScoring: this.extractPeriodScoring(linescore),
      players: this.extractPlayers(team.player)
    };
  }

  /**
   * Extract team aggregate statistics
   * @param {Object} stats - Stats object
   * @returns {Object} - Team statistics
   */
  extractTeamStats(stats) {
    return {
      fgm: parseInt(stats.fgm) || 0,
      fga: parseInt(stats.fga) || 0,
      fgPct: parseFloat(stats.fgpct) || 0,
      fg3m: parseInt(stats.fgm3) || 0,
      fg3a: parseInt(stats.fga3) || 0,
      fg3Pct: parseFloat(stats.fg3pct) || 0,
      ftm: parseInt(stats.ftm) || 0,
      fta: parseInt(stats.fta) || 0,
      ftPct: parseFloat(stats.ftpct) || 0,
      points: parseInt(stats.tp) || 0,
      rebounds: parseInt(stats.treb) || 0,
      offensiveRebounds: parseInt(stats.oreb) || 0,
      defensiveRebounds: parseInt(stats.dreb) || 0,
      assists: parseInt(stats.ast) || 0,
      turnovers: parseInt(stats.to) || 0,
      steals: parseInt(stats.stl) || 0,
      blocks: parseInt(stats.blk) || 0,
      personalFouls: parseInt(stats.pf) || 0,
      technicalFouls: parseInt(stats.tf) || 0,
      minutes: parseInt(stats.min) || 0
    };
  }

  /**
   * Extract advanced metrics
   * @param {Object} special - Special stats object
   * @returns {Object} - Advanced metrics
   */
  extractAdvancedMetrics(special) {
    return {
      pointsInPaint: parseInt(special.pts_paint) || 0,
      fastBreakPoints: parseInt(special.pts_fastb) || 0,
      secondChancePoints: parseInt(special.pts_ch2) || 0,
      pointsOffTurnovers: parseInt(special.pts_to) || 0,
      benchPoints: parseInt(special.pts_bench) || 0,
      possessionCount: parseInt(special.poss_count) || 0,
      ties: parseInt(special.ties) || 0,
      leads: parseInt(special.leads) || 0,
      largestLead: parseInt(special.large_lead) || 0,
      largestLeadTime: special.large_lead_t || null,
      biggestRun: parseInt(special.biggest_run) || 0
    };
  }

  /**
   * Calculate derived metrics
   * @param {Object} stats - Stats object
   * @returns {Object} - Derived metrics
   */
  calculateDerivedMetrics(stats) {
    const fgm = parseInt(stats.fgm) || 0;
    const fga = parseInt(stats.fga) || 0;
    const fg3m = parseInt(stats.fgm3) || 0;
    const ftm = parseInt(stats.ftm) || 0;
    const fta = parseInt(stats.fta) || 0;
    const tp = parseInt(stats.tp) || 0;
    const to = parseInt(stats.to) || 0;

    // Effective FG% = (FGM + 0.5 * 3PM) / FGA
    const effectiveFgPct = fga > 0 ? ((fgm + 0.5 * fg3m) / fga) * 100 : 0;

    // True Shooting % = PTS / (2 * (FGA + 0.44 * FTA))
    const tsDenominator = 2 * (fga + 0.44 * fta);
    const trueShootingPct = tsDenominator > 0 ? (tp / tsDenominator) * 100 : 0;

    // Turnover rate = TO / (FGA + 0.44 * FTA + TO)
    const toRateDenominator = fga + 0.44 * fta + to;
    const turnoverRate = toRateDenominator > 0 ? (to / toRateDenominator) * 100 : 0;

    return {
      effectiveFgPct: parseFloat(effectiveFgPct.toFixed(2)),
      trueShootingPct: parseFloat(trueShootingPct.toFixed(2)),
      turnoverRate: parseFloat(turnoverRate.toFixed(2))
    };
  }

  /**
   * Extract period-by-period scoring
   * @param {Object} linescore - Linescore object
   * @returns {Array} - Period scoring array
   */
  extractPeriodScoring(linescore) {
    if (!linescore.lineprd) {
      return [];
    }

    const periods = this._ensureArray(linescore.lineprd);

    return periods.map(period => ({
      period: parseInt(period.prd) || 0,
      score: parseInt(period.score) || 0
    }));
  }

  /**
   * Extract player statistics
   * @param {Array|Object} players - Player data
   * @returns {Array} - Array of player objects
   */
  extractPlayers(players) {
    if (!players) {
      return [];
    }

    const playerArray = this._ensureArray(players);

    return playerArray
      .filter(player => player && player.code !== 'TM') // Filter out TEAM entries
      .map(player => this.extractPlayerData(player));
  }

  /**
   * Extract individual player data
   * @param {Object} player - Player object
   * @returns {Object} - Player data
   */
  extractPlayerData(player) {
    const stats = player.stats || {};

    return {
      uniform: player.uni || null,
      playerNumber: player.pno || null,
      code: player.code || null,
      name: player.name || null,
      checkName: player.checkname || null,
      class: player.class || null,
      position: player.pos || null,
      gamesPlayed: parseInt(player.gp) || 0,
      gamesStarted: parseInt(player.gs) || 0,
      onCourt: player.oncourt === 'Y',
      stats: {
        points: parseInt(stats.tp) || 0,
        fgm: parseInt(stats.fgm) || 0,
        fga: parseInt(stats.fga) || 0,
        fg3m: parseInt(stats.fgm3) || 0,
        fg3a: parseInt(stats.fga3) || 0,
        ftm: parseInt(stats.ftm) || 0,
        fta: parseInt(stats.fta) || 0,
        rebounds: parseInt(stats.treb) || 0,
        offensiveRebounds: parseInt(stats.oreb) || 0,
        defensiveRebounds: parseInt(stats.dreb) || 0,
        assists: parseInt(stats.ast) || 0,
        turnovers: parseInt(stats.to) || 0,
        steals: parseInt(stats.stl) || 0,
        blocks: parseInt(stats.blk) || 0,
        personalFouls: parseInt(stats.pf) || 0,
        technicalFouls: parseInt(stats.tf) || 0,
        minutes: parseInt(stats.min) || 0,
        plusMinus: parseInt(stats.plusminus) || 0,
        efficiency: parseInt(stats.eff) || 0,
        pointsInPaint: parseInt(stats.pts_paint) || 0,
        fastBreakPoints: parseInt(stats.pts_fastb) || 0,
        secondChancePoints: parseInt(stats.pts_ch2) || 0
      }
    };
  }

  /**
   * Extract play-by-play sequences
   * @param {Object} game - Parsed game object
   * @returns {Array} - Array of play objects
   */
  extractPlayByPlay(game) {
    try {
      if (!game.plays || !game.plays.period) {
        logger.debug('No play-by-play data found in XML');
        return [];
      }

      const periods = this._ensureArray(game.plays.period);
      const allPlays = [];

      for (const period of periods) {
        const periodNumber = parseInt(period.number) || 0;
        
        if (!period.play) {
          continue;
        }

        const plays = this._ensureArray(period.play);

        for (const play of plays) {
          const playData = this.extractPlayData(play, periodNumber);
          if (playData) {
            allPlays.push(playData);
          }
        }

        // Also extract comments if present
        if (period.comment) {
          const comments = this._ensureArray(period.comment);

          for (const comment of comments) {
            allPlays.push({
              period: periodNumber,
              time: comment.time || null,
              team: comment.team || null,
              vh: comment.vh || null,
              checkname: comment.checkname || null,
              action: 'COMMENT',
              text: comment.text || null
            });
          }
        }
      }

      logger.debug('Play-by-play extraction complete', {
        totalPlays: allPlays.length,
        periods: periods.length
      });

      return allPlays;

    } catch (error) {
      logger.error('Failed to extract play-by-play', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Extract individual play data
   * @param {Object} play - Play object
   * @param {number} periodNumber - Period number
   * @returns {Object|null} - Play data or null if invalid
   */
  extractPlayData(play, periodNumber) {
    try {
      // Skip if no action
      if (!play || !play.action) {
        return null;
      }

      const playData = {
        period: periodNumber,
        time: play.time || null,
        team: play.team || null,
        vh: play.vh || null,
        uniform: play.uni || null,
        sequence: parseInt(play.sequence) || null,
        checkname: play.checkname || null,
        action: play.action || null,
        type: play.type || null
      };

      // Add scoring information if present
      if (play.hscore !== undefined) {
        playData.hscore = parseInt(play.hscore) || 0;
      }
      if (play.vscore !== undefined) {
        playData.vscore = parseInt(play.vscore) || 0;
      }

      // Add shot description if present
      if (play.desc) {
        playData.description = play.desc;
      }

      // Add context flags
      if (play.fastb) {
        playData.fastb = play.fastb;
      }
      if (play.to) {
        playData.to = play.to;
      }
      if (play.paint) {
        playData.paint = play.paint;
      }
      if (play.ch2) {
        playData.ch2 = play.ch2;
      }
      if (play.blocked) {
        playData.blocked = play.blocked;
      }

      // Add assist information
      if (play.action === 'FOUL' && play.drawnby) {
        playData.drawnBy = play.drawnby;
        playData.drawnUni = play.drawnuni;
      }

      // Add foul qualifiers
      if (play.qualifiers) {
        playData.qualifiers = play.qualifiers;
      }
      if (play.ft) {
        playData.freeThrows = play.ft;
      }

      // Add free throw sequence
      if (play.seq) {
        playData.ftSequence = play.seq;
      }

      return playData;

    } catch (error) {
      logger.error('Failed to extract play data', {
        error: error.message,
        stack: error.stack,
        periodNumber,
        playAction: play?.action
      });
      return null;
    }
  }
}

module.exports = XMLGameParser;
