const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const PartyLeaderManager = require('../../modules/gaming/PartyLeaderManager');
const LobbyManager = require('../../modules/gaming/LobbyManager');
const VoiceChannelManager = require('../../modules/gaming/VoiceChannelManager');
const dbConnection = require('../../database/connection');

class DisbandLobbyCommand extends BaseCommand {
  constructor() {
    super('disband-lobby', 'Disband your lobby (leader only)', {
      category: 'gaming',
      guildOnly: true,
      cooldown: 0,
      dynamicVisibility: true // Mark this command as having dynamic visibility
    });

    this.data
      .addStringOption(option =>
        option.setName('game')
          .setDescription('Name of the game lobby to disband (optional if you only lead one lobby)')
          .setRequired(false)
          .setMaxLength(100)
      );

    this.lobbyManager = new LobbyManager();
    this.voiceChannelManager = null;
    this.partyLeaderManager = null;
  }



  async execute(interaction) {
    try {
      // Initialize managers
      if (!this.voiceChannelManager) {
        this.voiceChannelManager = new VoiceChannelManager(interaction.client);
        this.lobbyManager.setClient(interaction.client);
        this.lobbyManager.setVoiceChannelManager(this.voiceChannelManager);
      }
      if (!this.partyLeaderManager) {
        this.partyLeaderManager = new PartyLeaderManager(this.lobbyManager, this.voiceChannelManager);
      }

      // Ensure database is connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      const userId = interaction.user.id;

      await interaction.deferReply({ ephemeral: true });

      const gameType = interaction.options.getString('game');
      let targetLobby;

      if (gameType) {
        // Specific game provided
        targetLobby = await this.lobbyManager.findLobbyByGameAndLeader(userId, gameType);

        if (!targetLobby) {
          throw new Error(`No active ${gameType} lobby found where you are the leader`);
        }
      } else {
        // No game specified - find user's lobbies and auto-select
        const userLedLobbies = await this.lobbyManager.getUserLedLobbies(userId);

        if (userLedLobbies.length === 0) {
          throw new Error('You are not currently leading any lobbies. Create one first with `/create-lobby`');
        } else if (userLedLobbies.length === 1) {
          // Only one lobby - use it automatically
          targetLobby = userLedLobbies[0];
        } else {
          // Multiple lobbies - require game specification
          const gameList = userLedLobbies.map(lobby => `• ${lobby.gameType}`).join('\n');
          throw new Error(`You are leading multiple lobbies. Please specify which game:\n${gameList}\n\nUse: \`/disband-lobby game:GameName\``);
        }
      }

      const gameTypeName = targetLobby.gameType;
      const memberCount = targetLobby.getMemberCount();

      // Disband the lobby (this will handle voice channel deletion)
      await this.partyLeaderManager.disbandLobby(targetLobby.id, userId);

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(0xFF6600)
        .setTitle('🏠 Lobby Disbanded')
        .setDescription(`Your **${gameTypeName}** lobby has been successfully disbanded.`)
        .addFields(
          { name: '👥 Members Affected', value: `${memberCount}`, inline: true },
          { name: '🆔 Lobby ID', value: `\`${targetLobby.id}\``, inline: true }
        )
        .addFields({
          name: '📋 What Happened',
          value: '• Voice channel deleted\n• All members removed\n• Lobby marked as disbanded',
          inline: false
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      this.logUsage(interaction, 'completed', {
        lobbyId: targetLobby.id,
        gameType: gameTypeName,
        memberCount
      });

    } catch (error) {
      this.logUsage(interaction, 'failed', { error: error.message });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Disband Lobby')
        .setDescription(error.message)
        .setTimestamp();

      if (interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  }
}

module.exports = DisbandLobbyCommand;