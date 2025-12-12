const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const LobbyManager = require('../../modules/gaming/LobbyManager');
const VoiceChannelManager = require('../../modules/gaming/VoiceChannelManager');
const dbConnection = require('../../database/connection');

class LeaveLobbyCommand extends BaseCommand {
  constructor() {
    super('leave-lobby', 'Leave your current lobby', {
      category: 'gaming',
      guildOnly: true,
      cooldown: 0
    });

    this.data
      .addStringOption(option =>
        option.setName('game')
          .setDescription('Name of the game lobby to leave (optional - will auto-detect if not provided)')
          .setRequired(false)
          .setMaxLength(100)
      );

    this.lobbyManager = new LobbyManager();
    this.voiceChannelManager = null;
  }

  async execute(interaction) {
    try {
      // Initialize voice channel manager with client
      if (!this.voiceChannelManager) {
        this.voiceChannelManager = new VoiceChannelManager(interaction.client);
        this.lobbyManager.setVoiceChannelManager(this.voiceChannelManager);
      }

      // Ensure database is connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      await interaction.deferReply();

      const gameType = interaction.options.getString('game');
      const userId = interaction.user.id;

      let targetLobby;

      if (gameType) {
        // Leave specific game lobby (search where user is a member)
        targetLobby = await this.lobbyManager.findLobbyByGameAndMember(userId, gameType);
        if (!targetLobby) {
          throw new Error(`You are not a member of any ${gameType} lobby`);
        }
      } else {
        // Find user's current lobby
        const userLobbies = await this.lobbyManager.getUserLobbies(userId);
        if (userLobbies.length === 0) {
          throw new Error('You are not currently in any lobby');
        }
        targetLobby = userLobbies[0]; // Use first active lobby
      }

      const lobbyGameType = targetLobby.gameType;
      const wasLeader = targetLobby.isLeader(userId);
      const voiceChannelId = targetLobby.voiceChannelId;

      // Remove from voice channel first
      if (voiceChannelId) {
        await this.voiceChannelManager.removeUserFromChannel(voiceChannelId, userId);
      }

      // Leave the lobby
      const remainingLobby = await this.lobbyManager.leaveLobby(targetLobby.id, userId);

      let embed;

      if (!remainingLobby) {
        // Lobby was disbanded (no members left)
        embed = new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('🏠 Lobby Disbanded')
          .setDescription(`You left the **${lobbyGameType}** lobby and it has been disbanded (no members remaining).`)
          .setTimestamp();
      } else if (wasLeader) {
        // Leadership was transferred
        embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('👑 Left Lobby - Leadership Transferred')
          .setDescription(`You left the **${lobbyGameType}** lobby. Leadership was transferred to <@${remainingLobby.leaderId}>.`)
          .addFields(
            { name: '👥 Remaining Members', value: `${remainingLobby.getMemberCount()}`, inline: true },
            { name: '👑 New Leader', value: `<@${remainingLobby.leaderId}>`, inline: true }
          )
          .setTimestamp();
      } else {
        // Regular member left
        embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Left Lobby Successfully')
          .setDescription(`You left the **${lobbyGameType}** lobby.`)
          .addFields(
            { name: '👥 Remaining Members', value: `${remainingLobby.getMemberCount()}`, inline: true },
            { name: '👑 Leader', value: `<@${remainingLobby.leaderId}>`, inline: true }
          )
          .setTimestamp();
      }

      await interaction.editReply({ embeds: [embed] });

      this.logUsage(interaction, 'completed', { 
        lobbyId: targetLobby.id,
        gameType: lobbyGameType,
        wasLeader,
        lobbyDisbanded: !remainingLobby
      });

    } catch (error) {
      this.logUsage(interaction, 'failed', { error: error.message });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Leave Lobby')
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

module.exports = LeaveLobbyCommand;