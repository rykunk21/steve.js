const tf = require('@tensorflow/tfjs');
const FrozenVAEEncoder = require('../../src/modules/sports/FrozenVAEEncoder');

describe('FrozenVAEEncoder', () => {
  let encoder;

  beforeEach(() => {
    encoder = new FrozenVAEEncoder(80, 16);
  });

  afterEach(() => {
    if (encoder) {
      encoder.dispose();
    }
  });

  describe('constructor', () => {
    test('should initialize with correct parameters', () => {
      expect(encoder.inputDim).toBe(80);
      expect(encoder.latentDim).toBe(16);
      expect(encoder.isFrozen).toBe(false);
      expect(encoder.encoder).toBeNull();
      expect(encoder.originalWeightsHash).toBeNull();
    });
  });

  describe('loadPretrainedWeights', () => {
    test('should load weights and freeze encoder', async () => {
      // Create mock pretrained weights
      const mockWeights = [
        { shape: [80, 64], data: new Array(80 * 64).fill(0.1) },
        { shape: [64], data: new Array(64).fill(0.05) },
        { shape: [64, 32], data: new Array(64 * 32).fill(0.2) },
        { shape: [32], data: new Array(32).fill(0.1) },
        { shape: [32, 32], data: new Array(32 * 32).fill(0.15) },
        { shape: [32], data: new Array(32).fill(0.08) }
      ];

      await encoder.loadPretrainedWeights(mockWeights);

      expect(encoder.encoder).toBeDefined();
      expect(encoder.isFrozen).toBe(true);
      expect(encoder.originalWeightsHash).toBeDefined();
      expect(encoder.encoder.countParams()).toBeGreaterThan(0);
    });

    test('should handle empty weights gracefully', async () => {
      await encoder.loadPretrainedWeights([]);

      expect(encoder.encoder).toBeDefined();
      expect(encoder.isFrozen).toBe(true);
      expect(encoder.originalWeightsHash).toBeDefined();
    });

    test('should handle null weights', async () => {
      await encoder.loadPretrainedWeights(null);

      expect(encoder.encoder).toBeDefined();
      expect(encoder.isFrozen).toBe(true);
      expect(encoder.originalWeightsHash).toBeDefined();
    });
  });

  describe('freezeEncoder', () => {
    test('should freeze encoder layers', async () => {
      // Initialize encoder first
      await encoder.loadPretrainedWeights([]);

      // Check that all layers are not trainable
      encoder.encoder.layers.forEach(layer => {
        expect(layer.trainable).toBe(false);
      });

      expect(encoder.isFrozen).toBe(true);
      expect(encoder.originalWeightsHash).toBeDefined();
    });

    test('should throw error if encoder not initialized', async () => {
      await expect(encoder.freezeEncoder()).rejects.toThrow(
        'Encoder not initialized. Call loadPretrainedWeights first.'
      );
    });
  });

  describe('encode', () => {
    beforeEach(async () => {
      await encoder.loadPretrainedWeights([]);
    });

    test('should encode array input to latent distribution', () => {
      const input = new Array(80).fill(0.5);
      const { mu, logVar, sigma } = encoder.encode(input);

      expect(mu.shape).toEqual([1, 16]);
      expect(logVar.shape).toEqual([1, 16]);
      expect(sigma.shape).toEqual([1, 16]);

      // Check that sigma = exp(0.5 * logVar)
      const expectedSigma = tf.exp(tf.mul(0.5, logVar));
      const sigmaDiff = tf.sub(sigma, expectedSigma);
      const maxDiff = tf.max(tf.abs(sigmaDiff)).dataSync()[0];
      expect(maxDiff).toBeLessThan(1e-6);

      mu.dispose();
      logVar.dispose();
      sigma.dispose();
      expectedSigma.dispose();
      sigmaDiff.dispose();
    });

    test('should encode tensor input to latent distribution', () => {
      const inputTensor = tf.randomNormal([2, 80]);
      const { mu, logVar, sigma } = encoder.encode(inputTensor);

      expect(mu.shape).toEqual([2, 16]);
      expect(logVar.shape).toEqual([2, 16]);
      expect(sigma.shape).toEqual([2, 16]);

      inputTensor.dispose();
      mu.dispose();
      logVar.dispose();
      sigma.dispose();
    });

    test('should throw error if encoder not loaded', () => {
      const freshEncoder = new FrozenVAEEncoder();
      const input = new Array(80).fill(0.5);

      expect(() => freshEncoder.encode(input)).toThrow(
        'Encoder not loaded. Call loadPretrainedWeights first.'
      );

      freshEncoder.dispose();
    });

    test('should update inference statistics', () => {
      const input = new Array(80).fill(0.5);
      const initialCount = encoder.inferenceCount;

      const { mu, logVar, sigma } = encoder.encode(input);

      expect(encoder.inferenceCount).toBe(initialCount + 1);
      expect(encoder.totalInferenceTime).toBeGreaterThan(0);

      mu.dispose();
      logVar.dispose();
      sigma.dispose();
    });
  });

  describe('encodeToTeamDistribution', () => {
    beforeEach(async () => {
      await encoder.loadPretrainedWeights([]);
    });

    test('should return team distribution as arrays', () => {
      const gameFeatures = new Array(80).fill(0.5);
      const { mu, sigma } = encoder.encodeToTeamDistribution(gameFeatures);

      expect(Array.isArray(mu)).toBe(true);
      expect(Array.isArray(sigma)).toBe(true);
      expect(mu).toHaveLength(16);
      expect(sigma).toHaveLength(16);

      // All sigma values should be positive
      expect(sigma.every(s => s > 0)).toBe(true);
    });
  });

  describe('validateImmutability', () => {
    beforeEach(async () => {
      await encoder.loadPretrainedWeights([]);
    });

    test('should validate unchanged weights', async () => {
      const isValid = await encoder.validateImmutability(false);
      expect(isValid).toBe(true);
      expect(encoder.validationCount).toBe(1);
    });

    test('should detect weight changes', async () => {
      // Manually change a weight to simulate violation
      const weights = encoder.encoder.getWeights();
      const modifiedWeight = tf.add(weights[0], tf.scalar(0.001));
      
      // Create new weight array without disposing original weights (they're owned by the model)
      const newWeights = [modifiedWeight, ...weights.slice(1)];
      encoder.encoder.setWeights(newWeights);

      const isValid = await encoder.validateImmutability(false);
      expect(isValid).toBe(false);

      // Only dispose the tensor we created
      modifiedWeight.dispose();
    });

    test('should throw error on weight changes when throwOnChange=true', async () => {
      // Manually change a weight
      const weights = encoder.encoder.getWeights();
      const modifiedWeight = tf.add(weights[0], tf.scalar(0.001));
      
      const newWeights = [modifiedWeight, ...weights.slice(1)];
      encoder.encoder.setWeights(newWeights);

      await expect(encoder.validateImmutability(true)).rejects.toThrow(
        'CRITICAL: Encoder weights have changed! Immutability violated.'
      );

      // Only dispose the tensor we created
      modifiedWeight.dispose();
    });

    test('should handle unfrozen encoder', async () => {
      encoder.isFrozen = false;
      encoder.originalWeightsHash = null;

      await expect(encoder.validateImmutability(true)).rejects.toThrow(
        'Encoder not properly frozen or hash not computed'
      );
    });
  });

  describe('computeWeightsHash', () => {
    beforeEach(async () => {
      await encoder.loadPretrainedWeights([]);
    });

    test('should compute consistent hash for same weights', async () => {
      const hash1 = await encoder.computeWeightsHash();
      const hash2 = await encoder.computeWeightsHash();

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBeGreaterThan(0);
    });

    test('should compute different hash for different weights', async () => {
      const hash1 = await encoder.computeWeightsHash();

      // Modify weights
      const weights = encoder.encoder.getWeights();
      const modifiedWeight = tf.add(weights[0], tf.scalar(0.001));
      
      const newWeights = [modifiedWeight, ...weights.slice(1)];
      encoder.encoder.setWeights(newWeights);

      const hash2 = await encoder.computeWeightsHash();

      expect(hash1).not.toBe(hash2);

      // Only dispose the tensor we created
      modifiedWeight.dispose();
    });

    test('should throw error if encoder not initialized', async () => {
      const freshEncoder = new FrozenVAEEncoder();

      await expect(freshEncoder.computeWeightsHash()).rejects.toThrow(
        'Encoder not initialized'
      );

      freshEncoder.dispose();
    });
  });

  describe('periodicValidation', () => {
    beforeEach(async () => {
      await encoder.loadPretrainedWeights([]);
    });

    test('should perform validation when interval elapsed', async () => {
      // Set last validation time to past
      encoder.lastValidationTime = Date.now() - 120000; // 2 minutes ago
      const initialCount = encoder.validationCount;

      const result = await encoder.periodicValidation(60000); // 1 minute interval

      expect(result).toBe(true);
      expect(encoder.validationCount).toBe(initialCount + 1);
    });

    test('should skip validation when interval not elapsed', async () => {
      // Set last validation time to recent
      encoder.lastValidationTime = Date.now() - 30000; // 30 seconds ago
      const initialCount = encoder.validationCount;

      const result = await encoder.periodicValidation(60000); // 1 minute interval

      expect(result).toBe(true);
      expect(encoder.validationCount).toBe(initialCount); // No new validation
    });
  });

  describe('getEncoderStats', () => {
    test('should return stats for uninitialized encoder', () => {
      const stats = encoder.getEncoderStats();

      expect(stats.isFrozen).toBe(false);
      expect(stats.inputDim).toBe(80);
      expect(stats.latentDim).toBe(16);
      expect(stats.totalParams).toBe(0);
      expect(stats.inferenceCount).toBe(0);
      expect(stats.validationCount).toBe(0);
      expect(stats.weightsHash).toBeNull();
    });

    test('should return stats for initialized encoder', async () => {
      await encoder.loadPretrainedWeights([]);

      // Perform some operations
      const input = new Array(80).fill(0.5);
      const { mu, logVar, sigma } = encoder.encode(input);
      await encoder.validateImmutability(false);

      const stats = encoder.getEncoderStats();

      expect(stats.isFrozen).toBe(true);
      expect(stats.totalParams).toBeGreaterThan(0);
      expect(stats.inferenceCount).toBe(1);
      expect(stats.avgInferenceTime).toBeGreaterThan(0);
      expect(stats.validationCount).toBe(1); // One manual validation
      expect(stats.weightsHash).toBeDefined();

      mu.dispose();
      logVar.dispose();
      sigma.dispose();
    });
  });

  describe('serialization', () => {
    beforeEach(async () => {
      await encoder.loadPretrainedWeights([]);
    });

    test('should save and load encoder state', async () => {
      // Perform some operations to change stats
      const input = new Array(80).fill(0.5);
      const { mu, logVar, sigma } = encoder.encode(input);

      const savedState = await encoder.saveState();

      expect(savedState.inputDim).toBe(80);
      expect(savedState.latentDim).toBe(16);
      expect(savedState.isFrozen).toBe(true);
      expect(savedState.weightsHash).toBeDefined();
      expect(savedState.encoderWeights).toBeDefined();

      // Create new encoder and load state
      const newEncoder = new FrozenVAEEncoder();
      await newEncoder.loadState(savedState);

      expect(newEncoder.isFrozen).toBe(true);
      expect(newEncoder.originalWeightsHash).toBe(encoder.originalWeightsHash);

      // Validate that both encoders produce same output
      const { mu: mu2, logVar: logVar2, sigma: sigma2 } = newEncoder.encode(input);

      const muDiff = tf.sub(mu, mu2);
      const maxMuDiff = tf.max(tf.abs(muDiff)).dataSync()[0];
      expect(maxMuDiff).toBeLessThan(1e-6);

      // Clean up
      mu.dispose();
      logVar.dispose();
      sigma.dispose();
      mu2.dispose();
      logVar2.dispose();
      sigma2.dispose();
      muDiff.dispose();
      newEncoder.dispose();
    });

    test('should throw error when saving uninitialized encoder', async () => {
      const freshEncoder = new FrozenVAEEncoder();

      await expect(freshEncoder.saveState()).rejects.toThrow(
        'Encoder not properly initialized and frozen'
      );

      freshEncoder.dispose();
    });
  });

  describe('resource management', () => {
    test('should dispose resources without errors', async () => {
      await encoder.loadPretrainedWeights([]);

      expect(() => {
        encoder.dispose();
        encoder = null; // Prevent double disposal in afterEach
      }).not.toThrow();
    });

    test('should handle disposal of uninitialized encoder', () => {
      const freshEncoder = new FrozenVAEEncoder();

      expect(() => {
        freshEncoder.dispose();
      }).not.toThrow();
    });
  });
});