const PretrainVAE = require('../../src/modules/sports/PretrainVAE');

// Mock dependencies
jest.mock('../../src/modules/sports/VAEFeatureExtractor', () => {
  return jest.fn().mockImplementation(() => ({}));
});

jest.mock('../../src/database/repositories/GameIdsRepository', () => {
  return jest.fn().mockImplementation(() => ({
    getGamesWithLabels: jest.fn().mockResolvedValue([
      {
        gameId: 'game-1',
        sport: 'mens-college-basketball',
        homeTeamId: 'team-1',
        awayTeamId: 'team-2',
        labelsExtracted: true
      },
      {
        gameId: 'game-2',
        sport: 'mens-college-basketball',
        homeTeamId: 'team-3',
        awayTeamId: 'team-4',
        labelsExtracted: true
      },
      {
        gameId: 'game-3',
        sport: 'mens-college-basketball',
        homeTeamId: 'team-5',
        awayTeamId: 'team-6',
        labelsExtracted: true
      }
    ])
  }));
});

jest.mock('../../src/database/connection', () => ({
  getConnection: jest.fn().mockResolvedValue({
    run: jest.fn().mockResolvedValue({ lastID: 1 })
  })
}));

// Mock InfoNCEVAE to avoid complex training in tests
jest.mock('../../src/modules/sports/InfoNCEVAE', () => {
  return jest.fn().mockImplementation(() => ({
    setInfoNCEParams: jest.fn(),
    trainBatchWithInfoNCE: jest.fn().mockResolvedValue({
      totalLoss: 2.5,
      reconstructionLoss: 1.0,
      klLoss: 0.5,
      vaeLoss: 1.5,
      infoNCELoss: 1.0,
      batchSize: 2,
      successfulSamples: 2,
      totalSamples: 2
    }),
    dataSampler: {
      sampleContrastivePair: jest.fn().mockResolvedValue({
        positive: {
          home: [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1],
          away: [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1]
        },
        negatives: [
          [0.25, 0.12, 0.13, 0.08, 0.12, 0.06, 0.18, 0.06],
          [0.18, 0.14, 0.16, 0.07, 0.09, 0.04, 0.22, 0.1]
        ]
      })
    },
    forward: jest.fn().mockReturnValue({
      reconstruction: { dataSync: () => [0.5], dispose: () => {} },
      mu: { dataSync: () => new Array(16).fill(0.1), dispose: () => {} },
      logVar: { dataSync: () => new Array(16).fill(-1), dispose: () => {} },
      z: { dispose: () => {} }
    }),
    encode: jest.fn().mockReturnValue({
      mu: { dataSync: () => new Array(16).fill(0.1), dispose: () => {} },
      logVar: { dataSync: () => new Array(16).fill(-1), dispose: () => {} }
    }),
    computeCombinedLoss: jest.fn().mockReturnValue({
      totalLoss: { dataSync: () => [2.5], dispose: () => {} },
      reconstructionLoss: { dataSync: () => [1.0], dispose: () => {} },
      klLoss: { dataSync: () => [0.5], dispose: () => {} },
      vaeLoss: { dataSync: () => [1.5], dispose: () => {} },
      infoNCELoss: { dataSync: () => [1.0], dispose: () => {} }
    }),
    toJSON: jest.fn().mockResolvedValue({
      encoderWeights: [{ shape: [80, 64], data: new Array(80 * 64).fill(0.1) }],
      decoderWeights: [{ shape: [16, 80], data: new Array(16 * 80).fill(0.1) }],
      inputDim: 80,
      latentDim: 16
    }),
    getTrainingStats: jest.fn().mockReturnValue({
      trainingStep: 10,
      infoNCEStep: 10,
      currentBeta: 1.0,
      currentLambda: 1.0
    }),
    dispose: jest.fn()
  }));
});

describe('PretrainVAE', () => {
  let pretrainer;

  beforeEach(() => {
    pretrainer = new PretrainVAE({
      inputDim: 80,
      latentDim: 16,
      maxEpochs: 5, // Short for testing
      batchSize: 2,
      earlyStoppingPatience: 3,
      convergenceThreshold: 0.1
    });
  });

  afterEach(() => {
    if (pretrainer) {
      pretrainer.dispose();
    }
  });

  describe('constructor', () => {
    test('should initialize with default configuration', () => {
      const defaultPretrainer = new PretrainVAE();
      
      expect(defaultPretrainer.config.inputDim).toBe(80);
      expect(defaultPretrainer.config.latentDim).toBe(16);
      expect(defaultPretrainer.config.temperature).toBe(0.1);
      expect(defaultPretrainer.config.sport).toBe('mens-college-basketball');
      expect(defaultPretrainer.trainingHistory).toEqual([]);
      expect(defaultPretrainer.bestValidationLoss).toBe(Infinity);
      
      defaultPretrainer.dispose();
    });

    test('should initialize with custom configuration', () => {
      expect(pretrainer.config.inputDim).toBe(80);
      expect(pretrainer.config.latentDim).toBe(16);
      expect(pretrainer.config.maxEpochs).toBe(5);
      expect(pretrainer.config.batchSize).toBe(2);
    });
  });

  describe('loadTrainingData', () => {
    test('should load and prepare training data', async () => {
      const trainingData = await pretrainer.loadTrainingData();
      
      expect(trainingData).toHaveLength(6); // 3 games × 2 teams each
      expect(trainingData[0]).toHaveProperty('gameId');
      expect(trainingData[0]).toHaveProperty('teamType');
      expect(trainingData[0]).toHaveProperty('features');
      expect(trainingData[0]).toHaveProperty('hasLabels', true);
      
      // Check that we have both home and away for each game
      const gameIds = [...new Set(trainingData.map(d => d.gameId))];
      expect(gameIds).toHaveLength(3);
      
      for (const gameId of gameIds) {
        const gameData = trainingData.filter(d => d.gameId === gameId);
        expect(gameData).toHaveLength(2);
        expect(gameData.map(d => d.teamType).sort()).toEqual(['away', 'home']);
      }
    });

    test('should handle empty games list', async () => {
      pretrainer.gameIdsRepository.getGamesWithLabels.mockResolvedValueOnce([]);
      
      await expect(pretrainer.loadTrainingData()).rejects.toThrow(
        'No games with labels found for sport: mens-college-basketball'
      );
    });
  });

  describe('extractGameFeatures', () => {
    test('should extract normalized features', async () => {
      const features = await pretrainer.extractGameFeatures('game-1', 'home');
      
      expect(features).toHaveLength(80);
      expect(features.every(f => f >= 0 && f <= 1)).toBe(true);
    });
  });

  describe('splitData', () => {
    test('should split data into training and validation sets', () => {
      const mockData = new Array(100).fill(0).map((_, i) => ({ id: i }));
      const { trainSet, validationSet } = pretrainer.splitData(mockData);
      
      expect(trainSet.length + validationSet.length).toBe(100);
      expect(validationSet.length).toBe(20); // 20% validation split
      expect(trainSet.length).toBe(80);
    });

    test('should handle small datasets', () => {
      const mockData = [{ id: 1 }, { id: 2 }];
      const { trainSet, validationSet } = pretrainer.splitData(mockData);
      
      expect(trainSet.length + validationSet.length).toBe(2);
      expect(validationSet.length).toBe(0); // Floor of 2 * 0.2 = 0
      expect(trainSet.length).toBe(2);
    });
  });

  describe('computeValidationLoss', () => {
    beforeEach(() => {
      // Initialize VAE for validation tests
      const InfoNCEVAE = require('../../src/modules/sports/InfoNCEVAE');
      pretrainer.vae = new InfoNCEVAE();
    });

    test('should compute validation loss without gradients', async () => {
      const sample = {
        gameId: 'game-1',
        teamType: 'home',
        features: new Array(80).fill(0.5),
        hasLabels: true
      };

      const result = await pretrainer.computeValidationLoss(sample);
      
      expect(result.totalLoss).toBeGreaterThan(0);
      expect(result.reconstructionLoss).toBeGreaterThan(0);
      expect(result.vaeLoss).toBeGreaterThan(0);
      expect(result.infoNCELoss).toBeGreaterThan(0);
    });

    test('should handle missing transition probabilities', async () => {
      const sample = {
        gameId: 'game-1',
        teamType: 'home',
        features: new Array(80).fill(0.5),
        hasLabels: true
      };

      // Mock missing home probabilities
      pretrainer.vae.dataSampler.sampleContrastivePair.mockResolvedValueOnce({
        positive: { home: null, away: [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1] },
        negatives: [[0.25, 0.12, 0.13, 0.08, 0.12, 0.06, 0.18, 0.06]]
      });

      await expect(pretrainer.computeValidationLoss(sample)).rejects.toThrow(
        'No home transition probabilities for game game-1'
      );
    });
  });

  describe('computeCorrelation', () => {
    test('should compute Pearson correlation correctly', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10]; // Perfect positive correlation
      
      const correlation = pretrainer.computeCorrelation(x, y);
      expect(correlation).toBeCloseTo(1.0, 5);
    });

    test('should handle negative correlation', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [10, 8, 6, 4, 2]; // Perfect negative correlation
      
      const correlation = pretrainer.computeCorrelation(x, y);
      expect(correlation).toBeCloseTo(-1.0, 5);
    });

    test('should handle no correlation', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [3, 3, 3, 3, 3]; // No variance in y
      
      const correlation = pretrainer.computeCorrelation(x, y);
      expect(correlation).toBe(0);
    });

    test('should handle empty arrays', () => {
      const correlation = pretrainer.computeCorrelation([], []);
      expect(correlation).toBe(0);
    });
  });

  describe('computeValidationMetrics', () => {
    test('should compute validation metrics for predictiveness', () => {
      const predictions = [
        new Array(16).fill(0).map(() => Math.random()),
        new Array(16).fill(0).map(() => Math.random()),
        new Array(16).fill(0).map(() => Math.random())
      ];
      
      const actuals = [
        [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1],
        [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1],
        [0.25, 0.12, 0.13, 0.08, 0.12, 0.06, 0.18, 0.06]
      ];

      const metrics = pretrainer.computeValidationMetrics(predictions, actuals);
      
      expect(metrics.avgCorrelation).toBeGreaterThanOrEqual(0);
      expect(metrics.maxCorrelation).toBeGreaterThanOrEqual(0);
      expect(metrics.samplesValidated).toBe(3);
      expect(typeof metrics.isPredictive).toBe('boolean');
    });

    test('should handle empty predictions', () => {
      const metrics = pretrainer.computeValidationMetrics([], []);
      expect(metrics.error).toBe('No valid predictions for validation');
    });
  });

  describe('training simulation', () => {
    beforeEach(() => {
      // Initialize VAE for training tests
      const InfoNCEVAE = require('../../src/modules/sports/InfoNCEVAE');
      pretrainer.vae = new InfoNCEVAE();
    });

    test('should simulate training epochs', async () => {
      // Mock a simple training scenario
      const trainSet = [
        { gameId: 'game-1', teamType: 'home', features: new Array(80).fill(0.5) },
        { gameId: 'game-1', teamType: 'away', features: new Array(80).fill(0.4) }
      ];

      const epoch = await pretrainer.trainEpoch(trainSet, 0);
      expect(typeof epoch).toBe('number');
      expect(epoch).toBeGreaterThan(0);
    });

    test('should simulate validation epochs', async () => {
      const validationSet = [
        { gameId: 'game-1', teamType: 'home', features: new Array(80).fill(0.5) }
      ];

      const validationLoss = await pretrainer.validateEpoch(validationSet, 0);
      expect(typeof validationLoss).toBe('number');
      expect(validationLoss).toBeGreaterThan(0);
    });
  });

  describe('getTrainingStats', () => {
    test('should return comprehensive training statistics', () => {
      pretrainer.trainingHistory = [
        { epoch: 0, trainLoss: 3.0, validationLoss: 2.8 },
        { epoch: 1, trainLoss: 2.5, validationLoss: 2.3 }
      ];
      pretrainer.bestValidationLoss = 2.3;
      pretrainer.isConverged = false;

      const stats = pretrainer.getTrainingStats();
      
      expect(stats.config).toBeDefined();
      expect(stats.trainingHistory).toHaveLength(2);
      expect(stats.bestValidationLoss).toBe(2.3);
      expect(stats.isConverged).toBe(false);
      expect(stats.vaeStats).toBeNull(); // VAE not initialized yet
    });
  });

  describe('resource management', () => {
    test('should dispose resources without errors', () => {
      expect(() => {
        pretrainer.dispose();
        pretrainer = null; // Prevent double disposal in afterEach
      }).not.toThrow();
    });
  });
});