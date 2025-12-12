const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const LobbyManager = require('../../modules/gaming/LobbyManager');
const VoiceChannelManager = require('../../modules/gaming/VoiceChannelManager');
const PartyLeaderManager = require('../../modules/gaming/PartyLeaderManager');
const dbConnection = require('../../database/connection');
const config = require('../../config');

class TransferLeadershipCommand extends BaseCommand {
  constructor() {
    super('transfer-leadership', 'Transfer lobby leadership to another member (leader only)', {
      category: 'gaming',
      guildOnly: true,
      cooldown: 5
    });

    this.data
      .addUserOption(option =>
        option.setName('new-leader')
          .setDescription('The member to transfer leadership to')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('game')
          .setDescription('The game lobby to transfer leadership for (optional if you only lead one lobby)')
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

      const newLeader = interaction.options.getUser('new-leader');
      const gameType = interaction.options.getString('game');
      const currentLeaderId = interaction.user.id;

      // Check if trying to transfer to self
      if (newLeader.id === currentLeaderId) {
        throw new Error('You are already the leader of this lobby');
      }

      // Check if target user is a bot
      if (newLeader.bot) {
        throw new Error('You cannot transfer leadership to bots');
      }

      let lobby;

      if (gameType) {
        // Specific game provided
        lobby = await this.lobbyManager.findLobbyByGameAndLeader(currentLeaderId, gameType);
        
        if (!lobby) {
          throw new Error(`No active ${gameType} lobby found where you are the leader`);
        }
      } else {
        // No game specified - find user's lobbies and auto-select
        const userLedLobbies = await this.lobbyManager.getUserLedLobbies(currentLeaderId);
        
        if (userLedLobbies.length === 0) {
          throw new Error('You are not currently leading any lobbies');
        } else if (userLedLobbies.length === 1) {
          // Only one lobby - use it automatically
          lobby = userLedLobbies[0];
        } else {
          // Multiple lobbies - require game specification
          const gameList = userLedLobbies.map(l => `• ${l.gameType}`).join('\n');
          throw new Error(`You are leading multiple lobbies. Please specify which game:\n${gameList}\n\nUse: \`/transfer-leadership new-leader:@${newLeader.username} game:GameName\``);
        }
      }

      // Check if new leader is a member of the lobby
      if (!lobby.hasMember(newLeader.id)) {
        throw new Error(`<@${newLeader.id}> is not a member of your ${gameType} lobby. Invite them first with \`/invite-player\``);
      }

      // Use PartyLeaderManager to transfer leadership
      const result = await this.partyLeaderManager.transferLeadership(
        lobby.id, 
        currentLeaderId, 
        newLeader.id
      );

      const gameTypeName = lobby.gameType;

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('👑 Leadership Transferred Successfully!')
        .setDescription(`Leadership of the **${gameTypeName}** lobby has been transferred to <@${newLeader.id}>!`)
        .addFields(
          { name: '🎯 Game', value: gameTypeName, inline: true },
          { name: '👑 Former Leader', value: `<@${currentLeaderId}>`, inline: true },
          { name: '👑 New Leader', value: `<@${newLeader.id}>`, inline: true },
          { name: '👥 Total Members', value: `${result.lobby.getMemberCount()}`, inline: true }
        );

      if (result.lobby.voiceChannelId) {
        embed.addFields({
          name: '🔊 Voice Channel',
          value: `<#${result.lobby.voiceChannelId}>\nThe new leader now has full voice channel permissions.`,
          inline: false
        });
      }

      embed.addFields({
        name: '📋 New Leader Capabilities',
        value: `<@${newLeader.id}> can now:\n• Invite and kick players\n• Transfer leadership again\n• Disband the lobby\n• Manage voice channel settings`
      })
      .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send a volatile DM to the new leader (auto-deletes after 5 minutes)
      const volatileDM = require('../../utils/volatileDM');
      
      const dmEmbed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('👑 You\'re Now a Lobby Leader!')
        .setDescription(`<@${currentLeaderId}> has transferred leadership of the **${gameTypeName}** lobby to you in **${interaction.guild.name}**!`)
        .addFields(
          { name: '🎯 Game', value: gameTypeName, inline: true },
          { name: '👑 Former Leader', value: `<@${currentLeaderId}>`, inline: true },
          { name: '🏠 Server', value: interaction.guild.name, inline: true }
        );

      if (result.lobby.voiceChannelId) {
        dmEmbed.addFields({
          name: '🔊 Voice Channel',
          value: `You now have full control over <#${result.lobby.voiceChannelId}>`
        });
      }

      dmEmbed.addFields({
        name: '📋 Your New Powers',
        value: `As the leader, you can:\n• \`/invite-player\` - Invite new members\n• \`/kick-player\` - Remove members\n• \`/transfer-leadership\` - Pass leadership\n• \`/disband-lobby game:${gameTypeName}\` - End the lobby`
      })
      .addFields({
        name: '⏰ Auto-Delete',
        value: `This message will automatically delete in ${config.dm.volatileDeleteMinutes} minutes to keep your DMs clean.`
      })
      .setTimestamp();

      await volatileDM.sendVolatileDM(newLeader, { embeds: [dmEmbed] }, config.dm.volatileDeleteMinutes);

      this.logUsage(interaction, 'completed', {
        gameType: gameTypeName,
        oldLeader: currentLeaderId,
        newLeader: newLeader.id,
        lobbyId: lobby.id,
        memberCount: result.lobby.getMemberCount()
      });

    } catch (error) {
      this.logUsage(interaction, 'failed', { error: error.message });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Transfer Leadership')
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

module.exports = TransferLeadershipCommand;