const logger = require('./logger');

class ErrorHandler {
  static async handleDiscordError(error, interaction = null) {
    logger.error('Discord API Error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });

    if (!interaction) return;

    let userMessage = 'An unexpected error occurred. Please try again later.';

    switch (error.code) {
      case 50013: // Missing Permissions
        userMessage = 'I don\'t have permission to perform this action. Please check my role permissions.';
        break;
      case 50001: // Missing Access
        userMessage = 'I don\'t have access to this channel or resource.';
        break;
      case 50035: // Invalid Form Body
        userMessage = 'Invalid input provided. Please check your command parameters.';
        break;
      case 429: // Rate Limited
        userMessage = 'I\'m being rate limited. Please wait a moment and try again.';
        break;
      case 10062: // Unknown Interaction
        // Don't respond to unknown interaction errors
        return;
    }

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: userMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: userMessage, ephemeral: true });
      }
    } catch (followupError) {
      logger.error('Failed to send error message to user:', followupError);
    }
  }

  static async handleDatabaseError(error, context = '') {
    logger.error('Database Error:', {
      context,
      message: error.message,
      stack: error.stack
    });

    // Database-specific error handling can be added here
    // For example, connection retry logic, constraint violation handling, etc.
  }

  static async handleAPIError(error, apiName = 'External API') {
    logger.error(`${apiName} Error:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message,
      url: error.config?.url
    });

    // API-specific error handling
    // Rate limiting, retry logic, fallback mechanisms, etc.
  }

  static setupGlobalErrorHandlers() {
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      // In production, you might want to restart the process
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // In production, you might want to restart the process
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    });
  }
}

module.exports = ErrorHandler;