const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const GameLogManager = require('../../modules/sports/GameLogManager');
const logger = require('../../utils/logger');

class GameLogStatusCommand extends BaseCommand {
  constructor() {
    super('game-log-status', 'Check the status of sports game logs and channels', {
      category: 'sports',
      guildOnly: true,
      cooldown: 10 // 10 second cooldown
    });

    // Set permissions AFTER super() call
    this.data.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
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
        content: '📊 Checking game log status...',
        ephemeral: true
      });

      const guild = interaction.guild;
      const status = await this.gameLogManager.getGameLogStatus(guild);

      // Create status embed
      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📊 Game Log Status')
        .setDescription(`Status for **${guild.name}**`)
        .setTimestamp();

      // Add sports channels status
      const sportsStatus = Object.entries(status.sports)
        .map(([sportKey, sportStatus]) => {
          const name = this.getSportDisplayName(sportKey);
          const channelStatus = sportStatus.hasChannel ? 
            `✅ <#${sportStatus.channelId}>` : 
            '❌ No channel';
          const queryStatus = sportStatus.canQuery ? '✅ Available' : '❌ Limit reached';
          
          return `**${name}**\n` +
                 `└ Channel: ${channelStatus}\n` +
                 `└ Queries: ${queryStatus}`;
        })
        .join('\n\n');

      embed.addFields(
        { 
          name: '🏈 Sports Channels', 
          value: sportsStatus,
          inline: false 
        }
      );

      // Add daily query usage
      const queryUsage = Object.entries(status.queryStatus)
        .map(([sportKey, queryStatus]) => {
          const name = this.getSportDisplayName(sportKey);
          const scheduleUsage = `${queryStatus.scheduleQueries}/${queryStatus.limit}`;
          const oddsUsage = `${queryStatus.oddsQueries}/${queryStatus.limit}`;
          
          return `**${name}**: Schedule ${scheduleUsage}, Odds ${oddsUsage}`;
        })
        .join('\n');

      embed.addFields(
        { 
          name: '📈 Daily API Usage', 
          value: queryUsage,
          inline: false 
        }
      );

      // Add summary statistics
      const totalChannels = Object.values(status.sports).filter(s => s.hasChannel).length;
      const totalSports = Object.keys(status.sports).length;
      const availableQueries = Object.values(status.queryStatus).filter(s => s.canQuerySchedule).length;

      embed.addFields(
        { 
          name: '📋 Summary', 
          value: `**Channels**: ${totalChannels}/${totalSports} configured\n` +
                 `**API Access**: ${availableQueries}/${totalSports} sports available\n` +
                 `**Auto Updates**: ${this.gameLogManager.isInitialized ? '✅ Active' : '❌ Inactive'}`,
          inline: false 
        }
      );

      // Add helpful information
      embed.addFields(
        { 
          name: '💡 Information', 
          value: '• Game logs update automatically at 8 AM EST daily\n' +
                 '• Use `/update-game-logs` to manually refresh\n' +
                 '• Missing channels will be created automatically\n' +
                 '• API limits reset daily at midnight EST',
          inline: false 
        }
      );

      await interaction.editReply({
        content: null,
        embeds: [embed]
      });

      this.logUsage(interaction, 'completed', { 
        guildId: guild.id,
        channelsConfigured: totalChannels,
        availableQueries
      });

    } catch (error) {
      logger.error('Failed to get game log status:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Get Status')
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

module.exports = GameLogStatusCommand;