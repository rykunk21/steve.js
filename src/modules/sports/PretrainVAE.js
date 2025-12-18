const InfoNCEVAE = require('./InfoNCEVAE');
const VAEFeatureExtractor = require('./VAEFeatureExtractor');
const GameIdsRepository = require('../../database/repositories/GameIdsRepository');
const connection = require('../../database/connection');
const logger = require('../../utils/logger');

/**
 * VAE Pretraining Pipeline with InfoNCE
 * 
 * Orchestrates the one-time pretraining of the VAE encoder using InfoNCE objective.
 * After pretraining, the encoder weights are frozen permanently to preserve
 * the learned discriminative structure.
 * 
 * Pipeline:
 * 1. Load games with extracted transition probability labels
 * 2. Extract normalized game features for each team
 * 3. Train VAE with InfoNCE contrastive learning
 * 4. Validate that latent representations are predictive
 * 5. Save frozen encoder weights to database
 */
class PretrainVAE {
  constructor(config = {}) {
    // Training configuration
    this.config = {
      inputDim: config.inputDim || 80,
      latentDim: config.latentDim || 16,
      temperature: config.temperature || 0.1,
      lambdaInfoNCE: config.lambdaInfoNCE || 1.0,
      numNegatives: config.numNegatives || 64,
      batchSize: config.batchSize || 32,
      maxEpochs: config.maxEpochs || 100,
      convergenceThreshold: config.convergenceThreshold || 1e-4,
      validationSplit: config.validationSplit || 0.2,
      earlyStoppingPatience: config.earlyStoppingPatience || 10,
      sport: config.sport || 'mens-college-basketball',
      ...config
    };

    // Components
    this.vae = null;
    this.featureExtractor = new VAEFeatureExtractor();
    this.gameIdsRepository = new GameIdsRepository();
    
    // Training state
    this.trainingHistory = [];
    this.bestValidationLoss = Infinity;
    this.patienceCounter = 0;
    this.isConverged = false;

    logger.info('Initialized VAE pretraining pipeline', this.config);
  }

  /**
   * Run complete pretraining pipeline
   * @returns {Promise<Object>} - Training results and model state
   */
  async runPretraining() {
    try {
      logger.info('Starting VAE pretraining with InfoNCE');

      // Step 1: Load and prepare training data
      const trainingData = await this.loadTrainingData();
      logger.info('Loaded training data', {
        totalGames: trainingData.length,
        sport: this.config.sport
      });

      // Step 2: Split into training and validation sets
      const { trainSet, validationSet } = this.splitData(trainingData);
      logger.info('Split data for training', {
        trainSize: trainSet.length,
        validationSize: validationSet.length
      });

      // Step 3: Initialize VAE
      this.vae = new InfoNCEVAE(
        this.config.inputDim,
        this.config.latentDim,
        this.config.temperature
      );
      
      this.vae.setInfoNCEParams({
        lambdaInfoNCE: this.config.lambdaInfoNCE,
        numNegatives: this.config.numNegatives
      });

      // Step 4: Run training loop
      const trainingResults = await this.trainModel(trainSet, validationSet);

      // Step 5: Validate final model
      const validationResults = await this.validateModel(validationSet);

      // Step 6: Save trained model
      const modelId = await this.saveTrainedModel();

      const results = {
        success: true,
        modelId,
        trainingResults,
        validationResults,
        config: this.config,
        trainingHistory: this.trainingHistory
      };

      logger.info('VAE pretraining completed successfully', {
        epochs: trainingResults.epochs,
        finalLoss: trainingResults.finalLoss,
        modelId
      });

      return results;

    } catch (error) {
      logger.error('VAE pretraining failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Load training data from database
   * @returns {Promise<Array>} - Array of training samples
   */
  async loadTrainingData() {
    try {
      // Get all games with extracted transition probability labels
      const games = await this.gameIdsRepository.getGamesWithLabels(this.config.sport);
      
      if (games.length === 0) {
        throw new Error(`No games with labels found for sport: ${this.config.sport}`);
      }

      const trainingData = [];

      for (const game of games) {
        try {
          // Extract features for both home and away teams
          const homeFeatures = await this.extractGameFeatures(game.gameId, 'home');
          const awayFeatures = await this.extractGameFeatures(game.gameId, 'away');

          if (homeFeatures && awayFeatures) {
            trainingData.push({
              gameId: game.gameId,
              teamType: 'home',
              features: homeFeatures,
              hasLabels: true
            });

            trainingData.push({
              gameId: game.gameId,
              teamType: 'away',
              features: awayFeatures,
              hasLabels: true
            });
          }

        } catch (error) {
          logger.warn('Failed to extract features for game', {
            gameId: game.gameId,
            error: error.message
          });
        }
      }

      if (trainingData.length === 0) {
        throw new Error('No valid training samples extracted');
      }

      return trainingData;

    } catch (error) {
      logger.error('Failed to load training data', {
        sport: this.config.sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Extract normalized game features for a team
   * @param {string} gameId - Game ID
   * @param {string} teamType - 'home' or 'away'
   * @returns {Promise<Array|null>} - Normalized feature vector or null
   */
  async extractGameFeatures(gameId, teamType) {
    try {
      // This would normally fetch XML from StatBroadcast and extract features
      // For now, return mock normalized features for testing
      // TODO: Integrate with actual XMLGameParser and HistoricalGameFetcher
      
      const mockFeatures = new Array(this.config.inputDim)
        .fill(0)
        .map(() => Math.random()); // Random features in [0,1] range

      return mockFeatures;

    } catch (error) {
      logger.warn('Failed to extract game features', {
        gameId,
        teamType,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Split data into training and validation sets
   * @param {Array} data - Complete dataset
   * @returns {Object} - {trainSet, validationSet}
   */
  splitData(data) {
    // Shuffle data
    const shuffled = [...data].sort(() => Math.random() - 0.5);
    
    const validationSize = Math.floor(data.length * this.config.validationSplit);
    const trainSize = data.length - validationSize;

    return {
      trainSet: shuffled.slice(0, trainSize),
      validationSet: shuffled.slice(trainSize)
    };
  }

  /**
   * Train the VAE model with InfoNCE
   * @param {Array} trainSet - Training data
   * @param {Array} validationSet - Validation data
   * @returns {Promise<Object>} - Training results
   */
  async trainModel(trainSet, validationSet) {
    logger.info('Starting VAE training loop', {
      trainSize: trainSet.length,
      validationSize: validationSet.length,
      maxEpochs: this.config.maxEpochs
    });

    let epoch = 0;
    let bestLoss = Infinity;

    for (epoch = 0; epoch < this.config.maxEpochs; epoch++) {
      // Training phase
      const trainLoss = await this.trainEpoch(trainSet, epoch);
      
      // Validation phase
      const validationLoss = await this.validateEpoch(validationSet, epoch);

      // Record history
      const epochStats = {
        epoch,
        trainLoss,
        validationLoss,
        timestamp: new Date().toISOString()
      };
      this.trainingHistory.push(epochStats);

      // Check for improvement
      if (validationLoss < this.bestValidationLoss) {
        this.bestValidationLoss = validationLoss;
        this.patienceCounter = 0;
        bestLoss = validationLoss;
        
        logger.info('New best validation loss', {
          epoch,
          validationLoss: validationLoss.toFixed(6),
          trainLoss: trainLoss.toFixed(6)
        });
      } else {
        this.patienceCounter++;
      }

      // Early stopping check
      if (this.patienceCounter >= this.config.earlyStoppingPatience) {
        logger.info('Early stopping triggered', {
          epoch,
          patience: this.patienceCounter,
          bestValidationLoss: this.bestValidationLoss
        });
        break;
      }

      // Convergence check
      if (epoch > 0) {
        const prevLoss = this.trainingHistory[epoch - 1].validationLoss;
        const lossChange = Math.abs(validationLoss - prevLoss);
        
        if (lossChange < this.config.convergenceThreshold) {
          logger.info('Convergence achieved', {
            epoch,
            lossChange: lossChange.toFixed(8),
            threshold: this.config.convergenceThreshold
          });
          this.isConverged = true;
          break;
        }
      }

      // Log progress every 10 epochs
      if (epoch % 10 === 0 || epoch === this.config.maxEpochs - 1) {
        logger.info('Training progress', {
          epoch,
          trainLoss: trainLoss.toFixed(6),
          validationLoss: validationLoss.toFixed(6),
          bestLoss: this.bestValidationLoss.toFixed(6),
          patience: this.patienceCounter
        });
      }
    }

    return {
      epochs: epoch + 1,
      finalLoss: bestLoss,
      converged: this.isConverged,
      bestValidationLoss: this.bestValidationLoss,
      trainingHistory: this.trainingHistory
    };
  }

  /**
   * Train for one epoch
   * @param {Array} trainSet - Training data
   * @param {number} epoch - Current epoch number
   * @returns {Promise<number>} - Average training loss
   */
  async trainEpoch(trainSet, epoch) {
    const batchLosses = [];
    
    // Shuffle training data
    const shuffled = [...trainSet].sort(() => Math.random() - 0.5);
    
    // Process in batches
    for (let i = 0; i < shuffled.length; i += this.config.batchSize) {
      const batch = shuffled.slice(i, i + this.config.batchSize);
      
      try {
        const batchResult = await this.vae.trainBatchWithInfoNCE(batch, this.config.sport);
        batchLosses.push(batchResult.totalLoss);
      } catch (error) {
        logger.warn('Batch training failed', {
          epoch,
          batchIndex: Math.floor(i / this.config.batchSize),
          error: error.message
        });
      }
    }

    if (batchLosses.length === 0) {
      throw new Error(`No successful batches in epoch ${epoch}`);
    }

    return batchLosses.reduce((sum, loss) => sum + loss, 0) / batchLosses.length;
  }

  /**
   * Validate for one epoch
   * @param {Array} validationSet - Validation data
   * @param {number} epoch - Current epoch number
   * @returns {Promise<number>} - Average validation loss
   */
  async validateEpoch(validationSet, epoch) {
    const validationLosses = [];
    
    // Process validation set (no gradient updates)
    for (const sample of validationSet) {
      try {
        // Forward pass only for validation
        const result = await this.computeValidationLoss(sample);
        validationLosses.push(result.totalLoss);
      } catch (error) {
        logger.warn('Validation sample failed', {
          epoch,
          gameId: sample.gameId,
          teamType: sample.teamType,
          error: error.message
        });
      }
    }

    if (validationLosses.length === 0) {
      throw new Error(`No successful validation samples in epoch ${epoch}`);
    }

    return validationLosses.reduce((sum, loss) => sum + loss, 0) / validationLosses.length;
  }

  /**
   * Compute validation loss for a single sample (no gradient updates)
   * @param {Object} sample - Validation sample
   * @returns {Promise<Object>} - Loss information
   */
  async computeValidationLoss(sample) {
    try {
      // Sample contrastive pairs
      const { positive, negatives } = await this.vae.dataSampler.sampleContrastivePair(
        sample.gameId, this.config.numNegatives, this.config.sport
      );

      const positiveLabel = sample.teamType === 'home' ? positive.home : positive.away;
      
      if (!positiveLabel) {
        throw new Error(`No ${sample.teamType} transition probabilities for game ${sample.gameId}`);
      }

      // Forward pass without gradients
      const tf = require('@tensorflow/tfjs');
      const inputTensor = tf.tensor2d([sample.features], [1, this.config.inputDim]);
      const positiveTensor = tf.tensor2d([positiveLabel], [1, 8]);
      const negativesTensor = tf.tensor2d(negatives, [negatives.length, 8]);

      try {
        const { reconstruction, mu, logVar, z } = this.vae.forward(inputTensor);
        const lossInfo = this.vae.computeCombinedLoss(
          inputTensor, reconstruction, mu, logVar, z, positiveTensor, negativesTensor
        );

        const result = {
          totalLoss: lossInfo.totalLoss.dataSync()[0],
          reconstructionLoss: lossInfo.reconstructionLoss.dataSync()[0],
          klLoss: lossInfo.klLoss.dataSync()[0],
          vaeLoss: lossInfo.vaeLoss.dataSync()[0],
          infoNCELoss: lossInfo.infoNCELoss.dataSync()[0]
        };

        // Clean up
        inputTensor.dispose();
        positiveTensor.dispose();
        negativesTensor.dispose();
        reconstruction.dispose();
        mu.dispose();
        logVar.dispose();
        z.dispose();
        lossInfo.totalLoss.dispose();
        lossInfo.reconstructionLoss.dispose();
        lossInfo.klLoss.dispose();
        lossInfo.vaeLoss.dispose();
        lossInfo.infoNCELoss.dispose();

        return result;

      } finally {
        // Ensure cleanup even if error occurs
        if (!inputTensor.isDisposed) inputTensor.dispose();
        if (!positiveTensor.isDisposed) positiveTensor.dispose();
        if (!negativesTensor.isDisposed) negativesTensor.dispose();
      }

    } catch (error) {
      logger.warn('Validation loss computation failed', {
        gameId: sample.gameId,
        teamType: sample.teamType,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate that the trained model produces predictive representations
   * @param {Array} validationSet - Validation data
   * @returns {Promise<Object>} - Validation metrics
   */
  async validateModel(validationSet) {
    logger.info('Validating trained model predictiveness');

    const predictions = [];
    const actuals = [];

    for (const sample of validationSet.slice(0, 100)) { // Sample subset for validation
      try {
        // Get latent representation
        const tf = require('@tensorflow/tfjs');
        const inputTensor = tf.tensor2d([sample.features], [1, this.config.inputDim]);
        const { mu } = this.vae.encode(inputTensor);
        const latentRep = Array.from(mu.dataSync());

        // Get actual transition probabilities
        const { positive } = await this.vae.dataSampler.sampleContrastivePair(
          sample.gameId, 1, this.config.sport
        );
        const actualProbs = sample.teamType === 'home' ? positive.home : positive.away;

        if (actualProbs) {
          predictions.push(latentRep);
          actuals.push(actualProbs);
        }

        inputTensor.dispose();
        mu.dispose();

      } catch (error) {
        logger.warn('Model validation sample failed', {
          gameId: sample.gameId,
          error: error.message
        });
      }
    }

    // Compute validation metrics
    const metrics = this.computeValidationMetrics(predictions, actuals);
    
    logger.info('Model validation completed', {
      samplesValidated: predictions.length,
      ...metrics
    });

    return metrics;
  }

  /**
   * Compute validation metrics for predictiveness
   * @param {Array} predictions - Latent representations
   * @param {Array} actuals - Actual transition probabilities
   * @returns {Object} - Validation metrics
   */
  computeValidationMetrics(predictions, actuals) {
    if (predictions.length === 0) {
      return { error: 'No valid predictions for validation' };
    }

    // Simple correlation analysis between latent dimensions and transition probabilities
    const correlations = [];
    
    for (let latentDim = 0; latentDim < this.config.latentDim; latentDim++) {
      for (let transDim = 0; transDim < 8; transDim++) {
        const latentValues = predictions.map(p => p[latentDim]);
        const transValues = actuals.map(a => a[transDim]);
        
        const correlation = this.computeCorrelation(latentValues, transValues);
        correlations.push(Math.abs(correlation));
      }
    }

    const avgCorrelation = correlations.reduce((sum, corr) => sum + corr, 0) / correlations.length;
    const maxCorrelation = Math.max(...correlations);

    return {
      avgCorrelation,
      maxCorrelation,
      samplesValidated: predictions.length,
      isPredictive: avgCorrelation > 0.1 // Threshold for predictiveness
    };
  }

  /**
   * Compute Pearson correlation coefficient
   * @param {Array} x - First variable
   * @param {Array} y - Second variable
   * @returns {number} - Correlation coefficient
   */
  computeCorrelation(x, y) {
    const n = x.length;
    if (n === 0) return 0;

    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = y.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denominator = Math.sqrt(denomX * denomY);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Save trained model to database
   * @returns {Promise<string>} - Model ID
   */
  async saveTrainedModel() {
    try {
      const modelState = await this.vae.toJSON();
      const modelId = `infonce-vae-${Date.now()}`;

      // Save to vae_model_weights table
      const db = await connection.getConnection();
      
      await db.run(`
        INSERT INTO vae_model_weights (
          model_version, encoder_weights, decoder_weights, latent_dim, input_dim,
          training_completed, frozen, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        modelId,
        JSON.stringify(modelState.encoderWeights),
        JSON.stringify(modelState.decoderWeights),
        this.config.latentDim,
        this.config.inputDim,
        1, // training_completed
        1, // frozen (will be frozen after pretraining)
        new Date().toISOString(),
        new Date().toISOString()
      ]);

      logger.info('Saved trained VAE model to database', {
        modelId,
        latentDim: this.config.latentDim,
        inputDim: this.config.inputDim
      });

      return modelId;

    } catch (error) {
      logger.error('Failed to save trained model', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get training statistics
   * @returns {Object} - Training statistics
   */
  getTrainingStats() {
    return {
      config: this.config,
      trainingHistory: this.trainingHistory,
      bestValidationLoss: this.bestValidationLoss,
      isConverged: this.isConverged,
      patienceCounter: this.patienceCounter,
      vaeStats: this.vae ? this.vae.getTrainingStats() : null
    };
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.vae) {
      this.vae.dispose();
      this.vae = null;
    }
    
    this.featureExtractor = null;
    this.gameIdsRepository = null;
    
    logger.debug('Disposed PretrainVAE resources');
  }
}

module.exports = PretrainVAE;