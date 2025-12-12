const TransitionProbabilityNN = require('../../src/modules/sports/TransitionProbabilityNN');

describe('TransitionProbabilityNN', () => {
  let nn;
  
  beforeEach(() => {
    nn = new TransitionProbabilityNN(10); // 10-dimensional game context
  });

  afterEach(() => {
    // Clean up TensorFlow.js tensors to prevent memory leaks
    if (nn.model) {
      nn.model.dispose();
    }
  });

  describe('Constructor and Architecture', () => {
    test('should initialize with correct dimensions', () => {
      expect(nn.inputDim).toBe(74); // 16+16+16+16+10
      expect(nn.outputDim).toBe(8);
      expect(nn.gameContextDim).toBe(10);
      expect(nn.transitionLabels).toHaveLength(8);
    });

    test('should have correct layer architecture', () => {
      const arch = nn.getArchitecture();
      expect(arch.layers).toHaveLength(4); // TensorFlow.js doesn't count input as a layer
      expect(arch.layers[0].units).toBe(128); // hidden1
      expect(arch.layers[1].units).toBe(64); // hidden2
      expect(arch.layers[2].units).toBe(32); // hidden3
      expect(arch.layers[3].units).toBe(8); // output
    });

    test('should initialize TensorFlow.js model', () => {
      expect(nn.model).toBeDefined();
      expect(nn.optimizer).toBeDefined();
      expect(nn.countParameters()).toBeGreaterThan(0);
    });
  });

  describe('Input Vector Building', () => {
    test('should build correct input vector from components', () => {
      const teamA_mu = new Array(16).fill(0.1);
      const teamA_sigma = new Array(16).fill(0.2);
      const teamB_mu = new Array(16).fill(0.3);
      const teamB_sigma = new Array(16).fill(0.4);
      const gameContext = new Array(10).fill(0.5);

      const input = nn.buildInputVector(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext);
      
      expect(input).toHaveLength(74);
      expect(input.slice(0, 16)).toEqual(teamA_mu);
      expect(input.slice(16, 32)).toEqual(teamA_sigma);
      expect(input.slice(32, 48)).toEqual(teamB_mu);
      expect(input.slice(48, 64)).toEqual(teamB_sigma);
      expect(input.slice(64, 74)).toEqual(gameContext);
    });

    test('should validate input dimensions', () => {
      const teamA_mu = new Array(15).fill(0.1); // Wrong dimension
      const teamA_sigma = new Array(16).fill(0.2);
      const teamB_mu = new Array(16).fill(0.3);
      const teamB_sigma = new Array(16).fill(0.4);
      const gameContext = new Array(10).fill(0.5);

      expect(() => {
        nn.buildInputVector(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext);
      }).toThrow('Team A mu must be 16-dimensional');
    });
  });

  describe('Forward Pass', () => {
    test('should perform forward pass and return probabilities', () => {
      const teamA_mu = new Array(16).fill(0.1);
      const teamA_sigma = new Array(16).fill(0.2);
      const teamB_mu = new Array(16).fill(0.3);
      const teamB_sigma = new Array(16).fill(0.4);
      const gameContext = new Array(10).fill(0.5);

      const probabilities = nn.forward(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext);
      
      expect(probabilities).toHaveLength(8);
      expect(nn.validateProbabilities(probabilities)).toBe(true);
      
      // Check probabilities sum to approximately 1.0
      const sum = probabilities.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 6);
    });

    test('should work with pre-built input vector', () => {
      const input = new Array(74).fill(0.1);
      const probabilities = nn.forward(input);
      
      expect(probabilities).toHaveLength(8);
      expect(nn.validateProbabilities(probabilities)).toBe(true);
    });

    test('should throw error for invalid input dimensions', () => {
      const input = new Array(50).fill(0.1); // Wrong dimension
      
      expect(() => {
        nn.forward(input);
      }).toThrow('Invalid input dimension');
    });
  });

  describe('Prediction with Labels', () => {
    test('should return labeled probabilities', () => {
      const teamA_mu = new Array(16).fill(0.1);
      const teamA_sigma = new Array(16).fill(0.2);
      const teamB_mu = new Array(16).fill(0.3);
      const teamB_sigma = new Array(16).fill(0.4);
      const gameContext = new Array(10).fill(0.5);

      const result = nn.predict(teamA_mu, teamA_sigma, teamB_mu, teamB_sigma, gameContext);
      
      expect(result).toHaveProperty('2pt_make');
      expect(result).toHaveProperty('2pt_miss');
      expect(result).toHaveProperty('3pt_make');
      expect(result).toHaveProperty('3pt_miss');
      expect(result).toHaveProperty('ft_make');
      expect(result).toHaveProperty('ft_miss');
      expect(result).toHaveProperty('oreb');
      expect(result).toHaveProperty('turnover');

      // All values should be valid probabilities
      Object.values(result).forEach(prob => {
        expect(prob).toBeGreaterThanOrEqual(0);
        expect(prob).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Loss Calculation', () => {
    test('should compute cross-entropy loss correctly', () => {
      const predicted = [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1];
      const actual = [0.25, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.05];
      
      const loss = nn.computeLoss(predicted, actual);
      
      expect(loss).toBeGreaterThan(0);
      expect(isFinite(loss)).toBe(true);
    });

    test('should handle zero probabilities gracefully', () => {
      const predicted = [0.0, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.3];
      const actual = [0.1, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.2];
      
      const loss = nn.computeLoss(predicted, actual);
      
      expect(isFinite(loss)).toBe(true);
    });

    test('should validate input dimensions', () => {
      const predicted = [0.2, 0.1, 0.15, 0.05, 0.1]; // Wrong length
      const actual = [0.25, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.05];
      
      expect(() => {
        nn.computeLoss(predicted, actual);
      }).toThrow('Predicted and actual arrays must have same length');
    });

    test('should validate probability values', () => {
      const predicted = [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1];
      const actual = [1.5, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.05]; // Invalid probability
      
      expect(() => {
        nn.computeLoss(predicted, actual);
      }).toThrow('Invalid probability');
    });
  });

  describe('Training', () => {
    test('should perform training step and return loss', async () => {
      const input = new Array(74).fill(0.1);
      const target = [0.25, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.05];
      
      const loss = await nn.trainStep(input, target);
      
      expect(loss).toBeGreaterThan(0);
      expect(isFinite(loss)).toBe(true);
    });

    test('should train on batch and return average loss', async () => {
      const inputs = [
        new Array(74).fill(0.1),
        new Array(74).fill(0.2),
        new Array(74).fill(0.3)
      ];
      const targets = [
        [0.25, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.05],
        [0.2, 0.2, 0.15, 0.05, 0.1, 0.1, 0.1, 0.1],
        [0.3, 0.1, 0.05, 0.15, 0.05, 0.15, 0.1, 0.1]
      ];
      
      const avgLoss = await nn.trainBatch(inputs, targets);
      
      expect(avgLoss).toBeGreaterThan(0);
      expect(isFinite(avgLoss)).toBe(true);
    });

    test('should validate batch dimensions', async () => {
      const inputs = [new Array(74).fill(0.1)];
      const targets = [
        [0.25, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.05],
        [0.2, 0.2, 0.15, 0.05, 0.1, 0.1, 0.1, 0.1]
      ]; // Mismatched lengths
      
      await expect(nn.trainBatch(inputs, targets)).rejects.toThrow('Inputs and targets must have same length');
    });

    test('should support backward method as alias', async () => {
      const input = new Array(74).fill(0.1);
      const target = [0.25, 0.15, 0.1, 0.1, 0.15, 0.05, 0.15, 0.05];
      
      const loss = await nn.backward(input, target);
      
      expect(loss).toBeGreaterThan(0);
      expect(isFinite(loss)).toBe(true);
    });
  });

  // Removed activation function and matrix operation tests since they're now handled by TensorFlow.js

  describe('Probability Validation', () => {
    test('should validate correct probabilities', () => {
      const probabilities = [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1];
      expect(nn.validateProbabilities(probabilities)).toBe(true);
    });

    test('should reject negative probabilities', () => {
      const probabilities = [-0.1, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.4];
      expect(nn.validateProbabilities(probabilities)).toBe(false);
    });

    test('should reject probabilities that do not sum to 1', () => {
      const probabilities = [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.5]; // Sum > 1
      expect(nn.validateProbabilities(probabilities)).toBe(false);
    });

    test('should reject wrong number of probabilities', () => {
      const probabilities = [0.5, 0.5]; // Wrong length
      expect(nn.validateProbabilities(probabilities)).toBe(false);
    });
  });

  describe('Serialization', () => {
    test('should serialize and deserialize correctly', async () => {
      const originalArch = nn.getArchitecture();
      const state = await nn.toJSON();
      
      const newNN = new TransitionProbabilityNN();
      await newNN.fromJSON(state);
      
      const newArch = newNN.getArchitecture();
      
      expect(newArch.inputDim).toBe(originalArch.inputDim);
      expect(newArch.outputDim).toBe(originalArch.outputDim);
      expect(newArch.totalParameters).toBe(originalArch.totalParameters);
      
      // Clean up
      newNN.model.dispose();
    });

    test('should maintain consistency after serialization', async () => {
      const input = new Array(74).fill(0.1);
      const originalOutput = nn.forward(input);
      
      const state = await nn.toJSON();
      const newNN = new TransitionProbabilityNN();
      await newNN.fromJSON(state);
      
      const newOutput = newNN.forward(input);
      
      // Should be approximately equal (floating point precision)
      for (let i = 0; i < originalOutput.length; i++) {
        expect(newOutput[i]).toBeCloseTo(originalOutput[i], 5);
      }
      
      // Clean up
      newNN.model.dispose();
    });
  });

  describe('Edge Cases', () => {
    test('should handle all-zero input', () => {
      const input = new Array(74).fill(0);
      const output = nn.forward(input);
      
      expect(output).toHaveLength(8);
      expect(nn.validateProbabilities(output)).toBe(true);
    });

    test('should handle extreme input values', () => {
      const input = new Array(74).fill(100);
      const output = nn.forward(input);
      
      expect(output).toHaveLength(8);
      expect(output.every(val => isFinite(val))).toBe(true);
      expect(nn.validateProbabilities(output)).toBe(true);
    });

    test('should handle mixed positive and negative inputs', () => {
      const input = new Array(74).fill(0).map((_, i) => i % 2 === 0 ? 1 : -1);
      const output = nn.forward(input);
      
      expect(output).toHaveLength(8);
      expect(nn.validateProbabilities(output)).toBe(true);
    });
  });
});