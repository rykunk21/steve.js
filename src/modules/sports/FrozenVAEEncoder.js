const tf = require('@tensorflow/tfjs');
const logger = require('../../utils/logger');

/**
 * Frozen VAE Encoder for stable team representations
 * 
 * Loads pretrained encoder weights and disables gradient computation permanently.
 * This preserves the InfoNCE-learned discriminative structure while allowing
 * team representations to evolve via Bayesian posterior updates.
 * 
 * Key features:
 * - Immutable encoder weights (frozen after InfoNCE pretraining)
 * - Validation to ensure weights never change
 * - Efficient inference-only forward passes
 * - Logging to track encoder immutability
 */
class FrozenVAEEncoder {
  constructor(vaeOrInputDim = 80, latentDim = 16) {
    // Support both constructor signatures:
    // 1. new FrozenVAEEncoder(vaeInstance) - copy from existing VAE
    // 2. new FrozenVAEEncoder(inputDim, latentDim) - create new encoder
    
    if (typeof vaeOrInputDim === 'object' && vaeOrInputDim.encoder) {
      // Constructor signature 1: Copy from existing VAE
      const vae = vaeOrInputDim;
      this.inputDim = vae.inputDim;
      this.latentDim = vae.latentDim;
      
      // Clone the encoder from the VAE
      this.encoder = tf.sequential({
        layers: vae.encoder.layers.map(layer => {
          const config = layer.getConfig();
          // Handle different layer types
          let LayerClass;
          if (config.className === 'Dense' || !config.className) {
            LayerClass = tf.layers.dense;
          } else if (config.className && typeof config.className === 'string') {
            // Fallback for other layer types
            const className = config.className.charAt(0).toLowerCase() + config.className.slice(1);
            LayerClass = tf.layers[className] || tf.layers.dense;
          } else {
            LayerClass = tf.layers.dense; // Default fallback
          }
          return LayerClass(config);
        })
      });
      
      // Copy weights from VAE encoder
      const vaeWeights = vae.encoder.getWeights();
      this.encoder.setWeights(vaeWeights.map(w => w.clone()));
      
      // Freeze immediately
      this.encoder.layers.forEach(layer => {
        layer.trainable = false;
      });
      
      this.isFrozen = true;
    } else {
      // Constructor signature 2: Create new encoder
      this.inputDim = vaeOrInputDim;
      this.latentDim = latentDim;
      this.encoder = null;
      this.isFrozen = false;
    }
    
    // Immutability tracking
    this.originalWeightsHash = null;
    this.validationCount = 0;
    this.lastValidationTime = null;
    
    // Performance tracking
    this.inferenceCount = 0;
    this.totalInferenceTime = 0;

    logger.info('Initialized FrozenVAEEncoder', {
      inputDim: this.inputDim,
      latentDim: this.latentDim,
      isFrozen: this.isFrozen
    });
  }

  /**
   * Load pretrained encoder weights and freeze them
   * @param {Object} encoderWeights - Pretrained encoder weights
   * @param {Object} config - Optional encoder configuration
   */
  async loadPretrainedWeights(encoderWeights, config = null) {
    try {
      // Create encoder architecture
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

      // Load pretrained weights
      if (encoderWeights && encoderWeights.length > 0) {
        const weightTensors = encoderWeights.map(w => tf.tensor(w.data, w.shape));
        this.encoder.setWeights(weightTensors);
        
        // Clean up temporary tensors
        weightTensors.forEach(tensor => tensor.dispose());
        
        logger.info('Loaded pretrained encoder weights', {
          numWeights: encoderWeights.length,
          totalParams: this.encoder.countParams()
        });
      } else {
        logger.warn('No pretrained weights provided, using random initialization');
      }

      // Freeze the encoder
      await this.freezeEncoder();

      logger.info('Encoder successfully loaded and frozen', {
        inputDim: this.inputDim,
        latentDim: this.latentDim,
        totalParams: this.encoder.countParams(),
        isFrozen: this.isFrozen
      });

    } catch (error) {
      logger.error('Failed to load pretrained encoder weights', {
        error: error.message,
        inputDim: this.inputDim,
        latentDim: this.latentDim
      });
      throw error;
    }
  }

  /**
   * Freeze encoder weights permanently
   */
  async freezeEncoder() {
    if (!this.encoder) {
      throw new Error('Encoder not initialized. Call loadPretrainedWeights first.');
    }

    try {
      // Disable training for all layers
      this.encoder.layers.forEach(layer => {
        layer.trainable = false;
      });

      // Mark as frozen
      this.isFrozen = true;

      // Compute hash of current weights for validation
      this.originalWeightsHash = await this.computeWeightsHash();
      this.lastValidationTime = Date.now();

      logger.info('Encoder frozen successfully', {
        layerCount: this.encoder.layers.length,
        weightsHash: this.originalWeightsHash.substring(0, 8) + '...',
        frozenAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to freeze encoder', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Encode input to latent distribution parameters (inference only)
   * @param {tf.Tensor|Array} input - Input tensor or array [batch, inputDim]
   * @returns {Object} - {mu: Tensor, logVar: Tensor, sigma: Tensor}
   */
  encode(input) {
    if (!this.encoder) {
      throw new Error('Encoder not loaded. Call loadPretrainedWeights first.');
    }

    if (!this.isFrozen) {
      throw new Error('Encoder not frozen. Call freezeEncoder first.');
    }

    const startTime = Date.now();

    return tf.tidy(() => {
      // Convert array to tensor if needed
      let inputTensor;
      if (Array.isArray(input)) {
        inputTensor = tf.tensor2d([input], [1, this.inputDim]);
      } else {
        inputTensor = input;
      }

      // Forward pass through frozen encoder
      const encoded = this.encoder.predict(inputTensor);
      
      // Split into mu and logVar
      const mu = encoded.slice([0, 0], [-1, this.latentDim]);
      const logVar = encoded.slice([0, this.latentDim], [-1, this.latentDim]);
      
      // Compute sigma from logVar
      const sigma = tf.exp(tf.mul(0.5, logVar));

      // Update performance tracking
      this.inferenceCount++;
      this.totalInferenceTime += Date.now() - startTime;

      // Dispose intermediate tensors
      encoded.dispose();
      
      // Clean up input tensor if we created it
      if (Array.isArray(input)) {
        inputTensor.dispose();
      }

      return { mu, logVar, sigma };
    });
  }

  /**
   * Encode to team distribution (convenience method)
   * @param {Array} gameFeatures - Normalized game features [inputDim]
   * @returns {Object} - {mu: Array, sigma: Array}
   */
  encodeToTeamDistribution(gameFeatures) {
    const { mu, logVar } = this.encode(gameFeatures);
    
    try {
      const muArray = Array.from(mu.dataSync());
      const sigmaArray = Array.from(logVar.dataSync()).map(lv => Math.exp(0.5 * lv));
      
      return { mu: muArray, sigma: sigmaArray };
      
    } finally {
      mu.dispose();
      logVar.dispose();
    }
  }

  /**
   * Validate that encoder weights haven't changed
   * @param {boolean} throwOnChange - Whether to throw error if weights changed
   * @returns {Promise<boolean>} - True if weights are unchanged
   */
  async validateImmutability(throwOnChange = true) {
    if (!this.isFrozen || !this.originalWeightsHash) {
      if (throwOnChange) {
        throw new Error('Encoder not properly frozen or hash not computed');
      }
      return false;
    }

    try {
      const currentHash = await this.computeWeightsHash();
      const isUnchanged = currentHash === this.originalWeightsHash;
      
      this.validationCount++;
      this.lastValidationTime = Date.now();

      if (!isUnchanged) {
        const errorMsg = 'CRITICAL: Encoder weights have changed! Immutability violated.';
        logger.error(errorMsg, {
          originalHash: this.originalWeightsHash.substring(0, 8) + '...',
          currentHash: currentHash.substring(0, 8) + '...',
          validationCount: this.validationCount
        });
        
        if (throwOnChange) {
          throw new Error(errorMsg);
        }
      } else {
        logger.debug('Encoder immutability validated', {
          weightsHash: currentHash.substring(0, 8) + '...',
          validationCount: this.validationCount
        });
      }

      return isUnchanged;

    } catch (error) {
      logger.error('Failed to validate encoder immutability', {
        error: error.message,
        validationCount: this.validationCount
      });
      
      if (throwOnChange) {
        throw error;
      }
      return false;
    }
  }

  /**
   * Compute hash of current encoder weights
   * @returns {Promise<string>} - Hash of weights
   */
  async computeWeightsHash() {
    if (!this.encoder) {
      throw new Error('Encoder not initialized');
    }

    try {
      const weights = this.encoder.getWeights();
      
      // Concatenate all weight data
      let allData = [];
      for (const weight of weights) {
        const data = weight.dataSync();
        allData = allData.concat(Array.from(data));
      }

      // Simple hash function (for validation purposes)
      let hash = 0;
      for (let i = 0; i < allData.length; i++) {
        const char = Math.floor(allData[i] * 1000000); // Scale for precision
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }

      return hash.toString(16);

    } catch (error) {
      logger.error('Failed to compute weights hash', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get encoder weights (for testing/validation purposes)
   * @returns {Object} - Encoder weights by layer name
   */
  async getEncoderWeights() {
    if (!this.encoder) {
      throw new Error('Encoder not initialized');
    }

    const weights = this.encoder.getWeights();
    const weightsByLayer = {};
    
    this.encoder.layers.forEach((layer, layerIndex) => {
      const layerWeights = layer.getWeights();
      layerWeights.forEach((weight, weightIndex) => {
        const key = `${layer.name}_weight_${weightIndex}`;
        // Find corresponding weight in the full weights array
        const globalWeightIndex = weights.findIndex(w => w === weight);
        if (globalWeightIndex !== -1) {
          weightsByLayer[key] = weights[globalWeightIndex];
        }
      });
    });

    return weightsByLayer;
  }

  /**
   * Get encoder statistics and status
   * @returns {Object} - Encoder statistics
   */
  getEncoderStats() {
    return {
      isFrozen: this.isFrozen,
      inputDim: this.inputDim,
      latentDim: this.latentDim,
      totalParams: this.encoder ? this.encoder.countParams() : 0,
      inferenceCount: this.inferenceCount,
      avgInferenceTime: this.inferenceCount > 0 ? this.totalInferenceTime / this.inferenceCount : 0,
      validationCount: this.validationCount,
      lastValidationTime: this.lastValidationTime,
      weightsHash: this.originalWeightsHash ? this.originalWeightsHash.substring(0, 8) + '...' : null
    };
  }

  /**
   * Perform periodic validation (should be called regularly during training)
   * @param {number} intervalMs - Minimum interval between validations (default: 60000ms = 1 minute)
   * @returns {Promise<boolean>} - True if validation was performed and passed
   */
  async periodicValidation(intervalMs = 60000) {
    const now = Date.now();
    
    if (!this.lastValidationTime || (now - this.lastValidationTime) >= intervalMs) {
      return await this.validateImmutability(false); // Don't throw on validation
    }
    
    return true; // Skip validation, assume still valid
  }

  /**
   * Save frozen encoder state
   * @returns {Promise<Object>} - Serialized encoder state
   */
  async saveState() {
    if (!this.encoder || !this.isFrozen) {
      throw new Error('Encoder not properly initialized and frozen');
    }

    try {
      const weights = this.encoder.getWeights();
      const weightData = weights.map(tensor => ({
        shape: tensor.shape,
        data: Array.from(tensor.dataSync())
      }));

      const state = {
        inputDim: this.inputDim,
        latentDim: this.latentDim,
        isFrozen: this.isFrozen,
        weightsHash: this.originalWeightsHash,
        encoderConfig: this.encoder.getConfig(),
        encoderWeights: weightData,
        stats: this.getEncoderStats(),
        frozenAt: this.lastValidationTime
      };

      logger.info('Saved frozen encoder state', {
        inputDim: this.inputDim,
        latentDim: this.latentDim,
        weightsHash: this.originalWeightsHash?.substring(0, 8) + '...'
      });

      return state;

    } catch (error) {
      logger.error('Failed to save encoder state', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Load frozen encoder state
   * @param {Object} state - Serialized encoder state
   */
  async loadState(state) {
    try {
      this.inputDim = state.inputDim;
      this.latentDim = state.latentDim;
      
      // Load encoder weights
      await this.loadPretrainedWeights(state.encoderWeights);
      
      // Restore immutability tracking
      this.originalWeightsHash = state.weightsHash;
      this.lastValidationTime = state.frozenAt;
      
      // Validate that loaded state is correct
      await this.validateImmutability(true);

      logger.info('Loaded frozen encoder state', {
        inputDim: this.inputDim,
        latentDim: this.latentDim,
        weightsHash: this.originalWeightsHash?.substring(0, 8) + '...'
      });

    } catch (error) {
      logger.error('Failed to load encoder state', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Dispose of TensorFlow.js resources
   */
  dispose() {
    if (this.encoder) {
      this.encoder.dispose();
      this.encoder = null;
    }
    
    this.isFrozen = false;
    this.originalWeightsHash = null;
    
    logger.debug('Disposed FrozenVAEEncoder resources');
  }
}

module.exports = FrozenVAEEncoder;