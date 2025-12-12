import BaseCommand from '../BaseCommand.js';
import { PermissionFlagsBits } from 'discord.js';
import { info, error as _error } from '../../utils/logger.js';

class RefreshCommandsCommand extends BaseCommand {
  constructor() {
    super('refresh-commands', 'Force refresh all slash commands (Admin only)', {
      category: 'admin',
      adminOnly: true,
      permissions: [PermissionFlagsBits.Administrator]
    });
  }

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const { REST, Routes } = require('discord.js');
      const config = require('../../config');

      const rest = new REST().setToken(config.discord.token);

      // Just clear commands - don't try to re-register while bot is running
      info('Clearing all commands...');

      // Clear global commands
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });

      // Clear guild commands if in development
      if (process.env.DEV_GUILD_ID && process.env.DEV_GUILD_ID !== 'your_test_server_guild_id_here') {
        await rest.put(
          Routes.applicationGuildCommands(config.discord.clientId, process.env.DEV_GUILD_ID),
          { body: [] }
        );
      }

      await interaction.editReply({
        content: `✅ Successfully cleared all slash commands!\n\n**Next steps:**\n• Restart the bot to re-register commands\n• Commands will be registered automatically on startup\n\n**Note:** It may take 1-2 minutes for Discord to update after restart.`
      });

    } catch (error) {
      _error('Failed to refresh commands:', error);
      await interaction.editReply({
        content: `❌ Failed to clear commands: ${error.message}`
      });
    }
  }
}

export default RefreshCommandsCommand;