const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const LobbyManager = require('../../modules/gaming/LobbyManager');
const dbConnection = require('../../database/connection');

class JoinLobbyCommand extends BaseCommand {
  constructor() {
    super('join-lobby', 'Request to join an existing gaming lobby', {
      category: 'gaming',
      guildOnly: true,
      cooldown: 5 // Add cooldown to prevent spam
    });

    this.data
      .addStringOption(option =>
        option.setName('lobby-id')
          .setDescription('The lobby ID to request to join')
          .setRequired(true)
          .setMaxLength(50)
      );

    this.lobbyManager = new LobbyManager();

    // Enable autocomplete for lobby-id option
    this.data.options[0].setAutocomplete(true);
  }

  async execute(interaction) {
    try {
      // Ensure database is connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      const lobbyId = interaction.options.getString('lobby-id');
      const requesterId = interaction.user.id;

      // Get the lobby to validate it exists and is active
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      if (!lobby || !lobby.isActive()) {
        await interaction.reply({
          content: '❌ This lobby is no longer active or does not exist.',
          ephemeral: true
        });
        return;
      }

      // Check if user is already in the lobby
      if (lobby.hasMember(requesterId)) {
        await interaction.reply({
          content: '✅ You are already a member of this lobby!',
          ephemeral: true
        });
        return;
      }

      // Check if user is the leader
      if (lobby.isLeader(requesterId)) {
        await interaction.reply({
          content: '👑 You are the leader of this lobby!',
          ephemeral: true
        });
        return;
      }

      // Respond to the requester immediately to prevent timeout
      await interaction.reply({
        content: `📨 Sending join request to <@${lobby.leaderId}>...`,
        ephemeral: true
      });

      // Use the lobby catalog manager to handle the join request
      // This duplicates the exact functionality of clicking the "Request to Join" button
      const lobbyCatalogManager = require('../../utils/lobbyCatalogManager');
      
      // Create unique request ID (same format as button handler)
      const requestId = `${lobbyId}_${requesterId}_${Date.now()}`;

      // Store the request (same as button handler)
      lobbyCatalogManager.pendingRequests.set(requestId, {
        lobbyId,
        requesterId,
        requesterTag: interaction.user.tag,
        leaderId: lobby.leaderId,
        gameType: lobby.gameType,
        guildName: interaction.guild.name,
        timestamp: Date.now()
      });

      // Send DM to lobby leader asynchronously (same as button handler)
      try {
        await lobbyCatalogManager.sendJoinRequestDM(requestId, interaction.client);
        
        // Update the response to confirm success
        await interaction.editReply({
          content: `📨 Join request sent to <@${lobby.leaderId}>! They will receive a DM to approve or decline your request.`
        });
      } catch (dmError) {
        // If DM fails, update the response with error info
        await interaction.editReply({
          content: `⚠️ Join request created but failed to send DM to <@${lobby.leaderId}>. They may have DMs disabled. Your request is still pending.`
        });
      }

      this.logUsage(interaction, 'completed', {
        requestId,
        lobbyId,
        requesterId,
        leaderId: lobby.leaderId,
        gameType: lobby.gameType
      });

    } catch (error) {
      this.logUsage(interaction, 'failed', { error: error.message });

      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Send Join Request')
        .setDescription(error.message)
        .addFields({
          name: '💡 Tip',
          value: 'Make sure you have the correct lobby ID. You can find it in the lobby catalog or by using `/lobby-info`.'
        })
        .setTimestamp();

      // Check if we've already replied to avoid Discord API errors
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  }

  async autocomplete(interaction) {
    try {
      // Ensure database is connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      const focusedValue = interaction.options.getFocused();
      const guildId = interaction.guild.id;
      const userId = interaction.user.id;

      // Get all active lobbies in this guild
      const LobbyRepository = require('../../database/repositories/LobbyRepository');
      const lobbyRepo = new LobbyRepository();
      const activeLobbies = await lobbyRepo.getActiveLobbysByGuild(guildId);

      // Filter lobbies that the user can join (not already a member, not the leader)
      const joinableLobbies = activeLobbies.filter(lobby => {
        return !lobby.hasMember(userId) && !lobby.isLeader(userId);
      });

      // Create autocomplete choices
      const choices = joinableLobbies
        .filter(lobby => {
          // Filter by the focused value (partial match on lobby ID or game type)
          const searchTerm = focusedValue.toLowerCase();
          return lobby.id.toLowerCase().includes(searchTerm) || 
                 lobby.gameType.toLowerCase().includes(searchTerm);
        })
        .slice(0, 25) // Discord limit
        .map(lobby => {
          const memberCount = lobby.getMemberCount();
          const truncatedId = lobby.id.length > 8 ? lobby.id.substring(0, 8) + '...' : lobby.id;
          return {
            name: `${lobby.gameType} (${memberCount} members) - ID: ${truncatedId}`,
            value: lobby.id
          };
        });

      await interaction.respond(choices);
    } catch (error) {
      // If autocomplete fails, just return empty array
      await interaction.respond([]);
    }
  }
}

module.exports = JoinLobbyCommand;