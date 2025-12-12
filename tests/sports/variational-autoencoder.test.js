const VariationalAutoencoder = require('../../src/modules/sports/VariationalAutoencoder');

describe('VariationalAutoencoder', () => {
  let vae;

  beforeEach(() => {
    vae = new VariationalAutoencoder(80, 16);
  });

  describe('initialization', () => {
    test('should initialize with correct dimensions', () => {
      expect(vae.inputDim).toBe(80);
      expect(vae.latentDim).toBe(16);
      expect(vae.encoderWeights).toHaveLength(3); // 3 layers in encoder
      expect(vae.decoderWeights).toHaveLength(3); // 3 layers in decoder
    });

    test('should have proper encoder architecture', () => {
      expect(vae.encoderLayers).toEqual([
        { size: 80, type: 'input' },
        { size: 64, type: 'hidden', activation: 'relu' },
        { size: 32, type: 'hidden', activation: 'relu' },
        { size: 32, type: 'output', activation: 'linear' } // 16*2 for μ and log(σ²)
      ]);
    });

    test('should have proper decoder architecture', () => {
      expect(vae.decoderLayers).toEqual([
        { size: 16, type: 'input' },
        { size: 32, type: 'hidden', activation: 'relu' },
        { size: 64, type: 'hidden', activation: 'relu' },
        { size: 80, type: 'output', activation: 'sigmoid' }
      ]);
    });
  });

  describe('encoding', () => {
    test('should encode input to latent distribution parameters', () => {
      const input = new Array(80).fill(0).map(() => Math.random());
      const { mu, logVar } = vae.encode(input);
      
      expect(mu).toHaveLength(16);
      expect(logVar).toHaveLength(16);
      expect(mu.every(val => typeof val === 'number')).toBe(true);
      expect(logVar.every(val => typeof val === 'number')).toBe(true);
    });

    test('should throw error for invalid input dimension', () => {
      const invalidInput = new Array(50).fill(0);
      expect(() => vae.encode(invalidInput)).toThrow('Invalid input dimension');
    });
  });

  describe('decoding', () => {
    test('should decode latent vector to reconstructed features', () => {
      const z = new Array(16).fill(0).map(() => Math.random());
      const reconstruction = vae.decode(z);
      
      expect(reconstruction).toHaveLength(80);
      expect(reconstruction.every(val => typeof val === 'number')).toBe(true);
      // Sigmoid output should be in [0,1] range
      expect(reconstruction.every(val => val >= 0 && val <= 1)).toBe(true);
    });

    test('should throw error for invalid latent dimension', () => {
      const invalidZ = new Array(10).fill(0);
      expect(() => vae.decode(invalidZ)).toThrow('Invalid latent dimension');
    });
  });

  describe('reparameterization', () => {
    test('should sample from latent distribution', () => {
      const mu = new Array(16).fill(0);
      const logVar = new Array(16).fill(0); // log(1) = 0, so σ = 1
      const z = vae.reparameterize(mu, logVar);
      
      expect(z).toHaveLength(16);
      expect(z.every(val => typeof val === 'number')).toBe(true);
    });

    test('should produce different samples', () => {
      const mu = new Array(16).fill(0);
      const logVar = new Array(16).fill(0);
      const z1 = vae.reparameterize(mu, logVar);
      const z2 = vae.reparameterize(mu, logVar);
      
      // Should be different due to random sampling
      expect(z1).not.toEqual(z2);
    });
  });

  describe('forward pass', () => {
    test('should perform complete forward pass', () => {
      const input = new Array(80).fill(0).map(() => Math.random());
      const { reconstruction, mu, logVar, z } = vae.forward(input);
      
      expect(reconstruction).toHaveLength(80);
      expect(mu).toHaveLength(16);
      expect(logVar).toHaveLength(16);
      expect(z).toHaveLength(16);
      
      // Reconstruction should be in [0,1] range
      expect(reconstruction.every(val => val >= 0 && val <= 1)).toBe(true);
    });
  });

  describe('loss computation', () => {
    test('should compute VAE loss components', () => {
      const input = new Array(80).fill(0).map(() => Math.random());
      const reconstruction = new Array(80).fill(0).map(() => Math.random());
      const mu = new Array(16).fill(0);
      const logVar = new Array(16).fill(0);
      
      const lossInfo = vae.computeLoss(input, reconstruction, mu, logVar);
      
      expect(lossInfo).toHaveProperty('totalLoss');
      expect(lossInfo).toHaveProperty('reconstructionLoss');
      expect(lossInfo).toHaveProperty('klLoss');
      expect(lossInfo).toHaveProperty('vaeLoss');
      expect(lossInfo).toHaveProperty('nnFeedbackLoss');
      expect(lossInfo).toHaveProperty('alpha');
      
      expect(typeof lossInfo.totalLoss).toBe('number');
      expect(typeof lossInfo.reconstructionLoss).toBe('number');
      expect(typeof lossInfo.klLoss).toBe('number');
      expect(lossInfo.klLoss).toBeGreaterThanOrEqual(0); // KL divergence is non-negative
    });

    test('should include NN feedback loss when provided', () => {
      const input = new Array(80).fill(0).map(() => Math.random());
      const reconstruction = new Array(80).fill(0).map(() => Math.random());
      const mu = new Array(16).fill(0);
      const logVar = new Array(16).fill(0);
      const nnFeedbackLoss = 0.5;
      
      const lossInfo = vae.computeLoss(input, reconstruction, mu, logVar, nnFeedbackLoss);
      
      expect(lossInfo.nnFeedbackLoss).toBe(nnFeedbackLoss);
      expect(lossInfo.totalLoss).toBeGreaterThan(lossInfo.vaeLoss);
    });
  });

  describe('team distribution methods', () => {
    test('should encode game features to team distribution', () => {
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const { mu, sigma } = vae.encodeGameToTeamDistribution(gameFeatures);
      
      expect(mu).toHaveLength(16);
      expect(sigma).toHaveLength(16);
      expect(sigma.every(val => val > 0)).toBe(true); // Standard deviation should be positive
    });

    test('should sample from team distribution', () => {
      const mu = new Array(16).fill(0);
      const sigma = new Array(16).fill(1);
      const sample = vae.sampleFromTeamDistribution(mu, sigma);
      
      expect(sample).toHaveLength(16);
      expect(sample.every(val => typeof val === 'number')).toBe(true);
    });
  });

  describe('feedback coefficient', () => {
    test('should decay feedback coefficient', () => {
      const initialAlpha = vae.alphaFeedback;
      vae.decayFeedbackCoefficient();
      
      expect(vae.alphaFeedback).toBeLessThan(initialAlpha);
      expect(vae.alphaFeedback).toBe(initialAlpha * vae.feedbackDecayRate);
    });

    test('should set feedback coefficient', () => {
      const newAlpha = 0.05;
      vae.setFeedbackCoefficient(newAlpha);
      
      expect(vae.alphaFeedback).toBe(newAlpha);
    });
  });

  describe('serialization', () => {
    test('should serialize and deserialize model state', () => {
      const originalState = vae.toJSON();
      const newVae = new VariationalAutoencoder();
      newVae.fromJSON(originalState);
      
      expect(newVae.inputDim).toBe(vae.inputDim);
      expect(newVae.latentDim).toBe(vae.latentDim);
      expect(newVae.learningRate).toBe(vae.learningRate);
      expect(newVae.alphaFeedback).toBe(vae.alphaFeedback);
    });
  });

  describe('parameter counting', () => {
    test('should count parameters correctly', () => {
      const paramCount = vae.countParameters();
      
      // Calculate expected parameters
      // Encoder: (80*64 + 64) + (64*32 + 32) + (32*32 + 32) = 5120 + 64 + 2048 + 32 + 1024 + 32 = 8320
      // Decoder: (16*32 + 32) + (32*64 + 64) + (64*80 + 80) = 512 + 32 + 2048 + 64 + 5120 + 80 = 7856
      // Total: 8320 + 7856 = 16176
      const expectedParams = 16176;
      
      expect(paramCount).toBe(expectedParams);
    });
  });
});