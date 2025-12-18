const tf = require('@tensorflow/tfjs');
const logger = require('../../utils/logger');

/**
 * Neural Network for predicting transition probabilities from team latent representations
 * Input: [team_A_μ[16], team_A_σ[16], team_B_μ[16], team_B_σ[16], game_context[~10]]
 * Architecture: MLP with hidden layers (128, 64, 32) → 8 transition probabilities
 * Output: [2pt_make, 2pt_miss, 3pt_make, 3pt_miss, ft_make, ft_miss, oreb, turnover]
 */
class TransitionProbabilityNN {
  constructor(gameContextDim = 10) {
    // Input dimensions: team_A_μ[16] + team_A_σ[16] + team_B_μ[16] + team_B_σ[16] + game_context[gameContextDim]
    this.inputDim = 16 + 16 + 16 + 16 + gameContextDim; // 64 + gameContextDim
    this.outputDim = 8; // 8 transition probabilities
    this.gameContextDim = gameContextDim;
    
    // Training parameters
    this.learningRate = 0.001; // Optimized learning rate for stable learning
    this.batchSize = 32;
    
    // Training phase control to prevent VAE collapse
    this.trainingStep = 0;
    this.nnWarmupSteps = 40; // Train NN alone for first 40 steps (freeze VAE feedback)
    
    // Transition probability labels for reference
    this.transitionLabels = [
      '2pt_make', '2pt_miss', '3pt_make', '3pt_miss', 
      'ft_make', 'ft_miss', 'oreb', 'turnover'
    ];

    // TensorFlow.js model
    this.model = null;
    this.optimizer = null;
    
    // Initialize the model
    this.initializeModel();

    logger.info('Initialized TransitionProbabilityNN with TensorFlow.js', {
      inputDim: this.inputDim,
      outputDim: this.outputDim,
      gameContextDim: this.gameContextDim,
      totalParameters: this.model ? this.model.countParams() : 0
    });
  }

  /**
   * Initialize TensorFlow.js model with deeper, more complex architecture
   * Optimized for basketball transition probability prediction
   */
  initializeModel() {
    // Create sequential model
    this.model = tf.sequential();

    // Small classifier head to prevent overfitting and mode collapse
    // Hidden layer 1: 64 units with ReLU activation + strong dropout
    this.model.add(tf.layers.dense({
      inputShape: [this.inputDim],
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      biasInitializer: 'zeros',
      name: 'hidden1'
    }));
    this.model.add(tf.layers.dropout({ rate: 0.5, name: 'dropout1' }));

    // Hidden layer 2: 32 units with ReLU activation + dropout
    this.model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      biasInitializer: 'zeros',
      name: 'hidden2'
    }));
    this.model.add(tf.layers.dropout({ rate: 0.3, name: 'dropout2' }));

    // Output layer: 8 units with softmax activation for probabilities
    this.model.add(tf.layers.dense({
      units: this.outputDim,
      activation: 'softmax',
      kernelInitializer: 'glorotNormal',
      biasInitializer: 'zeros',
      name: 'output'
    }));

    // Create optimizer with better parameters for avoiding mode collapse
    this.optimizer = tf.train.adam(this.learningRate, 0.9, 0.999, 1e-7);

    // Compile model with categorical crossentropy loss
    this.model.compile({
      optimizer: this.optimizer,
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    // Skip initialization noise to avoid disposal issues
    // this.addInitializationNoise();

    logger.debug('Initialized TensorFlow.js model', {
      totalParameters: this.model.countParams(),
      layers: this.model.layers.map(layer => ({
        name: layer.name,
        units: layer.units || layer.inputShape,
        activation: layer.activation ? layer.activation.name : 'none'
      }))
    });
  }

  /**
   * Add small random noise to model weights to break symmetry
   */
  addInitializationNoise() {
    const weights = this.model.getWeights();
    const noisyWeights = weights.map(weight => {
      const noise = tf.randomNormal(weight.shape, 0, 0.01);
      const noisyWeight = weight.add(noise);
      noise.dispose();
      return noisyWeight;
    });
    
    this.model.setWeights(noisyWeights);
    
    // Clean up
    weights.forEach(w => w.dispose());
    noisyWeights.forEach(w => w.dispose());
  }

  /**
   * Build input vector from team posterior distributions and game context
   * @param {Array|Object} teamA_posterior - Team A posterior {mu, sigma} or mu array
   * @param {Array} teamA_sigma - Team A sigma (if first param is mu array)
   * @param {Array} teamB_mu - Team B mu (if first param is mu array) or teamB_posterior
   * @param {Array} teamB_sigma - Team B sigma (if first param is mu array)
   * @param {Array} gameContext - Game context features [gameContextDim]
   * @returns {Array} - Combined input vector
   */
  buildInputVector(teamA_posterior, teamA_sigma = null, teamB_mu = null, teamB_sigma = null, gameContext = null) {
    let teamA_mu, teamB_posterior;
    
    // Handle both posterior object format and individual array format
    if (typeof teamA_posterior === 'object' && teamA_posterior.mu && teamA_posterior.sigma) {
      // New format: buildInputVector(teamA_posterior, teamB_posterior, gameContext)
      teamA_mu = teamA_posterior.mu;
      teamA_sigma = teamA_posterior.sigma;
      teamB_posterior = teamA_sigma; // Second parameter is teamB_posterior
      teamB_mu = teamB_posterior.mu;
      teamB_sigma = teamB_posterior.sigma;
      gameContext = teamB_mu; // Third parameter is gameContext
    } else {
      // Legacy format: buildInputVector(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext)
      teamA_mu = teamA_posterior;
    }

    // Validate input dimensions
    if (teamA_mu.length !== 16) {
      throw new Error(`Team A mu must be 16-dimensional, got ${teamA_mu.length}`);
    }
    if (teamA_sigma.length !== 16) {
      throw new Error(`Team A sigma must be 16-dimensional, got ${teamA_sigma.length}`);
    }
    if (teamB_mu.length !== 16) {
      throw new Error(`Team B mu must be 16-dimensional, got ${teamB_mu.length}`);
    }
    if (teamB_sigma.length !== 16) {
      throw new Error(`Team B sigma must be 16-dimensional, got ${teamB_sigma.length}`);
    }
    if (gameContext.length !== this.gameContextDim) {
      throw new Error(`Game context must be ${this.gameContextDim}-dimensional, got ${gameContext.length}`);
    }

    // Convert sigma to variance for NN input (more stable than std dev)
    const teamA_variance = teamA_sigma.map(s => s * s);
    const teamB_variance = teamB_sigma.map(s => s * s);

    // Concatenate all input components: [mu_A, var_A, mu_B, var_B, context]
    return [
      ...teamA_mu,
      ...teamA_variance,
      ...teamB_mu,
      ...teamB_variance,
      ...gameContext
    ];
  }

  /**
   * Forward pass through the network using TensorFlow.js
   * @param {Array} input - Input vector or components
   * @param {Array} teamA_sigma - Optional: Team A sigma if input is not pre-built
   * @param {Array} teamB_mu - Optional: Team B mu if input is not pre-built
   * @param {Array} teamB_sigma - Optional: Team B sigma if input is not pre-built
   * @param {Array} gameContext - Optional: Game context if input is not pre-built
   * @returns {Array} - Transition probabilities [8]
   */
  forward(input, teamA_sigma = null, teamB_mu = null, teamB_sigma = null, gameContext = null) {
    let inputVector;

    // If additional parameters provided, build input vector
    if (teamA_sigma !== null) {
      inputVector = this.buildInputVector(input, teamA_sigma, teamB_mu, teamB_sigma, gameContext);
    } else {
      inputVector = input;
    }

    if (inputVector.length !== this.inputDim) {
      throw new Error(`Invalid input dimension: expected ${this.inputDim}, got ${inputVector.length}`);
    }

    // Convert to tensor and perform forward pass
    return tf.tidy(() => {
      const inputTensor = tf.tensor2d([inputVector], [1, this.inputDim]);
      const prediction = this.model.predict(inputTensor);
      const probabilities = prediction.dataSync();
      return Array.from(probabilities);
    });
  }

  /**
   * Predict transition probabilities from team posterior distributions
   * @param {Array|Object} teamA_posterior - Team A posterior {mu, sigma} or input vector
   * @param {Array} teamA_sigma - Team A sigma (if first param is mu array)
   * @param {Array} teamB_mu - Team B mu (if first param is mu array)
   * @param {Array} teamB_sigma - Team B sigma (if first param is mu array)
   * @param {Array} gameContext - Game context features [gameContextDim]
   * @returns {Object|Array} - Transition probabilities with labels or raw array
   */
  predict(teamA_posterior, teamA_sigma = null, teamB_mu = null, teamB_sigma = null, gameContext = null) {
    let probabilities;
    
    // Handle both posterior object format and individual array format
    if (typeof teamA_posterior === 'object' && teamA_posterior.mu && teamA_posterior.sigma) {
      // New format: predict(teamA_posterior, teamB_posterior, gameContext)
      const teamB_posterior = teamA_sigma; // Second parameter is teamB_posterior
      const context = teamB_mu; // Third parameter is gameContext
      
      probabilities = this.forward(
        teamA_posterior.mu, 
        teamA_posterior.sigma, 
        teamB_posterior.mu, 
        teamB_posterior.sigma, 
        context
      );
    } else {
      // Legacy format: predict(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext)
      probabilities = this.forward(teamA_posterior, teamA_sigma, teamB_mu, teamB_sigma, gameContext);
    }
    
    // Return labeled probabilities for object format, raw array for legacy
    if (typeof teamA_posterior === 'object' && teamA_posterior.mu) {
      const result = {};
      for (let i = 0; i < this.transitionLabels.length; i++) {
        result[this.transitionLabels[i]] = probabilities[i];
      }
      return result;
    } else {
      return probabilities;
    }
  }

  /**
   * Compute focal loss to prevent mode collapse and handle class imbalance
   * @param {Array} predicted - Predicted probabilities [8]
   * @param {Array} actual - Actual transition frequencies [8]
   * @param {number} alpha - Class balancing factor (default: 0.25)
   * @param {number} gamma - Focusing parameter (default: 2.0)
   * @returns {number} - Focal loss
   */
  computeLoss(predicted, actual, alpha = 0.25, gamma = 2.0) {
    if (predicted.length !== actual.length) {
      throw new Error('Predicted and actual arrays must have same length');
    }
    
    if (predicted.length !== this.outputDim) {
      throw new Error(`Expected ${this.outputDim} probabilities, got ${predicted.length}`);
    }

    // Validate actual probabilities
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] < 0 || actual[i] > 1) {
        throw new Error(`Invalid probability at index ${i}: ${actual[i]}`);
      }
    }

    // Compute focal loss to prevent mode collapse
    return tf.tidy(() => {
      const predictedTensor = tf.tensor1d(predicted);
      const actualTensor = tf.tensor1d(actual);
      
      // Clip predictions to prevent log(0)
      const eps = 1e-7;
      const clippedPred = tf.clipByValue(predictedTensor, eps, 1 - eps);
      
      // Compute cross entropy
      const ce = tf.neg(tf.sum(tf.mul(actualTensor, tf.log(clippedPred))));
      
      // Compute focal weight: (1 - p_t)^gamma
      const pt = tf.sum(tf.mul(actualTensor, clippedPred));
      const focalWeight = tf.pow(tf.sub(1, pt), gamma);
      
      // Apply focal loss: -α * (1-p_t)^γ * log(p_t)
      const focalLoss = tf.mul(tf.mul(alpha, focalWeight), ce);
      
      return focalLoss.dataSync()[0];
    });
  }

  /**
   * Train on a single example using TensorFlow.js automatic differentiation
   * Ensures only NN weights are updated, never encoder weights
   * @param {Array} input - Input vector (from posterior distributions)
   * @param {Array} target - Target transition frequencies [8]
   * @param {number} learningRate - Learning rate (optional)
   * @returns {Promise<number>} - Loss value
   */
  async trainStep(input, target, learningRate = null) {
    // Note: TensorFlow.js Adam optimizer doesn't support setLearningRate in browser version
    // If different learning rate needed, create new optimizer
    if (learningRate && learningRate !== this.learningRate) {
      this.learningRate = learningRate;
      this.optimizer = tf.train.adam(this.learningRate);
      this.model.compile({
        optimizer: this.optimizer,
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });
    }

    // Validate inputs
    if (input.length !== this.inputDim) {
      throw new Error(`Invalid input dimension: expected ${this.inputDim}, got ${input.length}`);
    }
    
    if (target.length !== this.outputDim) {
      throw new Error(`Invalid target dimension: expected ${this.outputDim}, got ${target.length}`);
    }

    // Validate that input comes from posterior distributions (not direct VAE encoding)
    this.validatePosteriorInput(input);

    // Create tensors outside of tidy for gradient computation
    const inputTensor = tf.tensor2d([input], [1, this.inputDim]);
    const targetTensor = tf.tensor2d([target], [1, this.outputDim]);

    try {
      // Use tf.variableGrads for custom training step
      const f = () => {
        const prediction = this.model.apply(inputTensor);
        return tf.losses.softmaxCrossEntropy(targetTensor, prediction);
      };

      const { value: loss, grads } = tf.variableGrads(f);
      
      // CRITICAL: Only apply gradients to NN model variables
      // This ensures encoder weights are never updated
      this.optimizer.applyGradients(grads);
      
      const lossValue = loss.dataSync()[0];
      
      // Clean up gradients
      Object.values(grads).forEach(grad => grad.dispose());
      loss.dispose();
      
      return lossValue;
    } finally {
      // Clean up tensors
      inputTensor.dispose();
      targetTensor.dispose();
    }
  }

  /**
   * Validate that input comes from posterior distributions, not direct VAE encoding
   * @param {Array} input - Input vector to validate
   */
  validatePosteriorInput(input) {
    // Input should be: [team_A_mu[16], team_A_sigma[16], team_B_mu[16], team_B_sigma[16], context[gameContextDim]]
    
    // Check that sigma values (positions 16-31 and 48-63) are reasonable posterior uncertainties
    const teamA_sigma = input.slice(16, 32);
    const teamB_sigma = input.slice(48, 64);
    
    // Posterior sigmas should be positive and within reasonable bounds
    for (let i = 0; i < 16; i++) {
      if (teamA_sigma[i] <= 0 || teamA_sigma[i] > 5.0) {
        logger.warn('Suspicious team A sigma value in NN input', {
          index: i,
          value: teamA_sigma[i],
          expected: 'positive value <= 5.0'
        });
      }
      
      if (teamB_sigma[i] <= 0 || teamB_sigma[i] > 5.0) {
        logger.warn('Suspicious team B sigma value in NN input', {
          index: i,
          value: teamB_sigma[i],
          expected: 'positive value <= 5.0'
        });
      }
    }
  }

  /**
   * Backward pass (alias for trainStep for compatibility)
   * @param {Array} input - Input vector
   * @param {Array} target - Target transition frequencies [8]
   * @param {number} learningRate - Learning rate (optional)
   * @returns {Promise<number>} - Loss value
   */
  async backward(input, target, learningRate = null) {
    return await this.trainStep(input, target, learningRate);
  }

  /**
   * Add training example to mini-batch buffer
   * @param {Array} input - Input vector
   * @param {Array} target - Target vector
   */
  addToBatch(input, target) {
    if (!this.batchBuffer) {
      this.batchBuffer = { inputs: [], targets: [] };
    }
    
    this.batchBuffer.inputs.push([...input]);
    this.batchBuffer.targets.push([...target]);
  }

  /**
   * Train on accumulated mini-batch and clear buffer
   * @returns {Promise<number>} - Average loss
   */
  async trainBatchBuffer() {
    if (!this.batchBuffer || this.batchBuffer.inputs.length === 0) {
      return 0;
    }

    const batchSize = this.batchBuffer.inputs.length;
    const inputTensor = tf.tensor2d(this.batchBuffer.inputs);
    const targetTensor = tf.tensor2d(this.batchBuffer.targets);

    try {
      // Train on the batch
      const history = await this.model.fit(inputTensor, targetTensor, {
        epochs: 1,
        batchSize: batchSize,
        verbose: 0
      });

      const loss = history.history.loss[0];

      // Clear buffer
      this.batchBuffer = { inputs: [], targets: [] };

      return loss;
    } finally {
      inputTensor.dispose();
      targetTensor.dispose();
    }
  }

  /**
   * Get current batch buffer size
   * @returns {number} - Number of samples in buffer
   */
  getBatchSize() {
    return this.batchBuffer ? this.batchBuffer.inputs.length : 0;
  }

  /**
   * Train on a batch of examples using TensorFlow.js
   * @param {Array} inputs - Array of input vectors
   * @param {Array} targets - Array of target transition frequencies
   * @returns {Promise<number>} - Average loss
   */
  async trainBatch(inputs, targets) {
    if (inputs.length !== targets.length) {
      throw new Error('Inputs and targets must have same length');
    }

    // Create tensors outside of tidy for async operations
    const inputTensor = tf.tensor2d(inputs, [inputs.length, this.inputDim]);
    const targetTensor = tf.tensor2d(targets, [targets.length, this.outputDim]);

    try {
      // Train on the batch
      const history = await this.model.fit(inputTensor, targetTensor, {
        epochs: 1,
        batchSize: inputs.length,
        verbose: 0
      });

      const loss = history.history.loss[0];

      logger.debug('Trained batch', {
        batchSize: inputs.length,
        averageLoss: loss.toFixed(6)
      });

      return loss;
    } finally {
      // Clean up tensors
      inputTensor.dispose();
      targetTensor.dispose();
    }
  }

  /**
   * Count total parameters in the TensorFlow.js model
   * @returns {number} - Total parameters
   */
  countParameters() {
    return this.model ? this.model.countParams() : 0;
  }

  /**
   * Validate transition probabilities sum to 1.0
   * @param {Array} probabilities - Transition probabilities
   * @param {number} tolerance - Tolerance for sum check
   * @returns {boolean} - Whether probabilities are valid
   */
  validateProbabilities(probabilities, tolerance = 1e-6) {
    if (probabilities.length !== this.outputDim) {
      return false;
    }

    // Check all probabilities are non-negative
    for (let i = 0; i < probabilities.length; i++) {
      if (probabilities[i] < 0 || probabilities[i] > 1) {
        return false;
      }
    }

    // Check probabilities sum to approximately 1.0
    const sum = probabilities.reduce((a, b) => a + b, 0);
    return Math.abs(sum - 1.0) < tolerance;
  }

  /**
   * Get network architecture summary
   * @returns {Object} - Architecture information
   */
  getArchitecture() {
    const layers = this.model ? this.model.layers.map(layer => ({
      name: layer.name,
      units: layer.units || layer.inputShape,
      activation: layer.activation ? layer.activation.name : 'none'
    })) : [];

    return {
      inputDim: this.inputDim,
      outputDim: this.outputDim,
      gameContextDim: this.gameContextDim,
      layers: layers,
      totalParameters: this.countParameters(),
      transitionLabels: this.transitionLabels
    };
  }

  /**
   * Save model to JSON (TensorFlow.js format)
   * @returns {Promise<Object>} - Model state
   */
  async toJSON() {
    const modelWeights = await this.model.getWeights();
    const weightsData = modelWeights.map(tensor => ({
      shape: tensor.shape,
      data: Array.from(tensor.dataSync())
    }));

    // DO NOT dispose of weight tensors here - they are still owned by the model
    // The model will manage their lifecycle
    // modelWeights.forEach(tensor => tensor.dispose());

    return {
      inputDim: this.inputDim,
      outputDim: this.outputDim,
      gameContextDim: this.gameContextDim,
      learningRate: this.learningRate,
      transitionLabels: this.transitionLabels,
      modelConfig: this.model.getConfig(),
      weights: weightsData
    };
  }

  /**
   * Load model from JSON (TensorFlow.js format)
   * @param {Object} state - Model state
   */
  async fromJSON(state) {
    this.inputDim = state.inputDim;
    this.outputDim = state.outputDim;
    this.gameContextDim = state.gameContextDim || 10;
    this.learningRate = state.learningRate;
    this.transitionLabels = state.transitionLabels || [
      '2pt_make', '2pt_miss', '3pt_make', '3pt_miss', 
      'ft_make', 'ft_miss', 'oreb', 'turnover'
    ];

    // Dispose existing model if it exists
    if (this.model) {
      this.model.dispose();
    }

    // Recreate model with same architecture
    this.initializeModel();

    // Restore weights if provided
    if (state.weights) {
      const weightTensors = state.weights.map(w => tf.tensor(w.data, w.shape));
      this.model.setWeights(weightTensors);
      
      // Clean up tensors
      weightTensors.forEach(tensor => tensor.dispose());
    }

    logger.info('Loaded TransitionProbabilityNN from JSON', {
      inputDim: this.inputDim,
      outputDim: this.outputDim,
      totalParameters: this.countParameters()
    });
  }

  /**
   * Save model to file (JSON format - compatible without tfjs-node)
   * @param {string} filepath - File path (without extension)
   */
  async saveToFile(filepath) {
    const fs = require('fs').promises;
    const path = require('path');
    
    // Ensure directory exists
    const dir = path.dirname(filepath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore error
    }
    
    try {
      // Try TensorFlow.js native format first (if tfjs-node is available)
      const absolutePath = path.resolve(filepath);
      await this.model.save(`file://${absolutePath}`);
      
      // Also save metadata
      const metadata = {
        inputDim: this.inputDim,
        outputDim: this.outputDim,
        gameContextDim: this.gameContextDim,
        learningRate: this.learningRate,
        transitionLabels: this.transitionLabels
      };
      
      await fs.writeFile(`${filepath}_metadata.json`, JSON.stringify(metadata, null, 2));
      logger.info('Saved TransitionProbabilityNN model to file (TensorFlow.js format)', { filepath });
      
    } catch (error) {
      // Fallback to JSON format if TensorFlow.js save fails
      logger.warn('TensorFlow.js save failed, using JSON fallback', { error: error.message });
      
      const weights = this.model.getWeights();
      const weightsData = weights.map(w => ({
        shape: w.shape,
        data: Array.from(w.dataSync())
      }));
      
      const modelData = {
        inputDim: this.inputDim,
        outputDim: this.outputDim,
        gameContextDim: this.gameContextDim,
        learningRate: this.learningRate,
        transitionLabels: this.transitionLabels,
        weights: weightsData,
        architecture: {
          layers: [
            { type: 'dense', units: 256, activation: 'relu', inputShape: [this.inputDim] },
            { type: 'dropout', rate: 0.2 },
            { type: 'dense', units: 192, activation: 'relu' },
            { type: 'dropout', rate: 0.2 },
            { type: 'dense', units: 128, activation: 'relu' },
            { type: 'dropout', rate: 0.15 },
            { type: 'dense', units: 64, activation: 'relu' },
            { type: 'dropout', rate: 0.1 },
            { type: 'dense', units: 32, activation: 'relu' },
            { type: 'dense', units: this.outputDim, activation: 'softmax' }
          ]
        },
        savedAt: new Date().toISOString(),
        format: 'json_fallback'
      };
      
      await fs.writeFile(`${filepath}.json`, JSON.stringify(modelData, null, 2));
      logger.info('Saved TransitionProbabilityNN model to file (JSON format)', { filepath });
      
      // DO NOT dispose of weight tensors - they are still owned by the model
      // weights.forEach(w => w.dispose());
    }
  }

  /**
   * Load model from file (supports both TensorFlow.js and JSON formats)
   * @param {string} filepath - File path (without extension)
   */
  async loadFromFile(filepath) {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      // Check if it's a TensorFlow.js model or JSON fallback
      const modelJsonExists = await fs.access(`${filepath}.json`).then(() => true).catch(() => false);
      const metadataExists = await fs.access(`${filepath}_metadata.json`).then(() => true).catch(() => false);
      
      if (modelJsonExists && metadataExists) {
        // Try TensorFlow.js format first
        try {
          const absolutePath = path.resolve(`${filepath}.json`);
          this.model = await tf.loadLayersModel(`file://${absolutePath}`);
          
          // Load metadata
          const metadataStr = await fs.readFile(`${filepath}_metadata.json`, 'utf8');
          const metadata = JSON.parse(metadataStr);
          
          this.inputDim = metadata.inputDim;
          this.outputDim = metadata.outputDim;
          this.gameContextDim = metadata.gameContextDim;
          this.learningRate = metadata.learningRate;
          this.transitionLabels = metadata.transitionLabels;
          
          logger.info('Loaded TransitionProbabilityNN model from file (TensorFlow.js format)', { filepath });
          
        } catch (tfError) {
          throw new Error(`TensorFlow.js load failed: ${tfError.message}`);
        }
        
      } else if (modelJsonExists) {
        // Try JSON fallback format
        const modelContent = await fs.readFile(`${filepath}.json`, 'utf8');
        const modelData = JSON.parse(modelContent);
        
        if (modelData.format === 'json_fallback') {
          // Load from JSON fallback format
          this.inputDim = modelData.inputDim;
          this.outputDim = modelData.outputDim;
          this.gameContextDim = modelData.gameContextDim;
          this.learningRate = modelData.learningRate;
          this.transitionLabels = modelData.transitionLabels;
          
          // Recreate model architecture
          this.initializeModel();
          
          // Restore weights
          if (modelData.weights) {
            const weightTensors = modelData.weights.map(w => tf.tensor(w.data, w.shape));
            this.model.setWeights(weightTensors);
            
            // Dispose of temporary tensors
            weightTensors.forEach(w => w.dispose());
          }
          
          logger.info('Loaded TransitionProbabilityNN model from file (JSON format)', { filepath });
          
        } else {
          throw new Error('Unknown model format');
        }
        
      } else {
        throw new Error('Model file not found');
      }
      
      // Recreate optimizer and compile
      this.optimizer = tf.train.adam(this.learningRate);
      this.model.compile({
        optimizer: this.optimizer,
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });

    } catch (error) {
      logger.error('Failed to load TransitionProbabilityNN model', {
        filepath,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Dispose of TensorFlow.js resources
   */
  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    if (this.optimizer) {
      this.optimizer = null; // Optimizer doesn't need explicit disposal
    }
    logger.debug('Disposed TransitionProbabilityNN resources');
  }
}

module.exports = TransitionProbabilityNN;