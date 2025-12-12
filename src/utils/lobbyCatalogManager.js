const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');

/**
 * Manages the lobby catalog system for displaying active lobbies
 */
class LobbyCatalogManager {
  constructor() {
    this.pendingRequests = new Map(); // Track pending join requests
    this.catalogMessages = new Map(); // Track catalog messages by lobby ID
  }

  /**
   * Create or find the lobby catalog channel
   * @param {Guild} guild - Discord guild
   * @returns {Promise<TextChannel>} - The lobby catalog channel
   */
  async getOrCreateLobbyChannel(guild) {
    // Look for existing lobby channel
    let lobbyChannel = guild.channels.cache.find(
      channel => channel.name === 'lobby-catalog' || channel.name === '🎮-lobby-catalog'
    );

    if (!lobbyChannel) {
      try {
        // Create the lobby catalog channel
        lobbyChannel = await guild.channels.create({
          name: '🎮-lobby-catalog',
          type: 0, // Text channel
          topic: 'Browse and join active gaming lobbies! Click the buttons below to request access.',
          permissionOverwrites: [
            {
              // @everyone can view and react but not send messages
              id: guild.roles.everyone.id,
              allow: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'],
              deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads']
            },
            {
              // Bot can do everything
              id: guild.members.me.id,
              allow: ['ViewChannel', 'SendMessages', 'ManageMessages', 'EmbedLinks', 'UseExternalEmojis', 'AddReactions']
            }
          ]
        });

        logger.info('Created lobby catalog channel', {
          guildId: guild.id,
          channelId: lobbyChannel.id,
          channelName: lobbyChannel.name
        });

        // Send welcome message
        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🎮 Gaming Lobby Catalog')
          .setDescription('Welcome to the lobby catalog! Here you can see all active gaming lobbies and request to join them.')
          .addFields(
            { name: '📋 How it works', value: '• Active lobbies appear here automatically\n• Click "Request to Join" to ask for access\n• Lobby leaders will receive your request via DM\n• Once approved, you\'ll get voice channel access' },
            { name: '🎯 Commands', value: '• `/create-lobby` - Create your own lobby\n• `/lobby-info` - View lobby details\n• `/leave-lobby` - Leave a lobby you\'re in' }
          )
          .setTimestamp();

        await lobbyChannel.send({ embeds: [welcomeEmbed] });
      } catch (error) {
        logger.error('Failed to create lobby catalog channel:', error);
        throw new Error('Could not create lobby catalog channel. Please check bot permissions.');
      }
    }

    return lobbyChannel;
  }

  /**
   * Post a lobby to the catalog channel
   * @param {Guild} guild - Discord guild
   * @param {Object} lobby - Lobby object
   * @param {string} leaderId - Leader user ID
   * @param {string} voiceChannelId - Voice channel ID (optional)
   * @returns {Promise<Message>} - The catalog message
   */
  async postLobbyToCatalog(guild, lobby, leaderId, voiceChannelId = null) {
    try {
      const lobbyChannel = await this.getOrCreateLobbyChannel(guild);

      // Create lobby embed
      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`🎮 ${lobby.gameType} Lobby`)
        .setDescription(`Join <@${leaderId}>'s gaming session!`)
        .addFields(
          { name: '🎯 Game', value: lobby.gameType, inline: true },
          { name: '👑 Leader', value: `<@${leaderId}>`, inline: true },
          { name: '👥 Members', value: `${lobby.getMemberCount()}`, inline: true }
        );

      if (voiceChannelId) {
        embed.addFields({ 
          name: '🔊 Voice Channel', 
          value: `<#${voiceChannelId}>`, 
          inline: true 
        });
      }

      embed.addFields(
        { name: '⏰ Status', value: 'Active - Auto-cleanup after 30min of inactivity', inline: false },
        { name: '🆔 Lobby ID', value: `\`${lobby.id}\``, inline: true }
      );

      if (voiceChannelId) {
        embed.addFields({
          name: '🎨 Customize',
          value: 'React with emojis below to customize your voice channel name!',
          inline: false
        });
      }

      embed.setTimestamp()
        .setFooter({ text: 'Click the button below to request access!' });

      // Create join request button
      const joinButton = new ButtonBuilder()
        .setCustomId(`join_request_${lobby.id}`)
        .setLabel('Request to Join')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🚪');

      const actionRow = new ActionRowBuilder().addComponents(joinButton);

      // Send the catalog message
      const catalogMessage = await lobbyChannel.send({
        embeds: [embed],
        components: [actionRow]
      });

      // Track the catalog message
      this.catalogMessages.set(lobby.id, {
        messageId: catalogMessage.id,
        channelId: lobbyChannel.id,
        guildId: guild.id
      });

      logger.info('Posted lobby to catalog', {
        lobbyId: lobby.id,
        messageId: catalogMessage.id,
        channelId: lobbyChannel.id,
        gameType: lobby.gameType
      });

      return catalogMessage;
    } catch (error) {
      logger.error('Failed to post lobby to catalog:', error);
      throw error;
    }
  }

  /**
   * Update a lobby's catalog message
   * @param {string} lobbyId - Lobby ID
   * @param {Object} updatedLobby - Updated lobby object
   * @param {Client} client - Discord client
   */
  async updateLobbyInCatalog(lobbyId, updatedLobby, client) {
    try {
      const catalogData = this.catalogMessages.get(lobbyId);
      if (!catalogData) {
        return; // No catalog message to update
      }

      const guild = client.guilds.cache.get(catalogData.guildId);
      const channel = guild?.channels.cache.get(catalogData.channelId);
      
      if (!channel) {
        logger.warn('Catalog channel not found for lobby update', { lobbyId });
        return;
      }

      const message = await channel.messages.fetch(catalogData.messageId).catch(() => null);
      if (!message) {
        logger.warn('Catalog message not found for lobby update', { lobbyId });
        return;
      }

      // Update the embed with new member count
      const embed = EmbedBuilder.from(message.embeds[0]);
      
      // Update member count field
      const fields = embed.data.fields;
      const memberField = fields.find(field => field.name === '👥 Members');
      if (memberField) {
        memberField.value = `${updatedLobby.getMemberCount()}`;
      }

      await message.edit({ embeds: [embed] });

      logger.debug('Updated lobby in catalog', { lobbyId, memberCount: updatedLobby.getMemberCount() });
    } catch (error) {
      logger.error('Failed to update lobby in catalog:', error);
    }
  }

  /**
   * Remove a lobby from the catalog
   * @param {string} lobbyId - Lobby ID
   * @param {Client} client - Discord client
   */
  async removeLobbyFromCatalog(lobbyId, client) {
    try {
      const catalogData = this.catalogMessages.get(lobbyId);
      if (!catalogData) {
        return; // No catalog message to remove
      }

      const guild = client.guilds.cache.get(catalogData.guildId);
      const channel = guild?.channels.cache.get(catalogData.channelId);
      
      if (channel) {
        const message = await channel.messages.fetch(catalogData.messageId).catch(() => null);
        if (message) {
          await message.delete();
          logger.info('Removed lobby from catalog', { lobbyId });
        }
      }

      // Clean up tracking
      this.catalogMessages.delete(lobbyId);
    } catch (error) {
      logger.error('Failed to remove lobby from catalog:', error);
    }
  }

  /**
   * Handle join request button interaction
   * @param {ButtonInteraction} interaction - Discord button interaction
   * @param {LobbyManager} lobbyManager - Lobby manager instance
   */
  async handleJoinRequest(interaction, lobbyManager) {
    try {
      const lobbyId = interaction.customId.replace('join_request_', '');
      const requesterId = interaction.user.id;

      // Get the lobby
      const lobby = await lobbyManager.getLobby(lobbyId);
      if (!lobby || !lobby.isActive()) {
        await interaction.reply({
          content: '❌ This lobby is no longer active or has expired.',
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

      // Create unique request ID
      const requestId = `${lobbyId}_${requesterId}_${Date.now()}`;

      // Store the request
      this.pendingRequests.set(requestId, {
        lobbyId,
        requesterId,
        requesterTag: interaction.user.tag,
        leaderId: lobby.leaderId,
        gameType: lobby.gameType,
        guildName: interaction.guild.name,
        timestamp: Date.now()
      });

      // Send DM to lobby leader
      await this.sendJoinRequestDM(requestId, interaction.client);

      // Respond to the requester
      await interaction.reply({
        content: `📨 Join request sent to <@${lobby.leaderId}>! They will receive a DM to approve or decline your request.`,
        ephemeral: true
      });

      logger.info('Join request created', {
        requestId,
        lobbyId,
        requesterId,
        leaderId: lobby.leaderId,
        gameType: lobby.gameType
      });

    } catch (error) {
      logger.error('Failed to handle join request:', error);
      await interaction.reply({
        content: '❌ Failed to send join request. Please try again.',
        ephemeral: true
      });
    }
  }

  /**
   * Send join request DM to lobby leader
   * @param {string} requestId - Request ID
   * @param {Client} client - Discord client
   */
  async sendJoinRequestDM(requestId, client) {
    try {
      const config = require('../config');
      const requestData = this.pendingRequests.get(requestId);
      if (!requestData) return;

      const leader = await client.users.fetch(requestData.leaderId);
      const requester = await client.users.fetch(requestData.requesterId);

      // Create DM embed
      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🚪 Lobby Join Request')
        .setDescription(`**${requester.tag}** wants to join your **${requestData.gameType}** lobby in **${requestData.guildName}**!`)
        .addFields(
          { name: '👤 Requester', value: `<@${requestData.requesterId}>`, inline: true },
          { name: '🎯 Game', value: requestData.gameType, inline: true },
          { name: '🏠 Server', value: requestData.guildName, inline: true }
        )
        .addFields({
          name: '⏰ Auto-Delete',
          value: `This message will automatically delete in ${config.dm.volatileDeleteMinutes} minutes to keep your DMs clean.`
        })
        .setTimestamp();

      // Create approve/decline buttons
      const approveButton = new ButtonBuilder()
        .setCustomId(`approve_${requestId}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const declineButton = new ButtonBuilder()
        .setCustomId(`decline_${requestId}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

      const actionRow = new ActionRowBuilder().addComponents(approveButton, declineButton);

      // Send volatile DM
      const volatileDM = require('./volatileDM');
      
      await volatileDM.sendVolatileDM(leader, {
        embeds: [embed],
        components: [actionRow]
      }, config.dm.volatileDeleteMinutes);

    } catch (error) {
      logger.error('Failed to send join request DM:', error);
    }
  }

  /**
   * Handle approve/decline button interactions
   * @param {ButtonInteraction} interaction - Discord button interaction
   * @param {LobbyManager} lobbyManager - Lobby manager instance
   * @param {VoiceChannelManager} voiceChannelManager - Voice channel manager instance
   */
  async handleJoinResponse(interaction, lobbyManager, voiceChannelManager) {
    try {
      const config = require('../config');
      const [action, ...requestIdParts] = interaction.customId.split('_');
      const requestId = requestIdParts.join('_');
      const requestData = this.pendingRequests.get(requestId);

      if (!requestData) {
        await interaction.reply({
          content: '❌ This request has expired or already been processed.',
          ephemeral: true
        });
        return;
      }

      const { lobbyId, requesterId, requesterTag, gameType } = requestData;

      if (action === 'approve') {
        // Approve the request
        try {
          const lobby = await lobbyManager.joinLobby(lobbyId, requesterId);
          
          // Grant voice channel access
          if (lobby.voiceChannelId && voiceChannelManager) {
            await voiceChannelManager.addUserToChannel(lobby.voiceChannelId, requesterId);
          }

          // Update catalog
          await this.updateLobbyInCatalog(lobbyId, lobby, interaction.client);

          await interaction.reply({
            content: `✅ **${requesterTag}** has been added to your **${gameType}** lobby!`,
            ephemeral: true
          });

          // Notify the requester with volatile DM
          try {
            const requester = await interaction.client.users.fetch(requesterId);
            const notifyEmbed = new EmbedBuilder()
              .setColor(0x00FF00)
              .setTitle('✅ Join Request Approved!')
              .setDescription(`Your request to join the **${gameType}** lobby has been approved!`)
              .addFields(
                {
                  name: '📋 Next Steps',
                  value: `• Go back to the server\n• Join the voice channel if available\n• Have fun gaming!`
                },
                {
                  name: '⏰ Auto-Delete',
                  value: `This message will automatically delete in ${config.dm.volatileDeleteMinutes} minutes to keep your DMs clean.`
                }
              )
              .setTimestamp();

            const volatileDM = require('./volatileDM');
            await volatileDM.sendVolatileDM(requester, { embeds: [notifyEmbed] }, config.dm.volatileDeleteMinutes);
          } catch (dmError) {
            // DM failed, but that's okay
            logger.debug('Failed to send approval notification DM:', dmError);
          }

        } catch (joinError) {
          await interaction.reply({
            content: `❌ Failed to add **${requesterTag}** to the lobby: ${joinError.message}`,
            ephemeral: true
          });
        }

      } else if (action === 'decline') {
        // Decline the request
        await interaction.reply({
          content: `❌ Join request from **${requesterTag}** has been declined.`,
          ephemeral: true
        });

        // Optionally notify the requester (less intrusive) with volatile DM
        try {
          const requester = await interaction.client.users.fetch(requesterId);
          const declineEmbed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle('❌ Join Request Declined')
            .setDescription(`Your request to join the **${gameType}** lobby was declined.`)
            .addFields(
              {
                name: '🎮 Don\'t worry!',
                value: 'There are other lobbies to join. Check the lobby catalog for more options!'
              },
              {
                name: '⏰ Auto-Delete',
                value: `This message will automatically delete in ${config.dm.volatileDeleteMinutes} minutes to keep your DMs clean.`
              }
            )
            .setTimestamp();

          const volatileDM = require('./volatileDM');
          await volatileDM.sendVolatileDM(requester, { embeds: [declineEmbed] }, config.dm.volatileDeleteMinutes);
        } catch (dmError) {
          // DM failed, but that's okay
          logger.debug('Failed to send decline notification DM:', dmError);
        }
      }

      // Clean up the request
      this.pendingRequests.delete(requestId);

    } catch (error) {
      logger.error('Failed to handle join response:', error);
      await interaction.reply({
        content: '❌ An error occurred while processing your response.',
        ephemeral: true
      });
    }
  }

  /**
   * Clean up expired requests
   */
  cleanupExpiredRequests() {
    const now = Date.now();
    const expireTime = 10 * 60 * 1000; // 10 minutes

    for (const [requestId, requestData] of this.pendingRequests.entries()) {
      if (now - requestData.timestamp > expireTime) {
        this.pendingRequests.delete(requestId);
        logger.debug('Cleaned up expired join request', { requestId });
      }
    }
  }

  /**
   * Get pending request count (for monitoring)
   */
  getPendingRequestCount() {
    return this.pendingRequests.size;
  }

  /**
   * Clean up all data (on shutdown)
   */
  cleanup() {
    this.pendingRequests.clear();
    this.catalogMessages.clear();
    logger.info('Cleaned up lobby catalog manager');
  }
}

// Create singleton instance
const lobbyCatalogManager = new LobbyCatalogManager();

module.exports = lobbyCatalogManager;