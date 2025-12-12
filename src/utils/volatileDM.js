const logger = require('./logger');

/**
 * Utility for sending DMs that auto-delete after a specified time
 */
class VolatileDMManager {
  constructor() {
    this.pendingDeletions = new Map(); // Track messages scheduled for deletion
  }

  /**
   * Send a DM that will auto-delete after the specified time
   * @param {User} user - Discord user to send DM to
   * @param {Object} messageOptions - Discord message options (embeds, content, etc.)
   * @param {number} deleteAfterMinutes - Minutes after which to delete the message (default: 5)
   * @returns {Promise<Message|null>} - The sent message or null if failed
   */
  async sendVolatileDM(user, messageOptions, deleteAfterMinutes = 5) {
    try {
      // Send the DM
      const sentMessage = await user.send(messageOptions);
      
      // Schedule deletion
      this.scheduleDeletion(sentMessage, deleteAfterMinutes);
      
      logger.info('Volatile DM sent successfully', {
        userId: user.id,
        username: user.username,
        deleteAfterMinutes,
        messageId: sentMessage.id,
        scheduledDeletionAt: new Date(Date.now() + (deleteAfterMinutes * 60 * 1000)).toISOString()
      });

      return sentMessage;
    } catch (error) {
      // DM failed (user has DMs disabled, blocked bot, etc.)
      logger.debug('Failed to send volatile DM', {
        userId: user.id,
        username: user.username,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Schedule a message for deletion
   * @param {Message} message - The Discord message to delete
   * @param {number} deleteAfterMinutes - Minutes to wait before deletion
   */
  scheduleDeletion(message, deleteAfterMinutes) {
    const deleteAfterMs = deleteAfterMinutes * 60 * 1000;
    const messageKey = `${message.author.id}-${message.id}`;

    // Debug logging to check values
    logger.info('Scheduling DM deletion with values', {
      deleteAfterMinutes,
      deleteAfterMinutesType: typeof deleteAfterMinutes,
      deleteAfterMs,
      deleteAfterMsType: typeof deleteAfterMs,
      isValidNumber: !isNaN(deleteAfterMinutes) && isFinite(deleteAfterMinutes)
    });

    // Clear any existing timeout for this message
    if (this.pendingDeletions.has(messageKey)) {
      clearTimeout(this.pendingDeletions.get(messageKey));
    }

    // Schedule new deletion
    const timeoutId = setTimeout(async () => {
      try {
        await message.delete();
        logger.info('Volatile DM deleted successfully', {
          messageId: message.id,
          userId: message.channel.recipient?.id,
          username: message.channel.recipient?.username,
          deletedAt: new Date().toISOString()
        });
      } catch (deleteError) {
        // Message might already be deleted by user or other reasons
        logger.warn('Failed to delete volatile DM (likely already deleted)', {
          messageId: message.id,
          userId: message.channel.recipient?.id,
          username: message.channel.recipient?.username,
          error: deleteError.message,
          errorCode: deleteError.code
        });
      } finally {
        // Clean up tracking
        this.pendingDeletions.delete(messageKey);
      }
    }, deleteAfterMs);

    // Track the timeout
    this.pendingDeletions.set(messageKey, timeoutId);

    logger.info('Scheduled volatile DM deletion', {
      messageId: message.id,
      userId: message.channel.recipient?.id,
      username: message.channel.recipient?.username,
      deleteAfterMinutes,
      deleteAt: new Date(Date.now() + deleteAfterMs).toISOString(),
      pendingDeletionsCount: this.pendingDeletions.size
    });
  }

  /**
   * Cancel scheduled deletion for a message
   * @param {Message} message - The message to cancel deletion for
   */
  cancelDeletion(message) {
    const messageKey = `${message.author.id}-${message.id}`;
    
    if (this.pendingDeletions.has(messageKey)) {
      clearTimeout(this.pendingDeletions.get(messageKey));
      this.pendingDeletions.delete(messageKey);
      
      logger.debug('Cancelled volatile DM deletion', {
        messageId: message.id
      });
      return true;
    }
    
    return false;
  }

  /**
   * Get count of pending deletions (for monitoring)
   */
  getPendingDeletionCount() {
    return this.pendingDeletions.size;
  }

  /**
   * Get detailed information about pending deletions (for debugging)
   */
  getPendingDeletionsInfo() {
    const now = Date.now();
    const deletions = [];
    
    for (const [messageKey, timeoutId] of this.pendingDeletions.entries()) {
      const [userId, messageId] = messageKey.split('-');
      deletions.push({
        messageKey,
        userId,
        messageId,
        timeoutId: timeoutId.toString(),
        hasTimeout: !!timeoutId
      });
    }
    
    return {
      count: this.pendingDeletions.size,
      deletions,
      timestamp: new Date(now).toISOString()
    };
  }

  /**
   * Test timeout calculation (for debugging)
   */
  testTimeoutCalculation(minutes = 5) {
    const ms = minutes * 60 * 1000;
    const scheduledTime = new Date(Date.now() + ms);
    
    logger.info('Timeout calculation test', {
      inputMinutes: minutes,
      inputType: typeof minutes,
      calculatedMs: ms,
      calculatedMsType: typeof ms,
      currentTime: new Date().toISOString(),
      scheduledTime: scheduledTime.toISOString(),
      timeDifferenceMs: ms,
      timeDifferenceMinutes: ms / (60 * 1000)
    });
    
    return {
      inputMinutes: minutes,
      calculatedMs: ms,
      scheduledTime: scheduledTime.toISOString(),
      isValid: !isNaN(ms) && isFinite(ms) && ms > 0
    };
  }

  /**
   * Clear all pending deletions (cleanup on shutdown)
   */
  clearAllPendingDeletions() {
    for (const timeoutId of this.pendingDeletions.values()) {
      clearTimeout(timeoutId);
    }
    this.pendingDeletions.clear();
    
    logger.info('Cleared all pending volatile DM deletions');
  }

  /**
   * Clear all bot DMs for a specific user
   * @param {Client} client - Discord client instance
   * @param {string} userId - User ID to clear DMs for
   * @param {number} hoursBack - How many hours back to search for messages (default: 168 = 1 week)
   * @returns {Promise<Object>} - Results of the deletion operation
   */
  async clearUserDMs(client, userId, hoursBack = 168) {
    logger.info('Starting DM cleanup for specific user', { userId, hoursBack });
    
    const results = {
      messagesDeleted: 0,
      errors: [],
      startTime: new Date(),
      userId,
      batchesProcessed: 0
    };

    try {
      // Get the user and create DM channel
      const user = await client.users.fetch(userId);
      const dmChannel = await user.createDM();
      
      let lastMessageId = null;
      let hasMoreMessages = true;
      const maxBatches = 20; // Allow more batches for user-specific cleanup
      let batchCount = 0;
      const cutoffTime = this.getSnowflakeFromHoursAgo(hoursBack);

      while (hasMoreMessages && batchCount < maxBatches) {
        batchCount++;
        
        const fetchOptions = { limit: 100 };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }
        // Only add 'after' filter if we have a valid cutoff time
        if (cutoffTime && cutoffTime !== null) {
          fetchOptions.after = cutoffTime;
        }

        const messages = await dmChannel.messages.fetch(fetchOptions);
        
        if (messages.size === 0) {
          hasMoreMessages = false;
          break;
        }

        // Filter messages sent by the bot
        const botMessages = messages.filter(msg => msg.author.id === client.user.id);
        
        logger.debug(`Found ${botMessages.size} bot messages in batch ${batchCount}`, {
          userId,
          totalMessages: messages.size,
          botMessages: botMessages.size
        });

        // Delete bot messages
        for (const [messageId, message] of botMessages) {
          try {
            await message.delete();
            results.messagesDeleted++;
            
            // Cancel any pending volatile deletion for this message
            this.cancelDeletion(message);
            
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (deleteError) {
            results.errors.push({
              messageId,
              error: deleteError.message,
              code: deleteError.code
            });
            
            // If we get a rate limit error, wait longer
            if (deleteError.code === 429) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        }

        // Update last message ID for next batch
        lastMessageId = messages.last()?.id;
        
        // If we got less than the limit, we've reached the end
        if (messages.size < 100) {
          hasMoreMessages = false;
        }
      }

      results.batchesProcessed = batchCount;
      const duration = Date.now() - results.startTime.getTime();
      
      logger.info('Completed DM cleanup for user', {
        userId,
        messagesDeleted: results.messagesDeleted,
        errorCount: results.errors.length,
        batchesProcessed: batchCount,
        durationMs: duration
      });

      return {
        ...results,
        duration
      };
      
    } catch (error) {
      logger.error('Failed to clear user DMs:', error);
      results.errors.push({ global: true, error: error.message });
      return results;
    }
  }

  /**
   * DEBUG FUNCTION: Delete all DMs sent by the bot
   * This function attempts to delete recent DMs from the bot in all accessible DM channels
   * @param {Client} client - Discord client instance
   * @param {number} hoursBack - How many hours back to search for messages (default: 24)
   * @returns {Promise<Object>} - Results of the deletion operation
   */
  async debugDeleteAllBotDMs(client, hoursBack = 24) {
    logger.warn('DEBUG: Starting deletion of all bot DMs', { hoursBack });
    
    const results = {
      channelsChecked: 0,
      messagesDeleted: 0,
      errors: [],
      startTime: new Date()
    };

    try {
      // Get all DM channels the bot has access to
      const dmChannels = client.channels.cache.filter(channel => channel.type === 1); // DM channels
      
      logger.info(`DEBUG: Found ${dmChannels.size} DM channels to check`);
      
      for (const [channelId, channel] of dmChannels) {
        try {
          results.channelsChecked++;
          
          // Fetch recent messages from this DM channel
          const fetchOptions = { limit: 100 };
          const cutoffTime = this.getSnowflakeFromHoursAgo(hoursBack);
          if (cutoffTime && cutoffTime !== null) {
            fetchOptions.after = cutoffTime;
          }
          
          const messages = await channel.messages.fetch(fetchOptions);
          
          // Filter messages sent by the bot
          const botMessages = messages.filter(msg => msg.author.id === client.user.id);
          
          logger.debug(`DEBUG: Found ${botMessages.size} bot messages in DM with ${channel.recipient?.username}`, {
            channelId,
            recipientId: channel.recipient?.id
          });

          // Delete each bot message
          for (const [messageId, message] of botMessages) {
            try {
              await message.delete();
              results.messagesDeleted++;
              
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (deleteError) {
              results.errors.push({
                channelId,
                messageId,
                error: deleteError.message,
                recipient: channel.recipient?.username
              });
            }
          }
          
        } catch (channelError) {
          results.errors.push({
            channelId,
            error: channelError.message,
            recipient: channel.recipient?.username
          });
        }
      }

      const duration = Date.now() - results.startTime.getTime();
      
      logger.warn('DEBUG: Completed bot DM deletion', {
        channelsChecked: results.channelsChecked,
        messagesDeleted: results.messagesDeleted,
        errorCount: results.errors.length,
        durationMs: duration
      });

      return results;
      
    } catch (error) {
      logger.error('DEBUG: Failed to delete bot DMs', error);
      results.errors.push({ global: true, error: error.message });
      return results;
    }
  }

  /**
   * Helper function to get Discord snowflake from hours ago
   * @param {number} hoursAgo - Hours back from now
   * @returns {string|null} - Discord snowflake ID or null if invalid
   */
  getSnowflakeFromHoursAgo(hoursAgo) {
    const msAgo = hoursAgo * 60 * 60 * 1000;
    const timestamp = Date.now() - msAgo;
    
    // Discord epoch (January 1, 2015)
    const discordEpoch = 1420070400000;
    
    // Don't try to create snowflakes for timestamps before Discord existed
    if (timestamp < discordEpoch) {
      logger.debug('Timestamp is before Discord epoch, returning null', {
        timestamp,
        discordEpoch,
        hoursAgo
      });
      return null;
    }
    
    // Calculate snowflake using BigInt to avoid overflow issues
    const timeSinceEpoch = BigInt(timestamp - discordEpoch);
    const snowflake = (timeSinceEpoch << BigInt(22)).toString();
    
    // Validate the snowflake is positive
    if (snowflake.startsWith('-')) {
      logger.warn('Generated negative snowflake, returning null', {
        timestamp,
        hoursAgo,
        snowflake
      });
      return null;
    }
    
    logger.debug('Generated snowflake for timestamp', {
      hoursAgo,
      timestamp,
      snowflake
    });
    
    return snowflake;
  }
}

// Create singleton instance
const volatileDMManager = new VolatileDMManager();

module.exports = volatileDMManager;