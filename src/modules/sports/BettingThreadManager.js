const { EmbedBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const ESPNAPIClient = require('./ESPNAPIClient');
const TeamColorMapper = require('./TeamColorMapper');
const SpreadBarGenerator = require('./SpreadBarGenerator');
const TeamNameMatcher = require('./TeamNameMatcher');
const ImageComposer = require('../../utils/imageComposer');
const BettingRecommendationEngine = require('./BettingRecommendationEngine');
const logger = require('../../utils/logger');

/**
 * Manages betting threads for sports games
 */
class BettingThreadManager {
  constructor(client) {
    this.client = client;
    this.espnClient = new ESPNAPIClient();
    this.colorMapper = new TeamColorMapper();
    this.spreadBarGenerator = new SpreadBarGenerator();
    this.teamNameMatcher = new TeamNameMatcher();
    this.imageComposer = new ImageComposer();
    this.recommendationEngine = new BettingRecommendationEngine();
    
    // Sport-specific forum channel names
    this.sportForumNames = {
      'nfl': 'nfl-betting',
      'nba': 'nba-betting',
      'nhl': 'nhl-betting',
      'ncaa_basketball': 'ncaa-basketball-betting',
      'ncaa_football': 'ncaa-football-betting'
    };
    
    // Colors for each sport
    this.sportColors = {
      'nfl': 0x013369, // NFL Blue
      'nba': 0xC8102E, // NBA Red
      'nhl': 0x000000, // NHL Black
      'ncaa_basketball': 0xFF8C00, // Orange
      'ncaa_football': 0x8B0000  // Dark Red
    };

    // Track created threads by sport and game ID (simple in-memory tracking)
    this.createdThreads = new Map(); // Key: `${sport}_${gameId}`, Value: threadId
  }

  /**
   * Check if a betting thread exists for a game
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @returns {boolean} - Whether thread exists
   */
  hasThread(sport, gameId) {
    const threadKey = `${sport}_${gameId}`;
    return this.createdThreads.has(threadKey);
  }

  /**
   * Get thread ID for a game
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @returns {string|null} - Thread ID or null
   */
  getThreadId(sport, gameId) {
    const threadKey = `${sport}_${gameId}`;
    return this.createdThreads.get(threadKey) || null;
  }

  /**
   * Create a betting thread for a specific game
   * @param {Guild} guild - Discord guild
   * @param {string} sport - Sport key
   * @param {string} gameId - ESPN game ID
   * @param {Object} options - Creation options
   * @param {boolean} options.skipRecommendation - Skip MCMC recommendation generation for faster creation
   * @returns {Promise<ThreadChannel|null>} - Created thread or null
   */
  async createBettingThread(guild, sport, gameId, options = {}) {
    const { skipRecommendation = false } = options;
    const startTime = Date.now();
    
    try {
      logger.info('Creating betting thread', {
        guildId: guild.id,
        sport,
        gameId,
        skipRecommendation
      });

      // Find or create sport-specific betting forum channel
      const forumChannel = await this.findOrCreateBettingForum(guild, sport);
      if (!forumChannel) {
        throw new Error(`Could not find or create ${sport} betting forum channel`);
      }

      // Get game details from ESPN
      const gameData = await this.getGameDetails(sport, gameId);
      if (!gameData) {
        throw new Error('Could not fetch game details from ESPN');
      }

      // Get betting odds - prefer ESPN odds, fall back to ActionNetwork if needed
      let bettingData = null;
      const oddsStartTime = Date.now();
      
      // Log game data to debug odds availability
      logger.info('Checking for odds in game data', {
        sport,
        gameId,
        hasOdds: !!gameData.odds,
        gameDataKeys: Object.keys(gameData),
        oddsData: gameData.odds ? 'present' : 'missing',
        gameTeams: {
          away: gameData.teams?.away?.abbreviation,
          home: gameData.teams?.home?.abbreviation
        }
      });
      
      // First, check if ESPN provided odds data
      if (gameData.odds) {
        logger.info('Using ESPN odds data for thread', {
          sport,
          gameId,
          provider: gameData.odds.provider,
          hasSpread: gameData.odds.spread !== null,
          hasMoneyline: gameData.odds.moneyline?.home !== null || gameData.odds.moneyline?.away !== null,
          hasTotal: gameData.odds.total !== null,
          oddsStructure: {
            spread: gameData.odds.spread,
            spreadOddsHome: gameData.odds.spreadOdds?.home,
            spreadOddsAway: gameData.odds.spreadOdds?.away,
            moneylineHome: gameData.odds.moneyline?.home,
            moneylineAway: gameData.odds.moneyline?.away,
            total: gameData.odds.total
          }
        });
        
        try {
          // Convert ESPN odds format to BettingSnapshot format for compatibility
          bettingData = this.convertESPNOddsToBettingSnapshot(gameData, gameData.odds);
          
          // Validate that we got usable betting data
          if (!bettingData.spreadLine && !bettingData.homeMoneyline && !bettingData.totalLine) {
            logger.warn('ESPN odds conversion resulted in no usable betting lines', {
              sport,
              gameId,
              bettingData: {
                spreadLine: bettingData.spreadLine,
                homeMoneyline: bettingData.homeMoneyline,
                totalLine: bettingData.totalLine
              }
            });
            bettingData = null; // Fall back to ActionNetwork
          }
        } catch (conversionError) {
          logger.error('Failed to convert ESPN odds to BettingSnapshot', {
            sport,
            gameId,
            error: conversionError.message,
            stack: conversionError.stack
          });
          bettingData = null; // Fall back to ActionNetwork
        }
        
      } else {
        // Fall back to ActionNetwork scraping if ESPN doesn't have odds
        logger.warn('ESPN odds not available for game, falling back to ActionNetwork', { 
          sport, 
          gameId,
          gameDisplayName: gameData.displayName || gameData.name
        });
        
        try {
          const actionNetworkStartTime = Date.now();
          const ActionNetworkScraper = require('./ActionNetworkScraper');
          const scraper = new ActionNetworkScraper();
          
          const snapshots = await scraper.scrapeOdds(sport);
          await scraper.cleanup();
          
          const scrapeDuration = Date.now() - actionNetworkStartTime;
          
          logger.info('ActionNetwork scraping completed', {
            sport,
            gameId,
            snapshotsFound: snapshots.length,
            durationMs: scrapeDuration
          });
          
          // Use TeamNameMatcher to find betting data for this specific game
          bettingData = this.findBettingDataForGame(snapshots, gameData);
          
          if (bettingData) {
            logger.info('Found ActionNetwork betting data for thread', {
              sport,
              gameId,
              hasSpread: bettingData.spreadLine !== null,
              hasMoneyline: bettingData.homeMoneyline !== null,
              hasTotal: bettingData.totalLine !== null,
              matchConfidence: bettingData.matchConfidence || 'N/A',
              bettingDataSummary: {
                spreadLine: bettingData.spreadLine,
                totalLine: bettingData.totalLine,
                homeMoneyline: bettingData.homeMoneyline,
                awayMoneyline: bettingData.awayMoneyline
              }
            });
          } else {
            logger.warn('No betting data found from ActionNetwork', { 
              sport, 
              gameId,
              availableSnapshots: snapshots.length,
              gameTeams: {
                away: gameData.teams?.away?.abbreviation,
                home: gameData.teams?.home?.abbreviation
              }
            });
          }
          
        } catch (oddsError) {
          logger.error('Failed to fetch ActionNetwork odds for thread', {
            sport,
            gameId,
            error: oddsError.message,
            stack: oddsError.stack
          });
          // Continue without betting data
        }
      }
      
      const oddsDuration = Date.now() - oddsStartTime;
      logger.info('Odds retrieval completed', {
        sport,
        gameId,
        hasBettingData: !!bettingData,
        source: bettingData?.source || 'none',
        durationMs: oddsDuration
      });

      // Create thread name with betting info
      const threadName = this.createThreadNameWithOdds(gameData, bettingData);

      // Generate spread bar visualization (if betting data available)
      let spreadBarMessage = null;
      if (bettingData && bettingData.spreadLine !== null && gameData.teams.away && gameData.teams.home) {
        try {
          const colors = this.colorMapper.getTeamColors(gameData.teams.away, gameData.teams.home);
          const barData = this.spreadBarGenerator.generateSpreadBar(
            gameData.teams.away,
            gameData.teams.home,
            bettingData.spreadLine,
            colors.awayColor,
            colors.homeColor
          );
          
          // Format: Just the emoji bar (visible in thread preview)
          spreadBarMessage = barData.bar;
          
          logger.debug('Generated spread bar visualization', {
            gameId,
            spreadLine: bettingData.spreadLine,
            barLength: spreadBarMessage?.length
          });
        } catch (barError) {
          logger.warn('Failed to generate spread bar, continuing without it', {
            gameId,
            error: barError.message,
            spreadLine: bettingData.spreadLine
          });
        }
      }

      // Create the thread with spread bar as first message
      const thread = await forumChannel.threads.create({
        name: threadName,
        message: {
          content: spreadBarMessage || '🏈 Game Thread'
        },
        reason: `Betting thread for ${gameData.displayName}`
      });

      // Create compact betting information display (single message)
      if (bettingData) {
        // Generate betting recommendation using MCMC simulation (optional for performance)
        let recommendation = null;
        if (!skipRecommendation) {
          try {
            const recStartTime = Date.now();
            recommendation = await this.recommendationEngine.generateRecommendation(gameData, bettingData);
            const recDuration = Date.now() - recStartTime;
            
            logger.info('Generated betting recommendation', {
              gameId,
              method: recommendation.method,
              hasPick: !!recommendation.pick,
              durationMs: recDuration
            });
          } catch (recError) {
            logger.warn('Failed to generate recommendation, continuing without it', {
              gameId,
              error: recError.message,
              stack: recError.stack
            });
          }
        } else {
          logger.debug('Skipped recommendation generation for faster thread creation', { gameId });
        }

        const bettingDisplay = await this.createCompactBettingDisplay(gameData, bettingData, recommendation);
        const bettingMessage = await thread.send(bettingDisplay);
        
        // Pin the betting message for easy access
        if (bettingMessage) {
          try {
            await bettingMessage.pin();
            logger.info('Pinned betting message', { threadId: thread.id });
          } catch (pinError) {
            logger.warn('Failed to pin betting message', { 
              threadId: thread.id, 
              error: pinError.message 
            });
          }
        }
      } else {
        // No betting data - send simple message
        await thread.send({
          content: 'Betting odds not available at this time.'
        });
      }

      // Track the created thread
      const threadKey = `${sport}_${gameId}`;
      this.createdThreads.set(threadKey, thread.id);

      // Store betting data if available
      if (bettingData) {
        await this.storeBettingSnapshot(bettingData);
      }

      const duration = Date.now() - startTime;
      
      logger.info('Betting thread created successfully', {
        guildId: guild.id,
        sport,
        gameId,
        threadId: thread.id,
        threadName,
        hasBettingData: !!bettingData,
        hasSpreadBar: !!spreadBarMessage,
        durationMs: duration,
        skipRecommendation
      });

      return thread;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Failed to create betting thread', {
        guildId: guild.id,
        sport,
        gameId,
        error: error.message,
        stack: error.stack,
        durationMs: duration
      });
      return null;
    }
  }

  /**
   * Delete a betting thread for a game
   * @param {Guild} guild - Discord guild
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @returns {Promise<boolean>} - Whether deletion was successful
   */
  async deleteBettingThread(guild, sport, gameId) {
    try {
      const threadKey = `${sport}_${gameId}`;
      const threadId = this.createdThreads.get(threadKey);
      
      if (!threadId) {
        logger.warn('No thread found to delete', { sport, gameId });
        return false;
      }

      // Find the thread
      const thread = guild.channels.cache.get(threadId);
      if (!thread) {
        // Thread doesn't exist anymore, remove from tracking
        this.createdThreads.delete(threadKey);
        logger.warn('Thread not found in guild, removed from tracking', { 
          sport, 
          gameId, 
          threadId 
        });
        return true;
      }

      // Delete the thread
      await thread.delete('Betting thread removed by admin');
      
      // Remove from tracking
      this.createdThreads.delete(threadKey);

      logger.info('Betting thread deleted successfully', {
        guildId: guild.id,
        sport,
        gameId,
        threadId
      });

      return true;

    } catch (error) {
      logger.error('Failed to delete betting thread', {
        guildId: guild.id,
        sport,
        gameId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Refresh thread tracking by scanning existing forum channels
   * This helps maintain state consistency after bot restarts
   * @param {Guild} guild - Discord guild
   */
  async refreshThreadTracking(guild) {
    try {
      logger.info('Refreshing betting thread tracking', { guildId: guild.id });
      
      // Clear current tracking
      this.createdThreads.clear();
      
      // Scan all forum channels for existing betting threads
      for (const [sport, forumName] of Object.entries(this.sportForumNames)) {
        const forumChannel = guild.channels.cache.find(
          ch => ch.type === ChannelType.GuildForum && 
                (ch.name === forumName || ch.name.includes(`${sport}-betting`))
        );
        
        if (forumChannel) {
          // Get active threads in this forum
          const threads = await forumChannel.threads.fetchActive();
          
          for (const [threadId, thread] of threads.threads) {
            // Try to extract game ID from thread name or initial message
            // This is a best-effort approach - may need refinement
            const threadKey = `${sport}_${thread.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
            this.createdThreads.set(threadKey, threadId);
            
            logger.debug('Tracked existing betting thread', {
              sport,
              threadId,
              threadName: thread.name
            });
          }
        }
      }
      
      logger.info('Thread tracking refresh completed', {
        guildId: guild.id,
        trackedThreads: this.createdThreads.size
      });
      
    } catch (error) {
      logger.error('Failed to refresh thread tracking', {
        guildId: guild.id,
        error: error.message
      });
    }
  }

  /**
   * Find or create sport-specific betting forum channel
   * @param {Guild} guild - Discord guild
   * @param {string} sport - Sport key
   * @returns {Promise<ForumChannel|null>} - Forum channel or null
   */
  async findOrCreateBettingForum(guild, sport) {
    try {
      const forumName = this.sportForumNames[sport];
      if (!forumName) {
        throw new Error(`No forum name configured for sport: ${sport}`);
      }

      // Try to find existing sport-specific forum channel
      let forumChannel = guild.channels.cache.find(
        ch => ch.type === ChannelType.GuildForum && 
              (ch.name === forumName || ch.name.includes(`${sport}-betting`))
      );

      if (forumChannel) {
        return forumChannel;
      }

      // Check bot permissions
      const botMember = guild.members.me;
      if (!botMember.permissions.has(['ManageChannels', 'SendMessages', 'CreatePublicThreads'])) {
        logger.warn('Bot lacks permissions to create forum channel', {
          guildId: guild.id,
          sport
        });
        return null;
      }

      // Create new sport-specific forum channel
      const sportDisplayName = this.getSportDisplayName(sport);
      forumChannel = await guild.channels.create({
        name: forumName,
        type: ChannelType.GuildForum,
        topic: `${sportDisplayName} betting discussions, odds tracking, and game analysis`,
        reason: `Created for ${sportDisplayName} betting threads`
      });

      logger.info('Created new sport-specific betting forum channel', {
        guildId: guild.id,
        sport,
        channelId: forumChannel.id,
        channelName: forumName
      });

      return forumChannel;

    } catch (error) {
      logger.error('Failed to find or create sport betting forum', {
        guildId: guild.id,
        sport,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get game details from ESPN API or cache
   * @param {string} sport - Sport key
   * @param {string} gameId - ESPN game ID
   * @returns {Promise<Object|null>} - Game data or null
   */
  async getGameDetails(sport, gameId) {
    try {
      // First try to get from cached schedule data
      const cachedGames = await this.espnClient.getCachedSchedule(sport);
      if (cachedGames) {
        const cachedGame = cachedGames.find(game => game.id === gameId);
        if (cachedGame) {
          return cachedGame;
        }
      }

      // If not in cache and we can make API calls, fetch fresh data
      if (this.espnClient.canMakeScheduleQuery(sport)) {
        const games = await this.espnClient.getUpcomingGames(sport);
        const game = games.find(g => g.id === gameId);
        if (game) {
          return game;
        }
      }

      // If we still don't have the game, create a minimal object
      return {
        id: gameId,
        sport: sport,
        displayName: `${this.getSportDisplayName(sport)} Game`,
        date: new Date(),
        teams: { home: null, away: null },
        status: 'scheduled'
      };

    } catch (error) {
      logger.error('Failed to get game details', {
        sport,
        gameId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Create thread name from game data
   * @param {Object} gameData - Game data
   * @returns {string} - Thread name
   */
  createThreadName(gameData) {
    if (gameData.teams.away && gameData.teams.home) {
      return `${gameData.teams.away.abbreviation || gameData.teams.away.name} @ ${gameData.teams.home.abbreviation || gameData.teams.home.name}`;
    }
    return gameData.displayName || `Game ${gameData.id}`;
  }

  /**
   * Create game embed
   * @param {string} sport - Sport key
   * @param {Object} gameData - Game data
   * @returns {EmbedBuilder} - Game embed
   */
  async createGameEmbed(sport, gameData) {
    // Get sport-specific emoji
    const sportEmojis = {
      'nfl': '🏈',
      'ncaa_football': '🏈',
      'nba': '🏀',
      'ncaa_basketball': '🏀',
      'nhl': '🏒'
    };
    const emoji = sportEmojis[sport] || '🏈';
    
    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${this.getSportDisplayName(sport)} Betting Thread`)
      .setColor(this.sportColors[sport] || 0x0099FF)
      .setTimestamp();

    // Game details
    let description = '';
    if (gameData.teams.away && gameData.teams.home) {
      description += `**${gameData.teams.away.name}** @ **${gameData.teams.home.name}**\n\n`;
    } else {
      description += `**${gameData.displayName}**\n\n`;
    }

    const gameTime = new Date(gameData.date).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    description += `⏰ **Game Time:** ${gameTime}\n`;

    if (gameData.venue) {
      description += `📍 **Venue:** ${gameData.venue}\n`;
    }

    if (gameData.status && gameData.status !== 'scheduled') {
      description += `📊 **Status:** ${gameData.status.toUpperCase()}\n`;
    }

    description += '\n💰 **Betting odds and discussion below**';

    embed.setDescription(description);

    return embed;
  }

  /**
   * Find betting data for a specific game from scraped snapshots using TeamNameMatcher
   * @param {BettingSnapshot[]} snapshots - Array of betting snapshots
   * @param {Object} gameData - ESPN game data
   * @returns {BettingSnapshot|null} - Matching betting snapshot or null
   */
  findBettingDataForGame(snapshots, gameData) {
    if (!snapshots || snapshots.length === 0) {
      logger.debug('No betting snapshots available for matching');
      return null;
    }

    // Validate game data has required team information
    if (!gameData.teams || !gameData.teams.home || !gameData.teams.away) {
      logger.warn('Game data missing team information', { gameId: gameData.id });
      return null;
    }

    // Convert ESPN game to format expected by TeamNameMatcher
    const espnGames = [{
      id: gameData.id,
      awayTeam: {
        name: gameData.teams.away.name,
        abbreviation: gameData.teams.away.abbreviation
      },
      homeTeam: {
        name: gameData.teams.home.name,
        abbreviation: gameData.teams.home.abbreviation
      }
    }];

    // Convert Action Network snapshots to format expected by TeamNameMatcher
    const actionNetworkGames = snapshots.map(snapshot => {
      const teams = this.extractTeamNamesFromGameId(snapshot.gameId);
      return {
        snapshot: snapshot, // Keep reference to original snapshot
        awayTeam: {
          name: teams.away,
          abbreviation: teams.away
        },
        homeTeam: {
          name: teams.home,
          abbreviation: teams.home
        }
      };
    });

    // Use TeamNameMatcher to find the best match
    const matches = this.teamNameMatcher.matchGames(espnGames, actionNetworkGames);

    if (matches.length === 0) {
      logger.warn('No matching Action Network game found for ESPN game', {
        gameId: gameData.id,
        espnTeams: `${gameData.teams.away.abbreviation} @ ${gameData.teams.home.abbreviation}`
      });
      return null;
    }

    // Get the matched snapshot
    const match = matches[0];
    const matchedSnapshot = match.anGame.snapshot;
    
    // Attach match confidence to snapshot for logging
    matchedSnapshot.matchConfidence = match.confidence;

    // Log match quality for monitoring
    logger.info('Matched ESPN game to Action Network odds', {
      gameId: gameData.id,
      espnTeams: `${gameData.teams.away.abbreviation} @ ${gameData.teams.home.abbreviation}`,
      anGameId: matchedSnapshot.gameId,
      confidence: match.confidence.toFixed(3),
      awayScore: match.awayScore.toFixed(3),
      homeScore: match.homeScore.toFixed(3)
    });

    return matchedSnapshot;
  }

  /**
   * Extract team names from ESPN game data
   * @param {Object} gameData - ESPN game data
   * @returns {Object} - Team names object
   */
  extractTeamNamesFromGame(gameData) {
    let home = null;
    let away = null;

    if (gameData.teams && gameData.teams.home && gameData.teams.away) {
      home = gameData.teams.home.abbreviation || gameData.teams.home.name;
      away = gameData.teams.away.abbreviation || gameData.teams.away.name;
    } else if (gameData.displayName) {
      // Try to parse from display name like "Team1 at Team2"
      const parts = gameData.displayName.split(' at ');
      if (parts.length === 2) {
        away = parts[0].trim();
        home = parts[1].trim();
      }
    }

    return { home, away };
  }

  /**
   * Extract team names from betting snapshot game ID
   * @param {string} gameId - Game ID like "la_at_jac"
   * @returns {Object} - Team names object
   */
  extractTeamNamesFromGameId(gameId) {
    const parts = gameId.split('_at_');
    if (parts.length === 2) {
      return {
        away: parts[0].toUpperCase(),
        home: parts[1].toUpperCase()
      };
    }
    return { home: null, away: null };
  }

  /**
   * Check if two team objects match
   * @param {Object} teams1 - First team object
   * @param {Object} teams2 - Second team object
   * @returns {boolean} - Whether teams match
   */
  teamsMatch(teams1, teams2) {
    if (!teams1.home || !teams1.away || !teams2.home || !teams2.away) {
      return false;
    }

    const normalize = (name) => name.toUpperCase().replace(/[^A-Z]/g, '');
    
    const home1 = normalize(teams1.home);
    const away1 = normalize(teams1.away);
    const home2 = normalize(teams2.home);
    const away2 = normalize(teams2.away);

    // Direct match
    if (home1 === home2 && away1 === away2) {
      return true;
    }

    // Check reversed (for neutral site games or data source discrepancies)
    if (home1 === away2 && away1 === home2) {
      return true;
    }

    // Handle common abbreviation differences
    const teamAliases = {
      'LAR': ['LA', 'RAMS'],
      'LA': ['LAR', 'RAMS'],
      'LAC': ['LAC', 'CHARGERS'],
      'NE': ['NE', 'PATRIOTS'],
      'NO': ['NO', 'SAINTS'],
      'NYG': ['NYG', 'GIANTS'],
      'NYJ': ['NYJ', 'JETS'],
      'TB': ['TB', 'BUCS', 'BUCCANEERS'],
      'GB': ['GB', 'PACKERS'],
      'KC': ['KC', 'CHIEFS'],
      'LV': ['LV', 'RAIDERS'],
      'SF': ['SF', '49ERS'],
      'WAS': ['WAS', 'COMMANDERS'],
      'JAX': ['JAC', 'JAGUARS'],
      'JAC': ['JAX', 'JAGUARS']
    };

    const getAliases = (team) => {
      const aliases = teamAliases[team] || [];
      return [team, ...aliases];
    };

    const home1Aliases = getAliases(home1);
    const away1Aliases = getAliases(away1);
    const home2Aliases = getAliases(home2);
    const away2Aliases = getAliases(away2);

    // Check if any aliases match
    const homeMatch = home1Aliases.some(alias1 => home2Aliases.includes(alias1));
    const awayMatch = away1Aliases.some(alias1 => away2Aliases.includes(alias1));

    if (homeMatch && awayMatch) {
      return true;
    }

    // Fallback: partial string matching
    const homePartialMatch = home1Aliases.some(alias1 => 
      home2Aliases.some(alias2 => 
        alias1.includes(alias2) || alias2.includes(alias1)
      )
    );
    
    const awayPartialMatch = away1Aliases.some(alias1 => 
      away2Aliases.some(alias2 => 
        alias1.includes(alias2) || alias2.includes(alias1)
      )
    );

    return homePartialMatch && awayPartialMatch;
  }

  /**
   * Create thread name with betting odds information
   * Format: "[Away Abbrev] @ [Home Abbrev] | [Favorite] -[Spread]"
   * @param {Object} gameData - ESPN game data
   * @param {BettingSnapshot} bettingData - Betting snapshot data
   * @returns {string} - Thread name with odds
   */
  createThreadNameWithOdds(gameData, bettingData) {
    const baseName = this.createThreadName(gameData);
    
    // If no betting data or no spread, show "Odds Pending"
    if (!bettingData || bettingData.spreadLine === null || bettingData.spreadLine === undefined) {
      return `${baseName} | Odds Pending`;
    }

    // Handle pick'em
    if (bettingData.spreadLine === 0) {
      return `${baseName} | PICK'EM`;
    }

    // Determine favorite and format spread
    const spread = bettingData.spreadLine;
    const absSpread = Math.abs(spread);
    const isFavoriteHome = spread < 0;
    
    const favoriteTeam = isFavoriteHome ? gameData.teams.home : gameData.teams.away;
    const favoriteAbbrev = favoriteTeam.abbreviation || favoriteTeam.name;
    
    return `${baseName} | ${favoriteAbbrev} -${absSpread}`;
  }

  /**
   * Create game embed with betting odds information
   * @param {string} sport - Sport key
   * @param {Object} gameData - ESPN game data
   * @param {BettingSnapshot} bettingData - Betting snapshot data
   * @returns {Promise<EmbedBuilder>} - Enhanced game embed
   */
  async createGameEmbedWithOdds(sport, gameData, bettingData) {
    // Start with the basic game embed
    const embed = await this.createGameEmbed(sport, gameData);
    
    if (!bettingData) {
      embed.addFields({
        name: '💰 Betting Lines',
        value: 'Betting odds not available at this time.',
        inline: false
      });
      return embed;
    }

    // Get display summary of betting data
    const summary = bettingData.getDisplaySummary();
    
    // Add spread visualization at the top if available
    if (bettingData.spreadLine !== null && gameData.teams.away && gameData.teams.home) {
      // Get team colors
      const colors = this.colorMapper.getTeamColors(gameData.teams.away, gameData.teams.home);
      
      // Generate visual spread bar
      const visualization = this.spreadBarGenerator.generateSpreadVisualization(
        gameData.teams.away,
        gameData.teams.home,
        bettingData.spreadLine,
        colors.awayColor,
        colors.homeColor
      );
      
      embed.addFields({
        name: '📈 Spread Visualization',
        value: visualization,
        inline: false
      });
    }
    
    // Add betting information fields
    const bettingFields = [];
    
    // Moneyline
    if (summary.moneyline.home !== 'N/A' && summary.moneyline.away !== 'N/A') {
      bettingFields.push({
        name: '💵 Moneyline',
        value: `**Away:** ${summary.moneyline.away}\n**Home:** ${summary.moneyline.home}`,
        inline: true
      });
    }
    
    // Spread
    if (summary.spread.line !== 'N/A') {
      const spreadType = sport === 'nhl' ? 'Puck Line' : 'Point Spread';
      bettingFields.push({
        name: `📊 ${spreadType}`,
        value: `**Line:** ${summary.spread.line}\n**Away:** ${summary.spread.awayOdds}\n**Home:** ${summary.spread.homeOdds}`,
        inline: true
      });
    }
    
    // Total
    if (summary.total.line !== 'N/A') {
      bettingFields.push({
        name: '🎯 Over/Under',
        value: `**Total:** ${summary.total.line}\n**Over:** ${summary.total.overOdds}\n**Under:** ${summary.total.underOdds}`,
        inline: true
      });
    }
    
    // Add betting fields to embed
    if (bettingFields.length > 0) {
      embed.addFields(...bettingFields);
      
      // Add footer with data source and timestamp
      const timestamp = new Date(summary.metadata.scrapedAt).toLocaleString();
      embed.setFooter({ 
        text: `Odds from ${summary.metadata.source} • ${timestamp}${summary.metadata.isStale ? ' (Stale)' : ''}` 
      });
    }
    
    return embed;
  }

  /**
   * Create compact betting display with 2-column grid layout
   * @param {Object} gameData - Game data from ESPN
   * @param {BettingSnapshot} bettingData - Betting snapshot data
   * @param {Object} recommendation - Betting recommendation from MCMC engine (optional)
   * @returns {Object} - Discord message object with embed and button rows
   */
  async createCompactBettingDisplay(gameData, bettingData, recommendation = null) {
    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
    
    // Validate inputs
    if (!bettingData) {
      logger.error('createCompactBettingDisplay called with null bettingData');
      throw new Error('Betting data is required for compact display');
    }
    
    if (!gameData.teams || !gameData.teams.home || !gameData.teams.away) {
      logger.error('createCompactBettingDisplay called with invalid team data', {
        hasTeams: !!gameData.teams,
        hasHome: !!gameData.teams?.home,
        hasAway: !!gameData.teams?.away
      });
      throw new Error('Valid team data is required for compact display');
    }
    
    const summary = bettingData.getDisplaySummary();
    
    // Determine favorite and underdog
    const isFavoriteHome = bettingData.spreadLine < 0;
    const favoriteTeam = isFavoriteHome ? gameData.teams.home : gameData.teams.away;
    const underdogTeam = isFavoriteHome ? gameData.teams.away : gameData.teams.home;
    
    // Get betting values
    const favoriteSpread = bettingData.spreadLine < 0 ? bettingData.spreadLine : -bettingData.spreadLine;
    const underdogSpreadValue = bettingData.spreadLine > 0 ? bettingData.spreadLine : -bettingData.spreadLine;
    const underdogSpread = '+' + Math.abs(underdogSpreadValue);
    
    const favoriteSpreadOdds = isFavoriteHome ? summary.spread.homeOdds : summary.spread.awayOdds;
    const underdogSpreadOdds = isFavoriteHome ? summary.spread.awayOdds : summary.spread.homeOdds;
    
    const favoriteML = isFavoriteHome ? summary.moneyline.home : summary.moneyline.away;
    const underdogML = isFavoriteHome ? summary.moneyline.away : summary.moneyline.home;
    
    // Create composite image of both team logos side-by-side
    let compositeImage = null;
    let attachment = null;
    
    if (favoriteTeam.logo && underdogTeam.logo) {
      try {
        const imageStartTime = Date.now();
        const imageBuffer = await this.imageComposer.createSideBySideLogos(
          favoriteTeam.logo,
          underdogTeam.logo,
          favoriteTeam.abbreviation,
          underdogTeam.abbreviation
        );
        
        const imageDuration = Date.now() - imageStartTime;
        
        if (imageBuffer) {
          attachment = new AttachmentBuilder(imageBuffer, { 
            name: 'matchup.png' 
          });
          compositeImage = 'attachment://matchup.png';
          
          logger.debug('Created composite team image', {
            durationMs: imageDuration,
            bufferSize: imageBuffer.length
          });
        }
      } catch (error) {
        logger.warn('Failed to create composite image, using simple embed', {
          error: error.message,
          stack: error.stack,
          favoriteTeamLogo: favoriteTeam.logo,
          underdogTeamLogo: underdogTeam.logo
        });
      }
    } else {
      logger.debug('Skipping composite image - missing team logos', {
        hasFavoriteLogo: !!favoriteTeam.logo,
        hasUnderdogLogo: !!underdogTeam.logo
      });
    }
    
    // Create embed with composite image (gambling data is in buttons)
    const embed = new EmbedBuilder()
      .setColor(0x0099FF);
    
    if (compositeImage) {
      embed.setImage(compositeImage);
    } else {
      // Fallback if image creation fails
      embed.setDescription(`**${favoriteTeam.abbreviation}** vs **${underdogTeam.abbreviation}**`)
        .setThumbnail(favoriteTeam.logo || underdogTeam.logo);
    }

    // Add recommendation if available
    if (recommendation) {
      const recEmoji = recommendation.method === 'MCMC' ? '🎯' : '📊';
      let recText = `${recEmoji} **Recommended Pick:** ${recommendation.pick}\n`;
      recText += `${recommendation.reasoning}`;
      
      // Add warning if using fallback method
      if (recommendation.warning) {
        recText += `\n⚠️ ${recommendation.warning}`;
      }
      
      // Add simulation data if available
      if (recommendation.simulationData) {
        const simData = recommendation.simulationData;
        if (simData.expectedValue) {
          recText += `\n\n**Analysis:**`;
          recText += `\n• Simulated Prob: ${simData.simulatedProb}`;
          recText += `\n• Implied Prob: ${simData.impliedProb}`;
          recText += `\n• Expected Value: ${simData.expectedValue}`;
          recText += `\n• Confidence: ${simData.confidence}`;
        }
      }
      
      embed.addFields({
        name: '💡 Betting Recommendation',
        value: recText,
        inline: false
      });
    }
    
    // Row 1: Spread buttons (Favorite | Underdog)
    const spreadRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_fav_spread_${gameData.id}`)
        .setLabel(`${favoriteTeam.abbreviation} ${favoriteSpread} (${favoriteSpreadOdds})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`bet_dog_spread_${gameData.id}`)
        .setLabel(`${underdogTeam.abbreviation} ${underdogSpread} (${underdogSpreadOdds})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true)
    );
    
    // Row 2: Moneyline buttons (Favorite | Underdog)
    const moneylineRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_fav_ml_${gameData.id}`)
        .setLabel(`${favoriteTeam.abbreviation} ML ${favoriteML}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`bet_dog_ml_${gameData.id}`)
        .setLabel(`${underdogTeam.abbreviation} ML ${underdogML}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );
    
    // Row 3: Over/Under buttons (Over | Under)
    const totalRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_over_${gameData.id}`)
        .setLabel(`Over ${summary.total.line} (${summary.total.overOdds})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`bet_under_${gameData.id}`)
        .setLabel(`Under ${summary.total.line} (${summary.total.underOdds})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
    
    const result = {
      embeds: [embed],
      components: [spreadRow, moneylineRow, totalRow]
    };
    
    // Add attachment if we created a composite image
    if (attachment) {
      result.files = [attachment];
    }
    
    return result;
  }

  /**
   * Create two team betting displays with horizontal buttons
   * @param {Object} gameData - Game data from ESPN
   * @param {BettingSnapshot} bettingData - Betting snapshot data
   * @returns {Object} - { favoriteDisplay, underdogDisplay }
   */
  async createTeamBettingDisplays(gameData, bettingData) {
    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
    const summary = bettingData.getDisplaySummary();
    
    // Determine favorite and underdog
    const isFavoriteHome = bettingData.spreadLine < 0;
    const favoriteTeam = isFavoriteHome ? gameData.teams.home : gameData.teams.away;
    const underdogTeam = isFavoriteHome ? gameData.teams.away : gameData.teams.home;
    
    // Get betting values for each team
    const favoriteSpread = bettingData.spreadLine < 0 ? bettingData.spreadLine : -bettingData.spreadLine;
    const underdogSpreadValue = bettingData.spreadLine > 0 ? bettingData.spreadLine : -bettingData.spreadLine;
    const underdogSpread = '+' + Math.abs(underdogSpreadValue); // Always show + for underdog
    
    const favoriteSpreadOdds = isFavoriteHome ? summary.spread.homeOdds : summary.spread.awayOdds;
    const underdogSpreadOdds = isFavoriteHome ? summary.spread.awayOdds : summary.spread.homeOdds;
    
    const favoriteMoneyline = isFavoriteHome ? summary.moneyline.home : summary.moneyline.away;
    const underdogMoneyline = isFavoriteHome ? summary.moneyline.away : summary.moneyline.home;
    
    // Create favorite team embed (compact, no large images)
    const favoriteEmbed = new EmbedBuilder()
      .setColor(0xFF0000) // Red for favorite
      .setAuthor({ 
        name: `${favoriteTeam.abbreviation || favoriteTeam.name} (Favorite)`,
        iconURL: favoriteTeam.logo
      })
      .setDescription(`**${favoriteTeam.name}**`);
    
    // Create favorite team buttons (vertical layout - one per row)
    const favoriteSpreadRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_fav_spread_${gameData.id}`)
        .setLabel(`Spread ${favoriteSpread} (${favoriteSpreadOdds})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true)
    );
    
    const favoriteMLRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_fav_ml_${gameData.id}`)
        .setLabel(`ML ${favoriteMoneyline}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );
    
    const favoriteOverRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_fav_over_${gameData.id}`)
        .setLabel(`Over ${summary.total.line} (${summary.total.overOdds})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
    
    // Create underdog team embed (compact, no large images)
    const underdogEmbed = new EmbedBuilder()
      .setColor(0x0000FF) // Blue for underdog
      .setAuthor({ 
        name: `${underdogTeam.abbreviation || underdogTeam.name} (Underdog)`,
        iconURL: underdogTeam.logo
      })
      .setDescription(`**${underdogTeam.name}**`);
    
    // Create underdog team buttons (vertical layout - one per row)
    const underdogSpreadRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_dog_spread_${gameData.id}`)
        .setLabel(`Spread ${underdogSpread} (${underdogSpreadOdds})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true)
    );
    
    const underdogMLRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_dog_ml_${gameData.id}`)
        .setLabel(`ML ${underdogMoneyline}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );
    
    const underdogUnderRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bet_dog_under_${gameData.id}`)
        .setLabel(`Under ${summary.total.line} (${summary.total.underOdds})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
    
    return {
      favoriteDisplay: {
        embeds: [favoriteEmbed],
        components: [favoriteSpreadRow, favoriteMLRow, favoriteOverRow]
      },
      underdogDisplay: {
        embeds: [underdogEmbed],
        components: [underdogSpreadRow, underdogMLRow, underdogUnderRow]
      }
    };
  }

  /**
   * Create two team betting embeds (one for favorite, one for underdog)
   * @param {Object} gameData - Game data from ESPN
   * @param {BettingSnapshot} bettingData - Betting snapshot data
   * @returns {Object} - { favoriteEmbed, underdogEmbed }
   */
  createTeamBettingEmbeds(gameData, bettingData) {
    if (!bettingData || !gameData.teams.away || !gameData.teams.home) {
      return { favoriteEmbed: null, underdogEmbed: null };
    }

    const summary = bettingData.getDisplaySummary();
    
    // Determine favorite and underdog based on spread
    const isFavoriteHome = bettingData.spreadLine < 0;
    const favoriteTeam = isFavoriteHome ? gameData.teams.home : gameData.teams.away;
    const underdogTeam = isFavoriteHome ? gameData.teams.away : gameData.teams.home;
    
    // Get spread values for each team
    const favoriteSpread = isFavoriteHome ? bettingData.spreadLine : -bettingData.spreadLine;
    const underdogSpread = isFavoriteHome ? -bettingData.spreadLine : bettingData.spreadLine;
    
    // Get odds for each team
    const favoriteSpreadOdds = isFavoriteHome ? summary.spread.homeOdds : summary.spread.awayOdds;
    const underdogSpreadOdds = isFavoriteHome ? summary.spread.awayOdds : summary.spread.homeOdds;
    
    const favoriteMoneyline = isFavoriteHome ? summary.moneyline.home : summary.moneyline.away;
    const underdogMoneyline = isFavoriteHome ? summary.moneyline.away : summary.moneyline.home;
    
    // Create favorite team embed
    const favoriteEmbed = new EmbedBuilder()
      .setTitle(`${favoriteTeam.abbreviation || favoriteTeam.name} (Favorite)`)
      .setColor(0xFF0000) // Red for favorite
      .addFields(
        {
          name: 'Moneyline',
          value: favoriteMoneyline,
          inline: true
        },
        {
          name: 'Spread',
          value: `${favoriteSpread} (${favoriteSpreadOdds})`,
          inline: true
        },
        {
          name: 'Over/Under',
          value: `Over ${summary.total.line} (${summary.total.overOdds})`,
          inline: true
        }
      );
    
    // Add team logo if available
    if (favoriteTeam.logo) {
      favoriteEmbed.setThumbnail(favoriteTeam.logo);
    }
    
    // Add footer with team identifier for color management
    favoriteEmbed.setFooter({ 
      text: `Team: ${favoriteTeam.abbreviation || favoriteTeam.name} | React with color emoji to change spread bar color` 
    });
    
    // Create underdog team embed
    const underdogEmbed = new EmbedBuilder()
      .setTitle(`${underdogTeam.abbreviation || underdogTeam.name} (Underdog)`)
      .setColor(0x0000FF) // Blue for underdog
      .addFields(
        {
          name: 'Moneyline',
          value: underdogMoneyline,
          inline: true
        },
        {
          name: 'Spread',
          value: `${underdogSpread} (${underdogSpreadOdds})`,
          inline: true
        },
        {
          name: 'Over/Under',
          value: `Under ${summary.total.line} (${summary.total.underOdds})`,
          inline: true
        }
      );
    
    // Add team logo if available
    if (underdogTeam.logo) {
      underdogEmbed.setThumbnail(underdogTeam.logo);
    }
    
    // Add footer with team identifier for color management
    underdogEmbed.setFooter({ 
      text: `Team: ${underdogTeam.abbreviation || underdogTeam.name} | React with color emoji to change spread bar color` 
    });
    
    return { favoriteEmbed, underdogEmbed };
  }

  /**
   * Store betting snapshot to database
   * @param {BettingSnapshot} bettingData - Betting snapshot to store
   */
  async storeBettingSnapshot(bettingData) {
    if (!bettingData) {
      logger.warn('Attempted to store null betting snapshot');
      return;
    }
    
    try {
      // Validate betting data before storing
      const validation = bettingData.validate();
      if (!validation.isValid) {
        logger.warn('Betting snapshot validation failed, not storing', {
          gameId: bettingData.gameId,
          sport: bettingData.sport,
          errors: validation.errors
        });
        return;
      }
      
      const BettingSnapshotRepository = require('../../database/repositories/BettingSnapshotRepository');
      const dbConnection = require('../../database/connection');
      
      if (!dbConnection.db) {
        logger.error('Database connection not available for storing betting snapshot', {
          gameId: bettingData.gameId,
          sport: bettingData.sport
        });
        return;
      }
      
      const repo = new BettingSnapshotRepository(dbConnection.db);
      await repo.save(bettingData);
      
      logger.debug('Stored betting snapshot to database', {
        gameId: bettingData.gameId,
        sport: bettingData.sport,
        hasSpread: bettingData.spreadLine !== null,
        hasMoneyline: bettingData.homeMoneyline !== null,
        hasTotal: bettingData.totalLine !== null
      });
      
    } catch (error) {
      logger.error('Failed to store betting snapshot', {
        gameId: bettingData?.gameId,
        sport: bettingData?.sport,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Convert ESPN odds format to BettingSnapshot format for compatibility
   * @param {Object} gameData - ESPN game data
   * @param {Object} espnOdds - ESPN odds object
   * @returns {Object} - BettingSnapshot-compatible object
   */
  convertESPNOddsToBettingSnapshot(gameData, espnOdds) {
    const BettingSnapshot = require('../../database/models/BettingSnapshot');
    
    // Create game ID from team abbreviations
    const gameId = `${gameData.teams.away.abbreviation}_at_${gameData.teams.home.abbreviation}`.toLowerCase();
    
    // Parse spread line (ESPN provides absolute value, we need signed value)
    // Convention: negative spread = home team favored, positive = away team favored
    let spreadLine = null;
    if (espnOdds.spread !== null && espnOdds.spread !== undefined) {
      // ESPN's spread field is already the signed value we need
      // The spreadOdds.home.line and spreadOdds.away.line contain the same spread value
      // We use the home team's line to determine the spread (our convention)
      if (espnOdds.spreadOdds.home?.line !== undefined && espnOdds.spreadOdds.home?.line !== null) {
        // Parse the line (e.g., "-17.5" or "+17.5")
        const lineStr = String(espnOdds.spreadOdds.home.line);
        spreadLine = parseFloat(lineStr);
      } else {
        // Fallback: use the main spread field
        // ESPN typically provides this as the home team's spread
        spreadLine = parseFloat(espnOdds.spread);
      }
    }
    
    // Parse moneyline odds - handle both string and number formats
    const parseOdds = (oddsValue) => {
      if (oddsValue === null || oddsValue === undefined) return null;
      
      // If it's already a number, return it
      if (typeof oddsValue === 'number') return Math.round(oddsValue);
      
      // If it's a string, clean and parse it
      if (typeof oddsValue === 'string') {
        const cleaned = oddsValue.replace(/[^0-9+-]/g, '');
        const parsed = parseInt(cleaned);
        return isNaN(parsed) ? null : parsed;
      }
      
      return null;
    };
    
    const snapshot = new BettingSnapshot({
      gameId: gameId,
      sport: gameData.sport,
      scrapedAt: new Date(),
      homeMoneyline: parseOdds(espnOdds.moneyline.home),
      awayMoneyline: parseOdds(espnOdds.moneyline.away),
      spreadLine: spreadLine,
      homeSpreadOdds: parseOdds(espnOdds.spreadOdds.home?.odds),
      awaySpreadOdds: parseOdds(espnOdds.spreadOdds.away?.odds),
      totalLine: espnOdds.total,
      overOdds: parseOdds(espnOdds.totalOdds.over?.odds),
      underOdds: parseOdds(espnOdds.totalOdds.under?.odds),
      source: espnOdds.provider || 'ESPN',
      sportsbook: espnOdds.provider || 'ESPN BET'
    });
    
    logger.info('Converted ESPN odds to BettingSnapshot format', {
      gameId: gameId,
      provider: espnOdds.provider,
      spreadLine: spreadLine,
      hasSpread: spreadLine !== null,
      hasMoneyline: snapshot.homeMoneyline !== null || snapshot.awayMoneyline !== null,
      hasTotal: snapshot.totalLine !== null,
      rawSpreadData: {
        mainSpread: espnOdds.spread,
        homeSpreadLine: espnOdds.spreadOdds.home?.line,
        awaySpreadLine: espnOdds.spreadOdds.away?.line
      }
    });
    
    return snapshot;
  }

  /**
   * Get display name for sport
   * @param {string} sport - Sport key
   * @returns {string} - Display name
   */
  getSportDisplayName(sport) {
    const displayNames = {
      'nfl': 'NFL',
      'nba': 'NBA',
      'nhl': 'NHL',
      'ncaa_basketball': 'NCAA Basketball',
      'ncaa_football': 'NCAA Football'
    };
    
    return displayNames[sport] || sport.toUpperCase();
  }
}

module.exports = BettingThreadManager;