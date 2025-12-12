const logger = require('../../utils/logger');
const VariationalAutoencoder = require('./VariationalAutoencoder');
const TransitionProbabilityNN = require('./TransitionProbabilityNN');
const VAEFeedbackTrainer = require('./VAEFeedbackTrainer');

/**
 * Monte Carlo Markov Chain simulator for game outcomes
 * Runs thousands of simulations to estimate win probabilities and score distributions
 * Supports VAE-NN generated probabilities with uncertainty propagation
 */
class MCMCSimulator {
  constructor(iterations = 10000, vaeNNSystem = null, teamRepository = null) {
    this.iterations = iterations;
    this.vaeNNSystem = vaeNNSystem; // Complete VAE-NN system (VAEFeedbackTrainer)
    this.teamRepository = teamRepository;
    this.useVAENN = false; // Flag to track data source
    this.uncertaintyPropagation = true; // Enable uncertainty propagation from team distributions
    
    // Initialize VAE-NN system if components provided separately
    if (!this.vaeNNSystem && vaeNNSystem) {
      this.initializeVAENNSystem(vaeNNSystem);
    }
  }

  /**
   * Initialize VAE-NN system from individual components
   * @param {Object} components - VAE-NN system components
   */
  initializeVAENNSystem(components) {
    if (components.vae && components.transitionNN) {
      this.vaeNNSystem = new VAEFeedbackTrainer(components.vae, components.transitionNN, components.options);
      logger.info('Initialized VAE-NN system for MCMC simulator');
    } else if (components.feedbackTrainer) {
      this.vaeNNSystem = components.feedbackTrainer;
      logger.info('Using provided VAE-NN feedback trainer for MCMC simulator');
    }
  }

  /**
   * Run Monte Carlo simulation for a game using VAE-NN system
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Object} gameContext - Game context (neutral site, rest days, etc.)
   * @param {Object} fallbackMatrix - Fallback transition matrix if VAE-NN unavailable
   * @returns {Object} - Simulation results with probabilities and distributions
   */
  async simulateWithVAENN(homeTeamId, awayTeamId, gameContext = {}, fallbackMatrix = null) {
    let transitionMatrix = null;
    let dataSource = 'fallback';
    let uncertaintyMetrics = null;

    try {
      // Attempt to use VAE-NN system
      if (this.vaeNNSystem && this.teamRepository) {
        logger.debug('Attempting to use VAE-NN system for simulation', {
          homeTeamId,
          awayTeamId,
          gameContext
        });

        const vaeNNResult = await this.generateVAENNProbabilities(homeTeamId, awayTeamId, gameContext);
        
        if (vaeNNResult.success) {
          transitionMatrix = vaeNNResult.matrix;
          dataSource = 'vae_nn';
          uncertaintyMetrics = vaeNNResult.uncertaintyMetrics;
          this.useVAENN = true;

          logger.info('Using VAE-NN generated transition probabilities', {
            homeTeamId,
            awayTeamId,
            homeUncertainty: uncertaintyMetrics.homeTeamUncertainty,
            awayUncertainty: uncertaintyMetrics.awayTeamUncertainty,
            predictionConfidence: uncertaintyMetrics.predictionConfidence
          });
        } else {
          throw new Error(vaeNNResult.error);
        }
      } else {
        throw new Error('VAE-NN system not available');
      }
    } catch (error) {
      logger.warn('Failed to use VAE-NN system, falling back to traditional matrix', {
        error: error.message,
        homeTeamId,
        awayTeamId
      });

      if (fallbackMatrix) {
        transitionMatrix = fallbackMatrix;
        dataSource = 'fallback_matrix';
      } else {
        // Generate basic fallback matrix
        transitionMatrix = this.generateFallbackMatrix();
        dataSource = 'fallback_generated';
      }
      this.useVAENN = false;
    }

    // Run simulation with the selected matrix
    const simulationResults = this.simulate(transitionMatrix, gameContext);
    
    // Add VAE-NN specific metadata
    simulationResults.dataSource = dataSource;
    simulationResults.usedVAENN = this.useVAENN;
    simulationResults.uncertaintyMetrics = uncertaintyMetrics;
    
    return simulationResults;
  }

  /**
   * Run Monte Carlo simulation for a game
   * @param {Object} transitionMatrix - Transition matrix from TransitionMatrixBuilder or VAE-NN
   * @param {Object} gameContext - Optional game context for generation
   * @returns {Object} - Simulation results with probabilities and distributions
   */
  simulate(transitionMatrix, gameContext = null) {
    // Use provided transition matrix (may be from VAE-NN or traditional sources)
    let matrix = transitionMatrix;
    let dataSource = transitionMatrix.dataSource || 'traditional';

    const results = {
      homeWins: 0,
      awayWins: 0,
      ties: 0,
      homeScores: [],
      awayScores: [],
      margins: []
    };

    logger.debug('Starting MCMC simulation', {
      iterations: this.iterations,
      sport: matrix.sport,
      possessions: matrix.possessions,
      dataSource
    });

    // Run simulations
    for (let i = 0; i < this.iterations; i++) {
      const outcome = this.simulateGame(matrix);
      
      results.homeScores.push(outcome.homeScore);
      results.awayScores.push(outcome.awayScore);
      results.margins.push(outcome.homeScore - outcome.awayScore);
      
      if (outcome.homeScore > outcome.awayScore) {
        results.homeWins++;
      } else if (outcome.awayScore > outcome.homeScore) {
        results.awayWins++;
      } else {
        results.ties++;
      }
    }

    // Calculate statistics
    const simulationResults = {
      homeWinProb: results.homeWins / this.iterations,
      awayWinProb: results.awayWins / this.iterations,
      tieProb: results.ties / this.iterations,
      avgHomeScore: this.mean(results.homeScores),
      avgAwayScore: this.mean(results.awayScores),
      avgMargin: this.mean(results.margins),
      marginStdDev: this.stdDev(results.margins),
      homeScores: results.homeScores,
      awayScores: results.awayScores,
      margins: results.margins,
      iterations: this.iterations,
      dataSource: dataSource,
      usedVAENN: this.useVAENN || false
    };

    logger.info('MCMC simulation completed', {
      iterations: this.iterations,
      homeWinProb: (simulationResults.homeWinProb * 100).toFixed(1) + '%',
      avgHomeScore: simulationResults.avgHomeScore.toFixed(1),
      avgAwayScore: simulationResults.avgAwayScore.toFixed(1),
      avgMargin: simulationResults.avgMargin.toFixed(1),
      dataSource
    });

    return simulationResults;
  }

  /**
   * Simulate a single game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome with scores
   */
  simulateGame(matrix) {
    const sport = matrix.sport;

    if (sport === 'ncaa_basketball' || sport === 'nba') {
      return this.simulateBasketballGame(matrix);
    } else if (sport === 'nfl' || sport === 'ncaa_football') {
      return this.simulateFootballGame(matrix);
    } else if (sport === 'nhl') {
      return this.simulateHockeyGame(matrix);
    }

    throw new Error(`Unsupported sport for simulation: ${sport}`);
  }

  /**
   * Simulate a basketball game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome
   */
  simulateBasketballGame(matrix) {
    let homeScore = 0;
    let awayScore = 0;

    const possessions = Math.round(matrix.possessions);

    // Simulate each possession
    for (let i = 0; i < possessions; i++) {
      // Home possession
      homeScore += this.simulateBasketballPossession(matrix.home);

      // Away possession  
      awayScore += this.simulateBasketballPossession(matrix.away);
    }

    return { homeScore, awayScore };
  }

  /**
   * Simulate a complete basketball possession with proper offensive rebound handling
   * @param {Object} teamMatrix - Team transition probabilities
   * @returns {number} - Points scored on this possession
   */
  simulateBasketballPossession(teamMatrix) {
    let totalPoints = 0;
    let possessionContinues = true;
    let maxAttempts = 10; // Prevent infinite loops
    let attempts = 0;

    while (possessionContinues && attempts < maxAttempts) {
      attempts++;
      
      // Get transition probabilities (8-dimensional vector or legacy format)
      const transitionProbs = this.getTransitionProbabilities(teamMatrix);
      
      const outcome = this.samplePossessionOutcome(transitionProbs);
      
      switch (outcome) {
        case '2pt_make':
          totalPoints += 2;
          possessionContinues = false;
          break;
          
        case '3pt_make':
          totalPoints += 3;
          possessionContinues = false;
          break;
          
        case 'ft_make':
          totalPoints += 1;
          possessionContinues = false; // Simplified - in reality depends on situation
          break;
          
        case '2pt_miss':
        case '3pt_miss':
        case 'ft_miss':
          possessionContinues = false; // Miss ends possession (defensive rebound assumed)
          break;
          
        case 'oreb':
          // Offensive rebound - possession continues!
          possessionContinues = true;
          break;
          
        case 'turnover':
          possessionContinues = false;
          break;
          
        default:
          possessionContinues = false;
          break;
      }
    }

    return totalPoints;
  }

  /**
   * Get transition probabilities from team matrix (handles both new and legacy formats)
   * @param {Object} teamMatrix - Team matrix data
   * @returns {Array} - 8-dimensional transition probability array
   */
  getTransitionProbabilities(teamMatrix) {
    // Check if we have VAE-NN generated probabilities (8-dimensional array)
    if (teamMatrix.transitionProbs && Array.isArray(teamMatrix.transitionProbs)) {
      return teamMatrix.transitionProbs;
    }
    
    // Check if we have object format from VAE-NN system
    if (teamMatrix['2pt_make'] !== undefined) {
      return [
        teamMatrix['2pt_make'] || 0,
        teamMatrix['2pt_miss'] || 0,
        teamMatrix['3pt_make'] || 0,
        teamMatrix['3pt_miss'] || 0,
        teamMatrix['ft_make'] || 0,
        teamMatrix['ft_miss'] || 0,
        teamMatrix['oreb'] || 0,
        teamMatrix['turnover'] || 0
      ];
    }
    
    // Legacy format - convert to 8-dimensional probabilities
    const twoPointProb = teamMatrix.twoPointProb || 0.3;
    const threePointProb = teamMatrix.threePointProb || 0.2;
    const freeThrowProb = teamMatrix.freeThrowProb || 0.1;
    const turnoverProb = teamMatrix.turnoverProb || 0.15;
    
    // Estimate shooting percentages
    const twoPointPct = teamMatrix.twoPointPct || 0.5;
    const threePointPct = teamMatrix.threePointPct || 0.35;
    const freeThrowPct = teamMatrix.freeThrowPct || 0.75;
    
    // Estimate offensive rebound rate
    const offensiveReboundProb = 0.1; // Typical offensive rebound rate
    
    return [
      twoPointProb * twoPointPct,           // 2pt_make
      twoPointProb * (1 - twoPointPct),     // 2pt_miss
      threePointProb * threePointPct,       // 3pt_make
      threePointProb * (1 - threePointPct), // 3pt_miss
      freeThrowProb * freeThrowPct,         // ft_make
      freeThrowProb * (1 - freeThrowPct),   // ft_miss
      offensiveReboundProb,                 // oreb
      turnoverProb                          // turnover
    ];
  }

  /**
   * Sample a possession outcome from transition probabilities
   * @param {Array} transitionProbs - 8-dimensional probability array
   * @returns {string} - Possession outcome
   */
  samplePossessionOutcome(transitionProbs) {
    const outcomes = [
      '2pt_make', '2pt_miss', '3pt_make', '3pt_miss',
      'ft_make', 'ft_miss', 'oreb', 'turnover'
    ];
    
    const rand = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < transitionProbs.length; i++) {
      cumulative += transitionProbs[i];
      if (rand < cumulative) {
        return outcomes[i];
      }
    }
    
    // Fallback to turnover if probabilities don't sum to 1
    return 'turnover';
  }

  /**
   * Simulate a football game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome
   */
  simulateFootballGame(matrix) {
    let homeScore = 0;
    let awayScore = 0;

    const possessions = Math.round(matrix.possessions);

    // Simulate each possession
    for (let i = 0; i < possessions; i++) {
      // Home possession
      if (Math.random() < matrix.home.scoreProb) {
        homeScore += this.simulateFootballPossessionPoints(matrix.home);
      }

      // Away possession
      if (Math.random() < matrix.away.scoreProb) {
        awayScore += this.simulateFootballPossessionPoints(matrix.away);
      }
    }

    return { homeScore, awayScore };
  }

  /**
   * Simulate points scored on a football possession
   * @param {Object} teamMatrix - Team transition matrix
   * @returns {number} - Points scored (0, 2, 3, 6, or 7)
   */
  simulateFootballPossessionPoints(teamMatrix) {
    const rand = Math.random();

    // Determine scoring type
    if (rand < teamMatrix.touchdownProb) {
      // Touchdown (6 points) + extra point attempt
      const extraPoint = Math.random() < 0.95 ? 1 : 0; // 95% XP success rate
      return 6 + extraPoint;
    } else if (rand < teamMatrix.touchdownProb + teamMatrix.fieldGoalProb) {
      return 3; // Field goal
    } else if (rand < teamMatrix.touchdownProb + teamMatrix.fieldGoalProb + teamMatrix.safetyProb) {
      return 2; // Safety
    }

    return 0; // No score
  }

  /**
   * Simulate a hockey game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome
   */
  simulateHockeyGame(matrix) {
    let homeScore = 0;
    let awayScore = 0;

    const possessions = Math.round(matrix.possessions);

    // Simulate each possession (shot attempt)
    for (let i = 0; i < possessions; i++) {
      // Home possession
      if (Math.random() < matrix.home.scoreProb) {
        homeScore += 1; // Goal
      }

      // Away possession
      if (Math.random() < matrix.away.scoreProb) {
        awayScore += 1; // Goal
      }
    }

    return { homeScore, awayScore };
  }

  /**
   * Calculate mean of an array
   * @param {Array} arr - Array of numbers
   * @returns {number} - Mean value
   */
  mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate standard deviation of an array
   * @param {Array} arr - Array of numbers
   * @returns {number} - Standard deviation
   */
  stdDev(arr) {
    if (arr.length === 0) return 0;
    const avg = this.mean(arr);
    const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  /**
   * Calculate percentile from array
   * @param {Array} arr - Sorted array of numbers
   * @param {number} percentile - Percentile to calculate (0-100)
   * @returns {number} - Percentile value
   */
  percentile(arr, percentile) {
    if (arr.length === 0) return 0;
    
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Generate transition probabilities using VAE-NN system
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Object} gameContext - Game context information
   * @returns {Object} - Result with matrix and uncertainty metrics
   */
  async generateVAENNProbabilities(homeTeamId, awayTeamId, gameContext) {
    try {
      // Load team latent distributions from database
      const homeDistribution = await this.loadTeamDistribution(homeTeamId);
      const awayDistribution = await this.loadTeamDistribution(awayTeamId);

      if (!homeDistribution || !awayDistribution) {
        return {
          success: false,
          error: `Missing team distribution data for ${homeTeamId} or ${awayTeamId}`
        };
      }

      // Build game context features for NN input
      const contextFeatures = this.buildGameContextFeatures(gameContext);

      // Sample from team distributions or use mean vectors
      const homeLatent = this.uncertaintyPropagation 
        ? this.sampleFromDistribution(homeDistribution.mu, homeDistribution.sigma)
        : homeDistribution.mu;
      
      const awayLatent = this.uncertaintyPropagation
        ? this.sampleFromDistribution(awayDistribution.mu, awayDistribution.sigma)
        : awayDistribution.mu;

      // Generate transition probabilities using NN
      const homePrediction = this.vaeNNSystem.transitionNN.predict(
        homeLatent, 
        homeDistribution.sigma,
        awayLatent,
        awayDistribution.sigma,
        contextFeatures
      );

      const awayPrediction = this.vaeNNSystem.transitionNN.predict(
        awayLatent,
        awayDistribution.sigma,
        homeLatent,
        homeDistribution.sigma,
        contextFeatures
      );

      // Calculate uncertainty metrics
      const uncertaintyMetrics = {
        homeTeamUncertainty: this.calculateTeamUncertainty(homeDistribution.sigma),
        awayTeamUncertainty: this.calculateTeamUncertainty(awayDistribution.sigma),
        homeGamesProcessed: homeDistribution.gamesProcessed,
        awayGamesProcessed: awayDistribution.gamesProcessed,
        predictionConfidence: this.calculatePredictionConfidence(homeDistribution.sigma, awayDistribution.sigma),
        homeTeamName: homeDistribution.teamName,
        awayTeamName: awayDistribution.teamName,
        homeLastSeason: homeDistribution.lastSeason,
        awayLastSeason: awayDistribution.lastSeason
      };

      // Create transition matrix
      const matrix = this.createMatrixFromVAENN(homePrediction, awayPrediction, gameContext);

      return {
        success: true,
        matrix,
        uncertaintyMetrics,
        homeDistribution,
        awayDistribution
      };

    } catch (error) {
      logger.error('Failed to generate VAE-NN probabilities', {
        homeTeamId,
        awayTeamId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build game context features for NN input
   * @param {Object} gameContext - Game context information
   * @returns {Array} - Context feature vector (10 dimensions)
   */
  buildGameContextFeatures(gameContext) {
    // Normalize features to [0,1] range for neural network
    return [
      gameContext.isNeutralSite ? 1 : 0,                    // Binary: neutral site
      gameContext.isPostseason ? 1 : 0,                     // Binary: postseason game
      Math.min((gameContext.restDays || 1) / 7, 1),         // Normalized: rest days (0-7+ days)
      Math.min((gameContext.travelDistance || 0) / 3000, 1), // Normalized: travel distance (0-3000+ miles)
      gameContext.isConferenceGame ? 1 : 0,                 // Binary: conference game
      gameContext.isRivalryGame ? 1 : 0,                    // Binary: rivalry game
      gameContext.isTVGame ? 1 : 0,                         // Binary: televised game
      (gameContext.timeOfDay || 12) / 24,                   // Normalized: time of day (0-24 hours)
      (gameContext.dayOfWeek || 3) / 7,                     // Normalized: day of week (0-6)
      Math.min((gameContext.seasonProgress || 0.5), 1)      // Normalized: season progress (0-1)
    ];
  }

  /**
   * Load team latent distributions from database
   * @param {string} teamId - Team ID (ESPN format)
   * @returns {Promise<Object|null>} - Team distribution or null if not found
   */
  async loadTeamDistribution(teamId) {
    try {
      const team = await this.teamRepository.getTeamByEspnId(teamId);
      
      if (!team?.statisticalRepresentation) {
        logger.warn('No statistical representation found for team', { teamId });
        return null;
      }

      const distribution = JSON.parse(team.statisticalRepresentation);
      
      // Validate distribution format
      if (!distribution.mu || !distribution.sigma || 
          !Array.isArray(distribution.mu) || !Array.isArray(distribution.sigma) ||
          distribution.mu.length !== 16 || distribution.sigma.length !== 16) {
        logger.warn('Invalid team distribution format', { 
          teamId, 
          muLength: distribution.mu?.length,
          sigmaLength: distribution.sigma?.length 
        });
        return null;
      }

      return {
        teamId,
        teamName: team.teamName,
        mu: distribution.mu,
        sigma: distribution.sigma,
        gamesProcessed: distribution.games_processed || 0,
        lastSeason: distribution.last_season || '2024-25',
        lastUpdated: team.updatedAt
      };

    } catch (error) {
      logger.error('Failed to load team distribution', {
        teamId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Sample from a multivariate normal distribution
   * @param {Array} mu - Mean vector
   * @param {Array} sigma - Standard deviation vector
   * @returns {Array} - Sampled vector
   */
  sampleFromDistribution(mu, sigma) {
    return mu.map((mean, i) => {
      // Box-Muller transform for normal sampling
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mean + sigma[i] * z;
    });
  }

  /**
   * Calculate team uncertainty metric
   * @param {Array} sigma - Team uncertainty vector
   * @returns {number} - Average uncertainty
   */
  calculateTeamUncertainty(sigma) {
    return sigma.reduce((sum, s) => sum + s, 0) / sigma.length;
  }

  /**
   * Calculate prediction confidence based on team uncertainties
   * @param {Array} homeSigma - Home team uncertainty
   * @param {Array} awaySigma - Away team uncertainty
   * @returns {number} - Confidence score (0-1)
   */
  calculatePredictionConfidence(homeSigma, awaySigma) {
    const homeUncertainty = this.calculateTeamUncertainty(homeSigma);
    const awayUncertainty = this.calculateTeamUncertainty(awaySigma);
    const avgUncertainty = (homeUncertainty + awayUncertainty) / 2;
    
    // Convert uncertainty to confidence (lower uncertainty = higher confidence)
    // Assuming uncertainty typically ranges from 0.1 to 1.0
    return Math.max(0, Math.min(1, 1 - (avgUncertainty - 0.1) / 0.9));
  }

  /**
   * Set VAE-NN system for the simulator
   * @param {Object} vaeNNSystem - VAE-NN system (VAEFeedbackTrainer or components)
   * @param {Object} teamRepository - Team repository for loading distributions
   */
  setVAENNSystem(vaeNNSystem, teamRepository = null) {
    if (vaeNNSystem instanceof VAEFeedbackTrainer) {
      this.vaeNNSystem = vaeNNSystem;
    } else if (vaeNNSystem.vae && vaeNNSystem.transitionNN) {
      this.vaeNNSystem = new VAEFeedbackTrainer(
        vaeNNSystem.vae, 
        vaeNNSystem.transitionNN, 
        vaeNNSystem.options
      );
    } else {
      throw new Error('Invalid VAE-NN system provided');
    }

    if (teamRepository) {
      this.teamRepository = teamRepository;
    }

    logger.info('VAE-NN system set for MCMC simulator', {
      hasVAE: !!this.vaeNNSystem.vae,
      hasTransitionNN: !!this.vaeNNSystem.transitionNN,
      hasTeamRepository: !!this.teamRepository
    });
  }

  /**
   * Generate fallback transition matrix when VAE-NN unavailable
   * @param {Object} gameContext - Optional game context for sport-specific defaults
   * @returns {Object} - Basic transition matrix
   */
  generateFallbackMatrix(gameContext = {}) {
    logger.warn('Generating basic fallback transition matrix', { gameContext });
    
    const sport = gameContext.sport || 'ncaa_basketball';
    
    if (sport === 'ncaa_basketball' || sport === 'nba') {
      // Basic NCAA basketball averages with home court advantage
      return {
        sport,
        possessions: gameContext.possessions || 70,
        dataSource: 'fallback_generated',
        home: {
          transitionProbs: [0.35, 0.25, 0.12, 0.08, 0.08, 0.02, 0.05, 0.05], // Slight home advantage
          scoreProb: 0.55,
          twoPointProb: 0.6,
          threePointProb: 0.2,
          freeThrowProb: 0.1,
          turnoverProb: 0.05
        },
        away: {
          transitionProbs: [0.33, 0.27, 0.10, 0.10, 0.07, 0.03, 0.05, 0.05], // Slightly lower
          scoreProb: 0.50,
          twoPointProb: 0.6,
          threePointProb: 0.2,
          freeThrowProb: 0.1,
          turnoverProb: 0.05
        }
      };
    } else {
      // Generic fallback for other sports
      return {
        sport,
        possessions: gameContext.possessions || 100,
        dataSource: 'fallback_generated',
        home: {
          transitionProbs: [0.3, 0.3, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05],
          scoreProb: 0.5
        },
        away: {
          transitionProbs: [0.3, 0.3, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05],
          scoreProb: 0.45
        }
      };
    }
  }

  /**
   * Create transition matrix from VAE-NN predictions
   * @param {Object} homeTeamPredictions - Home team transition probabilities from NN
   * @param {Object} awayTeamPredictions - Away team transition probabilities from NN
   * @param {Object} gameContext - Game context information
   * @returns {Object} - Transition matrix compatible with MCMC simulator
   */
  createMatrixFromVAENN(homeTeamPredictions, awayTeamPredictions, gameContext = {}) {
    // Convert NN predictions to the format expected by MCMC simulator
    const homeTransitionProbs = Array.isArray(homeTeamPredictions) 
      ? homeTeamPredictions 
      : [
          homeTeamPredictions['2pt_make'] || 0,
          homeTeamPredictions['2pt_miss'] || 0,
          homeTeamPredictions['3pt_make'] || 0,
          homeTeamPredictions['3pt_miss'] || 0,
          homeTeamPredictions['ft_make'] || 0,
          homeTeamPredictions['ft_miss'] || 0,
          homeTeamPredictions['oreb'] || 0,
          homeTeamPredictions['turnover'] || 0
        ];

    const awayTransitionProbs = Array.isArray(awayTeamPredictions)
      ? awayTeamPredictions
      : [
          awayTeamPredictions['2pt_make'] || 0,
          awayTeamPredictions['2pt_miss'] || 0,
          awayTeamPredictions['3pt_make'] || 0,
          awayTeamPredictions['3pt_miss'] || 0,
          awayTeamPredictions['ft_make'] || 0,
          awayTeamPredictions['ft_miss'] || 0,
          awayTeamPredictions['oreb'] || 0,
          awayTeamPredictions['turnover'] || 0
        ];

    return {
      sport: 'ncaa_basketball',
      possessions: gameContext.possessions || 70,
      dataSource: 'vae_nn_generated',
      home: {
        transitionProbs: homeTransitionProbs,
        // Legacy compatibility
        scoreProb: homeTransitionProbs[0] + homeTransitionProbs[2] + homeTransitionProbs[4], // makes
        twoPointProb: homeTransitionProbs[0] + homeTransitionProbs[1],
        threePointProb: homeTransitionProbs[2] + homeTransitionProbs[3],
        freeThrowProb: homeTransitionProbs[4] + homeTransitionProbs[5],
        turnoverProb: homeTransitionProbs[7]
      },
      away: {
        transitionProbs: awayTransitionProbs,
        // Legacy compatibility
        scoreProb: awayTransitionProbs[0] + awayTransitionProbs[2] + awayTransitionProbs[4], // makes
        twoPointProb: awayTransitionProbs[0] + awayTransitionProbs[1],
        threePointProb: awayTransitionProbs[2] + awayTransitionProbs[3],
        freeThrowProb: awayTransitionProbs[4] + awayTransitionProbs[5],
        turnoverProb: awayTransitionProbs[7]
      }
    };
  }

  /**
   * Check if VAE-NN system is available and ready for use
   * @returns {Object} - Availability status and details
   */
  checkVAENNAvailability() {
    const status = {
      available: false,
      hasVAENN: !!this.vaeNNSystem,
      hasTeamRepository: !!this.teamRepository,
      hasVAE: false,
      hasTransitionNN: false,
      details: []
    };

    if (!this.vaeNNSystem) {
      status.details.push('VAE-NN system not initialized');
      return status;
    }

    if (!this.teamRepository) {
      status.details.push('Team repository not available');
      return status;
    }

    status.hasVAE = !!this.vaeNNSystem.vae;
    status.hasTransitionNN = !!this.vaeNNSystem.transitionNN;

    if (!status.hasVAE) {
      status.details.push('VAE component missing');
    }

    if (!status.hasTransitionNN) {
      status.details.push('TransitionNN component missing');
    }

    status.available = status.hasVAE && status.hasTransitionNN;

    if (status.available) {
      status.details.push('VAE-NN system ready for predictions');
    }

    return status;
  }

  /**
   * Get simulation configuration and status
   * @returns {Object} - Configuration details
   */
  getConfiguration() {
    const vaeNNStatus = this.checkVAENNAvailability();
    
    return {
      iterations: this.iterations,
      uncertaintyPropagation: this.uncertaintyPropagation,
      vaeNNSystem: vaeNNStatus,
      capabilities: {
        traditionalSimulation: true,
        vaeNNSimulation: vaeNNStatus.available,
        uncertaintyQuantification: vaeNNStatus.available && this.uncertaintyPropagation,
        fallbackSupport: true
      }
    };
  }

  /**
   * Dispose of resources (mainly for TensorFlow.js cleanup)
   */
  dispose() {
    if (this.vaeNNSystem?.vae?.dispose) {
      this.vaeNNSystem.vae.dispose();
    }
    
    if (this.vaeNNSystem?.transitionNN?.model?.dispose) {
      this.vaeNNSystem.transitionNN.model.dispose();
    }
    
    logger.debug('Disposed MCMC simulator resources');
  }
}

module.exports = MCMCSimulator;
