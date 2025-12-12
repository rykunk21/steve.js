const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

/**
 * Base class for all Discord slash commands
 * Provides common functionality and structure for command implementations
 */
class BaseCommand {
  constructor(name, description, options = {}) {
    this.name = name;
    this.description = description;
    this.options = {
      category: options.category || 'general',
      permissions: options.permissions || [],
      cooldown: options.cooldown || 3, // seconds
      guildOnly: options.guildOnly !== false, // default true
      adminOnly: options.adminOnly || false,
      ...options
    };

    // Build the slash command data
    this.data = new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(this.description);

    // Set default member permissions if specified
    if (this.options.permissions.length > 0) {
      // Convert permission flags to BigInt if needed
      const permissions = this.options.permissions.reduce((acc, perm) => {
        return acc | (typeof perm === 'bigint' ? perm : BigInt(perm));
      }, 0n);
      this.data.setDefaultMemberPermissions(permissions);
    }

    // Set guild-only if specified
    if (this.options.guildOnly) {
      this.data.setDMPermission(false);
    }

    // Initialize cooldown tracking
    this.cooldowns = new Map();
  }

  /**
   * Execute the command - must be implemented by subclasses
   * @param {CommandInteraction} interaction - The Discord interaction
   */
  async execute(interaction) {
    throw new Error(`Execute method must be implemented by ${this.constructor.name}`);
  }

  /**
   * Handle autocomplete interactions - optional override
   * @param {AutocompleteInteraction} interaction - The Discord autocomplete interaction
   */
  async autocomplete(interaction) {
    // Default implementation - no autocomplete
    await interaction.respond([]);
  }

  /**
   * Check if user has permission to use this command
   * @param {CommandInteraction} interaction - The Discord interaction
   * @returns {boolean} - Whether the user can use this command
   */
  async checkPermissions(interaction) {
    // Check if command is admin-only
    if (this.options.adminOnly) {
      const member = interaction.member;
      if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'This command requires administrator permissions.',
          ephemeral: true
        });
        return false;
      }
    }

    // Check guild-only restriction
    if (this.options.guildOnly && !interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true
      });
      return false;
    }

    // Check custom permissions
    if (this.options.permissions.length > 0 && interaction.member) {
      const hasPermission = this.options.permissions.every(permission =>
        interaction.member.permissions.has(permission)
      );

      if (!hasPermission) {
        await interaction.reply({
          content: 'You don\'t have the required permissions to use this command.',
          ephemeral: true
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Check and handle command cooldown
   * @param {CommandInteraction} interaction - The Discord interaction
   * @returns {boolean} - Whether the command can be executed (not on cooldown)
   */
  async checkCooldown(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();
    const cooldownAmount = this.options.cooldown * 1000;

    if (this.cooldowns.has(userId)) {
      const expirationTime = this.cooldowns.get(userId) + cooldownAmount;

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        await interaction.reply({
          content: `Please wait ${timeLeft.toFixed(1)} more seconds before using this command again.`,
          ephemeral: true
        });
        return false;
      }
    }

    this.cooldowns.set(userId, now);

    // Clean up expired cooldowns
    setTimeout(() => {
      this.cooldowns.delete(userId);
    }, cooldownAmount);

    return true;
  }

  /**
   * Validate command execution prerequisites
   * @param {CommandInteraction} interaction - The Discord interaction
   * @returns {boolean} - Whether the command can be executed
   */
  async validate(interaction) {
    // Check permissions
    if (!(await this.checkPermissions(interaction))) {
      return false;
    }

    // Check cooldown
    if (!(await this.checkCooldown(interaction))) {
      return false;
    }

    return true;
  }

  /**
   * Log command usage for analytics and debugging
   * @param {CommandInteraction} interaction - The Discord interaction
   * @param {string} status - Execution status (success, error, etc.)
   * @param {Object} metadata - Additional metadata to log
   */
  logUsage(interaction, status = 'executed', metadata = {}) {
    logger.info(`Command ${this.name} ${status}`, {
      command: this.name,
      user: interaction.user.tag,
      userId: interaction.user.id,
      guild: interaction.guild?.name || 'DM',
      guildId: interaction.guild?.id || null,
      channel: interaction.channel?.name || 'Unknown',
      channelId: interaction.channel?.id || null,
      status,
      ...metadata
    });
  }
}

module.exports = BaseCommand;