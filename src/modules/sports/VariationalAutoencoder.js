const tf = require('@tensorflow/tfjs');
const logger = require('../../utils/logger');

/**
 * Variational Autoencoder for team encoding using TensorFlow.js
 * Encoder: game_features[88] → μ[16], σ[16] (latent team distribution)
 * Decoder: z[16] → reconstructed_features[88] (for training)
 * Loss: reconstruction_loss + KL_divergence + α * NN_feedback_loss
 * 
 * Key improvements:
 * - Uses TensorFlow.js for proper gradient computation
 * - MSE reconstruction loss for continuous features
 * - Stable training with real backpropagation
 */
class VariationalAutoencoder {
  constructor(inputDim = 88, latentDim = 16) {
    this.inputDim = inputDim;
    this.latentDim = latentDim;
    
    // Training parameters
    this.learningRate = 0.001;
    this.betaKL = 3.0; // β-VAE: Strong KL weight to prevent collapse (β=2-5)
    this.betaKLSchedule = { min: 0.1, max: 3.0, warmupSteps: 50 }; // KL annealing (shorter for testing)
    this.alphaFeedback = 0.1; // Initial feedback coefficient (decays over time)
    this.feedbackDecayRate = 0.99; // Decay rate for feedback coefficient
    this.trainingStep = 0;
    
    // TensorFlow.js models
    this.encoder = null;
    this.decoder = null;
    this.optimizer = null;
    
    // Initialize models
    this.initializeModels();

    logger.info('Initialized VAE with TensorFlow.js', {
      inputDim: this.inputDim,
      latentDim: this.latentDim,
      encoderParams: this.encoder.countParams(),
      decoderParams: this.decoder.countParams(),
      totalParams: this.encoder.countParams() + this.decoder.countParams()
    });
  }

  /**
   * Initialize encoder and decoder models using TensorFlow.js
   */
  initializeModels() {
    // Encoder: input -> [mu, logVar]
    this.encoder = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.inputDim],
          units: 64,
          activation: 'relu',
          kernelInitializer: 'heNormal',
          name: 'encoder_hidden1'
        }),
        tf.layers.dense({
          units: 32,
          activation: 'relu',
          kernelInitializer: 'heNormal',
          name: 'encoder_hidden2'
        }),
        tf.layers.dense({
          units: this.latentDim * 2, // mu and logVar
          activation: 'linear',
          kernelInitializer: 'glorotNormal',
          name: 'encoder_output'
        })
      ]
    });

    // Decoder: latent -> reconstruction
    this.decoder = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.latentDim],
          units: 32,
          activation: 'relu',
          kernelInitializer: 'heNormal',
          name: 'decoder_hidden1'
        }),
        tf.layers.dense({
          units: 64,
          activation: 'relu',
          kernelInitializer: 'heNormal',
          name: 'decoder_hidden2'
        }),
        tf.layers.dense({
          units: this.inputDim,
          activation: 'sigmoid', // Output in [0,1] range
          kernelInitializer: 'glorotNormal',
          name: 'decoder_output'
        })
      ]
    });

    // Optimizer
    this.optimizer = tf.train.adam(this.learningRate);
  }

  /**
   * Encode input to latent distribution parameters
   * @param {tf.Tensor} input - Input tensor [batch, inputDim]
   * @returns {Object} - {mu: Tensor, logVar: Tensor}
   */
  encode(input) {
    return tf.tidy(() => {
      const encoded = this.encoder.predict(input);
      const mu = encoded.slice([0, 0], [-1, this.latentDim]);
      const logVar = encoded.slice([0, this.latentDim], [-1, this.latentDim]);
      return { mu, logVar };
    });
  }

  /**
   * Decode latent vector to reconstruction
   * @param {tf.Tensor} z - Latent tensor [batch, latentDim]
   * @returns {tf.Tensor} - Reconstruction [batch, inputDim]
   */
  decode(z) {
    return this.decoder.predict(z);
  }

  /**
   * Reparameterization trick: sample z = mu + sigma * epsilon
   * @param {tf.Tensor} mu - Mean tensor
   * @param {tf.Tensor} logVar - Log variance tensor
   * @returns {tf.Tensor} - Sampled latent vector
   */
  reparameterize(mu, logVar) {
    return tf.tidy(() => {
      const epsilon = tf.randomNormal(mu.shape);
      const sigma = tf.exp(tf.mul(0.5, logVar));
      return tf.add(mu, tf.mul(sigma, epsilon));
    });
  }

  /**
   * Forward pass through VAE
   * @param {tf.Tensor} input - Input tensor
   * @returns {Object} - {reconstruction, mu, logVar, z}
   */
  forward(input) {
    return tf.tidy(() => {
      const { mu, logVar } = this.encode(input);
      const z = this.reparameterize(mu, logVar);
      const reconstruction = this.decode(z);
      
      return { reconstruction, mu, logVar, z };
    });
  }

  /**
   * Compute VAE loss components using TensorFlow.js with β-VAE and KL annealing
   * @param {tf.Tensor} input - Original input
   * @param {tf.Tensor} reconstruction - Reconstructed input
   * @param {tf.Tensor} mu - Latent mean
   * @param {tf.Tensor} logVar - Latent log variance
   * @param {number} nnFeedbackLoss - Optional NN feedback loss
   * @returns {Object} - Loss components
   */
  computeLoss(input, reconstruction, mu, logVar, nnFeedbackLoss = 0) {
    return tf.tidy(() => {
      // Reconstruction loss: MSE (better for continuous features)
      const reconstructionLoss = tf.mean(tf.squaredDifference(input, reconstruction));
      
      // KL divergence: -0.5 * sum(1 + log(σ²) - μ² - σ²)
      const klLoss = tf.mul(-0.5, tf.sum(
        tf.add(
          tf.add(tf.ones(mu.shape), logVar),
          tf.neg(tf.add(tf.square(mu), tf.exp(logVar)))
        )
      ));
      
      // β-VAE with KL annealing to prevent collapse
      const currentBeta = this.getCurrentBetaKL();
      
      // Total VAE loss with β-VAE
      const vaeLoss = tf.add(reconstructionLoss, tf.mul(currentBeta, klLoss));
      
      // Add feedback loss if provided (only after VAE warmup AND NN warmup)
      const vaeWarmedUp = this.trainingStep > this.betaKLSchedule.warmupSteps;
      const feedbackWeight = vaeWarmedUp ? this.alphaFeedback : 0;
      const totalLoss = tf.add(vaeLoss, tf.mul(feedbackWeight, nnFeedbackLoss));
      
      return {
        totalLoss,
        reconstructionLoss,
        klLoss,
        vaeLoss,
        nnFeedbackLoss,
        alpha: feedbackWeight,
        beta: currentBeta
      };
    });
  }

  /**
   * Get current β value for KL annealing
   * @returns {number} - Current β value
   */
  getCurrentBetaKL() {
    const { min, max, warmupSteps } = this.betaKLSchedule;
    if (this.trainingStep < warmupSteps) {
      // Linear annealing from min to max
      const progress = this.trainingStep / warmupSteps;
      return min + (max - min) * progress;
    }
    return max;
  }

  /**
   * Training step with proper gradient computation
   * @param {Array} inputArray - Input features array
   * @param {number} nnFeedbackLoss - Optional NN feedback loss
   * @returns {Promise<Object>} - Loss information
   */
  async trainStep(inputArray, nnFeedbackLoss = 0) {
    const inputTensor = tf.tensor2d([inputArray], [1, this.inputDim]);
    
    try {
      // Use tf.variableGrads for custom training step
      const f = () => {
        const { reconstruction, mu, logVar } = this.forward(inputTensor);
        const lossInfo = this.computeLoss(inputTensor, reconstruction, mu, logVar, nnFeedbackLoss);
        return lossInfo.totalLoss;
      };

      const { value: loss, grads } = tf.variableGrads(f);
      
      // Apply gradients
      this.optimizer.applyGradients(grads);
      
      // Get loss components for logging
      const { reconstruction, mu, logVar } = this.forward(inputTensor);
      const lossInfo = this.computeLoss(inputTensor, reconstruction, mu, logVar, nnFeedbackLoss);
      
      const result = {
        totalLoss: loss.dataSync()[0],
        reconstructionLoss: lossInfo.reconstructionLoss.dataSync()[0],
        klLoss: lossInfo.klLoss.dataSync()[0],
        vaeLoss: lossInfo.vaeLoss.dataSync()[0],
        nnFeedbackLoss,
        alpha: lossInfo.alpha,
        beta: lossInfo.beta
      };

      // Increment training step for annealing
      this.trainingStep++;
      
      // Clean up
      Object.values(grads).forEach(grad => grad.dispose());
      loss.dispose();
      lossInfo.totalLoss.dispose();
      lossInfo.reconstructionLoss.dispose();
      lossInfo.klLoss.dispose();
      lossInfo.vaeLoss.dispose();
      reconstruction.dispose();
      mu.dispose();
      logVar.dispose();
      
      return result;
      
    } finally {
      inputTensor.dispose();
    }
  }

  /**
   * Backward pass (alias for trainStep for compatibility)
   * @param {Array} input - Input features array
   * @param {number} nnFeedbackLoss - Optional NN feedback loss
   * @returns {Promise<Object>} - Loss information
   */
  async backward(input, nnFeedbackLoss = 0) {
    return await this.trainStep(input, nnFeedbackLoss);
  }



  /**
   * Encode game features to team latent distribution with noise injection
   * @param {Array} gameFeatures - Normalized game features
   * @param {boolean} addNoise - Whether to add Gaussian noise (default: true)
   * @returns {Object} - {mu: Array, sigma: Array}
   */
  encodeGameToTeamDistribution(gameFeatures, addNoise = true) {
    const inputTensor = tf.tensor2d([gameFeatures], [1, this.inputDim]);
    
    try {
      const { mu, logVar } = this.encode(inputTensor);
      
      let muArray = Array.from(mu.dataSync());
      let sigmaArray = Array.from(logVar.dataSync()).map(lv => Math.exp(0.5 * lv));
      
      // Add Gaussian noise to prevent deterministic collapse
      if (addNoise) {
        const noiseScale = 0.1;
        muArray = muArray.map(m => m + (Math.random() - 0.5) * 2 * noiseScale);
        
        // Apply latent dropout (randomly zero out 10% of dimensions)
        const dropoutRate = 0.1;
        for (let i = 0; i < muArray.length; i++) {
          if (Math.random() < dropoutRate) {
            muArray[i] = 0;
          }
        }
      }
      
      mu.dispose();
      logVar.dispose();
      
      return { mu: muArray, sigma: sigmaArray };
      
    } finally {
      inputTensor.dispose();
    }
  }

  /**
   * Sample from team distribution N(μ, σ²)
   * @param {Array} mu - Mean vector [16]
   * @param {Array} sigma - Standard deviation vector [16]
   * @returns {Array} - Sampled team representation [16]
   */
  sampleFromTeamDistribution(mu, sigma) {
    const sample = new Array(this.latentDim);
    
    for (let i = 0; i < this.latentDim; i++) {
      const epsilon = this.randomNormal(0, 1);
      sample[i] = mu[i] + sigma[i] * epsilon;
    }
    
    return sample;
  }

  /**
   * Update feedback coefficient (decay over time)
   */
  decayFeedbackCoefficient() {
    this.alphaFeedback *= this.feedbackDecayRate;
    
    logger.debug('Decayed feedback coefficient', {
      newAlpha: this.alphaFeedback
    });
  }

  /**
   * Set feedback coefficient
   * @param {number} alpha - New feedback coefficient
   */
  setFeedbackCoefficient(alpha) {
    this.alphaFeedback = alpha;
  }



  /**
   * Generate random number from normal distribution
   * @param {number} mean - Mean
   * @param {number} stdDev - Standard deviation
   * @returns {number} - Random number
   */
  randomNormal(mean, stdDev) {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  /**
   * Count total parameters
   * @returns {number} - Total parameters
   */
  countParameters() {
    return this.encoder.countParams() + this.decoder.countParams();
  }

  /**
   * Save model to JSON format
   * @returns {Promise<Object>} - Model state
   */
  async toJSON() {
    const encoderWeights = await this.encoder.getWeights();
    const decoderWeights = await this.decoder.getWeights();
    
    const encoderData = encoderWeights.map(tensor => ({
      shape: tensor.shape,
      data: Array.from(tensor.dataSync())
    }));
    
    const decoderData = decoderWeights.map(tensor => ({
      shape: tensor.shape,
      data: Array.from(tensor.dataSync())
    }));

    // DO NOT dispose of weight tensors here - they are still owned by the model
    // The model will manage their lifecycle
    // encoderWeights.forEach(tensor => tensor.dispose());
    // decoderWeights.forEach(tensor => tensor.dispose());

    return {
      inputDim: this.inputDim,
      latentDim: this.latentDim,
      learningRate: this.learningRate,
      betaKL: this.betaKL,
      alphaFeedback: this.alphaFeedback,
      feedbackDecayRate: this.feedbackDecayRate,
      encoderConfig: this.encoder.getConfig(),
      decoderConfig: this.decoder.getConfig(),
      encoderWeights: encoderData,
      decoderWeights: decoderData
    };
  }

  /**
   * Load model from JSON format
   * @param {Object} state - Model state
   */
  async fromJSON(state) {
    this.inputDim = state.inputDim;
    this.latentDim = state.latentDim;
    this.learningRate = state.learningRate;
    this.betaKL = state.betaKL;
    this.alphaFeedback = state.alphaFeedback;
    this.feedbackDecayRate = state.feedbackDecayRate;

    // Dispose existing models
    if (this.encoder) this.encoder.dispose();
    if (this.decoder) this.decoder.dispose();

    // Recreate models
    this.initializeModels();

    // Restore weights if provided
    if (state.encoderWeights) {
      const encoderTensors = state.encoderWeights.map(w => tf.tensor(w.data, w.shape));
      this.encoder.setWeights(encoderTensors);
      encoderTensors.forEach(tensor => tensor.dispose());
    }

    if (state.decoderWeights) {
      const decoderTensors = state.decoderWeights.map(w => tf.tensor(w.data, w.shape));
      this.decoder.setWeights(decoderTensors);
      decoderTensors.forEach(tensor => tensor.dispose());
    }

    logger.info('Loaded VAE from JSON', {
      inputDim: this.inputDim,
      latentDim: this.latentDim,
      totalParams: this.countParameters()
    });
  }

  /**
   * Save model to file
   * @param {string} filepath - File path
   */
  async saveToFile(filepath) {
    const fs = require('fs').promises;
    const state = await this.toJSON();
    await fs.writeFile(filepath, JSON.stringify(state, null, 2));
    logger.info('Saved VAE model to file', { filepath });
  }

  /**
   * Load model from file
   * @param {string} filepath - File path
   */
  async loadFromFile(filepath) {
    const fs = require('fs').promises;
    const data = await fs.readFile(filepath, 'utf8');
    const state = JSON.parse(data);
    await this.fromJSON(state);
    logger.info('Loaded VAE model from file', { filepath });
  }

  /**
   * Dispose of TensorFlow.js resources
   */
  dispose() {
    if (this.encoder) {
      this.encoder.dispose();
      this.encoder = null;
    }
    if (this.decoder) {
      this.decoder.dispose();
      this.decoder = null;
    }
    if (this.optimizer) {
      this.optimizer = null; // Optimizer doesn't need explicit disposal
    }
    logger.debug('Disposed VAE resources');
  }
}

module.exports = VariationalAutoencoder;