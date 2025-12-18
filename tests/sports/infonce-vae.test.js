const tf = require('@tensorflow/tfjs');
const InfoNCEVAE = require('../../src/modules/sports/InfoNCEVAE');

// Mock the data sampler to avoid database dependencies
jest.mock('../../src/modules/sports/InfoNCEDataSampler', () => {
  return jest.fn().mockImplementation(() => ({
    sampleContrastivePair: jest.fn().mockResolvedValue({
      positive: {
        home: [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1],
        away: [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1]
      },
      negatives: [
        [0.25, 0.12, 0.13, 0.08, 0.12, 0.06, 0.18, 0.06],
        [0.18, 0.14, 0.16, 0.07, 0.09, 0.04, 0.22, 0.1],
        [0.22, 0.11, 0.14, 0.06, 0.11, 0.07, 0.19, 0.1],
        [0.28, 0.13, 0.12, 0.09, 0.08, 0.05, 0.16, 0.09]
      ]
    }),
    getCacheStats: jest.fn().mockReturnValue({
      cacheSize: 100,
      sampleCount: 50,
      cacheRefreshInterval: 100
    })
  }));
});

describe('InfoNCEVAE', () => {
  let vae;

  beforeEach(() => {
    vae = new InfoNCEVAE(80, 16, 0.1);
  });

  afterEach(() => {
    if (vae) {
      vae.dispose();
    }
  });

  describe('constructor', () => {
    test('should initialize with InfoNCE parameters', () => {
      expect(vae.lambdaInfoNCE).toBe(1.0);
      expect(vae.temperature).toBe(0.1);
      expect(vae.numNegatives).toBe(64);
      expect(vae.infoNCEStep).toBe(0);
      expect(vae.infoNCELoss).toBeDefined();
      expect(vae.dataSampler).toBeDefined();
    });

    test('should inherit from base VAE', () => {
      expect(vae.inputDim).toBe(80);
      expect(vae.latentDim).toBe(16);
      expect(vae.encoder).toBeDefined();
      expect(vae.decoder).toBeDefined();
    });
  });

  describe('getCurrentLambdaInfoNCE', () => {
    test('should return annealed lambda during warmup', () => {
      vae.infoNCEStep = 0;
      expect(vae.getCurrentLambdaInfoNCE()).toBe(0.1); // min value
      
      vae.infoNCEStep = 50; // halfway through warmup
      expect(vae.getCurrentLambdaInfoNCE()).toBeCloseTo(0.55, 2);
      
      vae.infoNCEStep = 100; // end of warmup
      expect(vae.getCurrentLambdaInfoNCE()).toBe(1.0); // max value
      
      vae.infoNCEStep = 150; // after warmup
      expect(vae.getCurrentLambdaInfoNCE()).toBe(1.0); // max value
    });
  });

  describe('computeCombinedLoss', () => {
    test('should compute combined VAE + InfoNCE loss', () => {
      const batchSize = 2;
      const input = tf.randomNormal([batchSize, 80]);
      const reconstruction = tf.randomNormal([batchSize, 80]);
      const mu = tf.randomNormal([batchSize, 16]);
      const logVar = tf.randomNormal([batchSize, 16]);
      const latents = tf.randomNormal([batchSize, 16]);
      const positiveLabels = tf.tensor2d([
        [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1],
        [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1]
      ]);
      const negativeLabels = tf.randomUniform([4, 8]);

      const lossInfo = vae.computeCombinedLoss(
        input, reconstruction, mu, logVar, latents, positiveLabels, negativeLabels
      );

      expect(lossInfo.totalLoss).toBeDefined();
      expect(lossInfo.reconstructionLoss).toBeDefined();
      expect(lossInfo.klLoss).toBeDefined();
      expect(lossInfo.vaeLoss).toBeDefined();
      expect(lossInfo.infoNCELoss).toBeDefined();
      expect(lossInfo.lambda).toBeGreaterThan(0);
      expect(lossInfo.beta).toBeGreaterThan(0);

      // Clean up
      input.dispose();
      reconstruction.dispose();
      mu.dispose();
      logVar.dispose();
      latents.dispose();
      positiveLabels.dispose();
      negativeLabels.dispose();
      lossInfo.totalLoss.dispose();
      lossInfo.reconstructionLoss.dispose();
      lossInfo.klLoss.dispose();
      lossInfo.vaeLoss.dispose();
      lossInfo.infoNCELoss.dispose();
    });
  });

  describe('trainStepWithInfoNCE', () => {
    test('should perform training step with InfoNCE loss', async () => {
      const inputArray = new Array(80).fill(0).map(() => Math.random());
      const gameId = 'test-game-123';
      const teamType = 'home';

      const result = await vae.trainStepWithInfoNCE(inputArray, gameId, teamType);

      expect(result.totalLoss).toBeGreaterThan(0);
      expect(result.reconstructionLoss).toBeGreaterThan(0);
      expect(result.klLoss).toBeDefined();
      expect(result.vaeLoss).toBeGreaterThan(0);
      expect(result.infoNCELoss).toBeGreaterThan(0);
      expect(result.lambda).toBeGreaterThan(0);
      expect(result.beta).toBeGreaterThan(0);
      expect(result.gameId).toBe(gameId);
      expect(result.teamType).toBe(teamType);
      expect(result.numNegatives).toBe(4); // From mocked negatives

      // Check that training steps were incremented
      expect(vae.trainingStep).toBe(1);
      expect(vae.infoNCEStep).toBe(1);
    });

    test('should handle away team type', async () => {
      const inputArray = new Array(80).fill(0).map(() => Math.random());
      const gameId = 'test-game-456';
      const teamType = 'away';

      const result = await vae.trainStepWithInfoNCE(inputArray, gameId, teamType);

      expect(result.teamType).toBe('away');
      expect(result.totalLoss).toBeGreaterThan(0);
    });

    test('should throw error for invalid team type', async () => {
      const inputArray = new Array(80).fill(0).map(() => Math.random());
      const gameId = 'test-game-789';
      
      // Mock sampler to return null for the requested team type
      vae.dataSampler.sampleContrastivePair.mockResolvedValueOnce({
        positive: { home: null, away: [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1] },
        negatives: [[0.25, 0.12, 0.13, 0.08, 0.12, 0.06, 0.18, 0.06]]
      });

      await expect(
        vae.trainStepWithInfoNCE(inputArray, gameId, 'home')
      ).rejects.toThrow('No home transition probabilities');
    });
  });

  describe('trainBatchWithInfoNCE', () => {
    test('should train on batch of games', async () => {
      const trainingBatch = [
        {
          inputArray: new Array(80).fill(0).map(() => Math.random()),
          gameId: 'game-1',
          teamType: 'home'
        },
        {
          inputArray: new Array(80).fill(0).map(() => Math.random()),
          gameId: 'game-2',
          teamType: 'away'
        }
      ];

      const result = await vae.trainBatchWithInfoNCE(trainingBatch);

      expect(result.totalLoss).toBeGreaterThan(0);
      expect(result.reconstructionLoss).toBeGreaterThan(0);
      expect(result.vaeLoss).toBeGreaterThan(0);
      expect(result.infoNCELoss).toBeGreaterThan(0);
      expect(result.batchSize).toBe(2);
      expect(result.successfulSamples).toBe(2);
      expect(result.totalSamples).toBe(2);
    });

    test('should handle partial batch failures gracefully', async () => {
      // Mock one failure
      vae.dataSampler.sampleContrastivePair
        .mockResolvedValueOnce({
          positive: { home: [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1], away: null },
          negatives: [[0.25, 0.12, 0.13, 0.08, 0.12, 0.06, 0.18, 0.06]]
        })
        .mockResolvedValueOnce({
          positive: {
            home: [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1],
            away: [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1]
          },
          negatives: [[0.25, 0.12, 0.13, 0.08, 0.12, 0.06, 0.18, 0.06]]
        });

      const trainingBatch = [
        {
          inputArray: new Array(80).fill(0).map(() => Math.random()),
          gameId: 'game-1',
          teamType: 'away' // This will fail due to null away data
        },
        {
          inputArray: new Array(80).fill(0).map(() => Math.random()),
          gameId: 'game-2',
          teamType: 'home' // This will succeed
        }
      ];

      const result = await vae.trainBatchWithInfoNCE(trainingBatch);

      expect(result.batchSize).toBe(1); // Only successful sample
      expect(result.successfulSamples).toBe(1);
      expect(result.totalSamples).toBe(2);
    });
  });

  describe('setInfoNCEParams', () => {
    test('should update InfoNCE parameters', () => {
      vae.setInfoNCEParams({
        lambdaInfoNCE: 2.0,
        temperature: 0.2,
        numNegatives: 128
      });

      expect(vae.lambdaInfoNCE).toBe(2.0);
      expect(vae.temperature).toBe(0.2);
      expect(vae.numNegatives).toBe(128);
      expect(vae.infoNCELoss.temperature).toBe(0.2);
    });

    test('should update only specified parameters', () => {
      const originalLambda = vae.lambdaInfoNCE;
      const originalTemp = vae.temperature;

      vae.setInfoNCEParams({ numNegatives: 32 });

      expect(vae.lambdaInfoNCE).toBe(originalLambda);
      expect(vae.temperature).toBe(originalTemp);
      expect(vae.numNegatives).toBe(32);
    });
  });

  describe('serialization', () => {
    test('should save and load complete model state', async () => {
      // Modify some state
      vae.infoNCEStep = 50;
      vae.lambdaInfoNCE = 1.5;
      vae.temperature = 0.2;

      const savedState = await vae.toJSON();

      expect(savedState.lambdaInfoNCE).toBe(1.5);
      expect(savedState.temperature).toBe(0.2);
      expect(savedState.infoNCEStep).toBe(50);
      expect(savedState.infoNCEWeights).toBeDefined();

      // Create new instance and load state
      const newVae = new InfoNCEVAE(80, 16, 0.1);
      await newVae.fromJSON(savedState);

      expect(newVae.lambdaInfoNCE).toBe(1.5);
      expect(newVae.temperature).toBe(0.2);
      expect(newVae.infoNCEStep).toBe(50);

      newVae.dispose();
    });
  });

  describe('getTrainingStats', () => {
    test('should return comprehensive training statistics', () => {
      vae.trainingStep = 10;
      vae.infoNCEStep = 8;

      const stats = vae.getTrainingStats();

      expect(stats.trainingStep).toBe(10);
      expect(stats.infoNCEStep).toBe(8);
      expect(stats.currentBeta).toBeGreaterThan(0);
      expect(stats.currentLambda).toBeGreaterThan(0);
      expect(stats.temperature).toBe(0.1);
      expect(stats.numNegatives).toBe(64);
      expect(stats.cacheStats).toBeDefined();
    });
  });

  describe('resource management', () => {
    test('should dispose all resources including InfoNCE components', () => {
      expect(() => {
        vae.dispose();
        vae = null; // Prevent double disposal in afterEach
      }).not.toThrow();
    });
  });
});