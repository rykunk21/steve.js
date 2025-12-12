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
    this.learningRate = 0.001;
    this.batchSize = 32;
    
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
   * Initialize TensorFlow.js model with specified architecture
   */
  initializeModel() {
    // Create sequential model
    this.model = tf.sequential();

    // Input layer (implicit in first dense layer)
    // Hidden layer 1: 128 units with ReLU activation
    this.model.add(tf.layers.dense({
      inputShape: [this.inputDim],
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      biasInitializer: 'zeros',
      name: 'hidden1'
    }));

    // Hidden layer 2: 64 units with ReLU activation
    this.model.add(tf.layers.dense({
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      biasInitializer: 'zeros',
      name: 'hidden2'
    }));

    // Hidden layer 3: 32 units with ReLU activation
    this.model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      biasInitializer: 'zeros',
      name: 'hidden3'
    }));

    // Output layer: 8 units with softmax activation for probabilities
    this.model.add(tf.layers.dense({
      units: this.outputDim,
      activation: 'softmax',
      kernelInitializer: 'glorotNormal',
      biasInitializer: 'zeros',
      name: 'output'
    }));

    // Create optimizer (Adam with specified learning rate)
    this.optimizer = tf.train.adam(this.learningRate);

    // Compile model with categorical crossentropy loss
    this.model.compile({
      optimizer: this.optimizer,
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

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
   * Build input vector from team latent distributions and game context
   * @param {Array} teamA_mu - Team A mean vector [16]
   * @param {Array} teamA_sigma - Team A standard deviation vector [16]
   * @param {Array} teamB_mu - Team B mean vector [16]
   * @param {Array} teamB_sigma - Team B standard deviation vector [16]
   * @param {Array} gameContext - Game context features [gameContextDim]
   * @returns {Array} - Combined input vector
   */
  buildInputVector(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext) {
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

    // Concatenate all input components
    return [
      ...teamA_mu,
      ...teamA_sigma,
      ...teamB_mu,
      ...teamB_sigma,
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
   * Predict transition probabilities from team representations
   * @param {Array} teamA_mu - Team A mean vector [16]
   * @param {Array} teamA_sigma - Team A standard deviation vector [16]
   * @param {Array} teamB_mu - Team B mean vector [16]
   * @param {Array} teamB_sigma - Team B standard deviation vector [16]
   * @param {Array} gameContext - Game context features [gameContextDim]
   * @returns {Object} - Transition probabilities with labels
   */
  predict(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext) {
    const probabilities = this.forward(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext);
    
    // Return labeled probabilities
    const result = {};
    for (let i = 0; i < this.transitionLabels.length; i++) {
      result[this.transitionLabels[i]] = probabilities[i];
    }
    
    return result;
  }

  /**
   * Compute cross-entropy loss between predicted and actual transition frequencies using TensorFlow.js
   * @param {Array} predicted - Predicted probabilities [8]
   * @param {Array} actual - Actual transition frequencies [8]
   * @returns {number} - Cross-entropy loss
   */
  computeLoss(predicted, actual) {
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

    // Use TensorFlow.js to compute categorical crossentropy
    return tf.tidy(() => {
      const predictedTensor = tf.tensor1d(predicted);
      const actualTensor = tf.tensor1d(actual);
      
      const loss = tf.losses.softmaxCrossEntropy(actualTensor, predictedTensor);
      return loss.dataSync()[0];
    });
  }

  /**
   * Train on a single example using TensorFlow.js automatic differentiation
   * @param {Array} input - Input vector
   * @param {Array} target - Target transition frequencies [8]
   * @param {number} learningRate - Learning rate (optional)
   * @returns {Promise<number>} - Loss value
   */
  async trainStep(input, target, learningRate = null) {
    if (learningRate && learningRate !== this.learningRate) {
      // Update optimizer learning rate if different
      this.optimizer.setLearningRate(learningRate);
    }

    // Validate inputs
    if (input.length !== this.inputDim) {
      throw new Error(`Invalid input dimension: expected ${this.inputDim}, got ${input.length}`);
    }
    
    if (target.length !== this.outputDim) {
      throw new Error(`Invalid target dimension: expected ${this.outputDim}, got ${target.length}`);
    }

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
      
      // Apply gradients
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
   * Save model to file (TensorFlow.js format)
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
    
    // Save using TensorFlow.js native format for better performance
    // Use file:// protocol with absolute path
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
    logger.info('Saved TransitionProbabilityNN model to file', { filepath });
  }

  /**
   * Load model from file (TensorFlow.js format)
   * @param {string} filepath - File path (without extension)
   */
  async loadFromFile(filepath) {
    const path = require('path');
    
    // Load TensorFlow.js model using absolute path
    const absolutePath = path.resolve(`${filepath}.json`);
    this.model = await tf.loadLayersModel(`file://${absolutePath}`);
    
    // Load metadata
    const fs = require('fs').promises;
    const metadataStr = await fs.readFile(`${filepath}_metadata.json`, 'utf8');
    const metadata = JSON.parse(metadataStr);
    
    this.inputDim = metadata.inputDim;
    this.outputDim = metadata.outputDim;
    this.gameContextDim = metadata.gameContextDim;
    this.learningRate = metadata.learningRate;
    this.transitionLabels = metadata.transitionLabels;
    
    // Recreate optimizer
    this.optimizer = tf.train.adam(this.learningRate);
    this.model.compile({
      optimizer: this.optimizer,
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
    
    logger.info('Loaded TransitionProbabilityNN model from file', { filepath });
  }
}

module.exports = TransitionProbabilityNN;