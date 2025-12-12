const { ChannelType, PermissionFlagsBits } = require('discord.js');
const logger = require('../../utils/logger');

/**
 * Manages Discord voice channel operations for gaming lobbies
 */
class VoiceChannelManager {
  constructor(client) {
    this.client = client;
    this.lobbyManager = null; // Will be set after initialization
    this.activeCleanupIntervals = new Map(); // Track cleanup intervals by channel ID
  }

  /**
   * Set the lobby manager reference for cleanup integration
   */
  setLobbyManager(lobbyManager) {
    this.lobbyManager = lobbyManager;
    // Also set the client reference for catalog operations
    if (this.client) {
      lobbyManager.setClient(this.client);
    }
  }

  /**
   * Create a private voice channel for a lobby
   */
  async createPrivateChannel(guildId, lobbyName, leaderId, options = {}) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        throw new Error('Guild not found');
      }

      // Check bot permissions
      const botMember = guild.members.me;
      if (!botMember.permissions.has([
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak
      ])) {
        throw new Error('Bot lacks required permissions to manage voice channels');
      }

      // Create channel name (sanitized)
      const channelName = this.sanitizeChannelName(`🎮 ${lobbyName}`);

      // Find or create a category for lobby channels
      let category = guild.channels.cache.find(
        channel => channel.type === ChannelType.GuildCategory && 
                  channel.name.toLowerCase().includes('gaming')
      );

      if (!category) {
        // Create gaming category if it doesn't exist
        category = await guild.channels.create({
          name: '🎮 Gaming Lobbies',
          type: ChannelType.GuildCategory,
          reason: 'Created category for gaming lobby channels'
        });
      }

      // Create the voice channel
      const voiceChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: `Created voice channel for lobby: ${lobbyName}`,
        permissionOverwrites: [
          {
            // Deny @everyone from viewing/joining
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
          },
          {
            // Allow bot full permissions
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers
            ]
          },
          {
            // Allow lobby leader full permissions
            id: leaderId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.MoveMembers
            ]
          }
        ],
        userLimit: options.userLimit || 10,
        bitrate: options.bitrate || 64000 // 64kbps default
      });

      logger.info('Voice channel created for lobby', {
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        guildId,
        leaderId,
        lobbyName
      });

      return voiceChannel;
    } catch (error) {
      logger.error('Failed to create voice channel:', error);
      throw error;
    }
  }

  /**
   * Add user to voice channel (grant permissions)
   */
  async addUserToChannel(channelId, userId) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        throw new Error('Voice channel not found');
      }

      if (channel.type !== ChannelType.GuildVoice) {
        throw new Error('Channel is not a voice channel');
      }

      // Grant user permissions to view and connect
      await channel.permissionOverwrites.create(userId, {
        ViewChannel: true,
        Connect: true,
        Speak: true
      }, {
        reason: 'Added user to gaming lobby'
      });

      logger.info('User added to voice channel', {
        channelId,
        userId,
        channelName: channel.name
      });

      return true;
    } catch (error) {
      logger.error('Failed to add user to voice channel:', error);
      throw error;
    }
  }

  /**
   * Remove user from voice channel (revoke permissions)
   */
  async removeUserFromChannel(channelId, userId) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        throw new Error('Voice channel not found');
      }

      // Remove user's permission overwrite
      await channel.permissionOverwrites.delete(userId, {
        reason: 'Removed user from gaming lobby'
      });

      // If user is currently in the channel, disconnect them
      const member = channel.guild.members.cache.get(userId);
      if (member && member.voice.channelId === channelId) {
        await member.voice.disconnect('Removed from lobby');
      }

      logger.info('User removed from voice channel', {
        channelId,
        userId,
        channelName: channel.name
      });

      return true;
    } catch (error) {
      logger.error('Failed to remove user from voice channel:', error);
      throw error;
    }
  }

  /**
   * Delete voice channel
   */
  async deleteChannel(channelId, reason = 'Lobby disbanded') {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        logger.warn('Attempted to delete non-existent voice channel', { channelId });
        return false;
      }

      const channelName = channel.name;
      const guildId = channel.guild.id;

      await channel.delete(reason);

      logger.info('Voice channel deleted', {
        channelId,
        channelName,
        guildId,
        reason
      });

      return true;
    } catch (error) {
      logger.error('Failed to delete voice channel:', error);
      throw error;
    }
  }

  /**
   * Update channel settings
   */
  async updateChannel(channelId, updates) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        throw new Error('Voice channel not found');
      }

      const allowedUpdates = {};
      
      if (updates.name) {
        allowedUpdates.name = this.sanitizeChannelName(updates.name);
      }
      
      if (updates.userLimit !== undefined) {
        allowedUpdates.userLimit = Math.max(0, Math.min(99, updates.userLimit));
      }
      
      if (updates.bitrate !== undefined) {
        // Discord limits: 8kbps to 384kbps (premium servers can go higher)
        allowedUpdates.bitrate = Math.max(8000, Math.min(384000, updates.bitrate));
      }

      if (Object.keys(allowedUpdates).length > 0) {
        await channel.edit(allowedUpdates);
        
        logger.info('Voice channel updated', {
          channelId,
          updates: allowedUpdates
        });
      }

      return channel;
    } catch (error) {
      logger.error('Failed to update voice channel:', error);
      throw error;
    }
  }

  /**
   * Move user to voice channel
   */
  async moveUserToChannel(userId, channelId, guildId) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        throw new Error('Guild not found');
      }

      const member = guild.members.cache.get(userId);
      if (!member) {
        throw new Error('Member not found');
      }

      if (!member.voice.channel) {
        throw new Error('User is not in a voice channel');
      }

      const targetChannel = this.client.channels.cache.get(channelId);
      if (!targetChannel) {
        throw new Error('Target voice channel not found');
      }

      await member.voice.setChannel(targetChannel, 'Moved to lobby voice channel');

      logger.info('User moved to voice channel', {
        userId,
        channelId,
        channelName: targetChannel.name
      });

      return true;
    } catch (error) {
      logger.error('Failed to move user to voice channel:', error);
      throw error;
    }
  }

  /**
   * Get users currently in voice channel
   */
  getChannelMembers(channelId) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        return [];
      }

      return Array.from(channel.members.values()).map(member => ({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        muted: member.voice.mute,
        deafened: member.voice.deaf,
        streaming: member.voice.streaming,
        camera: member.voice.selfVideo
      }));
    } catch (error) {
      logger.error('Failed to get channel members:', error);
      return [];
    }
  }

  /**
   * Check if channel is empty
   */
  isChannelEmpty(channelId) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        return true;
      }

      return channel.members.size === 0;
    } catch (error) {
      logger.error('Failed to check if channel is empty:', error);
      return true;
    }
  }

  /**
   * Set up automatic channel cleanup when empty with lobby integration
   */
  setupChannelCleanup(channelId, lobbyId, timeoutMinutes = 30) {
    let emptyStartTime = null;
    
    const checkInterval = setInterval(async () => {
      try {
        const isEmpty = this.isChannelEmpty(channelId);
        
        if (isEmpty) {
          if (!emptyStartTime) {
            // Channel just became empty, start the timer
            emptyStartTime = Date.now();
            logger.info('Voice channel became empty, starting inactivity timer', {
              channelId,
              lobbyId,
              timeoutMinutes
            });
          } else {
            // Check if it's been empty for the timeout duration
            const emptyDuration = (Date.now() - emptyStartTime) / (1000 * 60); // minutes
            
            if (emptyDuration >= timeoutMinutes) {
              logger.info('Voice channel empty for timeout duration, cleaning up', {
                channelId,
                lobbyId,
                emptyDurationMinutes: Math.round(emptyDuration)
              });
              
              // Delete the voice channel
              await this.deleteChannel(channelId, `Channel empty for ${timeoutMinutes} minutes - automatic cleanup`);
              
              // Disband the associated lobby
              if (this.lobbyManager) {
                await this.lobbyManager.disbandLobby(lobbyId);
              }
              
              clearInterval(checkInterval);
            }
          }
        } else {
          // Channel has people, reset the empty timer
          if (emptyStartTime) {
            logger.debug('Voice channel no longer empty, resetting inactivity timer', {
              channelId,
              lobbyId
            });
            emptyStartTime = null;
          }
        }
      } catch (error) {
        logger.error('Error during channel cleanup check:', error);
        clearInterval(checkInterval);
      }
    }, 60 * 1000); // Check every minute

    return checkInterval;
  }

  /**
   * Sanitize channel name for Discord requirements
   */
  sanitizeChannelName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\-_\s]/g, '') // Remove invalid characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
      .substring(0, 100); // Discord limit is 100 characters
  }

  /**
   * Get channel information
   */
  getChannelInfo(channelId) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        return null;
      }

      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        userLimit: channel.userLimit,
        bitrate: channel.bitrate,
        memberCount: channel.members.size,
        members: this.getChannelMembers(channelId),
        createdAt: channel.createdAt,
        parentId: channel.parentId
      };
    } catch (error) {
      logger.error('Failed to get channel info:', error);
      return null;
    }
  }

  /**
   * Validate bot permissions for voice channel operations
   */
  async validatePermissions(guildId) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        throw new Error('Guild not found');
      }

      const botMember = guild.members.me;
      const requiredPermissions = [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.MoveMembers
      ];

      const missingPermissions = requiredPermissions.filter(
        permission => !botMember.permissions.has(permission)
      );

      if (missingPermissions.length > 0) {
        const permissionNames = missingPermissions.map(p => 
          Object.keys(PermissionFlagsBits).find(key => PermissionFlagsBits[key] === p)
        );
        
        throw new Error(`Bot is missing required permissions: ${permissionNames.join(', ')}`);
      }

      return true;
    } catch (error) {
      logger.error('Permission validation failed:', error);
      throw error;
    }
  }
}

module.exports = VoiceChannelManager;