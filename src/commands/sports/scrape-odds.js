const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');

class ScrapeOddsCommand extends BaseCommand {
  constructor() {
    super('scrape-odds', 'Manually trigger odds scraping for testing');
    
    this.data.addStringOption(option =>
      option.setName('sport')
        .setDescription('Sport to scrape (optional - scrapes all if not specified)')
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
      // Check permissions
      if (!interaction.member.permissions.has('ManageChannels')) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Permission Denied')
          .setDescription('You need the "Manage Channels" permission to use this command.')
          .setColor(0xFF0000);

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

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

      // Show initial status
      const initialEmbed = new EmbedBuilder()
        .setTitle('🔄 Scraping Odds...')
        .setDescription(sport ? `Scraping ${sport.toUpperCase()} odds...` : 'Scraping all sports...')
        .setColor(0xFFFF00)
        .setTimestamp();

      await interaction.editReply({ embeds: [initialEmbed] });

      // Perform scraping
      const startTime = Date.now();
      const results = await oddsTracker.manualScrape(sport);
      const duration = Date.now() - startTime;

      // Build results embed
      const resultsEmbed = new EmbedBuilder()
        .setTitle('✅ Odds Scraping Complete')
        .setColor(0x00FF00)
        .setTimestamp();

      if (sport) {
        // Single sport results
        const result = results[sport];
        resultsEmbed.setDescription(`**${sport.toUpperCase()}** odds scraping completed in ${duration}ms`);
        
        resultsEmbed.addFields(
          {
            name: '📊 Results',
            value: [
              `**Snapshots Saved:** ${result.snapshots}`,
              `**Line Movements:** ${result.movements.length}`,
              `**Duration:** ${duration}ms`
            ].join('\n'),
            inline: true
          }
        );

        // Show movements if any
        if (result.movements.length > 0) {
          const movementText = result.movements.slice(0, 5).map(movement => {
            const gameId = movement.gameId.replace(/_/g, ' ').toUpperCase();
            return `**${gameId}:** ${movement.significantMovements} significant moves`;
          }).join('\n');

          resultsEmbed.addFields({
            name: '📈 Line Movements Detected',
            value: movementText,
            inline: false
          });
        }

      } else {
        // All sports results
        const totalSnapshots = results.totalSnapshots || 0;
        const successCount = results.success?.length || 0;
        const failedCount = results.failed?.length || 0;

        resultsEmbed.setDescription(`All sports scraping completed in ${duration}ms`);
        
        resultsEmbed.addFields(
          {
            name: '📊 Overall Results',
            value: [
              `**Total Snapshots:** ${totalSnapshots}`,
              `**Successful Sports:** ${successCount}`,
              `**Failed Sports:** ${failedCount}`,
              `**Duration:** ${duration}ms`
            ].join('\n'),
            inline: true
          }
        );

        // Show successful sports
        if (results.success && results.success.length > 0) {
          const successText = results.success.map(s => 
            `**${s.sport.toUpperCase()}:** ${s.snapshots} snapshots, ${s.movements.length} movements`
          ).join('\n');

          resultsEmbed.addFields({
            name: '✅ Successful Sports',
            value: successText,
            inline: false
          });
        }

        // Show failed sports
        if (results.failed && results.failed.length > 0) {
          const failedText = results.failed.map(f => 
            `**${f.sport.toUpperCase()}:** ${f.error}`
          ).join('\n');

          resultsEmbed.addFields({
            name: '❌ Failed Sports',
            value: failedText.length > 1024 ? failedText.substring(0, 1021) + '...' : failedText,
            inline: false
          });
        }
      }

      resultsEmbed.setFooter({ 
        text: 'Use /odds-status to view detailed statistics' 
      });

      await interaction.editReply({ embeds: [resultsEmbed] });

    } catch (error) {
      console.error('Error in scrape-odds command:', error);
      
      const embed = new EmbedBuilder()
        .setTitle('❌ Scraping Failed')
        .setDescription(`Failed to scrape odds: ${error.message}`)
        .setColor(0xFF0000)
        .setTimestamp();

      // Add troubleshooting info for common errors
      if (error.message.includes('403') || error.message.includes('blocked')) {
        embed.addFields({
          name: '🚫 Access Blocked',
          value: [
            'ActionNetwork is blocking requests.',
            'This is common for betting sites.',
            '',
            '**Possible solutions:**',
            '• Use a VPN or proxy service',
            '• Implement browser automation',
            '• Use a paid odds API service'
          ].join('\n'),
          inline: false
        });
      }

      if (interaction.deferred) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
}

module.exports = ScrapeOddsCommand;