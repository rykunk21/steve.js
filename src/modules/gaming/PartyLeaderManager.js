const logger = require('../../utils/logger');

/**
 * Manages party leader operations and permissions for gaming lobbies
 */
class PartyLeaderManager {
  constructor(lobbyManager, voiceChannelManager) {
    this.lobbyManager = lobbyManager;
    this.voiceChannelManager = voiceChannelManager;
  }

  /**
   * Invite a user to the lobby
   */
  async inviteUser(lobbyId, leaderId, targetUserId) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'invite users');

      // Check if target user is already in the lobby
      if (lobby.hasMember(targetUserId)) {
        throw new Error('User is already in this lobby');
      }

      // Add user to lobby
      const updatedLobby = await this.lobbyManager.joinLobby(lobbyId, targetUserId);

      // If lobby has a voice channel, grant access to the new member
      if (updatedLobby.voiceChannelId) {
        await this.voiceChannelManager.addUserToChannel(
          updatedLobby.voiceChannelId, 
          targetUserId
        );
      }

      logger.info('User invited to lobby by leader', {
        lobbyId,
        leaderId,
        targetUserId,
        memberCount: updatedLobby.getMemberCount()
      });

      return {
        success: true,
        lobby: updatedLobby,
        message: 'User successfully invited to the lobby'
      };
    } catch (error) {
      logger.error('Failed to invite user to lobby:', error);
      throw error;
    }
  }

  /**
   * Kick a user from the lobby
   */
  async kickUser(lobbyId, leaderId, targetUserId) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'kick users');

      // Cannot kick the leader
      if (lobby.isLeader(targetUserId)) {
        throw new Error('Cannot kick the lobby leader');
      }

      // Check if target user is in the lobby
      if (!lobby.hasMember(targetUserId)) {
        throw new Error('User is not in this lobby');
      }

      // Remove user from voice channel first
      if (lobby.voiceChannelId) {
        await this.voiceChannelManager.removeUserFromChannel(
          lobby.voiceChannelId, 
          targetUserId
        );
      }

      // Remove user from lobby
      const updatedLobby = await this.lobbyManager.leaveLobby(lobbyId, targetUserId);

      logger.info('User kicked from lobby by leader', {
        lobbyId,
        leaderId,
        targetUserId,
        memberCount: updatedLobby ? updatedLobby.getMemberCount() : 0
      });

      return {
        success: true,
        lobby: updatedLobby,
        message: 'User successfully kicked from the lobby'
      };
    } catch (error) {
      logger.error('Failed to kick user from lobby:', error);
      throw error;
    }
  }

  /**
   * Transfer leadership to another member
   */
  async transferLeadership(lobbyId, currentLeaderId, newLeaderId) {
    try {
      // Get the lobby and validate current leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, currentLeaderId, 'transfer leadership');

      // Validate new leader is a member
      if (!lobby.hasMember(newLeaderId)) {
        throw new Error('New leader must be a member of the lobby');
      }

      // Cannot transfer to self
      if (currentLeaderId === newLeaderId) {
        throw new Error('You are already the leader');
      }

      // Transfer leadership in database
      const updatedLobby = await this.lobbyManager.transferLeadership(lobbyId, newLeaderId);

      // Update voice channel permissions if exists
      if (updatedLobby.voiceChannelId) {
        // Remove leader permissions from old leader (but keep member access)
        await this.voiceChannelManager.addUserToChannel(
          updatedLobby.voiceChannelId, 
          currentLeaderId
        );

        // Grant leader permissions to new leader
        await this.voiceChannelManager.addUserToChannel(
          updatedLobby.voiceChannelId, 
          newLeaderId
        );
      }

      logger.info('Leadership transferred', {
        lobbyId,
        oldLeader: currentLeaderId,
        newLeader: newLeaderId
      });

      return {
        success: true,
        lobby: updatedLobby,
        oldLeader: currentLeaderId,
        newLeader: newLeaderId,
        message: 'Leadership successfully transferred'
      };
    } catch (error) {
      logger.error('Failed to transfer leadership:', error);
      throw error;
    }
  }

  /**
   * Promote a member to co-leader (grant additional permissions)
   */
  async promoteToCoLeader(lobbyId, leaderId, targetUserId) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'promote members');

      // Validate target is a member
      if (!lobby.hasMember(targetUserId)) {
        throw new Error('User must be a member of the lobby');
      }

      // Grant additional voice channel permissions if exists
      if (lobby.voiceChannelId) {
        const channel = this.voiceChannelManager.client.channels.cache.get(lobby.voiceChannelId);
        if (channel) {
          await channel.permissionOverwrites.create(targetUserId, {
            ViewChannel: true,
            Connect: true,
            Speak: true,
            MoveMembers: true // Co-leader can move members
          }, {
            reason: 'Promoted to co-leader'
          });
        }
      }

      logger.info('Member promoted to co-leader', {
        lobbyId,
        leaderId,
        targetUserId
      });

      return {
        success: true,
        message: 'Member successfully promoted to co-leader'
      };
    } catch (error) {
      logger.error('Failed to promote member to co-leader:', error);
      throw error;
    }
  }

  /**
   * Update lobby settings (leader only)
   */
  async updateLobbySettings(lobbyId, leaderId, settings) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'update lobby settings');

      const updates = {};
      let voiceChannelUpdates = {};

      // Validate and prepare updates
      if (settings.name && settings.name.trim().length > 0) {
        updates.gameType = settings.name.trim();
      }

      if (settings.userLimit !== undefined) {
        const limit = parseInt(settings.userLimit);
        if (limit >= 1 && limit <= 99) {
          voiceChannelUpdates.userLimit = limit;
        }
      }

      if (settings.bitrate !== undefined) {
        const bitrate = parseInt(settings.bitrate);
        if (bitrate >= 8000 && bitrate <= 384000) {
          voiceChannelUpdates.bitrate = bitrate;
        }
      }

      // Update voice channel if there are changes
      if (lobby.voiceChannelId && Object.keys(voiceChannelUpdates).length > 0) {
        await this.voiceChannelManager.updateChannel(lobby.voiceChannelId, voiceChannelUpdates);
      }

      // Update lobby name in voice channel if changed
      if (updates.gameType && lobby.voiceChannelId) {
        voiceChannelUpdates.name = `🎮 ${updates.gameType}`;
        await this.voiceChannelManager.updateChannel(lobby.voiceChannelId, voiceChannelUpdates);
      }

      logger.info('Lobby settings updated by leader', {
        lobbyId,
        leaderId,
        updates,
        voiceChannelUpdates
      });

      return {
        success: true,
        updates,
        message: 'Lobby settings successfully updated'
      };
    } catch (error) {
      logger.error('Failed to update lobby settings:', error);
      throw error;
    }
  }

  /**
   * Extend lobby duration (leader only)
   */
  async extendLobby(lobbyId, leaderId, additionalMinutes) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'extend lobby duration');

      // Extend the lobby
      const updatedLobby = await this.lobbyManager.extendLobby(lobbyId, additionalMinutes);

      logger.info('Lobby extended by leader', {
        lobbyId,
        leaderId,
        additionalMinutes,
        newExpiry: updatedLobby.expiresAt
      });

      return {
        success: true,
        lobby: updatedLobby,
        additionalMinutes,
        message: `Lobby extended by ${additionalMinutes} minutes`
      };
    } catch (error) {
      logger.error('Failed to extend lobby:', error);
      throw error;
    }
  }

  /**
   * Disband the lobby (leader only)
   */
  async disbandLobby(lobbyId, leaderId) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'disband lobby');

      // Delete voice channel if exists
      if (lobby.voiceChannelId) {
        await this.voiceChannelManager.deleteChannel(
          lobby.voiceChannelId, 
          'Lobby disbanded by leader'
        );
      }

      // Disband the lobby
      await this.lobbyManager.disbandLobby(lobbyId);

      logger.info('Lobby disbanded by leader', {
        lobbyId,
        leaderId
      });

      return {
        success: true,
        message: 'Lobby successfully disbanded'
      };
    } catch (error) {
      logger.error('Failed to disband lobby:', error);
      throw error;
    }
  }

  /**
   * Move member to voice channel (leader only)
   */
  async moveMemberToChannel(lobbyId, leaderId, targetUserId) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'move members');

      // Validate target is a member
      if (!lobby.hasMember(targetUserId)) {
        throw new Error('User must be a member of the lobby');
      }

      // Move user to lobby voice channel
      if (lobby.voiceChannelId) {
        await this.voiceChannelManager.moveUserToChannel(
          targetUserId, 
          lobby.voiceChannelId, 
          lobby.guildId
        );

        logger.info('Member moved to lobby voice channel by leader', {
          lobbyId,
          leaderId,
          targetUserId,
          channelId: lobby.voiceChannelId
        });

        return {
          success: true,
          message: 'Member successfully moved to lobby voice channel'
        };
      } else {
        throw new Error('Lobby does not have a voice channel');
      }
    } catch (error) {
      logger.error('Failed to move member to voice channel:', error);
      throw error;
    }
  }

  /**
   * Get lobby member list with roles (leader only)
   */
  async getLobbyMembers(lobbyId, leaderId) {
    try {
      // Get the lobby and validate leadership
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      this.validateLeadershipAction(lobby, leaderId, 'view member list');

      const memberIds = lobby.getMemberIds();
      const members = memberIds.map(memberId => ({
        id: memberId,
        isLeader: lobby.isLeader(memberId),
        joinedAt: null // Could be enhanced to include join timestamp
      }));

      // Add voice channel status if available
      if (lobby.voiceChannelId) {
        const voiceMembers = this.voiceChannelManager.getChannelMembers(lobby.voiceChannelId);
        const voiceMemberIds = new Set(voiceMembers.map(m => m.id));

        members.forEach(member => {
          member.inVoiceChannel = voiceMemberIds.has(member.id);
        });
      }

      return {
        success: true,
        members,
        totalCount: members.length,
        lobby
      };
    } catch (error) {
      logger.error('Failed to get lobby members:', error);
      throw error;
    }
  }

  /**
   * Validate that the user is the leader and can perform the action
   */
  validateLeadershipAction(lobby, userId, action) {
    if (!lobby) {
      throw new Error('Lobby not found');
    }

    if (!lobby.isActive()) {
      throw new Error('Lobby is not active');
    }

    if (!lobby.isLeader(userId)) {
      throw new Error(`Only the lobby leader can ${action}`);
    }

    return true;
  }

  /**
   * Get leadership capabilities for a user in a lobby
   */
  async getLeadershipCapabilities(lobbyId, userId) {
    try {
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      
      if (!lobby) {
        return { isLeader: false, capabilities: [] };
      }

      const isLeader = lobby.isLeader(userId);
      const isMember = lobby.hasMember(userId);

      const capabilities = [];

      if (isLeader) {
        capabilities.push(
          'invite_users',
          'kick_users',
          'transfer_leadership',
          'promote_members',
          'update_settings',
          'extend_duration',
          'disband_lobby',
          'move_members',
          'view_members'
        );
      } else if (isMember) {
        capabilities.push('leave_lobby');
      }

      return {
        isLeader,
        isMember,
        capabilities,
        lobby
      };
    } catch (error) {
      logger.error('Failed to get leadership capabilities:', error);
      throw error;
    }
  }

  /**
   * Handle automatic leadership succession when leader leaves
   */
  async handleLeadershipSuccession(lobbyId, leavingLeaderId) {
    try {
      const lobby = await this.lobbyManager.getLobby(lobbyId);
      
      if (!lobby || !lobby.isLeader(leavingLeaderId)) {
        return null;
      }

      const memberIds = lobby.getMemberIds().filter(id => id !== leavingLeaderId);
      
      if (memberIds.length === 0) {
        // No members left, lobby will be disbanded
        return null;
      }

      // Select new leader (first member in the list)
      const newLeaderId = memberIds[0];
      
      // Transfer leadership
      await this.transferLeadership(lobbyId, leavingLeaderId, newLeaderId);

      logger.info('Automatic leadership succession completed', {
        lobbyId,
        oldLeader: leavingLeaderId,
        newLeader: newLeaderId
      });

      return {
        newLeader: newLeaderId,
        memberCount: memberIds.length
      };
    } catch (error) {
      logger.error('Failed to handle leadership succession:', error);
      throw error;
    }
  }
}

module.exports = PartyLeaderManager;