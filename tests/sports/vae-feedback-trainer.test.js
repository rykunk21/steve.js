const VAEFeedbackTrainer = require('../../src/modules/sports/VAEFeedbackTrainer');
const VariationalAutoencoder = require('../../src/modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('../../src/modules/sports/TransitionProbabilityNN');

describe('VAEFeedbackTrainer', () => {
  let vae;
  let transitionNN;
  let trainer;

  beforeEach(() => {
    // Initialize VAE and NN
    vae = new VariationalAutoencoder(80, 16);
    transitionNN = new TransitionProbabilityNN(10);
    
    // Initialize trainer with test parameters
    trainer = new VAEFeedbackTrainer(vae, transitionNN, {
      feedbackThreshold: 0.5,
      initialAlpha: 0.1,
      alphaDecayRate: 0.95,
      minAlpha: 0.001,
      maxIterations: 100,
      convergenceThreshold: 1e-6,
      stabilityWindow: 5
    });
  });

  afterEach(() => {
    // Clean up TensorFlow.js resources
    if (transitionNN && transitionNN.model) {
      transitionNN.model.dispose();
    }
  });

  describe('Initialization', () => {
    test('should initialize with correct parameters', () => {
      expect(trainer.feedbackThreshold).toBe(0.5);
      expect(trainer.initialAlpha).toBe(0.1);
      expect(trainer.currentAlpha).toBe(0.1);
      expect(trainer.alphaDecayRate).toBe(0.95);
      expect(trainer.minAlpha).toBe(0.001);
      expect(trainer.iteration).toBe(0);
    });

    test('should initialize with default parameters when none provided', () => {
      const defaultTrainer = new VAEFeedbackTrainer(vae, transitionNN);
      expect(defaultTrainer.feedbackThreshold).toBe(0.5);
      expect(defaultTrainer.initialAlpha).toBe(0.1);
      expect(defaultTrainer.alphaDecayRate).toBe(0.99);
      expect(defaultTrainer.minAlpha).toBe(0.001);
    });

    test('should initialize empty history arrays', () => {
      expect(trainer.lossHistory).toEqual([]);
      expect(trainer.feedbackHistory).toEqual([]);
      expect(trainer.convergenceHistory).toEqual([]);
    });
  });

  describe('Single Game Training', () => {
    test('should train on a single game successfully', async () => {
      // Create test data
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      
      const result = await trainer.trainOnGame(gameFeatures, actualTransitionProbs);
      
      expect(result).toHaveProperty('iteration');
      expect(result).toHaveProperty('nnLoss');
      expect(result).toHaveProperty('vaeLoss');
      expect(result).toHaveProperty('feedbackTriggered');
      expect(result).toHaveProperty('currentAlpha');
      expect(result).toHaveProperty('predictedProbs');
      expect(result).toHaveProperty('teamRepresentations');
      
      expect(result.iteration).toBe(0);
      expect(typeof result.nnLoss).toBe('number');
      expect(typeof result.vaeLoss).toBe('number');
      expect(typeof result.feedbackTriggered).toBe('boolean');
      expect(result.predictedProbs).toHaveLength(8);
    });

    test('should trigger feedback when NN loss exceeds threshold', async () => {
      // Set a very low threshold to ensure feedback triggers
      trainer.setFeedbackThreshold(0.001);
      
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      
      const result = await trainer.trainOnGame(gameFeatures, actualTransitionProbs);
      
      // With very low threshold, feedback should trigger
      expect(result.feedbackTriggered).toBe(true);
      expect(trainer.stats.feedbackTriggers).toBe(1);
    });

    test('should not trigger feedback when NN loss is below threshold', async () => {
      // Set a very high threshold to prevent feedback
      trainer.setFeedbackThreshold(10.0);
      
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      
      const result = await trainer.trainOnGame(gameFeatures, actualTransitionProbs);
      
      expect(result.feedbackTriggered).toBe(false);
      expect(trainer.stats.feedbackTriggers).toBe(0);
    });

    test('should work with pre-computed team representations', async () => {
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      const teamA_mu = new Array(16).fill(0).map(() => Math.random());
      const teamA_sigma = new Array(16).fill(0).map(() => Math.random() * 0.1 + 0.1);
      const teamB_mu = new Array(16).fill(0).map(() => Math.random());
      const teamB_sigma = new Array(16).fill(0).map(() => Math.random() * 0.1 + 0.1);
      const gameContext = new Array(10).fill(0).map(() => Math.random());
      
      const result = await trainer.trainOnGame(
        gameFeatures, 
        actualTransitionProbs,
        teamA_mu,
        teamA_sigma,
        teamB_mu,
        teamB_sigma,
        gameContext
      );
      
      expect(result.teamRepresentations.teamA_mu).toEqual(teamA_mu);
      expect(result.teamRepresentations.teamA_sigma).toEqual(teamA_sigma);
      expect(result.teamRepresentations.teamB_mu).toEqual(teamB_mu);
      expect(result.teamRepresentations.teamB_sigma).toEqual(teamB_sigma);
    });
  });

  describe('Batch Training', () => {
    test('should train on a batch of games', async () => {
      const gamesBatch = [];
      for (let i = 0; i < 3; i++) {
        gamesBatch.push({
          gameFeatures: new Array(80).fill(0).map(() => Math.random()),
          actualTransitionProbs: [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05]
        });
      }
      
      const batchResult = await trainer.trainOnBatch(gamesBatch);
      
      expect(batchResult).toHaveProperty('batchSize', 3);
      expect(batchResult).toHaveProperty('averageNNLoss');
      expect(batchResult).toHaveProperty('averageVAELoss');
      expect(batchResult).toHaveProperty('feedbackTriggerRate');
      expect(batchResult).toHaveProperty('currentAlpha');
      expect(batchResult.results).toHaveLength(3);
      
      expect(typeof batchResult.averageNNLoss).toBe('number');
      expect(typeof batchResult.averageVAELoss).toBe('number');
      expect(batchResult.feedbackTriggerRate).toBeGreaterThanOrEqual(0);
      expect(batchResult.feedbackTriggerRate).toBeLessThanOrEqual(1);
    });
  });

  describe('Feedback Coefficient Decay', () => {
    test('should decay feedback coefficient over time', () => {
      const initialAlpha = trainer.currentAlpha;
      
      trainer.decayFeedbackCoefficient();
      
      expect(trainer.currentAlpha).toBeLessThan(initialAlpha);
      expect(trainer.currentAlpha).toBe(initialAlpha * trainer.alphaDecayRate);
    });

    test('should not decay below minimum alpha', () => {
      trainer.currentAlpha = trainer.minAlpha;
      
      trainer.decayFeedbackCoefficient();
      
      expect(trainer.currentAlpha).toBe(trainer.minAlpha);
    });

    test('should update VAE feedback coefficient when decaying', () => {
      const spy = jest.spyOn(vae, 'setFeedbackCoefficient');
      
      trainer.decayFeedbackCoefficient();
      
      expect(spy).toHaveBeenCalledWith(trainer.currentAlpha);
      spy.mockRestore();
    });
  });

  describe('Training Metrics and Monitoring', () => {
    test('should record training metrics correctly', async () => {
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      
      await trainer.trainOnGame(gameFeatures, actualTransitionProbs);
      
      expect(trainer.lossHistory).toHaveLength(1);
      expect(trainer.feedbackHistory).toHaveLength(1);
      expect(trainer.stats.totalIterations).toBe(1);
      
      const lossRecord = trainer.lossHistory[0];
      expect(lossRecord).toHaveProperty('iteration', 0);
      expect(lossRecord).toHaveProperty('nnLoss');
      expect(lossRecord).toHaveProperty('vaeLoss');
      expect(lossRecord).toHaveProperty('alpha');
    });

    test('should limit history length for memory efficiency', async () => {
      // Mock a large number of iterations
      for (let i = 0; i < 1100; i++) {
        trainer.lossHistory.push({
          iteration: i,
          nnLoss: Math.random(),
          vaeLoss: Math.random(),
          alpha: trainer.currentAlpha
        });
      }
      
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      
      await trainer.trainOnGame(gameFeatures, actualTransitionProbs);
      
      expect(trainer.lossHistory.length).toBeLessThanOrEqual(1000);
    });

    test('should calculate running averages correctly', async () => {
      // Train on multiple games to build history
      for (let i = 0; i < 5; i++) {
        const gameFeatures = new Array(80).fill(0).map(() => Math.random());
        const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
        await trainer.trainOnGame(gameFeatures, actualTransitionProbs);
      }
      
      expect(trainer.stats.averageNNLoss).toBeGreaterThan(0);
      expect(trainer.stats.averageVAELoss).toBeGreaterThan(0);
    });
  });

  describe('Convergence Detection', () => {
    test('should detect convergence when losses stabilize', () => {
      // Simulate stable losses
      const stableLoss = 0.1;
      for (let i = 0; i < trainer.stabilityWindow; i++) {
        trainer.lossHistory.push({
          iteration: i,
          nnLoss: stableLoss + Math.random() * 1e-8, // Very small variance
          vaeLoss: stableLoss + Math.random() * 1e-8,
          alpha: trainer.currentAlpha
        });
      }
      
      const converged = trainer.checkConvergence();
      expect(converged).toBe(true);
      expect(trainer.stats.convergenceAchieved).toBe(true);
    });

    test('should not detect convergence with insufficient history', () => {
      const converged = trainer.checkConvergence();
      expect(converged).toBe(false);
    });

    test('should not detect convergence with high variance', () => {
      // Simulate unstable losses
      for (let i = 0; i < trainer.stabilityWindow; i++) {
        trainer.lossHistory.push({
          iteration: i,
          nnLoss: Math.random() * 10, // High variance
          vaeLoss: Math.random() * 10,
          alpha: trainer.currentAlpha
        });
      }
      
      const converged = trainer.checkConvergence();
      expect(converged).toBe(false);
    });
  });

  describe('Stability Monitoring', () => {
    test('should monitor feedback loop stability', () => {
      // Simulate feedback history
      for (let i = 0; i < trainer.stabilityWindow; i++) {
        trainer.feedbackHistory.push({
          iteration: i,
          triggered: i < 2, // First 2 trigger feedback, rest don't
          alpha: trainer.currentAlpha * Math.pow(trainer.alphaDecayRate, i)
        });
      }
      
      const stability = trainer.monitorStability();
      
      expect(stability).toHaveProperty('stable');
      expect(stability).toHaveProperty('feedbackRate');
      expect(stability).toHaveProperty('alphaDecayRate');
      expect(stability).toHaveProperty('currentAlpha');
      expect(stability).toHaveProperty('recentFeedbackTriggers');
      
      expect(stability.feedbackRate).toBe(2 / trainer.stabilityWindow); // 2 out of 5
      expect(stability.alphaDecayRate).toBeGreaterThan(0);
    });

    test('should report insufficient history when not enough data', () => {
      const stability = trainer.monitorStability();
      
      expect(stability.stable).toBe(false);
      expect(stability.reason).toBe('Insufficient history');
    });
  });

  describe('Configuration Management', () => {
    test('should update feedback threshold', () => {
      trainer.setFeedbackThreshold(0.8);
      expect(trainer.feedbackThreshold).toBe(0.8);
    });

    test('should update alpha decay parameters', () => {
      trainer.setAlphaDecayParameters(0.98, 0.005);
      expect(trainer.alphaDecayRate).toBe(0.98);
      expect(trainer.minAlpha).toBe(0.005);
    });

    test('should reset training state', () => {
      // Add some history first
      trainer.iteration = 10;
      trainer.currentAlpha = 0.05;
      trainer.lossHistory.push({ iteration: 0, nnLoss: 1, vaeLoss: 1, alpha: 0.1 });
      trainer.stats.totalIterations = 10;
      
      trainer.reset();
      
      expect(trainer.iteration).toBe(0);
      expect(trainer.currentAlpha).toBe(trainer.initialAlpha);
      expect(trainer.lossHistory).toEqual([]);
      expect(trainer.feedbackHistory).toEqual([]);
      expect(trainer.stats.totalIterations).toBe(0);
    });
  });

  describe('Serialization', () => {
    test('should serialize to JSON correctly', () => {
      // Add some state
      trainer.iteration = 5;
      trainer.currentAlpha = 0.08;
      trainer.lossHistory.push({ iteration: 0, nnLoss: 1, vaeLoss: 1, alpha: 0.1 });
      trainer.stats.totalIterations = 5;
      
      const json = trainer.toJSON();
      
      expect(json).toHaveProperty('feedbackThreshold');
      expect(json).toHaveProperty('initialAlpha');
      expect(json).toHaveProperty('currentAlpha', 0.08);
      expect(json).toHaveProperty('iteration', 5);
      expect(json).toHaveProperty('stats');
      expect(json).toHaveProperty('recentLossHistory');
      expect(json).toHaveProperty('recentFeedbackHistory');
    });

    test('should deserialize from JSON correctly', () => {
      const state = {
        feedbackThreshold: 0.7,
        initialAlpha: 0.15,
        alphaDecayRate: 0.97,
        minAlpha: 0.002,
        maxIterations: 500,
        convergenceThreshold: 1e-5,
        stabilityWindow: 8,
        currentAlpha: 0.12,
        iteration: 3,
        stats: { totalIterations: 3, feedbackTriggers: 1 },
        recentLossHistory: [{ iteration: 0, nnLoss: 1, vaeLoss: 1, alpha: 0.15 }],
        recentFeedbackHistory: [{ iteration: 0, triggered: true, alpha: 0.15 }]
      };
      
      trainer.fromJSON(state);
      
      expect(trainer.feedbackThreshold).toBe(0.7);
      expect(trainer.initialAlpha).toBe(0.15);
      expect(trainer.currentAlpha).toBe(0.12);
      expect(trainer.iteration).toBe(3);
      expect(trainer.stats.totalIterations).toBe(3);
      expect(trainer.lossHistory).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid game features gracefully', async () => {
      const invalidGameFeatures = new Array(50).fill(0); // Wrong dimension
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      
      await expect(trainer.trainOnGame(invalidGameFeatures, actualTransitionProbs))
        .rejects.toThrow();
    });

    test('should handle invalid transition probabilities gracefully', async () => {
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const invalidTransitionProbs = [0.2, 0.3]; // Wrong dimension
      
      await expect(trainer.trainOnGame(gameFeatures, invalidTransitionProbs))
        .rejects.toThrow();
    });
  });

  describe('Integration with VAE and NN', () => {
    test('should properly coordinate VAE and NN training', async () => {
      const vaeSpy = jest.spyOn(vae, 'backward');
      const nnSpy = jest.spyOn(transitionNN, 'trainStep');
      
      const gameFeatures = new Array(80).fill(0).map(() => Math.random());
      const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];
      
      await trainer.trainOnGame(gameFeatures, actualTransitionProbs);
      
      expect(vaeSpy).toHaveBeenCalled();
      expect(nnSpy).toHaveBeenCalled();
      
      vaeSpy.mockRestore();
      nnSpy.mockRestore();
    });

    test('should update VAE feedback coefficient correctly', () => {
      const spy = jest.spyOn(vae, 'setFeedbackCoefficient');
      
      trainer.decayFeedbackCoefficient();
      
      expect(spy).toHaveBeenCalledWith(trainer.currentAlpha);
      spy.mockRestore();
    });
  });
});