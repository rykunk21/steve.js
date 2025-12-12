const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const BaseCommand = require('../BaseCommand');
const BettingRecommendationEngine = require('../../modules/sports/BettingRecommendationEngine');
const BettingThreadManager = require('../../modules/sports/BettingThreadManager');
const ESPNAPIClient = require('../../modules/sports/ESPNAPIClient');
const TeamRepository = require('../../database/repositories/TeamRepository');
const VAEFeedbackTrainer = require('../../modules/sports/VAEFeedbackTrainer');
const VariationalAutoencoder = require('../../modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('../../modules/sports/TransitionProbabilityNN');
const logger = require('../../utils/logger');

/**
 * Generate betting recommendations using VAE-NN system
 * Implements task 4.3: Generate betting recommendations with VAE-NN
 */
class GenerateBettingRecommendationsCommand extends BaseCommand {
  constructor() {
    super();
    this.name = 'generate-betting-recommendations';
    this.description = 'Generate betting recommendations using VAE-NN enhanced MCMC simulation';
    this.category = 'sports';
    
    // Initialize components
    this.espnClient = new ESPNAPIClient();
    this.teamRepository = new TeamRepository();
    this.bettingThreadManager = new BettingThreadManager();
    this.recommendationEngine = null; // Will be initialized with VAE-NN system
  }

  /**
   * Build the slash command
   * @returns {SlashCommandBuilder} - Command builder
   */
  buildCommand() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(this.description)
      .addStringOption(option =>
        option.setName('sport')
          .setDescription('Sport to generate recommendations for')
          .setRequired(false)
          .addChoices(
            { name: 'NCAA Basketball', value: 'ncaa_basketball' },
            { name: 'NBA', value: 'nba' },
            { name: 'NFL', value: 'nfl' },
            { name: 'NHL', value: 'nhl' },
            { name: 'NCAA Football', value: 'ncaa_football' }
          ))
      .addBooleanOption(option =>
        option.setName('create_threads')
          .setDescription('Create betting threads for games with recommendations')
          .setRequired(false))
      .addBooleanOption(option =>
        option.setName('vae_nn_only')
          .setDescription('Only show VAE-NN enhanced recommendations (skip fallback methods)')
          .setRequired(false))
      .addIntegerOption(option =>
        option.setName('max_games')
          .setDescription('Maximum number of games to process (default: 10)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(25));
  }

  /**
   * Execute the command
   * @param {CommandInteraction} interaction - Discord interaction
   */
  async execute(interaction) {
    const startTime = Date.now();
    
    try {
      // Get command options
      const sport = interaction.options.getString('sport') || 'ncaa_basketball';
      const createThreads = interaction.options.getBoolean('create_threads') || false;
      const vaeNNOnly = interaction.options.getBoolean('vae_nn_only') || false;
      const maxGames = interaction.options.getInteger('max_games') || 10;
      
      // Defer reply for long-running operation
      await interaction.deferReply();
      
      logger.info('Generating betting recommendations via Discord command', {
        userId: interaction.user.id,
        guildId: interaction.guild?.id,
        sport,
        createThreads,
        vaeNNOnly,
        maxGames
      });
      
      // Initialize VAE-NN system
      await this.initializeVAENNSystem();
      
      // Fetch today's games
      const todaysGames = await this.espnClient.getTodaysGames(sport);
      
      if (!todaysGames || todaysGames.length === 0) {
        return await interaction.editReply({
          embeds: [this.createNoGamesEmbed(sport)]
        });
      }
      
      // Limit games to process
      const gamesToProcess = todaysGames.slice(0, maxGames);
      
      // Update user on progress
      await interaction.editReply({
        embeds: [this.createProcessingEmbed(sport, gamesToProcess.length)]
      });
      
      // Generate recommendations
      const recommendations = await this.generateRecommendations(gamesToProcess, vaeNNOnly);
      
      // Filter successful recommendations
      const successfulRecs = recommendations.filter(r => !r.recommendation.error);
      const vaeNNRecs = successfulRecs.filter(r => r.recommendation.method === 'VAE-NN');
      
      // Create betting threads if requested
      let threadsCreated = 0;
      if (createThreads && interaction.guild) {
        threadsCreated = await this.createBettingThreads(interaction.guild, successfulRecs, sport);
      }
      
      const totalDuration = Date.now() - startTime;
      
      // Send results
      const resultEmbeds = this.createResultEmbeds(recommendations, {
        sport,
        totalGames: gamesToProcess.length,
        successfulRecs: successfulRecs.length,
        vaeNNRecs: vaeNNRecs.length,
        threadsCreated,
        totalDurationMs: totalDuration,
        vaeNNOnly
      });
      
      await interaction.editReply({
        embeds: resultEmbeds,
        components: this.createActionButtons(recommendations, createThreads)
      });
      
      logger.info('Betting recommendations command completed', {
        userId: interaction.user.id,
        sport,
        totalGames: gamesToProcess.length,
        successfulRecs: successfulRecs.length,
        vaeNNRecs: vaeNNRecs.length,
        threadsCreated,
        durationMs: totalDuration
      });
      
    } catch (error) {
      logger.error('Failed to generate betting recommendations', {
        userId: interaction.user.id,
        error: error.message,
        stack: error.stack
      });
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Error Generating Recommendations')
        .setDescription(`Failed to generate betting recommendations: ${error.message}`)
        .setColor(0xFF0000)
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [errorEmbed]
      });
    }
  }

  /**
   * Initialize VAE-NN system for enhanced predictions
   */
  async initializeVAENNSystem() {
    try {
      if (this.recommendationEngine) {
        return; // Already initialized
      }
      
      logger.info('Initializing VAE-NN system for betting recommendations');
      
      // Initialize VAE
      const vae = new VariationalAutoencoder(80, 16); // inputDim, latentDim
      
      // Initialize Transition Probability NN
      const transitionNN = new TransitionProbabilityNN(10); // gameContextDim
      
      // Initialize VAE-NN feedback trainer
      const vaeNNSystem = new VAEFeedbackTrainer(vae, transitionNN, {
        feedbackThreshold: 0.5,
        initialAlpha: 0.1,
        alphaDecayRate: 0.99
      });
      
      // Initialize recommendation engine with VAE-NN system
      this.recommendationEngine = new BettingRecommendationEngine({
        vaeNNSystem: vaeNNSystem,
        teamRepository: this.teamRepository,
        espnClient: this.espnClient,
        preferVAENN: true,
        includeUncertaintyMetrics: true,
        iterations: 10000
      });
      
      logger.info('VAE-NN system initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize VAE-NN system', {
        error: error.message
      });
      throw new Error(`VAE-NN initialization failed: ${error.message}`);
    }
  }

  /**
   * Generate recommendations for games
   * @param {Array} games - Games to process
   * @param {boolean} vaeNNOnly - Only return VAE-NN recommendations
   * @returns {Promise<Array>} - Array of recommendations
   */
  async generateRecommendations(games, vaeNNOnly = false) {
    const recommendations = [];
    
    for (const game of games) {
      try {
        // Format game data
        const gameData = {
          id: game.id,
          sport: game.sport,
          date: new Date(game.date),
          neutralSite: game.neutralSite || false,
          teams: {
            home: {
              id: game.teams?.home?.id,
              name: game.teams?.home?.name,
              abbreviation: game.teams?.home?.abbreviation,
              logo: game.teams?.home?.logo
            },
            away: {
              id: game.teams?.away?.id,
              name: game.teams?.away?.name,
              abbreviation: game.teams?.away?.abbreviation,
              logo: game.teams?.away?.logo
            }
          },
          venue: game.venue
        };
        
        // Use default betting odds (real odds integration would be here)
        const bettingOdds = this.getDefaultBettingOdds();
        
        // Generate recommendation
        const recommendation = await this.recommendationEngine.generateRecommendation(gameData, bettingOdds);
        
        // Skip non-VAE-NN recommendations if requested
        if (vaeNNOnly && recommendation.method !== 'VAE-NN') {
          continue;
        }
        
        recommendations.push({
          gameId: game.id,
          matchup: `${gameData.teams.away.abbreviation} @ ${gameData.teams.home.abbreviation}`,
          gameTime: game.date,
          venue: game.venue,
          recommendation: recommendation
        });
        
      } catch (error) {
        logger.error(`Failed to generate recommendation for game ${game.id}`, {
          error: error.message
        });
        
        if (!vaeNNOnly) {
          recommendations.push({
            gameId: game.id,
            matchup: `${game.teams?.away?.abbreviation || 'TBD'} @ ${game.teams?.home?.abbreviation || 'TBD'}`,
            gameTime: game.date,
            recommendation: {
              pick: 'Error generating recommendation',
              reasoning: error.message,
              method: 'Error',
              error: true
            }
          });
        }
      }
    }
    
    return recommendations;
  }

  /**
   * Create betting threads for games with recommendations
   * @param {Guild} guild - Discord guild
   * @param {Array} recommendations - Successful recommendations
   * @param {string} sport - Sport key
   * @returns {Promise<number>} - Number of threads created
   */
  async createBettingThreads(guild, recommendations, sport) {
    let threadsCreated = 0;
    
    for (const rec of recommendations) {
      try {
        // Check if thread already exists
        if (this.bettingThreadManager.hasThread(sport, rec.gameId)) {
          continue;
        }
        
        // Create betting thread
        const thread = await this.bettingThreadManager.createBettingThread(
          guild,
          sport,
          rec.gameId,
          { skipRecommendation: false } // Include recommendation in thread
        );
        
        if (thread) {
          threadsCreated++;
          
          // Send VAE-NN specific recommendation to thread
          if (rec.recommendation.method === 'VAE-NN') {
            await this.sendVAENNRecommendationToThread(thread, rec);
          }
        }
        
      } catch (error) {
        logger.error(`Failed to create betting thread for game ${rec.gameId}`, {
          error: error.message
        });
      }
    }
    
    return threadsCreated;
  }

  /**
   * Send VAE-NN specific recommendation to betting thread
   * @param {ThreadChannel} thread - Discord thread
   * @param {Object} recommendation - Recommendation data
   */
  async sendVAENNRecommendationToThread(thread, recommendation) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('🧠 VAE-NN Enhanced Recommendation')
        .setDescription(recommendation.recommendation.reasoning)
        .setColor(0x00FF00)
        .addFields(
          {
            name: '🎯 Recommended Pick',
            value: recommendation.recommendation.pick,
            inline: false
          }
        );
      
      // Add simulation data if available
      if (recommendation.recommendation.simulationData) {
        const simData = recommendation.recommendation.simulationData;
        embed.addFields({
          name: '📊 Simulation Results',
          value: [
            `• Iterations: ${simData.iterations?.toLocaleString() || 'N/A'}`,
            `• Home Win Prob: ${simData.homeWinProb || 'N/A'}`,
            `• Away Win Prob: ${simData.awayWinProb || 'N/A'}`,
            `• Prediction Confidence: ${simData.predictionConfidence || 'N/A'}`
          ].join('\n'),
          inline: true
        });
      }
      
      // Add uncertainty metrics if available
      if (recommendation.recommendation.uncertaintyMetrics) {
        const uncertainty = recommendation.recommendation.uncertaintyMetrics;
        embed.addFields({
          name: '🎲 Team Uncertainty',
          value: [
            `• ${uncertainty.homeTeam.name}: ${uncertainty.homeTeam.uncertainty}`,
            `• ${uncertainty.awayTeam.name}: ${uncertainty.awayTeam.uncertainty}`,
            `• Overall Confidence: ${uncertainty.predictionConfidence}`
          ].join('\n'),
          inline: true
        });
      }
      
      embed.setFooter({
        text: `Data Source: ${recommendation.recommendation.dataSource || 'VAE-NN'} • Generated at ${new Date().toLocaleTimeString()}`
      });
      
      await thread.send({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Failed to send VAE-NN recommendation to thread', {
        threadId: thread.id,
        error: error.message
      });
    }
  }

  /**
   * Create embed for no games found
   * @param {string} sport - Sport key
   * @returns {EmbedBuilder} - No games embed
   */
  createNoGamesEmbed(sport) {
    return new EmbedBuilder()
      .setTitle('📅 No Games Found')
      .setDescription(`No ${sport.replace('_', ' ').toUpperCase()} games scheduled for today.`)
      .setColor(0xFFFF00)
      .setTimestamp();
  }

  /**
   * Create processing embed
   * @param {string} sport - Sport key
   * @param {number} gameCount - Number of games to process
   * @returns {EmbedBuilder} - Processing embed
   */
  createProcessingEmbed(sport, gameCount) {
    return new EmbedBuilder()
      .setTitle('🔄 Generating Recommendations')
      .setDescription(`Processing ${gameCount} ${sport.replace('_', ' ').toUpperCase()} games with VAE-NN enhanced MCMC simulation...`)
      .setColor(0x0099FF)
      .addFields({
        name: '⚡ Processing',
        value: 'Loading team latent distributions and running simulations...',
        inline: false
      })
      .setTimestamp();
  }

  /**
   * Create result embeds
   * @param {Array} recommendations - All recommendations
   * @param {Object} stats - Processing statistics
   * @returns {Array} - Array of embeds
   */
  createResultEmbeds(recommendations, stats) {
    const embeds = [];
    
    // Summary embed
    const summaryEmbed = new EmbedBuilder()
      .setTitle(`🏀 ${stats.sport.replace('_', ' ').toUpperCase()} Betting Recommendations`)
      .setDescription('VAE-NN Enhanced MCMC Simulation Results')
      .setColor(0x00FF00)
      .addFields(
        {
          name: '📊 Summary',
          value: [
            `• Total Games: ${stats.totalGames}`,
            `• Successful Recommendations: ${stats.successfulRecs}`,
            `• VAE-NN Enhanced: ${stats.vaeNNRecs}`,
            `• Processing Time: ${(stats.totalDurationMs / 1000).toFixed(1)}s`
          ].join('\n'),
          inline: true
        }
      );
    
    if (stats.threadsCreated > 0) {
      summaryEmbed.addFields({
        name: '🧵 Threads Created',
        value: `${stats.threadsCreated} betting threads created`,
        inline: true
      });
    }
    
    summaryEmbed.setTimestamp();
    embeds.push(summaryEmbed);
    
    // VAE-NN recommendations
    const vaeNNRecs = recommendations.filter(r => r.recommendation.method === 'VAE-NN');
    if (vaeNNRecs.length > 0) {
      const vaeNNEmbed = new EmbedBuilder()
        .setTitle('🧠 VAE-NN Enhanced Recommendations')
        .setColor(0x00FF00);
      
      vaeNNRecs.slice(0, 5).forEach((rec, index) => {
        const r = rec.recommendation;
        let fieldValue = `**Pick:** ${r.pick}\n`;
        
        if (r.simulationData?.predictionConfidence) {
          fieldValue += `**Confidence:** ${r.simulationData.predictionConfidence}\n`;
        }
        
        if (r.uncertaintyMetrics) {
          fieldValue += `**Team Uncertainty:** ${r.uncertaintyMetrics.predictionConfidence}\n`;
        }
        
        fieldValue += `**Reasoning:** ${r.reasoning.substring(0, 100)}...`;
        
        vaeNNEmbed.addFields({
          name: `${index + 1}. ${rec.matchup}`,
          value: fieldValue,
          inline: false
        });
      });
      
      if (vaeNNRecs.length > 5) {
        vaeNNEmbed.setFooter({
          text: `Showing 5 of ${vaeNNRecs.length} VAE-NN recommendations`
        });
      }
      
      embeds.push(vaeNNEmbed);
    }
    
    // Fallback recommendations (if not VAE-NN only)
    const fallbackRecs = recommendations.filter(r => r.recommendation.method !== 'VAE-NN' && !r.recommendation.error);
    if (fallbackRecs.length > 0 && !stats.vaeNNOnly) {
      const fallbackEmbed = new EmbedBuilder()
        .setTitle('📊 Fallback Recommendations')
        .setColor(0xFFFF00);
      
      fallbackRecs.slice(0, 3).forEach((rec, index) => {
        fallbackEmbed.addFields({
          name: `${index + 1}. ${rec.matchup}`,
          value: `**Pick:** ${rec.recommendation.pick}\n**Method:** ${rec.recommendation.method}`,
          inline: true
        });
      });
      
      embeds.push(fallbackEmbed);
    }
    
    return embeds;
  }

  /**
   * Create action buttons
   * @param {Array} recommendations - Recommendations
   * @param {boolean} threadsCreated - Whether threads were created
   * @returns {Array} - Action rows
   */
  createActionButtons(recommendations, threadsCreated) {
    const components = [];
    
    const actionRow = new ActionRowBuilder();
    
    // Refresh button
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('refresh_recommendations')
        .setLabel('🔄 Refresh')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false)
    );
    
    // Create threads button (if not already created)
    if (!threadsCreated && recommendations.length > 0) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('create_betting_threads')
          .setLabel('🧵 Create Threads')
          .setStyle(ButtonStyle.Success)
          .setDisabled(false)
      );
    }
    
    // Export button
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('export_recommendations')
        .setLabel('📄 Export')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    );
    
    components.push(actionRow);
    
    return components;
  }

  /**
   * Get default betting odds
   * @returns {Object} - Default odds
   */
  getDefaultBettingOdds() {
    return {
      homeMoneyline: -110,
      awayMoneyline: -110,
      spreadLine: 0,
      homeSpreadOdds: -110,
      awaySpreadOdds: -110,
      totalLine: 140,
      overOdds: -110,
      underOdds: -110,
      source: 'default'
    };
  }
}

module.exports = GenerateBettingRecommendationsCommand;