const { EmbedBuilder, ChannelType } = require('discord.js');
const ESPNAPIClient = require('./ESPNAPIClient');
const logger = require('../../utils/logger');
const cron = require('node-cron');

/**
 * Manages daily game logs and posts schedules to Discord channels
 */
class GameLogManager {
  constructor(client, bettingThreadManager = null) {
    this.client = client;
    this.espnClient = new ESPNAPIClient();
    this.bettingThreadManager = bettingThreadManager;
    this.scheduledJobs = new Map();
    
    // Default channel mapping - can be configured per guild
    this.defaultChannelNames = {
      'nfl': 'nfl-games',
      'nba': 'nba-games', 
      'nhl': 'nhl-games',
      'ncaa_basketball': 'ncaa-basketball',
      'ncaa_football': 'ncaa-football'
    };
    
    // Colors for each sport
    this.sportColors = {
      'nfl': 0x013369, // NFL Blue
      'nba': 0xC8102E, // NBA Red
      'nhl': 0x000000, // NHL Black
      'ncaa_basketball': 0xFF8C00, // Orange
      'ncaa_football': 0x8B0000  // Dark Red
    };
    
    this.isInitialized = false;
  }

  /**
   * Initialize the game log manager
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      // Schedule daily game log updates
      this.scheduleDailyUpdates();
      
      this.isInitialized = true;
      logger.info('GameLogManager initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize GameLogManager', { error: error.message });
      throw error;
    }
  }

  /**
   * Schedule daily game log updates
   */
  scheduleDailyUpdates() {
    // Schedule for 8 AM daily
    const job = cron.schedule('0 8 * * *', async () => {
      logger.info('Running scheduled daily game log update');
      await this.updateAllGuildGameLogs();
    }, {
      scheduled: false,
      timezone: 'America/New_York'
    });

    this.scheduledJobs.set('daily-update', job);
    job.start();
    
    logger.info('Scheduled daily game log updates for 8 AM EST');
  }

  /**
   * Update game logs for all guilds
   */
  async updateAllGuildGameLogs() {
    try {
      const guilds = this.client.guilds.cache;
      logger.info(`Updating game logs for ${guilds.size} guilds`);
      
      for (const [guildId, guild] of guilds) {
        try {
          await this.updateGuildGameLogs(guild);
        } catch (error) {
          logger.error('Failed to update game logs for guild', {
            guildId,
            guildName: guild.name,
            error: error.message
          });
        }
      }
      
    } catch (error) {
      logger.error('Failed to update all guild game logs', { error: error.message });
    }
  }

  /**
   * Update game logs for a specific guild
   * @param {Guild} guild - Discord guild
   */
  async updateGuildGameLogs(guild) {
    try {
      logger.info('Updating game logs for guild', {
        guildId: guild.id,
        guildName: guild.name
      });

      const sports = Object.keys(this.defaultChannelNames);
      logger.info('Processing sports for guild', {
        guildId: guild.id,
        sports: sports
      });
      
      for (const sport of sports) {
        try {
          logger.info('Starting sport update', {
            guildId: guild.id,
            sport
          });
          await this.updateSportGameLog(guild, sport);
          logger.info('Completed sport update', {
            guildId: guild.id,
            sport
          });
        } catch (error) {
          logger.error('Failed to update sport game log', {
            guildId: guild.id,
            sport,
            error: error.message,
            stack: error.stack
          });
        }
      }
      
    } catch (error) {
      logger.error('Failed to update guild game logs', {
        guildId: guild.id,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Update game log for a specific sport in a guild
   * @param {Guild} guild - Discord guild
   * @param {string} sport - Sport key
   */
  async updateSportGameLog(guild, sport) {
    try {
      logger.info('Starting updateSportGameLog', {
        guildId: guild.id,
        sport
      });

      // Find or create the channel for this sport
      logger.info('Finding or creating channel', {
        guildId: guild.id,
        sport
      });
      
      const channel = await this.findOrCreateSportChannel(guild, sport);
      if (!channel) {
        logger.warn('Could not find or create channel for sport', {
          guildId: guild.id,
          sport
        });
        return;
      }

      logger.info('Channel found/created successfully', {
        guildId: guild.id,
        sport,
        channelId: channel.id,
        channelName: channel.name
      });

      // Check if we can make queries for this sport
      const canQuery = this.espnClient.canMakeScheduleQuery(sport);
      logger.info('Query status check', {
        sport,
        canQuery
      });

      if (!canQuery) {
        logger.warn('Daily query limit reached for sport', { sport });
        
        // Try to use cached data
        const cachedGames = await this.espnClient.getCachedSchedule(sport);
        logger.info('Cached games check', {
          sport,
          cachedGamesCount: cachedGames ? cachedGames.length : 0
        });
        
        if (cachedGames && cachedGames.length > 0) {
          await this.postGameSchedule(channel, sport, cachedGames, true);
        }
        return;
      }

      // Fetch today's games
      logger.info('Fetching games from ESPN', { sport });
      const games = await this.espnClient.getUpcomingGames(sport);
      logger.info('Games fetched from ESPN', {
        sport,
        totalGames: games.length
      });

      const todaysGames = this.filterTodaysGames(games);
      logger.info('Filtered to today\'s games', {
        sport,
        todaysGamesCount: todaysGames.length,
        totalGames: games.length
      });
      
      if (todaysGames.length === 0) {
        logger.info('No games today for sport, posting no games message', { sport });
        await this.postNoGamesMessage(channel, sport);
        return;
      }

      // Post the game schedule
      logger.info('Posting game schedule', {
        sport,
        gameCount: todaysGames.length,
        channelId: channel.id
      });
      
      await this.postGameSchedule(channel, sport, todaysGames);
      
      logger.info('Successfully updated sport game log', {
        guildId: guild.id,
        sport,
        gameCount: todaysGames.length,
        channelId: channel.id
      });
      
    } catch (error) {
      logger.error('Failed to update sport game log', {
        guildId: guild.id,
        sport,
        error: error.message,
        stack: error.stack
      });
      throw error; // Re-throw to see the error in the command response
    }
  }

  /**
   * Find or create a channel for a sport
   * @param {Guild} guild - Discord guild
   * @param {string} sport - Sport key
   * @returns {Promise<TextChannel|null>} - Channel or null
   */
  async findOrCreateSportChannel(guild, sport) {
    try {
      const channelName = this.defaultChannelNames[sport];
      
      // Try to find existing channel
      let channel = guild.channels.cache.find(
        ch => ch.type === ChannelType.GuildText && 
              (ch.name === channelName || ch.name.includes(sport))
      );
      
      if (channel) {
        return channel;
      }

      // Check bot permissions
      const botMember = guild.members.me;
      if (!botMember.permissions.has(['ManageChannels', 'SendMessages', 'EmbedLinks'])) {
        logger.warn('Bot lacks permissions to create/use channels', {
          guildId: guild.id,
          sport
        });
        return null;
      }

      // Create new channel
      channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: `Daily ${this.getSportDisplayName(sport)} game schedules and updates`,
        reason: `Created for ${sport} game logs`
      });

      logger.info('Created new sport channel', {
        guildId: guild.id,
        sport,
        channelId: channel.id,
        channelName
      });

      return channel;
      
    } catch (error) {
      logger.error('Failed to find or create sport channel', {
        guildId: guild.id,
        sport,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Filter games to only today's games
   * @param {Array} games - All games
   * @returns {Array} - Today's games
   */
  filterTodaysGames(games) {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    return games.filter(game => {
      const gameDate = new Date(game.date);
      return gameDate >= todayStart && gameDate < todayEnd;
    });
  }

  /**
   * Post game schedule to channel with individual game messages
   * @param {TextChannel} channel - Discord channel
   * @param {string} sport - Sport key
   * @param {Array} games - Games to post
   * @param {boolean} isFromCache - Whether data is from cache
   */
  async postGameSchedule(channel, sport, games, isFromCache = false) {
    try {
      const sportName = this.getSportDisplayName(sport);
      const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      if (games.length === 0) {
        await this.postNoGamesMessage(channel, sport);
        return;
      }

      // Send header message with global controls
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      
      const headerEmbed = new EmbedBuilder()
        .setTitle(`🏈 ${sportName} Games - ${today}`)
        .setDescription(`Found ${games.length} game${games.length !== 1 ? 's' : ''} scheduled. Use global controls or individual game buttons below.`)
        .setColor(this.sportColors[sport] || 0x0099FF)
        .addFields({
          name: '🎮 Controls',
          value: '**Global:** Add/Remove all threads at once\n**Individual:** Toggle threads for specific games',
          inline: false
        })
        .setTimestamp();

      if (isFromCache) {
        headerEmbed.setFooter({ text: '⚠️ Using cached data - Daily API limit reached' });
      } else {
        headerEmbed.setFooter({ text: 'Data from ESPN API • Buttons update based on current state' });
      }

      // Global action buttons
      const globalActionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`add_all_threads_${sport}`)
            .setLabel('📈 Add All Threads')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📈'),
          new ButtonBuilder()
            .setCustomId(`remove_all_threads_${sport}`)
            .setLabel('🗑️ Remove All Threads')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
        );

      await channel.send({ 
        embeds: [headerEmbed], 
        components: [globalActionRow] 
      });

      // Post each game as individual message
      for (let i = 0; i < games.length; i++) {
        const game = games[i];
        await this.postIndividualGameMessage(channel, sport, game, i + 1);
        
        // Small delay to avoid rate limits
        if (i < games.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      logger.info('Posted individual game messages to channel', {
        channelId: channel.id,
        sport,
        gameCount: games.length,
        isFromCache
      });
      
    } catch (error) {
      logger.error('Failed to post game schedule', {
        channelId: channel.id,
        sport,
        error: error.message
      });
    }
  }

  /**
   * Post individual game message - ultra compact format
   * @param {TextChannel} channel - Discord channel
   * @param {string} sport - Sport key
   * @param {Object} game - Game object
   * @param {number} gameNumber - Game number for display
   */
  async postIndividualGameMessage(channel, sport, game, gameNumber) {
    try {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

      // Format game time (short format)
      const gameTime = new Date(game.date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
      });

      // Create team names (use abbreviations for compactness)
      let homeTeam = 'Home';
      let awayTeam = 'Away';
      
      if (game.teams && game.teams.home && game.teams.away) {
        homeTeam = game.teams.home.abbreviation || 
                   (game.teams.home.name?.substring(0, 6)) || 'Home';
        awayTeam = game.teams.away.abbreviation || 
                   (game.teams.away.name?.substring(0, 6)) || 'Away';
      } else if (game.displayName) {
        // Try to parse team names from displayName
        const parts = game.displayName.split(' at ');
        if (parts.length === 2) {
          awayTeam = parts[0].substring(0, 6);
          homeTeam = parts[1].substring(0, 6);
        } else {
          homeTeam = game.displayName.substring(0, 12);
          awayTeam = '';
        }
      }

      // Create compact content - everything in one message
      let content = `**${awayTeam}** @ **${homeTeam}**\n`;
      content += `*${gameTime}`;
      
      if (game.venue) {
        const venueName = game.venue.length > 20 ? game.venue.substring(0, 20) + '...' : game.venue;
        content += ` • ${venueName}`;
      }
      
      content += '*';

      // Check if betting thread already exists for this game
      let hasThread = false;
      let threadId = null;
      
      if (this.bettingThreadManager) {
        hasThread = this.bettingThreadManager.hasThread(sport, game.id);
        threadId = this.bettingThreadManager.getThreadId(sport, game.id);
      }

      // Add thread info to content if it exists
      if (hasThread && threadId) {
        content += `\n✅ **Thread:** <#${threadId}>`;
      }

      // Create toggle button with appropriate state
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`toggle_betting_${sport}_${game.id}`)
            .setLabel(hasThread ? '🗑️ Delete Thread' : '📈 Create Thread')
            .setStyle(hasThread ? ButtonStyle.Danger : ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`game_options_${sport}_${game.id}`)
            .setLabel('⚙️ Options')
            .setStyle(ButtonStyle.Secondary)
        );

      // Send ultra-compact message - no embed, just content + buttons
      await channel.send({ 
        content: content,
        components: [actionRow] 
      });

    } catch (error) {
      logger.error('Failed to post individual game message', {
        gameId: game.id,
        sport,
        error: error.message
      });
    }
  }

  /**
   * Post "no games" message
   * @param {TextChannel} channel - Discord channel
   * @param {string} sport - Sport key
   */
  async postNoGamesMessage(channel, sport) {
    try {
      const sportName = this.getSportDisplayName(sport);
      const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const embed = new EmbedBuilder()
        .setTitle(`🏈 ${sportName} Games - ${today}`)
        .setDescription('No games scheduled for today.')
        .setColor(this.sportColors[sport] || 0x0099FF)
        .setTimestamp()
        .setFooter({ text: 'Data from ESPN API' });

      await channel.send({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Failed to post no games message', {
        channelId: channel.id,
        sport,
        error: error.message
      });
    }
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

  /**
   * Manually trigger game log update for a guild
   * @param {Guild} guild - Discord guild
   * @param {string} sport - Optional specific sport
   */
  async manualUpdate(guild, sport = null) {
    try {
      if (sport) {
        await this.updateSportGameLog(guild, sport);
        logger.info('Manual game log update completed for sport', {
          guildId: guild.id,
          sport
        });
      } else {
        await this.updateGuildGameLogs(guild);
        logger.info('Manual game log update completed for guild', {
          guildId: guild.id
        });
      }
    } catch (error) {
      logger.error('Manual game log update failed', {
        guildId: guild.id,
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get game log status for a guild
   * @param {Guild} guild - Discord guild
   * @returns {Object} - Status information
   */
  async getGameLogStatus(guild) {
    try {
      const status = {
        guildId: guild.id,
        guildName: guild.name,
        sports: {},
        queryStatus: this.espnClient.getDailyQueryStatus()
      };

      for (const sport of Object.keys(this.defaultChannelNames)) {
        const channelName = this.defaultChannelNames[sport];
        const channel = guild.channels.cache.find(
          ch => ch.type === ChannelType.GuildText && 
                (ch.name === channelName || ch.name.includes(sport))
        );

        status.sports[sport] = {
          hasChannel: !!channel,
          channelId: channel?.id,
          channelName: channel?.name,
          canQuery: this.espnClient.canMakeScheduleQuery(sport)
        };
      }

      return status;
      
    } catch (error) {
      logger.error('Failed to get game log status', {
        guildId: guild.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopScheduledJobs() {
    for (const [name, job] of this.scheduledJobs) {
      job.stop();
      logger.info('Stopped scheduled job', { name });
    }
    this.scheduledJobs.clear();
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopScheduledJobs();
    this.isInitialized = false;
    logger.info('GameLogManager cleanup completed');
  }
}

module.exports = GameLogManager;