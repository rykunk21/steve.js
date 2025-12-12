const { EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const LobbyManager = require('../../modules/gaming/LobbyManager');
const VoiceChannelManager = require('../../modules/gaming/VoiceChannelManager');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');

class CreateLobbyCommand extends BaseCommand {
  constructor() {
    super('create-lobby', 'Create a new gaming lobby with voice channel', {
      category: 'gaming',
      guildOnly: true,
      cooldown: 0
    });

    // Add command options
    this.data
      .addStringOption(option =>
        option.setName('game')
          .setDescription('The game you want to play')
          .setRequired(true)
          .setMaxLength(100)
      )
      .addIntegerOption(option =>
        option.setName('max-players')
          .setDescription('Maximum number of players (default: 10)')
          .setMinValue(2)
          .setMaxValue(20)
          .setRequired(false)
      );

    // Initialize managers
    this.lobbyManager = new LobbyManager();
    this.voiceChannelManager = null; // Will be initialized with client
  }

  async execute(interaction) {
    try {
      // Initialize voice channel manager with client
      if (!this.voiceChannelManager) {
        this.voiceChannelManager = new VoiceChannelManager(interaction.client);
        this.lobbyManager.setClient(interaction.client);
        this.lobbyManager.setVoiceChannelManager(this.voiceChannelManager);
        this.voiceChannelManager.setLobbyManager(this.lobbyManager);
      }

      // Ensure database is connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      const gameType = interaction.options.getString('game');
      const maxPlayers = interaction.options.getInteger('max-players') || 10;
      const userId = interaction.user.id;
      const guildId = interaction.guild.id;

      // Create the lobby with integrated voice channel and inactivity cleanup
      const lobby = await this.lobbyManager.createLobbyWithVoice(guildId, userId, gameType, {
        voiceOptions: { userLimit: maxPlayers }
      });

      // Post lobby to catalog channel (this is the only response)
      const lobbyCatalogManager = require('../../utils/lobbyCatalogManager');
      let catalogMessage = null;
      
      try {
        catalogMessage = await lobbyCatalogManager.postLobbyToCatalog(
          interaction.guild,
          lobby,
          userId,
          lobby.voiceChannelId
        );
      } catch (catalogError) {
        logger.error('Failed to post lobby to catalog:', catalogError);
        throw new Error('Failed to create lobby listing. Please try again.');
      }

      // Send a simple ephemeral confirmation that the lobby was created
      await interaction.reply({
        content: `✅ Your **${gameType}** lobby has been created and posted to the lobby catalog! React with emojis on the lobby banner to customize your voice channel name.`,
        ephemeral: true
      });

      // Set up emoji reaction listener on the catalog message if voice channel was created
      if (lobby.voiceChannelId && catalogMessage) {
        const emojiReactionManager = require('../../utils/emojiReactionManager');
        const config = require('../../config');
        
        // Add some default emoji reactions to the catalog message
        const defaultEmojis = ['🔥', '⚡', '🎯', '💎', '🚀', '⭐'];
        
        try {
          for (const emoji of defaultEmojis) {
            await catalogMessage.react(emoji);
          }
        } catch (reactionError) {
          // If adding default reactions fails, that's okay
          logger.warn('Failed to add default emoji reactions:', reactionError);
        }

        emojiReactionManager.setupEmojiReactionListener(
          catalogMessage,
          lobby.id,
          lobby.voiceChannelId,
          this.voiceChannelManager,
          config.emoji.reactionTimeoutMinutes,
          userId // Pass the lobby owner's ID
        );
      }

      this.logUsage(interaction, 'completed', { 
        gameType, 
        maxPlayers, 
        lobbyId: lobby.id,
        inactivityCleanup: true
      });

    } catch (error) {
      this.logUsage(interaction, 'failed', { error: error.message });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Create Lobby')
        .setDescription(error.message)
        .setTimestamp();

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  }
}

module.exports = CreateLobbyCommand;