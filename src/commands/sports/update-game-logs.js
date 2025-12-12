const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const GameLogManager = require('../../modules/sports/GameLogManager');
const logger = require('../../utils/logger');

class UpdateGameLogsCommand extends BaseCommand {
  constructor() {
    super('update-game-logs', 'Update daily game schedules for all sports channels', {
      category: 'sports',
      guildOnly: true,
      cooldown: 30 // 30 second cooldown
    });

    // Add command options AFTER super() call
    this.data
      .addStringOption(option =>
        option.setName('sport')
          .setDescription('Update specific sport only (optional)')
          .setRequired(false)
          .addChoices(
            { name: 'NFL', value: 'nfl' },
            { name: 'NBA', value: 'nba' },
            { name: 'NHL', value: 'nhl' },
            { name: 'NCAA Basketball', value: 'ncaa_basketball' },
            { name: 'NCAA Football', value: 'ncaa_football' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

    this.gameLogManager = null;
  }

  async execute(interaction) {
    try {
      // Initialize game log manager if needed
      if (!this.gameLogManager) {
        this.gameLogManager = new GameLogManager(interaction.client);
        await this.gameLogManager.initialize();
      }

      // Send initial response
      await interaction.reply({
        content: '🔄 Updating game schedules...',
        ephemeral: true
      });

      const sport = interaction.options.getString('sport');
      const guild = interaction.guild;

      // Get current status before update
      const statusBefore = await this.gameLogManager.getGameLogStatus(guild);

      // Perform the update
      logger.info('Starting manual update from command', {
        guildId: guild.id,
        sport: sport || 'all',
        userId: interaction.user.id
      });
      
      await this.gameLogManager.manualUpdate(guild, sport);
      
      logger.info('Manual update completed from command', {
        guildId: guild.id,
        sport: sport || 'all',
        userId: interaction.user.id
      });

      // Get status after update
      const statusAfter = await this.gameLogManager.getGameLogStatus(guild);

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Game Logs Updated Successfully')
        .setTimestamp();

      if (sport) {
        const sportName = this.getSportDisplayName(sport);
        embed.setDescription(`Updated ${sportName} game schedule`);
        
        const sportStatus = statusAfter.sports[sport];
        embed.addFields(
          { 
            name: '📊 Sport Status', 
            value: `**${sportName}**\n` +
                   `Channel: ${sportStatus.hasChannel ? `<#${sportStatus.channelId}>` : '❌ Not found'}\n` +
                   `API Queries: ${sportStatus.canQuery ? '✅ Available' : '❌ Limit reached'}`,
            inline: false 
          }
        );
      } else {
        embed.setDescription('Updated all sport game schedules');
        
        const sportsInfo = Object.entries(statusAfter.sports)
          .map(([sportKey, status]) => {
            const name = this.getSportDisplayName(sportKey);
            const channel = status.hasChannel ? '✅' : '❌';
            const queries = status.canQuery ? '✅' : '❌';
            return `**${name}**: ${channel} Channel, ${queries} Queries`;
          })
          .join('\n');

        embed.addFields(
          { 
            name: '📊 Sports Status', 
            value: sportsInfo,
            inline: false 
          }
        );
      }

      // Add query status summary
      const queryStatus = statusAfter.queryStatus;
      const queryInfo = Object.entries(queryStatus)
        .map(([sportKey, status]) => {
          const name = this.getSportDisplayName(sportKey);
          return `**${name}**: ${status.scheduleQueries}/${status.limit} schedule, ${status.oddsQueries}/${status.limit} odds`;
        })
        .join('\n');

      embed.addFields(
        { 
          name: '📈 Daily Query Usage', 
          value: queryInfo,
          inline: false 
        }
      );

      await interaction.editReply({
        content: null,
        embeds: [embed]
      });

      this.logUsage(interaction, 'completed', { 
        sport: sport || 'all',
        guildId: guild.id
      });

    } catch (error) {
      logger.error('Failed to update game logs:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Update Game Logs')
        .setDescription(error.message)
        .setTimestamp();

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [errorEmbed] });
        } else {
          await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } catch (replyError) {
        logger.error('Failed to send error response:', replyError);
      }

      this.logUsage(interaction, 'failed', { error: error.message });
    }
  }

  /**
   * Get display name for sport
   * @param {string} sport - Sport key
   * @returns {string} - Display name
   */
  getSportDisplayName(sport) {
    const displayNames = {
      'nfl': 'NFL',
      'nba': 'NBA',
      'nhl': 'NHL',
      'ncaa_basketball': 'NCAA Basketball',
      'ncaa_football': 'NCAA Football'
    };
    
    return displayNames[sport] || sport.toUpperCase();
  }
}

module.exports = UpdateGameLogsCommand;