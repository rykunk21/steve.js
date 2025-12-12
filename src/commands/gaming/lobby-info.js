const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const LobbyManager = require('../../modules/gaming/LobbyManager');
const dbConnection = require('../../database/connection');

class LobbyInfoCommand extends BaseCommand {
  constructor() {
    super('lobby-info', 'View information about a lobby', {
      category: 'gaming',
      guildOnly: true,
      cooldown: 0
    });

    this.data
      .addStringOption(option =>
        option.setName('game')
          .setDescription('The game lobby to view info for (leave empty to see your current lobby)')
          .setRequired(false)
          .setMaxLength(100)
      )
      .addUserOption(option =>
        option.setName('leader')
          .setDescription('The leader of the lobby (only needed if viewing someone else\'s lobby)')
          .setRequired(false)
      );

    this.lobbyManager = new LobbyManager();
  }

  async execute(interaction) {
    try {
      // Ensure database is connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      await interaction.deferReply();

      const gameType = interaction.options.getString('game');
      const leader = interaction.options.getUser('leader');
      const userId = interaction.user.id;

      let lobby;

      if (gameType) {
        // Get specific lobby by game name
        if (leader) {
          // Viewing someone else's lobby - search by their leadership
          lobby = await this.lobbyManager.findLobbyByGameAndLeader(leader.id, gameType);
        } else {
          // Viewing your own lobby - search where you're a member (could be leader or not)
          lobby = await this.lobbyManager.findLobbyByGameAndMember(userId, gameType);
        }
      } else {
        // Get user's current lobby
        const userLobbies = await this.lobbyManager.getUserLobbies(userId);
        lobby = userLobbies.length > 0 ? userLobbies[0] : null;
      }

      if (!lobby) {
        const embed = new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('🔍 No Lobby Found')
          .setDescription(gameType ? 
            `No active ${gameType} lobby found for ${leader ? leader.username : 'your account'}.` :
            'You are not currently in any active lobby.'
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Create info embed
      const memberList = lobby.getMemberIds()
        .map(memberId => `${lobby.isLeader(memberId) ? '👑' : '👤'} <@${memberId}>`)
        .join('\n');

      const timeRemaining = lobby.getTimeRemaining();
      const timeDisplay = timeRemaining === null ? 
        'Until 30 min of voice inactivity' : 
        timeRemaining > 0 ? `${timeRemaining} minutes remaining` : '⚠️ Expired';

      const embed = new EmbedBuilder()
        .setColor(lobby.isActive() ? 0x00FF00 : 0xFF0000)
        .setTitle(`🎮 ${lobby.getDisplayName()}`)
        .setDescription(`**Status:** ${lobby.isActive() ? '🟢 Active' : '🔴 Inactive'}`)
        .addFields(
          { name: '🎯 Game Type', value: lobby.gameType, inline: true },
          { name: '👑 Leader', value: `<@${lobby.leaderId}>`, inline: true },
          { name: '⏰ Time Left', value: timeDisplay, inline: true },
          { name: '👥 Members', value: memberList || 'No members', inline: false }
        )
        .addFields(
          { name: '🆔 Lobby ID', value: `\`${lobby.id}\``, inline: true },
          { name: '📅 Created', value: `<t:${Math.floor(new Date(lobby.createdAt).getTime() / 1000)}:R>`, inline: true }
        )
        .setTimestamp();

      if (lobby.voiceChannelId) {
        embed.addFields({ 
          name: '🔊 Voice Channel', 
          value: `<#${lobby.voiceChannelId}>`, 
          inline: true 
        });
      }

      await interaction.editReply({ embeds: [embed] });

      this.logUsage(interaction, 'completed', { lobbyId: lobby.id });

    } catch (error) {
      this.logUsage(interaction, 'failed', { error: error.message });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Error Getting Lobby Info')
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

module.exports = LobbyInfoCommand;