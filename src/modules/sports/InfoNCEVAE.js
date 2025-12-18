const tf = require('@tensorflow/tfjs');
const VariationalAutoencoder = require('./VariationalAutoencoder');
const InfoNCELoss = require('./InfoNCELoss');
const InfoNCEDataSampler = require('./InfoNCEDataSampler');
const logger = require('../../utils/logger');

/**
 * VAE with InfoNCE pretraining for learning label-predictive representations
 * 
 * Extends the base VAE with InfoNCE contrastive learning:
 * Total Loss = reconstruction + β*KL + λ*InfoNCE
 * 
 * InfoNCE encourages the latent space to be predictive of transition probabilities
 * without forcing perfect reconstruction, leading to more discriminative representations.
 */
class InfoNCEVAE extends VariationalAutoencoder {
  constructor(inputDim = 80, latentDim = 16, temperature = 0.1) {
    super(inputDim, latentDim);
    
    // InfoNCE-specific parameters
    this.lambdaInfoNCE = 1.0; // InfoNCE loss weight
    this.lambdaSchedule = { min: 0.3, max: 0.8, warmupSteps: 50 }; // More conservative annealing
    this.temperature = temperature;
    
    // InfoNCE components
    this.infoNCELoss = new InfoNCELoss(temperature, 8); // 8-dim transition probabilities
    this.dataSampler = new InfoNCEDataSampler();
    
    // Training state
    this.infoNCEStep = 0;
    this.numNegatives = 64; // Number of negative samples per batch
    
    logger.info('Initialized InfoNCE VAE', {
      inputDim: this.inputDim,
      latentDim: this.latentDim,
      temperature: this.temperature,
      lambdaInfoNCE: this.lambdaInfoNCE,
      numNegatives: this.numNegatives
    });
  }

  /**
   * Get current λ value for InfoNCE annealing
   * @returns {number} - Current λ value
   */
  getCurrentLambdaInfoNCE() {
    const { min, max, warmupSteps } = this.lambdaSchedule;
    if (this.infoNCEStep < warmupSteps) {
      // Linear annealing from min to max
      const progress = this.infoNCEStep / warmupSteps;
      return min + (max - min) * progress;
    }
    return max;
  }

  /**
   * Compute combined VAE + InfoNCE loss
   * @param {tf.Tensor} input - Original input
   * @param {tf.Tensor} reconstruction - Reconstructed input
   * @param {tf.Tensor} mu - Latent mean
   * @param {tf.Tensor} logVar - Latent log variance
   * @param {tf.Tensor} latents - Sampled latent vectors
   * @param {tf.Tensor} positiveLabels - Positive transition probabilities
   * @param {tf.Tensor} negativeLabels - Negative transition probabilities
   * @returns {Object} - Loss components
   */
  computeCombinedLoss(input, reconstruction, mu, logVar, latents, positiveLabels, negativeLabels) {
    return tf.tidy(() => {
      // Standard VAE loss components
      const vaeLossInfo = this.computeLoss(input, reconstruction, mu, logVar, 0);
      
      // InfoNCE loss
      const infoNCELoss = this.infoNCELoss.computeInfoNCELossEfficient(
        latents, positiveLabels, negativeLabels
      );
      
      // Current InfoNCE weight with annealing
      const currentLambda = this.getCurrentLambdaInfoNCE();
      
      // Combined loss: VAE + λ*InfoNCE
      const totalLoss = tf.add(vaeLossInfo.vaeLoss, tf.mul(currentLambda, infoNCELoss));
      
      return {
        totalLoss,
        reconstructionLoss: vaeLossInfo.reconstructionLoss,
        klLoss: vaeLossInfo.klLoss,
        vaeLoss: vaeLossInfo.vaeLoss,
        infoNCELoss,
        lambda: currentLambda,
        beta: vaeLossInfo.beta
      };
    });
  }

  /**
   * Training step with InfoNCE contrastive learning
   * @param {Array} inputArray - Input features array
   * @param {string} gameId - Game ID for sampling contrastive pairs
   * @param {string} teamType - 'home' or 'away' for selecting positive label
   * @param {string} sport - Sport type (default: 'mens-college-basketball')
   * @returns {Promise<Object>} - Loss information
   */
  async trainStepWithInfoNCE(inputArray, gameId, teamType = 'home', sport = 'mens-college-basketball') {
    try {
      // Sample contrastive pairs from database
      const { positive, negatives } = await this.dataSampler.sampleContrastivePair(
        gameId, this.numNegatives, sport
      );

      // Select positive label based on team type
      const positiveLabel = teamType === 'home' ? positive.home : positive.away;
      
      if (!positiveLabel) {
        throw new Error(`No ${teamType} transition probabilities for game ${gameId}`);
      }

      // Convert to tensors
      const inputTensor = tf.tensor2d([inputArray], [1, this.inputDim]);
      const positiveTensor = tf.tensor2d([positiveLabel], [1, 8]);
      const negativesTensor = tf.tensor2d(negatives, [negatives.length, 8]);

      try {
        // Use tf.variableGrads without explicit variable list (auto-detects)
        const f = () => {
          const { reconstruction, mu, logVar, z } = this.forward(inputTensor);
          const lossInfo = this.computeCombinedLoss(
            inputTensor, reconstruction, mu, logVar, z, positiveTensor, negativesTensor
          );
          return lossInfo.totalLoss;
        };

        const { value: loss, grads } = tf.variableGrads(f);
        
        // Apply gradients - only apply to variables that exist in grads
        const filteredGrads = {};
        for (const [varName, grad] of Object.entries(grads)) {
          if (grad && !grad.isDisposed) {
            filteredGrads[varName] = grad;
          }
        }
        
        this.optimizer.applyGradients(filteredGrads);
        
        // Get loss components for logging
        const { reconstruction, mu, logVar, z } = this.forward(inputTensor);
        const lossInfo = this.computeCombinedLoss(
          inputTensor, reconstruction, mu, logVar, z, positiveTensor, negativesTensor
        );
        
        const result = {
          totalLoss: loss.dataSync()[0],
          reconstructionLoss: lossInfo.reconstructionLoss.dataSync()[0],
          klLoss: lossInfo.klLoss.dataSync()[0],
          vaeLoss: lossInfo.vaeLoss.dataSync()[0],
          infoNCELoss: lossInfo.infoNCELoss.dataSync()[0],
          lambda: lossInfo.lambda,
          beta: lossInfo.beta,
          gameId,
          teamType,
          numNegatives: negatives.length
        };

        // Increment training steps
        this.trainingStep++;
        this.infoNCEStep++;
        
        // Clean up
        Object.values(grads).forEach(grad => grad.dispose());
        loss.dispose();
        lossInfo.totalLoss.dispose();
        lossInfo.reconstructionLoss.dispose();
        lossInfo.klLoss.dispose();
        lossInfo.vaeLoss.dispose();
        lossInfo.infoNCELoss.dispose();
        reconstruction.dispose();
        mu.dispose();
        logVar.dispose();
        z.dispose();
        
        return result;
        
      } finally {
        inputTensor.dispose();
        positiveTensor.dispose();
        negativesTensor.dispose();
      }

    } catch (error) {
      logger.error('InfoNCE training step failed', {
        gameId,
        teamType,
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Batch training with InfoNCE for multiple games
   * @param {Array} trainingBatch - Array of {inputArray, gameId, teamType}
   * @param {string} sport - Sport type
   * @returns {Promise<Object>} - Aggregated loss information
   */
  async trainBatchWithInfoNCE(trainingBatch, sport = 'mens-college-basketball') {
    const batchResults = [];
    
    for (const { inputArray, gameId, teamType } of trainingBatch) {
      try {
        const result = await this.trainStepWithInfoNCE(inputArray, gameId, teamType, sport);
        batchResults.push(result);
      } catch (error) {
        logger.warn('Skipping failed training sample', {
          gameId,
          teamType,
          error: error.message
        });
      }
    }

    if (batchResults.length === 0) {
      throw new Error('No successful training samples in batch');
    }

    // Aggregate results
    const avgLoss = {
      totalLoss: batchResults.reduce((sum, r) => sum + r.totalLoss, 0) / batchResults.length,
      reconstructionLoss: batchResults.reduce((sum, r) => sum + r.reconstructionLoss, 0) / batchResults.length,
      klLoss: batchResults.reduce((sum, r) => sum + r.klLoss, 0) / batchResults.length,
      vaeLoss: batchResults.reduce((sum, r) => sum + r.vaeLoss, 0) / batchResults.length,
      infoNCELoss: batchResults.reduce((sum, r) => sum + r.infoNCELoss, 0) / batchResults.length,
      lambda: batchResults[0].lambda, // Same for all in batch
      beta: batchResults[0].beta,
      batchSize: batchResults.length,
      successfulSamples: batchResults.length,
      totalSamples: trainingBatch.length
    };

    logger.debug('Completed InfoNCE batch training', avgLoss);
    
    return avgLoss;
  }

  /**
   * Set InfoNCE hyperparameters
   * @param {Object} params - {lambdaInfoNCE, temperature, numNegatives}
   */
  setInfoNCEParams(params) {
    if (params.lambdaInfoNCE !== undefined) {
      this.lambdaInfoNCE = params.lambdaInfoNCE;
    }
    if (params.temperature !== undefined) {
      this.temperature = params.temperature;
      this.infoNCELoss.temperature = params.temperature;
    }
    if (params.numNegatives !== undefined) {
      this.numNegatives = params.numNegatives;
    }
    
    logger.info('Updated InfoNCE parameters', {
      lambdaInfoNCE: this.lambdaInfoNCE,
      temperature: this.temperature,
      numNegatives: this.numNegatives
    });
  }

  /**
   * Save model including InfoNCE components
   * @returns {Promise<Object>} - Complete model state
   */
  async toJSON() {
    const vaeState = await super.toJSON();
    const infoNCEState = await this.infoNCELoss.saveWeights();
    
    return {
      ...vaeState,
      // InfoNCE-specific state
      lambdaInfoNCE: this.lambdaInfoNCE,
      lambdaSchedule: this.lambdaSchedule,
      temperature: this.temperature,
      infoNCEStep: this.infoNCEStep,
      numNegatives: this.numNegatives,
      infoNCEWeights: infoNCEState
    };
  }

  /**
   * Load model including InfoNCE components
   * @param {Object} state - Complete model state
   */
  async fromJSON(state) {
    // Load base VAE state
    await super.fromJSON(state);
    
    // Load InfoNCE-specific state
    if (state.lambdaInfoNCE !== undefined) {
      this.lambdaInfoNCE = state.lambdaInfoNCE;
    }
    if (state.lambdaSchedule) {
      this.lambdaSchedule = state.lambdaSchedule;
    }
    if (state.temperature !== undefined) {
      this.temperature = state.temperature;
    }
    if (state.infoNCEStep !== undefined) {
      this.infoNCEStep = state.infoNCEStep;
    }
    if (state.numNegatives !== undefined) {
      this.numNegatives = state.numNegatives;
    }
    
    // Load InfoNCE weights
    if (state.infoNCEWeights) {
      await this.infoNCELoss.loadWeights(state.infoNCEWeights);
    }
    
    logger.info('Loaded InfoNCE VAE from JSON', {
      inputDim: this.inputDim,
      latentDim: this.latentDim,
      lambdaInfoNCE: this.lambdaInfoNCE,
      temperature: this.temperature,
      infoNCEStep: this.infoNCEStep
    });
  }

  /**
   * Get training statistics
   * @returns {Object} - Training statistics
   */
  getTrainingStats() {
    return {
      trainingStep: this.trainingStep,
      infoNCEStep: this.infoNCEStep,
      currentBeta: this.getCurrentBetaKL(),
      currentLambda: this.getCurrentLambdaInfoNCE(),
      temperature: this.temperature,
      numNegatives: this.numNegatives,
      cacheStats: this.dataSampler.getCacheStats()
    };
  }

  /**
   * Dispose of all resources including InfoNCE components
   */
  dispose() {
    super.dispose();
    
    if (this.infoNCELoss) {
      this.infoNCELoss.dispose();
      this.infoNCELoss = null;
    }
    
    // Data sampler doesn't need explicit disposal
    this.dataSampler = null;
    
    logger.debug('Disposed InfoNCE VAE resources');
  }
}

module.exports = InfoNCEVAE;