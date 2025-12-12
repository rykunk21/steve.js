const LobbyRepository = require('../../database/repositories/LobbyRepository');
const ServerConfigRepository = require('../../database/repositories/ServerConfigRepository');
const logger = require('../../utils/logger');

/**
 * Manages gaming lobby operations
 */
class LobbyManager {
  constructor(voiceChannelManager = null) {
    this.lobbyRepo = new LobbyRepository();
    this.configRepo = new ServerConfigRepository();
    this.voiceChannelManager = voiceChannelManager;
    this.cleanupInterval = null;
    
    // Start cleanup process (now mainly for database cleanup)
    this.startCleanupProcess();
  }

  /**
   * Set the voice channel manager reference
   */
  setVoiceChannelManager(voiceChannelManager) {
    this.voiceChannelManager = voiceChannelManager;
  }

  /**
   * Set the Discord client reference for catalog operations
   */
  setClient(client) {
    this.client = client;
  }

  /**
   * Create a new gaming lobby
   */
  async createLobby(guildId, leaderId, gameType, options = {}) {
    try {
      // Ensure server configuration exists (auto-create if needed)
      let config = await this.configRepo.getByGuildId(guildId);
      if (!config) {
        // Create default server configuration
        const ServerConfig = require('../../database/models/ServerConfig');
        config = new ServerConfig({ guildId });
        await this.configRepo.saveConfig(config);
        logger.info('Created default server configuration', { guildId });
      }

      const lobbySettings = config.lobbySettings;

      // Validate inputs
      if (!gameType || gameType.trim().length === 0) {
        throw new Error('Game type is required');
      }

      if (gameType.length > 100) {
        throw new Error('Game type must be 100 characters or less');
      }

      // Check if user already has an active lobby for this game
      const existingLobby = await this.getLobbyByUserAndGame(leaderId, gameType);
      if (existingLobby && existingLobby.isActive()) {
        throw new Error(`You already have an active ${gameType} lobby. Use \`/disband-lobby game:${gameType}\` to disband it first, or \`/lobby-info game:${gameType}\` to view it.`);
      }

      // Check if user can create more lobbies
      const canCreate = await this.lobbyRepo.canUserCreateLobby(leaderId, 3);
      if (!canCreate) {
        throw new Error('You have reached the maximum number of active lobbies (3)');
      }

      // If there's an old inactive lobby with the same ID, remove it first
      if (existingLobby && !existingLobby.isActive()) {
        await this.lobbyRepo.delete(existingLobby.id);
        logger.info('Removed old inactive lobby before creating new one', {
          oldLobbyId: existingLobby.id,
          gameType
        });
      }

      // Create the lobby with indefinite duration (will be managed by voice activity)
      const lobby = await this.lobbyRepo.createLobby(guildId, leaderId, gameType, null);

      logger.info('Lobby created successfully', {
        lobbyId: lobby.id,
        guildId,
        leaderId,
        gameType
      });

      return lobby;
    } catch (error) {
      logger.error('Failed to create lobby:', error);
      throw error;
    }
  }

  /**
   * Get lobby by ID
   */
  async getLobby(lobbyId) {
    try {
      const lobby = await this.lobbyRepo.getLobbyById(lobbyId);
      
      if (lobby && lobby.isExpired()) {
        await this.expireLobby(lobbyId);
        return null;
      }

      return lobby;
    } catch (error) {
      logger.error('Failed to get lobby:', error);
      throw error;
    }
  }

  /**
   * Join a lobby
   */
  async joinLobby(lobbyId, userId) {
    try {
      const lobby = await this.getLobby(lobbyId);
      
      if (!lobby) {
        throw new Error('Lobby not found or has expired');
      }

      if (!lobby.isActive()) {
        throw new Error('Lobby is not active');
      }

      if (lobby.hasMember(userId)) {
        throw new Error('You are already in this lobby');
      }

      // Get server configuration for max lobby size
      const config = await this.configRepo.getByGuildId(lobby.guildId);
      const maxSize = config ? config.lobbySettings.maxSize : 10;

      if (lobby.getMemberCount() >= maxSize) {
        throw new Error(`Lobby is full (max ${maxSize} members)`);
      }

      // Add member to lobby
      await this.lobbyRepo.addMember(lobbyId, userId);
      lobby.addMember(userId);

      logger.info('User joined lobby', {
        lobbyId,
        userId,
        memberCount: lobby.getMemberCount()
      });

      return lobby;
    } catch (error) {
      logger.error('Failed to join lobby:', error);
      throw error;
    }
  }

  /**
   * Leave a lobby
   */
  async leaveLobby(lobbyId, userId) {
    try {
      const lobby = await this.getLobby(lobbyId);
      
      if (!lobby) {
        throw new Error('Lobby not found');
      }

      if (!lobby.hasMember(userId)) {
        throw new Error('You are not in this lobby');
      }

      // Remove member from lobby
      await this.lobbyRepo.removeMember(lobbyId, userId);
      lobby.removeMember(userId);

      // If leader left and there are other members, transfer leadership
      if (lobby.isLeader(userId) && lobby.getMemberCount() > 0) {
        const memberIds = lobby.getMemberIds();
        const newLeader = memberIds[0]; // First remaining member becomes leader
        
        await this.transferLeadership(lobbyId, newLeader);
        lobby.transferLeadership(newLeader);

        logger.info('Leadership transferred due to leader leaving', {
          lobbyId,
          oldLeader: userId,
          newLeader
        });
      }

      // If no members left, disband the lobby
      if (lobby.getMemberCount() === 0) {
        await this.disbandLobby(lobbyId);
        logger.info('Lobby disbanded - no members remaining', { lobbyId });
        return null;
      }

      logger.info('User left lobby', {
        lobbyId,
        userId,
        memberCount: lobby.getMemberCount()
      });

      return lobby;
    } catch (error) {
      logger.error('Failed to leave lobby:', error);
      throw error;
    }
  }

  /**
   * Transfer lobby leadership
   */
  async transferLeadership(lobbyId, newLeaderId) {
    try {
      const lobby = await this.getLobby(lobbyId);
      
      if (!lobby) {
        throw new Error('Lobby not found');
      }

      if (!lobby.hasMember(newLeaderId)) {
        throw new Error('New leader must be a member of the lobby');
      }

      if (lobby.isLeader(newLeaderId)) {
        throw new Error('User is already the leader');
      }

      await this.lobbyRepo.transferLeadership(lobbyId, newLeaderId);
      lobby.transferLeadership(newLeaderId);

      logger.info('Leadership transferred', {
        lobbyId,
        newLeader: newLeaderId
      });

      return lobby;
    } catch (error) {
      logger.error('Failed to transfer leadership:', error);
      throw error;
    }
  }

  /**
   * Disband a lobby
   */
  async disbandLobby(lobbyId) {
    try {
      const lobby = await this.getLobby(lobbyId);
      
      if (!lobby) {
        throw new Error('Lobby not found');
      }

      // Delete voice channel if exists
      if (lobby.voiceChannelId && this.voiceChannelManager) {
        try {
          await this.voiceChannelManager.deleteChannel(
            lobby.voiceChannelId, 
            'Lobby disbanded - no members remaining'
          );
        } catch (voiceError) {
          logger.warn('Failed to delete voice channel during lobby disband:', voiceError);
        }
      }

      // Remove from lobby catalog
      try {
        const lobbyCatalogManager = require('../../utils/lobbyCatalogManager');
        const client = this.voiceChannelManager?.client || this.client;
        if (client) {
          await lobbyCatalogManager.removeLobbyFromCatalog(lobbyId, client);
        } else {
          logger.warn('No Discord client available for catalog cleanup during disband');
        }
      } catch (catalogError) {
        logger.warn('Failed to remove lobby from catalog during disband:', catalogError);
      }

      await this.lobbyRepo.disbandLobby(lobbyId);

      logger.info('Lobby disbanded', { lobbyId });
      return true;
    } catch (error) {
      logger.error('Failed to disband lobby:', error);
      throw error;
    }
  }

  /**
   * Expire a lobby
   */
  async expireLobby(lobbyId) {
    try {
      // Remove from lobby catalog
      try {
        const lobbyCatalogManager = require('../../utils/lobbyCatalogManager');
        const client = this.voiceChannelManager?.client || this.client;
        if (client) {
          await lobbyCatalogManager.removeLobbyFromCatalog(lobbyId, client);
        } else {
          logger.warn('No Discord client available for catalog cleanup during expiry');
        }
      } catch (catalogError) {
        logger.warn('Failed to remove lobby from catalog during expiry:', catalogError);
      }

      await this.lobbyRepo.expireLobby(lobbyId);
      logger.info('Lobby expired', { lobbyId });
      return true;
    } catch (error) {
      logger.error('Failed to expire lobby:', error);
      throw error;
    }
  }

  /**
   * Extend lobby duration
   */
  async extendLobby(lobbyId, additionalMinutes) {
    try {
      const lobby = await this.getLobby(lobbyId);
      
      if (!lobby) {
        throw new Error('Lobby not found');
      }

      if (!lobby.isActive()) {
        throw new Error('Cannot extend inactive lobby');
      }

      if (additionalMinutes < 1 || additionalMinutes > 240) {
        throw new Error('Extension must be between 1 and 240 minutes');
      }

      await this.lobbyRepo.extendLobby(lobbyId, additionalMinutes);
      lobby.extend(additionalMinutes);

      logger.info('Lobby extended', {
        lobbyId,
        additionalMinutes,
        newExpiry: lobby.expiresAt
      });

      return lobby;
    } catch (error) {
      logger.error('Failed to extend lobby:', error);
      throw error;
    }
  }

  /**
   * Get active lobbies for a guild
   */
  async getGuildLobbies(guildId) {
    try {
      return await this.lobbyRepo.getActiveLobbysByGuild(guildId);
    } catch (error) {
      logger.error('Failed to get guild lobbies:', error);
      throw error;
    }
  }

  /**
   * Get lobbies where user is a member
   */
  async getUserLobbies(userId) {
    try {
      return await this.lobbyRepo.getLobbiesByMember(userId);
    } catch (error) {
      logger.error('Failed to get user lobbies:', error);
      throw error;
    }
  }

  /**
   * Get lobbies led by user
   */
  async getUserLedLobbies(userId) {
    try {
      return await this.lobbyRepo.getLobbiesByLeader(userId);
    } catch (error) {
      logger.error('Failed to get user led lobbies:', error);
      throw error;
    }
  }

  /**
   * Create lobby with voice channel and automatic cleanup
   */
  async createLobbyWithVoice(guildId, leaderId, gameType, options = {}) {
    try {
      // Create the lobby first
      const lobby = await this.createLobby(guildId, leaderId, gameType, options);

      // Create voice channel if voice manager is available
      if (this.voiceChannelManager) {
        try {
          const voiceChannel = await this.voiceChannelManager.createPrivateChannel(
            guildId,
            gameType,
            leaderId,
            options.voiceOptions || {}
          );

          // Update lobby with voice channel ID
          await this.updateLobbyVoiceChannel(lobby.id, voiceChannel.id);
          lobby.voiceChannelId = voiceChannel.id;

          // Set up automatic cleanup based on voice channel inactivity (30 minutes)
          this.voiceChannelManager.setupChannelCleanup(voiceChannel.id, lobby.id, 30);

          logger.info('Lobby created with voice channel and inactivity cleanup', {
            lobbyId: lobby.id,
            voiceChannelId: voiceChannel.id,
            inactivityTimeout: 30
          });
        } catch (voiceError) {
          logger.warn('Failed to create voice channel for lobby, continuing without voice', {
            lobbyId: lobby.id,
            error: voiceError.message
          });
        }
      }

      return lobby;
    } catch (error) {
      logger.error('Failed to create lobby with voice:', error);
      throw error;
    }
  }

  /**
   * Update lobby voice channel
   */
  async updateLobbyVoiceChannel(lobbyId, voiceChannelId) {
    try {
      await this.lobbyRepo.updateVoiceChannel(lobbyId, voiceChannelId);
      
      logger.info('Lobby voice channel updated', {
        lobbyId,
        voiceChannelId
      });

      return true;
    } catch (error) {
      logger.error('Failed to update lobby voice channel:', error);
      throw error;
    }
  }

  /**
   * Get lobby by voice channel
   */
  async getLobbyByVoiceChannel(voiceChannelId) {
    try {
      return await this.lobbyRepo.getLobbyByVoiceChannel(voiceChannelId);
    } catch (error) {
      logger.error('Failed to get lobby by voice channel:', error);
      throw error;
    }
  }

  /**
   * Get lobby by user ID and game name (searches by current leader, not original creator)
   */
  async getLobbyByUserAndGame(userId, gameType) {
    try {
      // First try the direct ID approach (if user is original creator)
      const Lobby = require('../../database/models/Lobby');
      const directLobbyId = Lobby.getLobbyIdFromGame(userId, gameType);
      let lobby = await this.getLobby(directLobbyId);
      
      if (lobby && lobby.isLeader(userId)) {
        return lobby;
      }

      // If not found or user is not leader, search all active lobbies for this user as leader
      const userLedLobbies = await this.lobbyRepo.getLobbiesByLeader(userId);
      const matchingLobby = userLedLobbies.find(l => 
        l.gameType.toLowerCase() === gameType.toLowerCase() && l.isActive()
      );

      return matchingLobby || null;
    } catch (error) {
      logger.error('Failed to get lobby by user and game:', error);
      throw error;
    }
  }

  /**
   * Disband lobby by user ID and game name
   */
  async disbandLobbyByGame(userId, gameType) {
    try {
      const lobby = await this.getLobbyByUserAndGame(userId, gameType);
      
      if (!lobby) {
        throw new Error(`No active ${gameType} lobby found where you are the leader`);
      }

      if (!lobby.isLeader(userId)) {
        throw new Error('Only the lobby leader can disband the lobby');
      }

      return await this.disbandLobby(lobby.id);
    } catch (error) {
      logger.error('Failed to disband lobby by game:', error);
      throw error;
    }
  }

  /**
   * Find lobby by game type and current leader (more robust search)
   */
  async findLobbyByGameAndLeader(leaderId, gameType) {
    try {
      const userLedLobbies = await this.lobbyRepo.getLobbiesByLeader(leaderId);
      return userLedLobbies.find(lobby => 
        lobby.gameType.toLowerCase() === gameType.toLowerCase() && 
        lobby.isActive()
      ) || null;
    } catch (error) {
      logger.error('Failed to find lobby by game and leader:', error);
      throw error;
    }
  }

  /**
   * Find lobby by game type where user is a member (not necessarily leader)
   */
  async findLobbyByGameAndMember(userId, gameType) {
    try {
      const userLobbies = await this.lobbyRepo.getLobbiesByMember(userId);
      return userLobbies.find(lobby => 
        lobby.gameType.toLowerCase() === gameType.toLowerCase() && 
        lobby.isActive()
      ) || null;
    } catch (error) {
      logger.error('Failed to find lobby by game and member:', error);
      throw error;
    }
  }

  /**
   * Start automatic cleanup process for expired lobbies
   */
  startCleanupProcess() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      try {
        const cleanedCount = await this.lobbyRepo.cleanupExpiredLobbies();
        if (cleanedCount > 0) {
          logger.info(`Cleaned up ${cleanedCount} expired lobbies`);
        }
      } catch (error) {
        logger.error('Error during lobby cleanup:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    logger.info('Lobby cleanup process started');
  }

  /**
   * Stop cleanup process
   */
  stopCleanupProcess() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Lobby cleanup process stopped');
    }
  }

  /**
   * Get lobby statistics for a guild
   */
  async getLobbyStats(guildId) {
    try {
      return await this.lobbyRepo.getLobbyStats(guildId);
    } catch (error) {
      logger.error('Failed to get lobby stats:', error);
      throw error;
    }
  }

  /**
   * Validate lobby permissions
   */
  validateLobbyPermissions(lobby, userId, action) {
    if (!lobby) {
      throw new Error('Lobby not found');
    }

    switch (action) {
      case 'disband':
      case 'transfer_leadership':
      case 'extend':
        if (!lobby.isLeader(userId)) {
          throw new Error('Only the lobby leader can perform this action');
        }
        break;
      
      case 'join':
        if (lobby.hasMember(userId)) {
          throw new Error('You are already in this lobby');
        }
        break;
      
      case 'leave':
        if (!lobby.hasMember(userId)) {
          throw new Error('You are not in this lobby');
        }
        break;
    }

    if (!lobby.isActive()) {
      throw new Error('Lobby is not active');
    }

    return true;
  }
}

module.exports = LobbyManager;