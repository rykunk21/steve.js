const logger = require('./logger');

/**
 * Manages emoji reactions for customizing voice channel names
 */
class EmojiReactionManager {
  constructor() {
    this.pendingReactions = new Map(); // Track messages waiting for reactions
    this.reactionTimeouts = new Map(); // Track reaction timeouts
  }

  /**
   * Set up emoji reaction listener for a message
   * @param {Message} message - The Discord message to listen for reactions on
   * @param {string} lobbyId - The lobby ID associated with this message
   * @param {string} voiceChannelId - The voice channel ID to update
   * @param {VoiceChannelManager} voiceChannelManager - Voice channel manager instance
   * @param {number} timeoutMinutes - Minutes to wait for reactions (default: 10)
   * @param {string} ownerId - The lobby owner's user ID (only they can react)
   */
  setupEmojiReactionListener(message, lobbyId, voiceChannelId, voiceChannelManager, timeoutMinutes = 10, ownerId = null) {
    const reactionKey = `${message.id}-${lobbyId}`;
    
    // Store the reaction data
    this.pendingReactions.set(reactionKey, {
      message,
      lobbyId,
      voiceChannelId,
      voiceChannelManager,
      ownerId,
      originalChannelName: null // Will be set when first reaction is added
    });

    // Set up reaction collector
    const filter = (reaction, user) => {
      // Only accept reactions from non-bots and from the lobby owner (if specified)
      if (user.bot) {
        logger.debug('Reaction filter: Ignoring bot reaction', { userId: user.id });
        return false;
      }
      if (ownerId && user.id !== ownerId) {
        logger.debug('Reaction filter: Ignoring non-owner reaction', { 
          userId: user.id, 
          ownerId,
          messageId: message.id 
        });
        return false;
      }
      logger.debug('Reaction filter: Accepting reaction', { 
        userId: user.id, 
        ownerId,
        messageId: message.id,
        emoji: reaction.emoji.toString()
      });
      return true;
    };

    const collector = message.createReactionCollector({ 
      filter, 
      time: timeoutMinutes * 60 * 1000, // Convert to milliseconds
      dispose: true // Allow removing reactions to change emoji
    });

    logger.debug('Created reaction collector', {
      messageId: message.id,
      lobbyId,
      timeoutMs: timeoutMinutes * 60 * 1000,
      ownerId
    });

    collector.on('collect', async (reaction, user) => {
      logger.info('Reaction collected by collector', {
        messageId: message.id,
        emoji: reaction.emoji.toString(),
        userId: user.id,
        username: user.username,
        lobbyId
      });
      try {
        await this.handleEmojiReaction(reactionKey, reaction, user);
      } catch (error) {
        logger.error('Error handling emoji reaction:', error);
      }
    });

    collector.on('remove', async (reaction, user) => {
      logger.info('Reaction removed by collector', {
        messageId: message.id,
        emoji: reaction.emoji.toString(),
        userId: user.id,
        username: user.username,
        lobbyId
      });
      try {
        // When owner removes their reaction, reset channel name to original
        await this.handleEmojiRemoval(reactionKey, reaction, user);
      } catch (error) {
        logger.error('Error handling emoji removal:', error);
      }
    });

    collector.on('end', (collected, reason) => {
      logger.info('Reaction collector ended', {
        messageId: message.id,
        lobbyId,
        reason,
        collectedCount: collected.size
      });
      // Clean up when collector expires
      this.cleanupReactionListener(reactionKey);
    });

    // Set timeout for cleanup
    const timeoutId = setTimeout(() => {
      this.cleanupReactionListener(reactionKey);
    }, timeoutMinutes * 60 * 1000);

    this.reactionTimeouts.set(reactionKey, timeoutId);

    logger.debug('Set up emoji reaction listener', {
      messageId: message.id,
      lobbyId,
      voiceChannelId,
      timeoutMinutes,
      ownerId: ownerId || 'any user'
    });
  }

  /**
   * Handle when a user reacts with an emoji
   * @param {string} reactionKey - The reaction key for tracking
   * @param {MessageReaction} reaction - The Discord reaction
   * @param {User} user - The user who reacted
   */
  async handleEmojiReaction(reactionKey, reaction, user) {
    const reactionData = this.pendingReactions.get(reactionKey);
    if (!reactionData) {
      return; // Reaction data not found or already processed
    }

    const { voiceChannelId, voiceChannelManager, message, ownerId } = reactionData;
    const emoji = reaction.emoji;

    // Double-check that this is the owner (in case filter didn't catch it)
    if (ownerId && user.id !== ownerId) {
      logger.debug('Non-owner tried to react to lobby banner', {
        userId: user.id,
        ownerId,
        lobbyId: reactionData.lobbyId
      });
      return;
    }

    try {
      logger.debug('Processing emoji reaction for voice channel update', {
        voiceChannelId,
        emoji: emoji.toString(),
        userId: user.id,
        lobbyId: reactionData.lobbyId
      });

      // Get current channel info
      const channelInfo = voiceChannelManager.getChannelInfo(voiceChannelId);
      if (!channelInfo) {
        logger.warn('Voice channel not found for emoji reaction', { voiceChannelId });
        return;
      }

      logger.debug('Current channel info', {
        channelId: channelInfo.id,
        currentName: channelInfo.name,
        originalName: reactionData.originalChannelName
      });

      // Store original name if not already stored
      if (!reactionData.originalChannelName) {
        reactionData.originalChannelName = channelInfo.name;
        logger.debug('Stored original channel name', { 
          originalName: reactionData.originalChannelName 
        });
      }

      // Create new channel name with emoji
      const emojiStr = emoji.toString();
      const baseName = reactionData.originalChannelName.replace(/^[^\w\s]+\s*/, '').replace(/\s*[^\w\s]+$/, ''); // Remove existing emojis
      const newChannelName = `${emojiStr} ${baseName} ${emojiStr}`;

      logger.debug('Calculated new channel name', {
        emojiStr,
        baseName,
        newChannelName
      });

      // Update the voice channel name
      await voiceChannelManager.updateChannel(voiceChannelId, {
        name: newChannelName
      });

      logger.info('Voice channel name updated with emoji', {
        voiceChannelId,
        oldName: channelInfo.name,
        newName: newChannelName,
        emoji: emojiStr,
        userId: user.id,
        lobbyId: reactionData.lobbyId
      });

    } catch (error) {
      logger.error('Failed to update voice channel with emoji:', error);
      
      // Add error reaction
      try {
        await message.react('❌');
      } catch (reactError) {
        logger.warn('Failed to add error reaction:', reactError);
      }
    }
  }

  /**
   * Handle when a user removes their emoji reaction
   * @param {string} reactionKey - The reaction key for tracking
   * @param {MessageReaction} reaction - The Discord reaction
   * @param {User} user - The user who removed the reaction
   */
  async handleEmojiRemoval(reactionKey, reaction, user) {
    const reactionData = this.pendingReactions.get(reactionKey);
    if (!reactionData) {
      return; // Reaction data not found
    }

    const { voiceChannelId, voiceChannelManager, ownerId, originalChannelName } = reactionData;

    // Only handle removal by the owner
    if (ownerId && user.id !== ownerId) {
      return;
    }

    try {
      // Get current channel info
      const channelInfo = voiceChannelManager.getChannelInfo(voiceChannelId);
      if (!channelInfo) {
        logger.warn('Voice channel not found for emoji removal', { voiceChannelId });
        return;
      }

      // Reset to original name if we have it stored
      if (originalChannelName) {
        await voiceChannelManager.updateChannel(voiceChannelId, {
          name: originalChannelName
        });

        logger.info('Voice channel name reset to original', {
          voiceChannelId,
          oldName: channelInfo.name,
          newName: originalChannelName,
          userId: user.id,
          lobbyId: reactionData.lobbyId
        });
      }

    } catch (error) {
      logger.error('Failed to reset voice channel name:', error);
    }
  }

  /**
   * Clean up reaction listener data
   * @param {string} reactionKey - The reaction key to clean up
   */
  cleanupReactionListener(reactionKey) {
    // Clear timeout
    if (this.reactionTimeouts.has(reactionKey)) {
      clearTimeout(this.reactionTimeouts.get(reactionKey));
      this.reactionTimeouts.delete(reactionKey);
    }

    // Remove pending reaction data
    this.pendingReactions.delete(reactionKey);

    logger.debug('Cleaned up emoji reaction listener', { reactionKey });
  }

  /**
   * Get count of pending reactions (for monitoring)
   */
  getPendingReactionCount() {
    return this.pendingReactions.size;
  }

  /**
   * Clean up all pending reactions (on shutdown)
   */
  cleanupAllReactions() {
    // Clear all timeouts
    for (const timeoutId of this.reactionTimeouts.values()) {
      clearTimeout(timeoutId);
    }

    // Clear all data
    this.reactionTimeouts.clear();
    this.pendingReactions.clear();

    logger.info('Cleaned up all emoji reaction listeners');
  }

  /**
   * Check if a message has a pending reaction listener
   * @param {string} messageId - The message ID to check
   * @returns {boolean} - Whether there's a pending reaction listener
   */
  hasPendingReaction(messageId) {
    for (const [key, data] of this.pendingReactions.entries()) {
      if (data.message.id === messageId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove reaction listener for a specific message
   * @param {string} messageId - The message ID to remove listener for
   */
  removeReactionListener(messageId) {
    for (const [key, data] of this.pendingReactions.entries()) {
      if (data.message.id === messageId) {
        this.cleanupReactionListener(key);
        break;
      }
    }
  }
}

// Create singleton instance
const emojiReactionManager = new EmojiReactionManager();

module.exports = emojiReactionManager;