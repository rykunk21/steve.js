const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const logger = require('./utils/logger');
const config = require('./config');
const ErrorHandler = require('./utils/errorHandler');
const CommandLoader = require('./utils/commandLoader');

class DiscordBot {
  constructor() {
    // Validate configuration
    config.validate();

    // Setup global error handlers
    ErrorHandler.setupGlobalErrorHandlers();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions
        // GuildMessages and MessageReactions are needed for emoji reactions
        // Enable these in Discord Developer Portal if needed
      ]
    });

    this.commands = new Collection();
    this.commandLoader = new CommandLoader();
    this.isReady = false;

    // Initialize ESPN API client for bulk operations
    const ESPNAPIClient = require('./modules/sports/ESPNAPIClient');
    this.espnClient = new ESPNAPIClient();
    
    // Initialize odds tracker (will be set up after database connection)
    this.oddsTracker = null;
  }

  async initialize() {
    try {
      // Initialize database
      const dbConnection = require('./database/connection');
      await dbConnection.initialize();
      
      // Initialize odds tracker
      await this.initializeOddsTracker(dbConnection.db);

      // Load commands
      await this.loadCommands();

      // Register slash commands
      await this.registerSlashCommands();

      // Set up event handlers
      this.setupEventHandlers();

      // Login to Discord
      await this.client.login(config.discord.token);

      logger.info('Bot initialization completed');
    } catch (error) {
      logger.error('Failed to initialize bot:', error);
      process.exit(1);
    }
  }

  async loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');
    this.commands = await this.commandLoader.loadCommands(commandsPath);
  }

  async registerSlashCommands() {
    const commands = [];

    for (const command of this.commands.values()) {
      commands.push(command.data.toJSON());
    }

    if (commands.length === 0) {
      logger.info('No commands to register');
      return;
    }

    // Validate token and client ID before making API calls
    if (!config.discord.token || config.discord.token === 'your_discord_bot_token_here') {
      throw new Error('Invalid Discord bot token. Please set a valid DISCORD_TOKEN in your .env file.');
    }

    if (!config.discord.clientId || config.discord.clientId === 'your_discord_client_id_here') {
      throw new Error('Invalid Discord client ID. Please set a valid DISCORD_CLIENT_ID in your .env file.');
    }

    const rest = new REST().setToken(config.discord.token);

    try {
      logger.info(`Started refreshing ${commands.length} application (/) commands.`);
      logger.debug(`Using client ID: ${config.discord.clientId}`);

      // Always register global commands for multi-server support
      logger.info('Registering global commands for multi-server support...');
      
      // Clear any existing guild-specific commands to prevent conflicts
      if (process.env.DEV_GUILD_ID && process.env.DEV_GUILD_ID !== 'your_test_server_guild_id_here') {
        try {
          logger.info('Clearing guild-specific commands to prevent conflicts...');
          await rest.put(
            Routes.applicationGuildCommands(config.discord.clientId, process.env.DEV_GUILD_ID),
            { body: [] }
          );
          logger.info('Guild-specific commands cleared.');
        } catch (error) {
          logger.warn('Failed to clear guild-specific commands (this is okay):', error.message);
        }
      }

      // Register global commands
      const data = await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands }
      );

      logger.info(`Successfully registered ${data.length} global slash commands.`);
      logger.info('Commands will be available on all servers within 1 hour (usually much faster).');
      logger.info('Commands registered:', commands.map(cmd => cmd.name).join(', '));
    } catch (error) {
      if (error.status === 401) {
        logger.error('Authentication failed. Please check your Discord bot token and client ID.');
        logger.error('Make sure your bot token is valid and hasn\'t been regenerated.');
        logger.error('Token should start with something like "MTQyODc2MDM3OTQwNzcyODczNA."');
      } else if (error.status === 403) {
        logger.error('Bot lacks permissions. Make sure your bot has the "applications.commands" scope.');
      }
      logger.error('Error registering slash commands:', error);
      throw error;
    }
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      this.isReady = true;
      logger.info(`Bot is ready! Logged in as ${this.client.user.tag}`);
      logger.info(`Bot is in ${this.client.guilds.cache.size} guilds`);

      // Initialize server configurations for all guilds
      await this.initializeGuildConfigs();
      
      // Initialize game log manager for sports functionality
      await this.initializeGameLogManager();
      

    });

    this.client.on('interactionCreate', async (interaction) => {
      await this.handleInteraction(interaction);
    });

    this.client.on('voiceStateUpdate', (oldState, newState) => {
      // Voice state handling will be implemented in task 4
      logger.debug('Voice state update detected', {
        userId: newState.id,
        oldChannel: oldState.channelId,
        newChannel: newState.channelId
      });
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error:', error);
    });

    this.client.on('warn', (warning) => {
      logger.warn('Discord client warning:', warning);
    });

    this.client.on('disconnect', () => {
      logger.warn('Bot disconnected from Discord');
    });

    this.client.on('reconnecting', () => {
      logger.info('Bot reconnecting to Discord');
    });

    this.client.on('guildCreate', async (guild) => {
      logger.info('Bot joined new guild', {
        guildId: guild.id,
        guildName: guild.name
      });

      // Initialize server configuration for new guild
      try {
        const ServerConfigRepository = require('./database/repositories/ServerConfigRepository');
        const ServerConfig = require('./database/models/ServerConfig');
        const configRepo = new ServerConfigRepository();

        const config = new ServerConfig({ guildId: guild.id });
        await configRepo.saveConfig(config);

        logger.info('Initialized server configuration for new guild', {
          guildId: guild.id
        });
      } catch (error) {
        logger.error('Failed to initialize configuration for new guild:', error);
      }
    });

    // Handle message reactions for emoji-based lobby customization and team color management
    this.client.on('messageReactionAdd', async (reaction, user) => {
      try {
        // Skip bot reactions
        if (user.bot) return;

        // Check if this message has an active emoji reaction listener
        const emojiReactionManager = require('./utils/emojiReactionManager');
        if (emojiReactionManager.hasPendingReaction(reaction.message.id)) {
          logger.debug('Message reaction detected on tracked message', {
            messageId: reaction.message.id,
            emoji: reaction.emoji.toString(),
            userId: user.id
          });
        }

        // Check if this is a team color reaction on a betting embed
        await this.handleTeamColorReaction(reaction, user);
      } catch (error) {
        logger.error('Error handling message reaction add:', error);
      }
    });

    this.client.on('messageReactionRemove', async (reaction, user) => {
      try {
        // Skip bot reactions
        if (user.bot) return;

        // Check if this message has an active emoji reaction listener
        const emojiReactionManager = require('./utils/emojiReactionManager');
        if (emojiReactionManager.hasPendingReaction(reaction.message.id)) {
          logger.debug('Message reaction removed on tracked message', {
            messageId: reaction.message.id,
            emoji: reaction.emoji.toString(),
            userId: user.id
          });
        }
      } catch (error) {
        logger.error('Error handling message reaction remove:', error);
      }
    });


  }

  async handleInteraction(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
      }
    } catch (error) {
      await ErrorHandler.handleDiscordError(error, interaction);
    }
  }

  async handleSlashCommand(interaction) {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    // Validate command prerequisites (permissions, cooldowns, etc.)
    if (command.validate && !(await command.validate(interaction))) {
      return;
    }

    // Log command usage
    if (command.logUsage) {
      command.logUsage(interaction, 'started');
    }

    try {
      await command.execute(interaction);

      // Log successful execution
      if (command.logUsage) {
        command.logUsage(interaction, 'completed');
      }
    } catch (error) {
      // Log failed execution
      if (command.logUsage) {
        command.logUsage(interaction, 'failed', { error: error.message });
      }
      throw error; // Re-throw to be handled by the main error handler
    }
  }

  async handleAutocomplete(interaction) {
    const command = this.commands.get(interaction.commandName);

    if (!command || !command.autocomplete) {
      return;
    }

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.error('Error handling autocomplete:', error);
    }
  }

  async handleButtonInteraction(interaction) {
    try {
      const customId = interaction.customId;

      // Handle lobby join requests
      if (customId.startsWith('join_request_')) {
        const lobbyCatalogManager = require('./utils/lobbyCatalogManager');
        const LobbyManager = require('./modules/gaming/LobbyManager');
        const lobbyManager = new LobbyManager();
        lobbyManager.setClient(this.client);
        
        await lobbyCatalogManager.handleJoinRequest(interaction, lobbyManager);
        return;
      }

      // Handle join request responses (approve/decline)
      if (customId.startsWith('approve_') || customId.startsWith('decline_')) {
        const lobbyCatalogManager = require('./utils/lobbyCatalogManager');
        const LobbyManager = require('./modules/gaming/LobbyManager');
        const VoiceChannelManager = require('./modules/gaming/VoiceChannelManager');
        
        const lobbyManager = new LobbyManager();
        const voiceChannelManager = new VoiceChannelManager(this.client);
        lobbyManager.setClient(this.client);
        lobbyManager.setVoiceChannelManager(voiceChannelManager);
        
        await lobbyCatalogManager.handleJoinResponse(interaction, lobbyManager, voiceChannelManager);
        return;
      }

      // Handle betting thread toggle (create/delete)
      if (customId.startsWith('toggle_betting_')) {
        await this.handleToggleBetting(interaction);
        return;
      }

      // Handle game options modal
      if (customId.startsWith('game_options_')) {
        await this.handleGameOptions(interaction);
        return;
      }

      // Handle add all threads
      if (customId.startsWith('add_all_threads_')) {
        await this.handleAddAllThreads(interaction);
        return;
      }

      // Handle remove all threads
      if (customId.startsWith('remove_all_threads_')) {
        await this.handleRemoveAllThreads(interaction);
        return;
      }

      // If no handler found, log and respond
      logger.warn('Unhandled button interaction:', { customId });
      await interaction.reply({
        content: '❌ This button is no longer active or not recognized.',
        ephemeral: true
      });

    } catch (error) {
      logger.error('Error handling button interaction:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * Handle toggle betting thread button (create or delete)
   * @param {ButtonInteraction} interaction - Discord button interaction
   */
  async handleToggleBetting(interaction) {
    try {
      // Parse custom ID: toggle_betting_{sport}_{gameId}
      // Handle sports with underscores (like ncaa_football)
      const customId = interaction.customId;
      const prefix = 'toggle_betting_';
      const afterPrefix = customId.substring(prefix.length);
      
      // Find the last underscore to separate sport from gameId
      const lastUnderscoreIndex = afterPrefix.lastIndexOf('_');
      const sport = afterPrefix.substring(0, lastUnderscoreIndex);
      const gameId = afterPrefix.substring(lastUnderscoreIndex + 1);

      // Check if user has permissions
      if (!interaction.member.permissions.has('ManageChannels')) {
        // Just defer the interaction and log - no visible message
        await interaction.deferUpdate();
        logger.warn('User lacks permissions for betting thread management', {
          userId: interaction.user.id,
          userName: interaction.user.username,
          guildId: interaction.guild.id
        });
        return;
      }

      // Betting thread manager should be initialized at startup
      if (!this.bettingThreadManager) {
        logger.error('BettingThreadManager not initialized in toggle handler');
        await interaction.reply({
          content: '❌ Betting system not initialized. Please restart the bot.',
          ephemeral: true
        });
        return;
      }

      // Check if thread already exists
      const hasThread = this.bettingThreadManager.hasThread(sport, gameId);
      
      logger.info('Toggle betting button clicked', {
        sport,
        gameId,
        hasThread,
        userId: interaction.user.id,
        userName: interaction.user.username
      });
      
      logger.debug('Toggle betting thread state check', {
        sport,
        gameId,
        hasThread,
        trackedThreads: this.bettingThreadManager.createdThreads.size
      });
      
      // Immediate visual feedback - update button to show processing state
      await interaction.deferUpdate();

      if (hasThread) {
        // Delete existing thread
        const success = await this.bettingThreadManager.deleteBettingThread(
          interaction.guild,
          sport,
          gameId
        );

        if (success) {
          // Update button to "Create Thread"
          logger.info('Updating button after thread deletion', { sport, gameId });
          await this.updateGameButton(interaction, sport, gameId, false);
        } else {
          logger.error('Failed to delete betting thread', { sport, gameId });
          // Still update the button in case of tracking issues
          await this.updateGameButton(interaction, sport, gameId, false);
        }
      } else {
        // Create new thread
        const thread = await this.bettingThreadManager.createBettingThread(
          interaction.guild,
          sport,
          gameId
        );

        if (thread) {
          // Update button to "Delete Thread"
          logger.info('Updating button after thread creation', { sport, gameId, threadId: thread.id });
          await this.updateGameButton(interaction, sport, gameId, true, thread.id);
        } else {
          logger.error('Failed to create betting thread', { sport, gameId });
          // Keep button in original state if creation failed
        }
      }

    } catch (error) {
      logger.error('Failed to handle toggle betting:', error);
      
      // If we haven't deferred yet, try to defer the interaction
      if (!interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferUpdate();
        } catch (deferError) {
          logger.error('Failed to defer interaction:', deferError);
        }
      }
    }
  }

  /**
   * Update game button based on thread state
   * @param {ButtonInteraction} interaction - Discord button interaction
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @param {boolean} hasThread - Whether thread exists
   * @param {string} threadId - Thread ID (if exists)
   */
  async updateGameButton(interaction, sport, gameId, hasThread, threadId = null) {
    try {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

      // Get the original message content
      let originalContent = interaction.message.content;
      
      // Remove any existing thread info from content
      const lines = originalContent.split('\n');
      const gameInfoLines = lines.filter(line => !line.includes('✅ **Thread:**'));
      let updatedContent = gameInfoLines.join('\n');

      // Add thread info if thread exists
      if (hasThread && threadId) {
        updatedContent += `\n✅ **Thread:** <#${threadId}>`;
      }

      // Create updated button with proper state
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`toggle_betting_${sport}_${gameId}`)
            .setLabel(hasThread ? '🗑️ Delete Thread' : '📈 Create Thread')
            .setStyle(hasThread ? ButtonStyle.Danger : ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`game_options_${sport}_${gameId}`)
            .setLabel('⚙️ Options')
            .setStyle(ButtonStyle.Secondary)
        );

      // Update the message with new content and buttons
      await interaction.message.edit({
        content: updatedContent,
        components: [actionRow]
      });

      logger.debug('Updated game button successfully', {
        sport,
        gameId,
        hasThread,
        buttonLabel: hasThread ? 'Delete Thread' : 'Create Thread',
        threadId
      });

    } catch (error) {
      logger.error('Failed to update game button:', error);
    }
  }

  /**
   * Handle add all threads button
   * @param {ButtonInteraction} interaction - Discord button interaction
   */
  async handleAddAllThreads(interaction) {
    try {
      // Parse custom ID: add_all_threads_{sport}
      const customId = interaction.customId;
      const prefix = 'add_all_threads_';
      const sport = customId.substring(prefix.length);

      // Check permissions
      if (!interaction.member.permissions.has('ManageChannels')) {
        await interaction.reply({
          content: '❌ You need "Manage Channels" permission to create betting threads.',
          ephemeral: true
        });
        return;
      }

      // Immediate feedback - show processing message
      await interaction.reply({
        content: `🔄 Creating betting threads for all ${sport.toUpperCase()} games... This may take a moment.`,
        ephemeral: true
      });
      
      logger.info('Add all threads requested', {
        sport,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });

      if (!this.bettingThreadManager) {
        logger.error('BettingThreadManager not initialized in add all handler');
        await interaction.editReply({
          content: '❌ Betting system not initialized. Please restart the bot.'
        });
        return;
      }

      // OPTIMIZATION 1: Use cached data first, fallback to API if needed
      let games;
      const cachedGames = await this.espnClient.getCachedSchedule(sport);
      if (cachedGames && cachedGames.length > 0) {
        games = cachedGames;
        logger.info('Using cached games data', { sport, gameCount: games.length });
      } else {
        logger.info('No cached data, fetching from API', { sport });
        games = await this.espnClient.getUpcomingGames(sport);
      }

      const todaysGames = this.filterTodaysGames(games);
      
      logger.info('Processing add all threads', {
        sport,
        totalGames: todaysGames.length
      });

      // OPTIMIZATION 2: Filter games that need threads first
      const gamesToProcess = todaysGames.filter(game => 
        !this.bettingThreadManager.hasThread(sport, game.id)
      );

      if (gamesToProcess.length === 0) {
        await interaction.editReply({
          content: `✅ All ${sport.toUpperCase()} games already have betting threads!`
        });
        return;
      }

      // OPTIMIZATION 3: Create threads in parallel with concurrency limit
      const concurrencyLimit = 3; // Process 3 threads at a time
      const gameIds = [];
      let createdCount = 0;

      for (let i = 0; i < gamesToProcess.length; i += concurrencyLimit) {
        const batch = gamesToProcess.slice(i, i + concurrencyLimit);
        
        const promises = batch.map(async (game) => {
          try {
            // Skip recommendation generation for bulk operations to improve performance
            const thread = await this.bettingThreadManager.createBettingThread(
              interaction.guild,
              sport,
              game.id,
              { skipRecommendation: true }
            );
            if (thread) {
              gameIds.push(game.id);
              return true;
            }
            return false;
          } catch (error) {
            logger.error('Failed to create thread for game', { 
              sport, 
              gameId: game.id, 
              error: error.message 
            });
            return false;
          }
        });

        const results = await Promise.all(promises);
        createdCount += results.filter(Boolean).length;

        // Update progress
        const progress = Math.min(i + concurrencyLimit, gamesToProcess.length);
        await interaction.editReply({
          content: `🔄 Creating betting threads... ${progress}/${gamesToProcess.length} processed (${createdCount} created)`
        });
      }

      logger.info('Add all threads completed', {
        sport,
        createdCount,
        totalGames: todaysGames.length
      });

      // OPTIMIZATION 4: Update buttons in parallel batches
      await this.updateAllGameButtonsInChannelOptimized(interaction.channel, sport, gameIds);

      // Final success message
      await interaction.editReply({
        content: `✅ Created ${createdCount} betting threads for ${sport.toUpperCase()} games! Button states updated.`
      });

    } catch (error) {
      logger.error('Failed to handle add all threads:', error);
      try {
        await interaction.editReply({
          content: '❌ Failed to create betting threads. Please try again.'
        });
      } catch (editError) {
        logger.error('Failed to edit reply:', editError);
      }
    }
  }

  /**
   * Handle remove all threads button
   * @param {ButtonInteraction} interaction - Discord button interaction
   */
  async handleRemoveAllThreads(interaction) {
    try {
      // Parse custom ID: remove_all_threads_{sport}
      const customId = interaction.customId;
      const prefix = 'remove_all_threads_';
      const sport = customId.substring(prefix.length);

      // Check permissions
      if (!interaction.member.permissions.has('ManageChannels')) {
        await interaction.reply({
          content: '❌ You need "Manage Channels" permission to delete betting threads.',
          ephemeral: true
        });
        return;
      }

      // Immediate feedback - show processing message
      await interaction.reply({
        content: `🔄 Deleting betting threads for all ${sport.toUpperCase()} games... This may take a moment.`,
        ephemeral: true
      });
      
      logger.info('Remove all threads requested', {
        sport,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });

      if (!this.bettingThreadManager) {
        logger.error('BettingThreadManager not initialized in remove all handler');
        await interaction.editReply({
          content: '❌ Betting system not initialized. Please restart the bot.'
        });
        return;
      }

      // OPTIMIZATION 1: Use cached data first, fallback to API if needed
      let games;
      const cachedGames = await this.espnClient.getCachedSchedule(sport);
      if (cachedGames && cachedGames.length > 0) {
        games = cachedGames;
        logger.info('Using cached games data', { sport, gameCount: games.length });
      } else {
        logger.info('No cached data, fetching from API', { sport });
        games = await this.espnClient.getUpcomingGames(sport);
      }

      const todaysGames = this.filterTodaysGames(games);
      
      logger.info('Processing remove all threads', {
        sport,
        totalGames: todaysGames.length
      });

      // OPTIMIZATION 2: Filter games that have threads first
      const gamesToProcess = todaysGames.filter(game => 
        this.bettingThreadManager.hasThread(sport, game.id)
      );

      if (gamesToProcess.length === 0) {
        await interaction.editReply({
          content: `✅ No betting threads found for ${sport.toUpperCase()} games!`
        });
        return;
      }

      // OPTIMIZATION 3: Delete threads in parallel with concurrency limit
      const concurrencyLimit = 3; // Process 3 threads at a time
      const gameIds = [];
      let deletedCount = 0;

      for (let i = 0; i < gamesToProcess.length; i += concurrencyLimit) {
        const batch = gamesToProcess.slice(i, i + concurrencyLimit);
        
        const promises = batch.map(async (game) => {
          try {
            const success = await this.bettingThreadManager.deleteBettingThread(
              interaction.guild,
              sport,
              game.id
            );
            if (success) {
              gameIds.push(game.id);
              return true;
            }
            return false;
          } catch (error) {
            logger.error('Failed to delete thread for game', { 
              sport, 
              gameId: game.id, 
              error: error.message 
            });
            return false;
          }
        });

        const results = await Promise.all(promises);
        deletedCount += results.filter(Boolean).length;

        // Update progress
        const progress = Math.min(i + concurrencyLimit, gamesToProcess.length);
        await interaction.editReply({
          content: `🔄 Deleting betting threads... ${progress}/${gamesToProcess.length} processed (${deletedCount} deleted)`
        });
      }

      logger.info('Remove all threads completed', {
        sport,
        deletedCount,
        totalGames: todaysGames.length
      });

      // OPTIMIZATION 4: Update buttons in parallel batches
      await this.updateAllGameButtonsInChannelOptimized(interaction.channel, sport, gameIds);

      // Final success message
      await interaction.editReply({
        content: `✅ Deleted ${deletedCount} betting threads for ${sport.toUpperCase()} games! Button states updated.`
      });

    } catch (error) {
      logger.error('Failed to handle remove all threads:', error);
      try {
        await interaction.editReply({
          content: '❌ Failed to delete betting threads. Please try again.'
        });
      } catch (editError) {
        logger.error('Failed to edit reply:', editError);
      }
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
   * Update all game buttons in a channel to reflect current thread states (OPTIMIZED)
   * @param {TextChannel} channel - Discord channel
   * @param {string} sport - Sport key
   * @param {Array} affectedGameIds - Game IDs that were affected by bulk operation
   */
  async updateAllGameButtonsInChannelOptimized(channel, sport, affectedGameIds) {
    try {
      // Fetch recent messages in the channel
      const messages = await channel.messages.fetch({ limit: 50 });
      
      // Find messages that need updating
      const messagesToUpdate = [];
      
      for (const [messageId, message] of messages) {
        // Skip messages that don't have components or aren't from the bot
        if (!message.components || message.components.length === 0 || !message.author.bot) {
          continue;
        }

        // Check if this message has toggle buttons for the affected sport
        const toggleButton = message.components
          .flatMap(row => row.components)
          .find(component => component.customId && component.customId.startsWith(`toggle_betting_${sport}_`));

        if (!toggleButton) {
          continue;
        }

        const gameId = toggleButton.customId.split('_')[3];
        
        // Only update if this game was affected by the bulk operation
        if (affectedGameIds.includes(gameId)) {
          messagesToUpdate.push({ message, gameId });
        }
      }

      // Update messages in parallel batches
      const batchSize = 5;
      for (let i = 0; i < messagesToUpdate.length; i += batchSize) {
        const batch = messagesToUpdate.slice(i, i + batchSize);
        
        const updatePromises = batch.map(async ({ message, gameId }) => {
          try {
            const hasThread = this.bettingThreadManager.hasThread(sport, gameId);
            const threadId = hasThread ? this.bettingThreadManager.getThreadId(sport, gameId) : null;
            await this.updateGameButtonMessage(message, sport, gameId, hasThread, threadId);
          } catch (error) {
            logger.error('Failed to update game button message in batch', {
              messageId: message.id,
              gameId,
              error: error.message
            });
          }
        });

        await Promise.all(updatePromises);
      }

      logger.info('Updated all game buttons in channel (optimized)', {
        channelId: channel.id,
        sport,
        affectedGames: affectedGameIds.length,
        messagesUpdated: messagesToUpdate.length
      });

    } catch (error) {
      logger.error('Failed to update all game buttons in channel (optimized)', {
        channelId: channel.id,
        sport,
        error: error.message
      });
    }
  }

  /**
   * Update all game buttons in a channel to reflect current thread states (LEGACY)
   * @param {TextChannel} channel - Discord channel
   * @param {string} sport - Sport key
   * @param {Array} affectedGameIds - Game IDs that were affected by bulk operation
   */
  async updateAllGameButtonsInChannel(channel, sport, affectedGameIds) {
    try {
      // Fetch recent messages in the channel
      const messages = await channel.messages.fetch({ limit: 50 });
      
      for (const [messageId, message] of messages) {
        // Skip messages that don't have components or aren't from the bot
        if (!message.components || message.components.length === 0 || !message.author.bot) {
          continue;
        }

        // Check if this message has toggle buttons for the affected sport
        const hasToggleButton = message.components.some(row => 
          row.components.some(component => 
            component.customId && component.customId.startsWith(`toggle_betting_${sport}_`)
          )
        );

        if (!hasToggleButton) {
          continue;
        }

        // Extract game ID from the toggle button
        const toggleButton = message.components
          .flatMap(row => row.components)
          .find(component => component.customId && component.customId.startsWith(`toggle_betting_${sport}_`));

        if (!toggleButton) {
          continue;
        }

        const gameId = toggleButton.customId.split('_')[3];
        
        // Only update if this game was affected by the bulk operation
        if (!affectedGameIds.includes(gameId)) {
          continue;
        }

        // Check current thread state
        const hasThread = this.bettingThreadManager.hasThread(sport, gameId);
        const threadId = hasThread ? this.bettingThreadManager.getThreadId(sport, gameId) : null;

        // Update the message with new button state
        await this.updateGameButtonMessage(message, sport, gameId, hasThread, threadId);
      }

      logger.info('Updated all game buttons in channel', {
        channelId: channel.id,
        sport,
        affectedGames: affectedGameIds.length
      });

    } catch (error) {
      logger.error('Failed to update all game buttons in channel', {
        channelId: channel.id,
        sport,
        error: error.message
      });
    }
  }

  /**
   * Update a specific game button message
   * @param {Message} message - Discord message
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @param {boolean} hasThread - Whether thread exists
   * @param {string} threadId - Thread ID (if exists)
   */
  async updateGameButtonMessage(message, sport, gameId, hasThread, threadId = null) {
    try {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

      // Get the original message content
      let originalContent = message.content;
      
      // Remove any existing thread info from content
      const lines = originalContent.split('\n');
      const gameInfoLines = lines.filter(line => !line.includes('✅ **Thread:**'));
      let updatedContent = gameInfoLines.join('\n');

      // Add thread info if thread exists
      if (hasThread && threadId) {
        updatedContent += `\n✅ **Thread:** <#${threadId}>`;
      }

      // Create updated button with proper state
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`toggle_betting_${sport}_${gameId}`)
            .setLabel(hasThread ? '🗑️ Delete Thread' : '📈 Create Thread')
            .setStyle(hasThread ? ButtonStyle.Danger : ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`game_options_${sport}_${gameId}`)
            .setLabel('⚙️ Options')
            .setStyle(ButtonStyle.Secondary)
        );

      // Update the message with new content and buttons
      await message.edit({
        content: updatedContent,
        components: [actionRow]
      });

      logger.debug('Updated game button message', {
        messageId: message.id,
        sport,
        gameId,
        hasThread
      });

    } catch (error) {
      logger.error('Failed to update game button message', {
        messageId: message.id,
        sport,
        gameId,
        error: error.message
      });
    }
  }

  /**
   * Initialize odds tracker
   * @param {Database} database - Database connection
   */
  async initializeOddsTracker(database) {
    try {
      const OddsTracker = require('./modules/sports/OddsTracker');
      this.oddsTracker = new OddsTracker(database);
      await this.oddsTracker.initialize();
      
      logger.info('Odds tracker initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize odds tracker:', error);
      // Don't throw error - odds tracking is optional functionality
    }
  }

  /**
   * Handle game options button - show modal with options
   * @param {ButtonInteraction} interaction - Discord button interaction
   */
  async handleGameOptions(interaction) {
    try {
      // Parse custom ID: game_options_{sport}_{gameId}
      // Handle sports with underscores (like ncaa_football)
      const customId = interaction.customId;
      const prefix = 'game_options_';
      const afterPrefix = customId.substring(prefix.length);
      
      // Find the last underscore to separate sport from gameId
      const lastUnderscoreIndex = afterPrefix.lastIndexOf('_');
      const sport = afterPrefix.substring(0, lastUnderscoreIndex);
      const gameId = afterPrefix.substring(lastUnderscoreIndex + 1);

      // Check permissions
      if (!interaction.member.permissions.has('ManageChannels')) {
        await interaction.reply({
          content: '❌ You need "Manage Channels" permission to manage games.',
          ephemeral: true
        });
        return;
      }

      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

      // Get game info from the embed
      const embed = interaction.message.embeds[0];
      const gameTitle = embed.description?.replace(/\*\*/g, '') || 'Game';

      // Initialize betting thread manager to check thread status
      if (!this.bettingThreadManager) {
        const BettingThreadManager = require('./modules/sports/BettingThreadManager');
        this.bettingThreadManager = new BettingThreadManager(this.client);
      }

      const hasThread = this.bettingThreadManager.hasThread(sport, gameId);
      const threadId = this.bettingThreadManager.getThreadId(sport, gameId);

      // Create modal
      const modal = new ModalBuilder()
        .setCustomId(`game_options_modal_${sport}_${gameId}`)
        .setTitle(`Game Options: ${gameTitle.substring(0, 40)}`);

      // Current status field
      const statusInput = new TextInputBuilder()
        .setCustomId('current_status')
        .setLabel('Current Status')
        .setStyle(TextInputStyle.Short)
        .setValue(hasThread ? `Thread exists: ${threadId}` : 'No betting thread')
        .setRequired(false);

      // Action selection field
      const actionInput = new TextInputBuilder()
        .setCustomId('action_selection')
        .setLabel('Action (type: toggle, remove, or cancel)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('toggle = create/delete thread, remove = remove game, cancel = do nothing')
        .setRequired(true);

      // Reason field (optional)
      const reasonInput = new TextInputBuilder()
        .setCustomId('action_reason')
        .setLabel('Reason (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Optional reason for this action...')
        .setRequired(false)
        .setMaxLength(500);

      // Add inputs to action rows
      const statusRow = new ActionRowBuilder().addComponents(statusInput);
      const actionRow = new ActionRowBuilder().addComponents(actionInput);
      const reasonRow = new ActionRowBuilder().addComponents(reasonInput);

      modal.addComponents(statusRow, actionRow, reasonRow);

      // Show the modal
      await interaction.showModal(modal);

    } catch (error) {
      logger.error('Failed to handle game options:', error);
      
      try {
        await interaction.reply({
          content: '❌ An error occurred while opening game options.',
          ephemeral: true
        });
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
    }
  }

  /**
   * Handle modal submissions
   * @param {ModalSubmitInteraction} interaction - Discord modal interaction
   */
  async handleModalSubmit(interaction) {
    try {
      const customId = interaction.customId;

      // Handle game options modal
      if (customId.startsWith('game_options_modal_')) {
        await this.handleGameOptionsModal(interaction);
        return;
      }

      // If no handler found, log and respond
      logger.warn('Unhandled modal submission:', { customId });
      await interaction.reply({
        content: '❌ This modal is no longer active or not recognized.',
        ephemeral: true
      });

    } catch (error) {
      logger.error('Error handling modal submission:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * Handle game options modal submission
   * @param {ModalSubmitInteraction} interaction - Discord modal interaction
   */
  async handleGameOptionsModal(interaction) {
    try {
      // Parse custom ID: game_options_modal_{sport}_{gameId}
      // Handle sports with underscores (like ncaa_football)
      const customId = interaction.customId;
      const prefix = 'game_options_modal_';
      const afterPrefix = customId.substring(prefix.length);
      
      // Find the last underscore to separate sport from gameId
      const lastUnderscoreIndex = afterPrefix.lastIndexOf('_');
      const sport = afterPrefix.substring(0, lastUnderscoreIndex);
      const gameId = afterPrefix.substring(lastUnderscoreIndex + 1);

      // Get form values
      const action = interaction.fields.getTextInputValue('action_selection').toLowerCase().trim();
      const reason = interaction.fields.getTextInputValue('action_reason') || 'No reason provided';

      await interaction.reply({
        content: `🔄 Processing action: ${action}...`,
        ephemeral: true
      });

      // Initialize betting thread manager if needed
      if (!this.bettingThreadManager) {
        const BettingThreadManager = require('./modules/sports/BettingThreadManager');
        this.bettingThreadManager = new BettingThreadManager(this.client);
      }

      switch (action) {
        case 'toggle':
          // Same logic as toggle betting button
          const hasThread = this.bettingThreadManager.hasThread(sport, gameId);
          
          if (hasThread) {
            const success = await this.bettingThreadManager.deleteBettingThread(
              interaction.guild,
              sport,
              gameId
            );
            
            if (success) {
              // Find and update the original message
              await this.updateGameButtonFromModal(interaction, sport, gameId, false);
              await interaction.editReply({
                content: `✅ Betting thread deleted successfully.\nReason: ${reason}`
              });
            } else {
              await interaction.editReply({
                content: '❌ Failed to delete betting thread.'
              });
            }
          } else {
            const thread = await this.bettingThreadManager.createBettingThread(
              interaction.guild,
              sport,
              gameId
            );
            
            if (thread) {
              await this.updateGameButtonFromModal(interaction, sport, gameId, true, thread.id);
              await interaction.editReply({
                content: `✅ Betting thread created: <#${thread.id}>\nReason: ${reason}`
              });
            } else {
              await interaction.editReply({
                content: '❌ Failed to create betting thread.'
              });
            }
          }
          break;

        case 'remove':
          // Remove the game message entirely
          try {
            // Delete any existing thread first
            if (this.bettingThreadManager.hasThread(sport, gameId)) {
              await this.bettingThreadManager.deleteBettingThread(interaction.guild, sport, gameId);
            }
            
            // Find the original message and delete it
            // We'll need to find it in the channel - for now just acknowledge
            await interaction.editReply({
              content: `✅ Game removal requested.\nReason: ${reason}\n\n*Note: Manual message deletion required for now*`
            });
          } catch (error) {
            await interaction.editReply({
              content: '❌ Failed to remove game.'
            });
          }
          break;

        case 'cancel':
          await interaction.editReply({
            content: '✅ Action cancelled. No changes made.'
          });
          break;

        default:
          await interaction.editReply({
            content: `❌ Unknown action: "${action}". Valid actions are: toggle, remove, cancel`
          });
          break;
      }

    } catch (error) {
      logger.error('Failed to handle game options modal:', error);
      
      try {
        await interaction.editReply({
          content: '❌ An error occurred while processing your request.'
        });
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
    }
  }

  /**
   * Update game button from modal (need to find the original message)
   * @param {ModalSubmitInteraction} interaction - Modal interaction
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @param {boolean} hasThread - Whether thread exists
   * @param {string} threadId - Thread ID (if exists)
   */
  async updateGameButtonFromModal(interaction, sport, gameId, hasThread, threadId = null) {
    try {
      // For now, we'll just log this - finding the original message requires more complex logic
      logger.info('Game button update requested from modal', {
        sport,
        gameId,
        hasThread,
        threadId,
        guildId: interaction.guild.id
      });
      
      // TODO: Implement finding and updating the original game message
      // This would require storing message IDs or searching through recent messages
      
    } catch (error) {
      logger.error('Failed to update game button from modal:', error);
    }
  }

  /**
   * Handle remove game button
   * @param {ButtonInteraction} interaction - Discord button interaction
   */
  async handleRemoveGame(interaction) {
    try {
      // Parse custom ID: remove_game_{sport}_{gameId}
      const parts = interaction.customId.split('_');
      const sport = parts[2];
      const gameId = parts[3];

      // Check if user has permissions
      if (!interaction.member.permissions.has('ManageChannels')) {
        await interaction.reply({
          content: '❌ You need "Manage Channels" permission to remove games.',
          ephemeral: true
        });
        return;
      }

      // Update the message to show game was removed
      const { EmbedBuilder } = require('discord.js');
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xFF0000)
        .setTitle('🗑️ Game Removed')
        .setDescription('This game has been removed from the betting schedule.');

      await interaction.update({ 
        embeds: [embed], 
        components: [] // Remove buttons
      });

      logger.info('Game removed from betting schedule', {
        sport,
        gameId,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });

    } catch (error) {
      logger.error('Failed to handle remove game:', error);
      
      try {
        await interaction.reply({
          content: '❌ An error occurred while removing the game.',
          ephemeral: true
        });
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
    }
  }

  /**
   * Initialize server configurations for all guilds the bot is in
   */
  async initializeGuildConfigs() {
    try {
      const ServerConfigRepository = require('./database/repositories/ServerConfigRepository');
      const ServerConfig = require('./database/models/ServerConfig');
      const configRepo = new ServerConfigRepository();

      for (const [guildId, guild] of this.client.guilds.cache) {
        const existingConfig = await configRepo.getByGuildId(guildId);
        if (!existingConfig) {
          const config = new ServerConfig({ guildId });
          await configRepo.saveConfig(config);
          logger.info('Initialized server configuration', {
            guildId,
            guildName: guild.name
          });
        }
      }
    } catch (error) {
      logger.error('Failed to initialize guild configurations:', error);
    }
  }

  /**
   * Initialize game log manager for sports functionality
   */
  async initializeGameLogManager() {
    try {
      // Initialize betting thread manager first
      const BettingThreadManager = require('./modules/sports/BettingThreadManager');
      this.bettingThreadManager = new BettingThreadManager(this.client);
      
      // Initialize game log manager with betting thread manager reference
      const GameLogManager = require('./modules/sports/GameLogManager');
      this.gameLogManager = new GameLogManager(this.client, this.bettingThreadManager);
      await this.gameLogManager.initialize();
      
      logger.info('Game log manager and betting thread manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize sports managers:', error);
    }
  }



  /**
   * Handle team color reactions on betting embeds
   * @param {MessageReaction} reaction - Discord reaction
   * @param {User} user - User who reacted
   */
  async handleTeamColorReaction(reaction, user) {
    try {
      // Check if user is admin
      const member = await reaction.message.guild.members.fetch(user.id);
      if (!member.permissions.has('ManageChannels')) {
        return; // Only admins can change team colors
      }

      // Check if this is a color square emoji
      const colorEmojis = {
        '🟥': 'red',
        '🟧': 'orange',
        '🟨': 'yellow',
        '🟩': 'green',
        '🟦': 'blue',
        '🟪': 'purple',
        '🟫': 'brown',
        '⬜': 'white',
        '⬛': 'black'
      };

      const emojiName = reaction.emoji.name;
      const colorName = colorEmojis[emojiName];

      if (!colorName) {
        return; // Not a color square emoji
      }

      // Check if this message is a team betting embed
      const message = reaction.message;
      if (!message.embeds || message.embeds.length === 0) {
        return; // No embeds
      }

      const embed = message.embeds[0];
      
      // Check author field (new format) or title (old format)
      const authorName = embed.author?.name;
      const title = embed.title;
      const teamText = authorName || title;
      
      if (!teamText) {
        return; // No team identifier found
      }

      // Check if text matches team embed pattern (e.g., "ARIZ (Favorite)" or "FLA (Underdog)")
      const teamMatch = teamText.match(/^([A-Z]+)\s+\((Favorite|Underdog)\)$/);
      if (!teamMatch) {
        return; // Not a team betting embed
      }

      const teamAbbrev = teamMatch[1];
      const teamRole = teamMatch[2];

      logger.info('Team color reaction detected', {
        teamAbbrev,
        teamRole,
        colorName,
        userId: user.id,
        guildId: message.guild.id
      });

      // Store team color override in database
      await this.storeTeamColorOverride(message.guild.id, teamAbbrev, colorName);

      // Clear color mapper cache for this guild
      const TeamColorMapper = require('./modules/sports/TeamColorMapper');
      const colorMapper = new TeamColorMapper();
      colorMapper.clearConfigCache(message.guild.id);

      // Find the spread bar message (should be first message in thread)
      const thread = message.channel;
      if (!thread.isThread()) {
        logger.warn('Team color reaction not in a thread', { channelId: message.channel.id });
        return;
      }

      // Fetch the first message (spread bar)
      const messages = await thread.messages.fetch({ limit: 10 });
      const spreadBarMessage = messages.last(); // First message in thread

      if (!spreadBarMessage || !spreadBarMessage.content) {
        logger.warn('Could not find spread bar message', { threadId: thread.id });
        return;
      }

      // Regenerate spread bar with new color
      await this.regenerateSpreadBar(spreadBarMessage, message.guild.id);

      // Remove the reaction
      await reaction.users.remove(user.id);

      // Send ephemeral confirmation (send to thread)
      await thread.send({
        content: `✅ <@${user.id}> Updated ${teamAbbrev} color to ${colorName}`,
        allowedMentions: { users: [] }
      }).then(msg => {
        // Delete confirmation after 5 seconds
        setTimeout(() => msg.delete().catch(() => {}), 5000);
      });

      logger.info('Team color updated successfully', {
        teamAbbrev,
        colorName,
        guildId: message.guild.id
      });

    } catch (error) {
      logger.error('Failed to handle team color reaction:', error);
    }
  }

  /**
   * Store team color override in database
   * @param {string} guildId - Guild ID
   * @param {string} teamAbbrev - Team abbreviation
   * @param {string} colorName - Color name
   */
  async storeTeamColorOverride(guildId, teamAbbrev, colorName) {
    try {
      const ServerConfigRepository = require('./database/repositories/ServerConfigRepository');
      const configRepo = new ServerConfigRepository();

      // Use the repository method to set the override
      await configRepo.setTeamColorOverride(guildId, teamAbbrev, colorName);

      logger.debug('Stored team color override', {
        guildId,
        teamAbbrev,
        colorName
      });
    } catch (error) {
      logger.error('Failed to store team color override:', error);
      throw error;
    }
  }

  /**
   * Regenerate spread bar with updated team colors
   * @param {Message} spreadBarMessage - The spread bar message to update
   * @param {string} guildId - Guild ID
   */
  async regenerateSpreadBar(spreadBarMessage, guildId) {
    try {
      // Parse the thread to get game info
      const thread = spreadBarMessage.channel;
      const threadName = thread.name;

      // Parse thread name: "AWAY @ HOME | FAVORITE -SPREAD"
      const nameMatch = threadName.match(/([A-Z]+)\s+@\s+([A-Z]+)/);
      if (!nameMatch) {
        logger.warn('Could not parse thread name for spread bar regeneration', { threadName });
        return;
      }

      const awayAbbrev = nameMatch[1];
      const homeAbbrev = nameMatch[2];

      // Get team embeds to extract betting data
      const messages = await thread.messages.fetch({ limit: 5 });
      const embedMessages = Array.from(messages.values()).filter(m => m.embeds.length > 0);

      if (embedMessages.length < 2) {
        logger.warn('Could not find team embeds for spread bar regeneration', { threadId: thread.id });
        return;
      }

      // Extract spread from one of the embeds
      const embed = embedMessages[0].embeds[0];
      const spreadField = embed.fields.find(f => f.name === 'Spread');
      if (!spreadField) {
        logger.warn('Could not find spread field in embed', { threadId: thread.id });
        return;
      }

      // Parse spread value (e.g., "-3.5 (-110)" or "+3.5 (-110)")
      const spreadMatch = spreadField.value.match(/([+\-]\d+\.?\d*)/);
      if (!spreadMatch) {
        logger.warn('Could not parse spread value', { spreadValue: spreadField.value });
        return;
      }

      const spread = parseFloat(spreadMatch[1]);

      // Determine which team is home/away based on embed titles
      const favoriteEmbed = embedMessages.find(m => m.embeds[0].title.includes('(Favorite)'));
      const isFavoriteHome = favoriteEmbed && favoriteEmbed.embeds[0].title.startsWith(homeAbbrev);

      // Calculate actual home spread
      const homeSpread = isFavoriteHome ? spread : -spread;

      // Get updated team colors (use async version to get fresh data from database)
      const TeamColorMapper = require('./modules/sports/TeamColorMapper');
      const colorMapper = new TeamColorMapper();
      
      const awayTeam = { abbreviation: awayAbbrev };
      const homeTeam = { abbreviation: homeAbbrev };
      
      const colors = await colorMapper.getTeamColorsAsync(awayTeam, homeTeam, guildId);

      // Generate new spread bar
      const SpreadBarGenerator = require('./modules/sports/SpreadBarGenerator');
      const barGenerator = new SpreadBarGenerator();
      
      const barData = barGenerator.generateSpreadBar(
        awayTeam,
        homeTeam,
        homeSpread,
        colors.awayColor,
        colors.homeColor
      );

      // Update the message
      await spreadBarMessage.edit(barData.bar);

      logger.info('Regenerated spread bar with new colors', {
        threadId: thread.id,
        awayAbbrev,
        homeAbbrev,
        spread: homeSpread
      });

    } catch (error) {
      logger.error('Failed to regenerate spread bar:', error);
      throw error;
    }
  }

  /**
   * DEBUG FUNCTION: Delete all DMs sent by the bot
   * Call this function programmatically for testing/cleanup
   * @param {number} hoursBack - How many hours back to search (default: 24)
   * @returns {Promise<Object>} - Results of the deletion operation
   */
  async debugDeleteAllDMs(hoursBack = 24) {
    const volatileDM = require('./utils/volatileDM');
    return await volatileDM.debugDeleteAllBotDMs(this.client, hoursBack);
  }

  async shutdown() {
    logger.info('Shutting down bot...');

    // Clean up volatile DM timers
    const volatileDM = require('./utils/volatileDM');
    volatileDM.clearAllPendingDeletions();
    
    // Clean up emoji reaction listeners
    const emojiReactionManager = require('./utils/emojiReactionManager');
    emojiReactionManager.cleanupAllReactions();
    
    // Clean up game log manager
    if (this.gameLogManager) {
      this.gameLogManager.cleanup();
    }
    
    // Clean up odds tracker
    if (this.oddsTracker) {
      this.oddsTracker.cleanup();
    }
    


    if (this.client) {
      await this.client.destroy();
    }
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  if (bot) {
    await bot.shutdown();
  }
});

process.on('SIGTERM', async () => {
  if (bot) {
    await bot.shutdown();
  }
});

// Initialize and start the bot
const bot = new DiscordBot();

// Make bot instance accessible to commands
bot.client.bot = bot;

// DEBUG: Add global access to bot instance for console debugging
global.debugBot = bot;

// DEBUG: Add console command listener for DM deletion (development only)
if (process.env.NODE_ENV === 'development') {
  process.stdin.setEncoding('utf8');
  process.stdin.on('readable', () => {
    const chunk = process.stdin.read();
    if (chunk !== null) {
      const command = chunk.trim();

      if (command === 'delete-all-dms') {
        console.log('🗑️  Starting deletion of all bot DMs...');
        bot.debugDeleteAllDMs(24).then(results => {
          console.log('✅ DM deletion completed:', {
            channelsChecked: results.channelsChecked,
            messagesDeleted: results.messagesDeleted,
            errors: results.errors.length
          });
        }).catch(error => {
          console.error('❌ DM deletion failed:', error);
        });
      } else if (command === 'check-volatile-dms') {
        const volatileDM = require('./utils/volatileDM');
        const info = volatileDM.getPendingDeletionsInfo();
        console.log('📊 Volatile DM Status:', info);
      } else if (command === 'test-timeout') {
        const volatileDM = require('./utils/volatileDM');
        const config = require('./config');
        console.log('🧪 Testing timeout calculation...');
        console.log('Config value:', config.dm.volatileDeleteMinutes);
        const test = volatileDM.testTimeoutCalculation(config.dm.volatileDeleteMinutes);
        console.log('Test result:', test);
      } else if (command === 'help') {
        console.log('Available debug commands:');
        console.log('  delete-all-dms     - Delete all DMs sent by the bot');
        console.log('  check-volatile-dms - Check status of pending volatile DM deletions');
        console.log('  test-timeout       - Test timeout calculation with current config');
        console.log('  help              - Show this help message');
      }
    }
  });

  console.log('🔧 Development mode: Type "help" for debug commands');
}

bot.initialize().catch(error => {
  logger.error('Failed to start bot:', error);
  process.exit(1);
});

module.exports = DiscordBot;