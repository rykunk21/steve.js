const logger = require('../../utils/logger');
const FeatureExtractor = require('./FeatureExtractor');
const GameRepresentationBuilder = require('./GameRepresentationBuilder');
const TransitionProbabilityComputer = require('./TransitionProbabilityComputer');
const TransitionMatrixMLP = require('./TransitionMatrixMLP');

/**
 * Trains the MLP model on historical game data
 * Implements batch training with train/validation/test splits
 */
class ModelTrainer {
  constructor(historicalGameRepository, xmlGameParser) {
    this.historicalGameRepo = historicalGameRepository;
    this.xmlGameParser = xmlGameParser;
    
    // Initialize components
    this.featureExtractor = new FeatureExtractor();
    this.gameRepBuilder = new GameRepresentationBuilder(this.featureExtractor);
    this.transitionComputer = new TransitionProbabilityComputer();
    
    // Training configuration
    this.config = {
      batchSize: 64,
      epochs: 100,
      learningRate: 0.001,
      validationSplit: 0.15,
      testSplit: 0.15,
      earlyStoppingPatience: 10,
      learningRateDecay: 0.95,
      minLearningRate: 0.0001
    };

    // Training state
    this.trainingHistory = {
      trainLoss: [],
      validationLoss: [],
      epochs: 0
    };
  }

  /**
   * Train model on historical games
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   * @param {Object} options - Training options
   * @returns {Promise<Object>} - Training results
   */
  async train(sport, season, options = {}) {
    logger.info('Starting model training', { sport, season });

    // Merge options with defaults
    const config = { ...this.config, ...options };

    // Load historical games with play-by-play data
    const games = await this.loadTrainingData(sport, season);
    
    if (games.length === 0) {
      throw new Error('No training data available');
    }

    logger.info('Loaded training data', {
      totalGames: games.length,
      sport,
      season
    });

    // Build training dataset
    const dataset = await this.buildDataset(games);
    
    if (dataset.length === 0) {
      throw new Error('Failed to build training dataset');
    }

    logger.info('Built training dataset', {
      samples: dataset.length
    });

    // Split into train/validation/test
    const splits = this.splitDataset(dataset, config.validationSplit, config.testSplit);
    
    logger.info('Split dataset', {
      train: splits.train.length,
      validation: splits.validation.length,
      test: splits.test.length
    });

    // Initialize model
    const model = new TransitionMatrixMLP(
      this.gameRepBuilder.getDimension(),
      16 // Output dimension (transition probabilities)
    );

    // Train model
    const results = await this.trainModel(model, splits, config);

    // Save model
    await this.saveModel(model, sport, season);

    logger.info('Training completed', {
      epochs: results.epochs,
      finalTrainLoss: results.trainLoss.toFixed(4),
      finalValidationLoss: results.validationLoss.toFixed(4),
      testLoss: results.testLoss.toFixed(4)
    });

    return results;
  }

  /**
   * Load historical games with play-by-play data
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   * @returns {Promise<Array>} - Array of games
   */
  async loadTrainingData(sport, season) {
    // Get all games for the season
    const games = await this.historicalGameRepo.getSeasonGames(sport, season);
    
    // Filter for games with play-by-play data
    const gamesWithPlayByPlay = games.filter(game => game.hasPlayByPlay);

    logger.info('Filtered games with play-by-play', {
      total: games.length,
      withPlayByPlay: gamesWithPlayByPlay.length
    });

    return gamesWithPlayByPlay;
  }

  /**
   * Build training dataset from games
   * @param {Array} games - Historical games
   * @returns {Promise<Array>} - Training examples
   */
  async buildDataset(games) {
    const dataset = [];

    for (const game of games) {
      try {
        // Get team game histories (up to this game)
        const homeGames = await this.historicalGameRepo.getTeamGameHistory(
          game.homeTeamId,
          game.season,
          20
        );
        
        const awayGames = await this.historicalGameRepo.getTeamGameHistory(
          game.awayTeamId,
          game.season,
          20
        );

        // Filter to only include games before this one
        const homeHistory = homeGames.filter(g => 
          new Date(g.gameDate) < new Date(game.gameDate)
        );
        
        const awayHistory = awayGames.filter(g => 
          new Date(g.gameDate) < new Date(game.gameDate)
        );

        // Skip if insufficient history
        if (homeHistory.length < 5 || awayHistory.length < 5) {
          continue;
        }

        // Build game representation
        const representation = await this.gameRepBuilder.buildFromTeamHistory(
          game.homeTeamId,
          game.awayTeamId,
          homeHistory,
          awayHistory,
          {
            gameDate: game.gameDate,
            isNeutralSite: game.isNeutralSite,
            seasonStartDate: new Date(game.season, 10, 1) // November 1st
          }
        );

        // Parse game XML to get actual transition probabilities
        // Note: In production, this would load from stored XML data
        // For now, we'll compute from box score statistics
        const actualProbs = this.computeActualProbabilities(game);

        dataset.push({
          input: representation,
          target: actualProbs
        });

      } catch (error) {
        logger.warn('Failed to build training example', {
          gameId: game.id,
          error: error.message
        });
      }
    }

    return dataset;
  }

  /**
   * Compute actual transition probabilities from game statistics
   * @param {Object} game - Game object
   * @returns {Array} - Target probability vector
   */
  computeActualProbabilities(game) {
    // This is a simplified version that uses box score statistics
    // In production, this would use XMLGameParser output
    
    // Estimate probabilities from final scores and statistics
    const homeProbs = this.estimateTeamProbabilities(game, true);
    const awayProbs = this.estimateTeamProbabilities(game, false);

    return [...homeProbs, ...awayProbs];
  }

  /**
   * Estimate team probabilities from game statistics
   * @param {Object} game - Game object
   * @param {boolean} isHome - Whether team is home
   * @returns {Array} - Probability vector (8 dims)
   */
  estimateTeamProbabilities(game, isHome) {
    const score = isHome ? game.homeScore : game.awayScore;
    const fgPct = isHome ? game.homeFieldGoalPct : game.awayFieldGoalPct;
    const ftPct = isHome ? game.homeFreeThrowPct : game.awayFreeThrowPct;
    const turnovers = isHome ? game.homeTurnovers : game.awayTurnovers;

    // Estimate possessions (simplified)
    const possessions = 70; // Average NCAA basketball possessions

    // Estimate probabilities
    const scoreProb = Math.min(0.95, Math.max(0.05, (fgPct || 0.45) * 1.1));
    const twoPointProb = 0.60;
    const threePointProb = 0.30;
    const freeThrowProb = 0.10;
    const turnoverProb = Math.min(0.40, Math.max(0.05, (turnovers || 10) / possessions));
    const reboundProb = 0.30;
    const freeThrowPct = ftPct || 0.75;
    const expectedPoints = score / possessions;

    return [
      scoreProb,
      twoPointProb,
      threePointProb,
      freeThrowProb,
      turnoverProb,
      reboundProb,
      freeThrowPct,
      expectedPoints / 2 // Normalize to roughly [0, 1]
    ];
  }

  /**
   * Split dataset into train/validation/test sets
   * @param {Array} dataset - Complete dataset
   * @param {number} validationSplit - Validation split ratio
   * @param {number} testSplit - Test split ratio
   * @returns {Object} - Split datasets
   */
  splitDataset(dataset, validationSplit, testSplit) {
    // Shuffle dataset
    const shuffled = [...dataset].sort(() => Math.random() - 0.5);

    const totalSize = shuffled.length;
    const testSize = Math.floor(totalSize * testSplit);
    const validationSize = Math.floor(totalSize * validationSplit);
    const trainSize = totalSize - testSize - validationSize;

    return {
      train: shuffled.slice(0, trainSize),
      validation: shuffled.slice(trainSize, trainSize + validationSize),
      test: shuffled.slice(trainSize + validationSize)
    };
  }

  /**
   * Train the model
   * @param {TransitionMatrixMLP} model - MLP model
   * @param {Object} splits - Dataset splits
   * @param {Object} config - Training configuration
   * @returns {Promise<Object>} - Training results
   */
  async trainModel(model, splits, config) {
    let bestValidationLoss = Infinity;
    let patienceCounter = 0;
    let currentLearningRate = config.learningRate;

    const trainLossHistory = [];
    const validationLossHistory = [];

    for (let epoch = 0; epoch < config.epochs; epoch++) {
      // Train on batches
      const trainLoss = await this.trainEpoch(
        model,
        splits.train,
        config.batchSize,
        currentLearningRate
      );

      // Validate
      const validationLoss = this.validateModel(model, splits.validation);

      trainLossHistory.push(trainLoss);
      validationLossHistory.push(validationLoss);

      logger.info('Epoch completed', {
        epoch: epoch + 1,
        trainLoss: trainLoss.toFixed(4),
        validationLoss: validationLoss.toFixed(4),
        learningRate: currentLearningRate.toFixed(6)
      });

      // Early stopping check
      if (validationLoss < bestValidationLoss) {
        bestValidationLoss = validationLoss;
        patienceCounter = 0;
      } else {
        patienceCounter++;
        
        if (patienceCounter >= config.earlyStoppingPatience) {
          logger.info('Early stopping triggered', {
            epoch: epoch + 1,
            patience: patienceCounter
          });
          break;
        }
      }

      // Learning rate decay
      currentLearningRate = Math.max(
        config.minLearningRate,
        currentLearningRate * config.learningRateDecay
      );
    }

    // Evaluate on test set
    const testLoss = this.validateModel(model, splits.test);

    return {
      epochs: trainLossHistory.length,
      trainLoss: trainLossHistory[trainLossHistory.length - 1],
      validationLoss: validationLossHistory[validationLossHistory.length - 1],
      testLoss,
      trainLossHistory,
      validationLossHistory
    };
  }

  /**
   * Train for one epoch
   * @param {TransitionMatrixMLP} model - MLP model
   * @param {Array} trainData - Training data
   * @param {number} batchSize - Batch size
   * @param {number} learningRate - Learning rate
   * @returns {Promise<number>} - Average loss
   */
  async trainEpoch(model, trainData, batchSize, learningRate) {
    // Shuffle training data
    const shuffled = [...trainData].sort(() => Math.random() - 0.5);

    let totalLoss = 0;
    let batchCount = 0;

    // Train in batches
    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      
      const inputs = batch.map(ex => ex.input);
      const targets = batch.map(ex => ex.target);

      const batchLoss = model.trainBatch(inputs, targets);
      totalLoss += batchLoss;
      batchCount++;
    }

    return totalLoss / batchCount;
  }

  /**
   * Validate model on dataset
   * @param {TransitionMatrixMLP} model - MLP model
   * @param {Array} validationData - Validation data
   * @returns {number} - Average loss
   */
  validateModel(model, validationData) {
    let totalLoss = 0;

    for (const example of validationData) {
      const predicted = model.forward(example.input);
      const loss = model.computeLoss(predicted, example.target);
      totalLoss += loss;
    }

    return totalLoss / validationData.length;
  }

  /**
   * Save trained model
   * @param {TransitionMatrixMLP} model - Trained model
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   */
  async saveModel(model, sport, season) {
    const filepath = `data/models/transition_mlp_${sport}_${season}.json`;
    await model.saveToFile(filepath);
    logger.info('Saved trained model', { filepath });
  }

  /**
   * Load trained model
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   * @returns {Promise<TransitionMatrixMLP>} - Loaded model
   */
  async loadModel(sport, season) {
    const filepath = `data/models/transition_mlp_${sport}_${season}.json`;
    const model = new TransitionMatrixMLP();
    await model.loadFromFile(filepath);
    logger.info('Loaded trained model', { filepath });
    return model;
  }
}

module.exports = ModelTrainer;
