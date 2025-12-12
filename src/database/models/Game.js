/**
 * Game Model
 * Represents a sports game with thread information
 */
class Game {
  constructor(data = {}) {
    this.gameId = data.game_id || data.gameId;
    this.threadId = data.thread_id || data.threadId;
    this.channelId = data.channel_id || data.channelId;
    this.guildId = data.guild_id || data.guildId;
    this.league = data.league;
    this.homeTeam = data.home_team || data.homeTeam;
    this.awayTeam = data.away_team || data.awayTeam;
    this.gameDate = data.game_date || data.gameDate;
    this.status = data.status || 'scheduled';
    this.createdAt = data.created_at || data.createdAt;
    this.updatedAt = data.updated_at || data.updatedAt;
    
    // Additional game data (not stored in DB but useful for display)
    this.venue = data.venue;
    this.homeScore = data.homeScore;
    this.awayScore = data.awayScore;
    this.quarter = data.quarter;
    this.timeRemaining = data.timeRemaining;
  }

  /**
   * Create game from external API data
   */
  static fromApiData(apiData, guildId, channelId) {
    return new Game({
      gameId: apiData.id || `${apiData.sport_key}_${apiData.home_team}_${apiData.away_team}_${apiData.commence_time}`,
      guildId,
      channelId,
      league: apiData.sport_key,
      homeTeam: apiData.home_team,
      awayTeam: apiData.away_team,
      gameDate: new Date(apiData.commence_time).toISOString(),
      venue: apiData.venue,
      status: 'scheduled'
    });
  }

  /**
   * Validate game data
   */
  validate() {
    const errors = [];

    if (!this.gameId) {
      errors.push('Game ID is required');
    }

    if (!this.guildId) {
      errors.push('Guild ID is required');
    }

    if (!this.channelId) {
      errors.push('Channel ID is required');
    }

    if (!['nfl', 'nba', 'nhl', 'ncaa'].includes(this.league)) {
      errors.push('League must be one of: nfl, nba, nhl, ncaa');
    }

    if (!this.homeTeam || this.homeTeam.trim().length === 0) {
      errors.push('Home team is required');
    }

    if (!this.awayTeam || this.awayTeam.trim().length === 0) {
      errors.push('Away team is required');
    }

    if (!this.gameDate) {
      errors.push('Game date is required');
    }

    if (!['scheduled', 'live', 'completed', 'postponed', 'cancelled'].includes(this.status)) {
      errors.push('Invalid game status');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert to database format
   */
  toDatabase() {
    return {
      game_id: this.gameId,
      thread_id: this.threadId,
      channel_id: this.channelId,
      guild_id: this.guildId,
      league: this.league,
      home_team: this.homeTeam,
      away_team: this.awayTeam,
      game_date: this.gameDate,
      status: this.status
    };
  }

  /**
   * Check if game is upcoming (within next 24 hours)
   */
  isUpcoming() {
    const now = new Date();
    const gameTime = new Date(this.gameDate);
    const timeDiff = gameTime.getTime() - now.getTime();
    
    // Game is upcoming if it's in the future and within 24 hours
    return timeDiff > 0 && timeDiff <= (24 * 60 * 60 * 1000);
  }

  /**
   * Check if game is live (started but not completed)
   */
  isLive() {
    return this.status === 'live';
  }

  /**
   * Check if game is completed
   */
  isCompleted() {
    return this.status === 'completed';
  }

  /**
   * Check if game should be archived
   */
  shouldArchive() {
    if (this.isCompleted()) {
      const gameTime = new Date(this.gameDate);
      const now = new Date();
      const timeDiff = now.getTime() - gameTime.getTime();
      
      // Archive completed games after 7 days
      return timeDiff > (7 * 24 * 60 * 60 * 1000);
    }
    
    return false;
  }

  /**
   * Get formatted game title
   */
  getTitle() {
    return `${this.awayTeam} @ ${this.homeTeam}`;
  }

  /**
   * Get formatted game date
   */
  getFormattedDate() {
    const date = new Date(this.gameDate);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  }

  /**
   * Get league display name
   */
  getLeagueDisplayName() {
    const leagueNames = {
      nfl: 'NFL',
      nba: 'NBA',
      nhl: 'NHL',
      ncaa: 'NCAA'
    };
    
    return leagueNames[this.league] || this.league.toUpperCase();
  }

  /**
   * Get status display name
   */
  getStatusDisplayName() {
    const statusNames = {
      scheduled: 'Scheduled',
      live: 'Live',
      completed: 'Final',
      postponed: 'Postponed',
      cancelled: 'Cancelled'
    };
    
    return statusNames[this.status] || this.status;
  }

  /**
   * Get score display (if available)
   */
  getScoreDisplay() {
    if (this.homeScore !== undefined && this.awayScore !== undefined) {
      return `${this.awayTeam} ${this.awayScore} - ${this.homeScore} ${this.homeTeam}`;
    }
    
    return null;
  }

  /**
   * Update game status and scores
   */
  updateFromLiveData(liveData) {
    if (liveData.status) {
      this.status = liveData.status;
    }
    
    if (liveData.homeScore !== undefined) {
      this.homeScore = liveData.homeScore;
    }
    
    if (liveData.awayScore !== undefined) {
      this.awayScore = liveData.awayScore;
    }
    
    if (liveData.quarter) {
      this.quarter = liveData.quarter;
    }
    
    if (liveData.timeRemaining) {
      this.timeRemaining = liveData.timeRemaining;
    }
    
    this.updatedAt = new Date().toISOString();
  }
}

module.exports = Game;