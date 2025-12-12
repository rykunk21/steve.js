const { EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const logger = require('../../utils/logger');

class ClearMyDMsCommand extends BaseCommand {
  constructor() {
    super('clear-my-dms', 'Clear all DM messages from this bot in your DMs', {
      category: 'general',
      guildOnly: false, // Allow in DMs
      cooldown: 30 // 30 second cooldown to prevent spam
    });

    // Add command options
    this.data
      .addIntegerOption(option =>
        option.setName('hours-back')
          .setDescription('How many hours back to search for messages (default: 168 = 1 week)')
          .setMinValue(1)
          .setMaxValue(8760) // 1 year max
          .setRequired(false)
      );
  }

  async execute(interaction) {
    try {
      // Send initial response
      await interaction.reply({
        content: '🗑️ Starting to clear all bot messages from your DMs...',
        ephemeral: true
      });

      const userId = interaction.user.id;
      const client = interaction.client;
      const hoursBack = interaction.options.getInteger('hours-back') || 168; // Default 1 week

      // Use the volatile DM manager's efficient cleanup method
      const volatileDM = require('../../utils/volatileDM');
      
      // Update progress periodically
      const progressInterval = setInterval(async () => {
        try {
          await interaction.editReply({
            content: `🗑️ Clearing DMs from the past ${hoursBack} hours... This may take a moment...`,
            ephemeral: true
          });
        } catch (error) {
          // Ignore errors updating progress
        }
      }, 5000);

      let results;
      try {
        results = await volatileDM.clearUserDMs(client, userId, hoursBack);
      } finally {
        clearInterval(progressInterval);
      }

      const { messagesDeleted: deletedCount, errors, batchesProcessed: batchCount } = results;
      const errorCount = errors.length;

      // Create result embed
      const resultEmbed = new EmbedBuilder()
        .setColor(deletedCount > 0 ? 0x00FF00 : 0xFFAA00)
        .setTitle('🗑️ DM Cleanup Complete')
        .addFields(
          { name: '✅ Messages Deleted', value: `${deletedCount}`, inline: true },
          { name: '❌ Errors', value: `${errorCount}`, inline: true },
          { name: '📊 Batches Processed', value: `${batchCount}`, inline: true }
        )
        .setTimestamp();

      if (deletedCount === 0) {
        resultEmbed.setDescription(`No bot messages found in your DMs from the past ${hoursBack} hours.`);
      } else {
        resultEmbed.setDescription(`Successfully deleted ${deletedCount} bot messages from your DMs (past ${hoursBack} hours)!`);
      }

      if (errorCount > 0) {
        const errorSummary = errors.slice(0, 3).map(e => `• ${e.error}`).join('\n');
        resultEmbed.addFields({
          name: '⚠️ Error Details',
          value: errorCount > 3 ? `${errorSummary}\n... and ${errorCount - 3} more` : errorSummary,
          inline: false
        });
      }

      await interaction.editReply({
        content: null,
        embeds: [resultEmbed],
        ephemeral: true
      });

      // Log the operation
      this.logUsage(interaction, 'completed', {
        deletedCount,
        errorCount,
        batchesProcessed: batchCount,
        hoursBack
      });

      logger.info('DM cleanup completed for user', {
        userId,
        username: interaction.user.tag,
        deletedCount,
        errorCount,
        batchesProcessed: batchCount
      });

    } catch (error) {
      logger.error('Failed to clear user DMs:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ DM Cleanup Failed')
        .setDescription('An error occurred while trying to clear your DMs. Please try again later.')
        .addFields({
          name: 'Error Details',
          value: error.message || 'Unknown error',
          inline: false
        })
        .setTimestamp();

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [errorEmbed] });
        } else {
          await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } catch (replyError) {
        // If we can't reply, just log the error
        logger.error('Failed to send error response:', replyError);
      }

      this.logUsage(interaction, 'failed', { error: error.message });
    }
  }
}

module.exports = ClearMyDMsCommand;