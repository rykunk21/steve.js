const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');

class OddsStatusCommand extends BaseCommand {
  constructor() {
    super('odds-status', 'Check betting odds tracking status and statistics');
    
    this.data.addStringOption(option =>
      option.setName('sport')
        .setDescription('Specific sport to check (optional)')
        .setRequired(false)
        .addChoices(
          { name: 'NFL', value: 'nfl' },
          { name: 'NBA', value: 'nba' },
          { name: 'NHL', value: 'nhl' },
          { name: 'NCAA Basketball', value: 'ncaa_basketball' },
          { name: 'NCAA Football', value: 'ncaa_football' }
        )
    );
  }

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const sport = interaction.options.getString('sport');
      
      // Get odds tracker from bot instance
      const oddsTracker = interaction.client.oddsTracker;
      
      if (!oddsTracker || !oddsTracker.isInitialized) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Odds Tracking Unavailable')
          .setDescription('Odds tracking system is not initialized.')
          .setColor(0xFF0000)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sport) {
        // Show specific sport status
        await this.showSportStatus(interaction, oddsTracker, sport);
      } else {
        // Show overall status
        await this.showOverallStatus(interaction, oddsTracker);
      }

    } catch (error) {
      console.error('Error in odds-status command:', error);
      
      const embed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription('Failed to retrieve odds tracking status.')
        .setColor(0xFF0000)
        .setTimestamp();

      if (interaction.deferred) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }

  async showSportStatus(interaction, oddsTracker, sport) {
    try {
      const stats = await oddsTracker.getTrackingStats(sport, 7);
      const recentMovements = await oddsTracker.getRecentMovements(sport, 24);
      
      const embed = new EmbedBuilder()
        .setTitle(`📊 ${sport.toUpperCase()} Odds Tracking Status`)
        .setColor(0x0099FF)
        .setTimestamp();

      // Basic stats
      embed.addFields(
        {
          name: '📈 7-Day Statistics',
          value: [
            `**Total Snapshots:** ${stats.totalSnapshots}`,
            `**Unique Games:** ${stats.uniqueGames}`,
            `**Average Spread:** ${stats.averageSpread?.toFixed(1) || 'N/A'}`,
            `**Average Total:** ${stats.averageTotal?.toFixed(1) || 'N/A'}`
          ].join('\n'),
          inline: true
        },
        {
          name: '🔄 Recent Activity',
          value: [
            `**Line Movements (24h):** ${recentMovements.length}`,
            `**Significant Moves:** ${recentMovements.filter(m => m.significantMovements > 0).length}`,
            `**Last Update:** ${stats.latestSnapshot ? new Date(stats.latestSnapshot).toLocaleString() : 'Never'}`
          ].join('\n'),
          inline: true
        }
      );

      // Show recent movements if any
      if (recentMovements.length > 0) {
        const movementText = recentMovements.slice(0, 5).map(movement => {
          const gameId = movement.gameId.replace(/_/g, ' ').toUpperCase();
          const moveCount = movement.movements.length;
          const sigCount = movement.significantMovements;
          return `**${gameId}:** ${moveCount} moves (${sigCount} significant)`;
        }).join('\n');

        embed.addFields({
          name: '📊 Recent Line Movements',
          value: movementText || 'No recent movements',
          inline: false
        });
      }

      embed.setFooter({ 
        text: `Tracking ${stats.supportedSports.length} sports • ${stats.scrapingSchedules} daily updates` 
      });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      throw error;
    }
  }

  async showOverallStatus(interaction, oddsTracker) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('🎯 Odds Tracking System Status')
        .setColor(0x00FF00)
        .setTimestamp();

      // System status
      embed.addFields({
        name: '⚡ System Status',
        value: [
          `**Status:** ${oddsTracker.isInitialized ? '🟢 Active' : '🔴 Inactive'}`,
          `**Supported Sports:** ${oddsTracker.supportedSports.length}`,
          `**Daily Scrapes:** ${Object.keys(oddsTracker.scrapingSchedules).length}`,
          `**Scheduled Jobs:** ${oddsTracker.scheduledJobs.size}`
        ].join('\n'),
        inline: true
      });

      // Sports list
      const sportsText = oddsTracker.supportedSports.map(sport => {
        const displayName = {
          'nfl': 'NFL',
          'nba': 'NBA', 
          'nhl': 'NHL',
          'ncaa_basketball': 'NCAA Basketball',
          'ncaa_football': 'NCAA Football'
        }[sport] || sport.toUpperCase();
        return `• ${displayName}`;
      }).join('\n');

      embed.addFields({
        name: '🏈 Tracked Sports',
        value: sportsText,
        inline: true
      });

      // Scraping schedule
      const scheduleText = Object.entries(oddsTracker.scrapingSchedules).map(([name, cron]) => {
        const time = {
          'morning': '8:00 AM',
          'midday': '12:00 PM', 
          'afternoon': '4:00 PM',
          'evening': '8:00 PM',
          'night': '11:00 PM'
        }[name] || cron;
        return `• ${time}`;
      }).join('\n');

      embed.addFields({
        name: '⏰ Scraping Schedule',
        value: scheduleText,
        inline: false
      });

      embed.setFooter({ 
        text: 'Use /odds-status <sport> for detailed sport statistics' 
      });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      throw error;
    }
  }
}

module.exports = OddsStatusCommand;