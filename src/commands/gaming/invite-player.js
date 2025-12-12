const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const LobbyManager = require('../../modules/gaming/LobbyManager');
const VoiceChannelManager = require('../../modules/gaming/VoiceChannelManager');
const PartyLeaderManager = require('../../modules/gaming/PartyLeaderManager');
const dbConnection = require('../../database/connection');
const config = require('../../config');

class InvitePlayerCommand extends BaseCommand {
  constructor() {
    super('invite-player', 'Invite a player to your lobby (leader only)', {
      category: 'gaming',
      guildOnly: true,
      cooldown: 3
    });

    this.data
      .addUserOption(option =>
        option.setName('player')
          .setDescription('The player to invite to your lobby')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('game')
          .setDescription('The game lobby to invite them to (optional if you only lead one lobby)')
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
        this.lobbyManager.setVoiceChannelManager(this.voiceChannelManager);
      }
      if (!this.partyLeaderManager) {
        this.partyLeaderManager = new PartyLeaderManager(this.lobbyManager, this.voiceChannelManager);
      }

      // Ensure database is connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      await interaction.deferReply();

      const targetUser = interaction.options.getUser('player');
      const gameType = interaction.options.getString('game');
      const leaderId = interaction.user.id;

      // Check if target user is the same as the leader
      if (targetUser.id === leaderId) {
        throw new Error('You cannot invite yourself to your own lobby');
      }

      // Check if target user is a bot
      if (targetUser.bot) {
        throw new Error('You cannot invite bots to lobbies');
      }

      let lobby;

      if (gameType) {
        // Specific game provided
        lobby = await this.lobbyManager.findLobbyByGameAndLeader(leaderId, gameType);
        
        if (!lobby) {
          throw new Error(`No active ${gameType} lobby found where you are the leader. Create one first with \`/create-lobby\``);
        }
      } else {
        // No game specified - find user's lobbies and auto-select
        const userLedLobbies = await this.lobbyManager.getUserLedLobbies(leaderId);
        
        if (userLedLobbies.length === 0) {
          throw new Error('You are not currently leading any lobbies. Create one first with `/create-lobby`');
        } else if (userLedLobbies.length === 1) {
          // Only one lobby - use it automatically
          lobby = userLedLobbies[0];
        } else {
          // Multiple lobbies - require game specification
          const gameList = userLedLobbies.map(l => `• ${l.gameType}`).join('\n');
          throw new Error(`You are leading multiple lobbies. Please specify which game:\n${gameList}\n\nUse: \`/invite-player player:@${targetUser.username} game:GameName\``);
        }
      }

      // Use PartyLeaderManager to invite the user
      const result = await this.partyLeaderManager.inviteUser(lobby.id, leaderId, targetUser.id);

      const gameTypeName = lobby.gameType;

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📨 Player Invited Successfully!')
        .setDescription(`<@${targetUser.id}> has been invited to your **${gameTypeName}** lobby!`)
        .addFields(
          { name: '🎯 Game', value: gameTypeName, inline: true },
          { name: '👤 Invited Player', value: `<@${targetUser.id}>`, inline: true },
          { name: '👥 Total Members', value: `${result.lobby.getMemberCount()}`, inline: true }
        );

      if (result.lobby.voiceChannelId) {
        embed.addFields({
          name: '🔊 Voice Channel',
          value: `<#${result.lobby.voiceChannelId}>\nThe invited player now has access to the voice channel.`,
          inline: false
        });
      }

      embed.addFields({
        name: '📋 Next Steps',
        value: `• <@${targetUser.id}> can now join the voice channel\n• Use \`/lobby-info game:${gameTypeName}\` to see all members\n• Use \`/kick-player\` if needed to remove members`
      })
      .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send a volatile DM to the invited user (auto-deletes after 5 minutes)
      const volatileDM = require('../../utils/volatileDM');
      
      const dmEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🎮 You\'ve Been Invited to a Gaming Lobby!')
        .setDescription(`<@${leaderId}> has invited you to join their **${gameTypeName}** lobby in **${interaction.guild.name}**!`)
        .addFields(
          { name: '🎯 Game', value: gameTypeName, inline: true },
          { name: '👑 Leader', value: `<@${leaderId}>`, inline: true },
          { name: '🏠 Server', value: interaction.guild.name, inline: true }
        );

      if (result.lobby.voiceChannelId) {
        dmEmbed.addFields({
          name: '🔊 Voice Channel',
          value: `You now have access to the voice channel. Head back to the server and join <#${result.lobby.voiceChannelId}>!`
        });
      }

      dmEmbed.addFields({
        name: '📋 What to do next',
        value: `• Go back to **${interaction.guild.name}**\n• Join the voice channel if available\n• Have fun gaming together!`
      })
      .addFields({
        name: '⏰ Auto-Delete',
        value: `This message will automatically delete in ${config.dm.volatileDeleteMinutes} minutes to keep your DMs clean.`
      })
      .setTimestamp();

      await volatileDM.sendVolatileDM(targetUser, { embeds: [dmEmbed] }, config.dm.volatileDeleteMinutes);

      this.logUsage(interaction, 'completed', {
        gameType: gameTypeName,
        targetUserId: targetUser.id,
        lobbyId: lobby.id,
        memberCount: result.lobby.getMemberCount()
      });

    } catch (error) {
      this.logUsage(interaction, 'failed', { error: error.message });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Invite Player')
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

module.exports = InvitePlayerCommand;