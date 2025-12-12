const logger = require('../../utils/logger');

/**
 * Multi-Layer Perceptron for generating transition probabilities
 * Architecture: Input (35) → Hidden (128, 64, 32) → Output (16)
 */
class TransitionMatrixMLP {
  constructor(inputDim = 35, outputDim = 16) {
    this.inputDim = inputDim;
    this.outputDim = outputDim;
    
    // Network architecture
    this.layers = [
      { size: inputDim, type: 'input' },
      { size: 128, type: 'hidden', activation: 'relu' },
      { size: 64, type: 'hidden', activation: 'relu' },
      { size: 32, type: 'hidden', activation: 'relu' },
      { size: outputDim, type: 'output', activation: 'softmax' }
    ];

    // Initialize weights and biases
    this.weights = [];
    this.biases = [];
    this.initializeWeights();

    // Training parameters
    this.learningRate = 0.001;
    this.batchSize = 32;
  }

  /**
   * Initialize weights using He initialization
   */
  initializeWeights() {
    for (let i = 0; i < this.layers.length - 1; i++) {
      const inputSize = this.layers[i].size;
      const outputSize = this.layers[i + 1].size;

      // He initialization: weights ~ N(0, sqrt(2/inputSize))
      const stdDev = Math.sqrt(2.0 / inputSize);
      const weights = this.createMatrix(outputSize, inputSize);
      
      for (let row = 0; row < outputSize; row++) {
        for (let col = 0; col < inputSize; col++) {
          weights[row][col] = this.randomNormal(0, stdDev);
        }
      }

      this.weights.push(weights);
      
      // Initialize biases to zero
      this.biases.push(new Array(outputSize).fill(0));
    }

    logger.info('Initialized MLP weights', {
      layers: this.layers.map(l => l.size),
      totalWeights: this.countParameters()
    });
  }

  /**
   * Forward pass through the network
   * @param {Array} input - Input vector
   * @returns {Array} - Output probabilities
   */
  forward(input) {
    if (input.length !== this.inputDim) {
      throw new Error(`Invalid input dimension: expected ${this.inputDim}, got ${input.length}`);
    }

    let activation = input;
    const activations = [activation]; // Store for backprop

    // Forward through each layer
    for (let i = 0; i < this.weights.length; i++) {
      const layer = this.layers[i + 1];
      
      // Linear transformation: z = W * a + b
      const z = this.matrixVectorMultiply(this.weights[i], activation);
      for (let j = 0; j < z.length; j++) {
        z[j] += this.biases[i][j];
      }

      // Apply activation function
      if (layer.activation === 'relu') {
        activation = this.relu(z);
      } else if (layer.activation === 'softmax') {
        activation = this.softmax(z);
      } else {
        activation = z;
      }

      activations.push(activation);
    }

    return activation;
  }

  /**
   * Compute loss (cross-entropy) between predicted and actual probabilities
   * @param {Array} predicted - Predicted probabilities
   * @param {Array} actual - Actual probabilities
   * @returns {number} - Cross-entropy loss
   */
  computeLoss(predicted, actual) {
    if (predicted.length !== actual.length) {
      throw new Error('Predicted and actual arrays must have same length');
    }

    let loss = 0;
    const epsilon = 1e-10; // Prevent log(0)

    for (let i = 0; i < predicted.length; i++) {
      loss -= actual[i] * Math.log(predicted[i] + epsilon);
    }

    return loss;
  }

  /**
   * Backward pass (backpropagation)
   * @param {Array} input - Input vector
   * @param {Array} target - Target output
   * @param {number} learningRate - Learning rate
   * @returns {number} - Loss value
   */
  backward(input, target, learningRate = null) {
    const lr = learningRate || this.learningRate;

    // Forward pass to get activations
    let activation = input;
    const activations = [activation];
    const zValues = [];

    for (let i = 0; i < this.weights.length; i++) {
      const z = this.matrixVectorMultiply(this.weights[i], activation);
      for (let j = 0; j < z.length; j++) {
        z[j] += this.biases[i][j];
      }
      zValues.push(z);

      const layer = this.layers[i + 1];
      if (layer.activation === 'relu') {
        activation = this.relu(z);
      } else if (layer.activation === 'softmax') {
        activation = this.softmax(z);
      } else {
        activation = z;
      }

      activations.push(activation);
    }

    // Compute loss
    const loss = this.computeLoss(activation, target);

    // Backward pass
    const deltas = [];
    
    // Output layer delta (for softmax + cross-entropy)
    let delta = [];
    for (let i = 0; i < activation.length; i++) {
      delta.push(activation[i] - target[i]);
    }
    deltas.unshift(delta);

    // Hidden layers deltas
    for (let i = this.weights.length - 2; i >= 0; i--) {
      const layer = this.layers[i + 1];
      const nextDelta = deltas[0];
      
      // Backpropagate through weights
      delta = this.matrixVectorMultiplyTranspose(this.weights[i + 1], nextDelta);
      
      // Apply derivative of activation function
      if (layer.activation === 'relu') {
        for (let j = 0; j < delta.length; j++) {
          delta[j] *= zValues[i][j] > 0 ? 1 : 0; // ReLU derivative
        }
      }
      
      deltas.unshift(delta);
    }

    // Update weights and biases
    for (let i = 0; i < this.weights.length; i++) {
      const delta = deltas[i + 1];
      const prevActivation = activations[i];

      // Update weights: W -= lr * delta * activation^T
      for (let j = 0; j < this.weights[i].length; j++) {
        for (let k = 0; k < this.weights[i][j].length; k++) {
          this.weights[i][j][k] -= lr * delta[j] * prevActivation[k];
        }
      }

      // Update biases: b -= lr * delta
      for (let j = 0; j < this.biases[i].length; j++) {
        this.biases[i][j] -= lr * delta[j];
      }
    }

    return loss;
  }

  /**
   * Train on a batch of examples
   * @param {Array} inputs - Array of input vectors
   * @param {Array} targets - Array of target outputs
   * @returns {number} - Average loss
   */
  trainBatch(inputs, targets) {
    if (inputs.length !== targets.length) {
      throw new Error('Inputs and targets must have same length');
    }

    let totalLoss = 0;

    for (let i = 0; i < inputs.length; i++) {
      const loss = this.backward(inputs[i], targets[i]);
      totalLoss += loss;
    }

    return totalLoss / inputs.length;
  }

  /**
   * ReLU activation function
   * @param {Array} z - Input values
   * @returns {Array} - Activated values
   */
  relu(z) {
    return z.map(val => Math.max(0, val));
  }

  /**
   * Softmax activation function
   * @param {Array} z - Input values
   * @returns {Array} - Probability distribution
   */
  softmax(z) {
    // Subtract max for numerical stability
    const maxZ = Math.max(...z);
    const expZ = z.map(val => Math.exp(val - maxZ));
    const sumExpZ = expZ.reduce((a, b) => a + b, 0);
    return expZ.map(val => val / sumExpZ);
  }

  /**
   * Matrix-vector multiplication
   * @param {Array} matrix - 2D matrix
   * @param {Array} vector - 1D vector
   * @returns {Array} - Result vector
   */
  matrixVectorMultiply(matrix, vector) {
    const result = new Array(matrix.length).fill(0);
    
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < vector.length; j++) {
        result[i] += matrix[i][j] * vector[j];
      }
    }
    
    return result;
  }

  /**
   * Matrix-vector multiplication with transpose
   * @param {Array} matrix - 2D matrix
   * @param {Array} vector - 1D vector
   * @returns {Array} - Result vector
   */
  matrixVectorMultiplyTranspose(matrix, vector) {
    const result = new Array(matrix[0].length).fill(0);
    
    for (let i = 0; i < matrix[0].length; i++) {
      for (let j = 0; j < matrix.length; j++) {
        result[i] += matrix[j][i] * vector[j];
      }
    }
    
    return result;
  }

  /**
   * Create a 2D matrix
   * @param {number} rows - Number of rows
   * @param {number} cols - Number of columns
   * @returns {Array} - 2D matrix
   */
  createMatrix(rows, cols) {
    const matrix = [];
    for (let i = 0; i < rows; i++) {
      matrix.push(new Array(cols).fill(0));
    }
    return matrix;
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
   * Count total parameters in the network
   * @returns {number} - Total parameters
   */
  countParameters() {
    let count = 0;
    
    for (let i = 0; i < this.weights.length; i++) {
      count += this.weights[i].length * this.weights[i][0].length;
      count += this.biases[i].length;
    }
    
    return count;
  }

  /**
   * Save model weights to JSON
   * @returns {Object} - Model state
   */
  toJSON() {
    return {
      inputDim: this.inputDim,
      outputDim: this.outputDim,
      layers: this.layers,
      weights: this.weights,
      biases: this.biases,
      learningRate: this.learningRate
    };
  }

  /**
   * Load model weights from JSON
   * @param {Object} state - Model state
   */
  fromJSON(state) {
    this.inputDim = state.inputDim;
    this.outputDim = state.outputDim;
    this.layers = state.layers;
    this.weights = state.weights;
    this.biases = state.biases;
    this.learningRate = state.learningRate;

    logger.info('Loaded MLP weights from JSON', {
      layers: this.layers.map(l => l.size),
      totalWeights: this.countParameters()
    });
  }

  /**
   * Save model to file
   * @param {string} filepath - File path
   */
  async saveToFile(filepath) {
    const fs = require('fs').promises;
    const state = this.toJSON();
    await fs.writeFile(filepath, JSON.stringify(state, null, 2));
    logger.info('Saved MLP model to file', { filepath });
  }

  /**
   * Load model from file
   * @param {string} filepath - File path
   */
  async loadFromFile(filepath) {
    const fs = require('fs').promises;
    const data = await fs.readFile(filepath, 'utf8');
    const state = JSON.parse(data);
    this.fromJSON(state);
    logger.info('Loaded MLP model from file', { filepath });
  }
}

module.exports = TransitionMatrixMLP;
