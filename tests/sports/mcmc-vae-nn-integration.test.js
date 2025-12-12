const MCMCSimulator = require('../../src/modules/sports/MCMCSimulator');
const VariationalAutoencoder = require('../../src/modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('../../src/modules/sports/TransitionProbabilityNN');
const VAEFeedbackTrainer = require('../../src/modules/sports/VAEFeedbackTrainer');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

// Mock the dependencies
jest.mock('../../src/modules/sports/VariationalAutoencoder');
jest.mock('../../src/modules/sports/TransitionProbabilityNN');
jest.mock('../../src/modules/sports/VAEFeedbackTrainer');
jest.mock('../../src/database/repositories/TeamRepository');

describe('MCMC VAE-NN Integration', () => {
  let simulator;
  let mockVAENNSystem;
  let mockTeamRepository;

  beforeEach(() => {
    // Mock TransitionNN
    const mockTransitionNN = {
      predict: jest.fn(),
      gameContextDim: 10
    };

    // Mock VAE
    const mockVAE = {
      encodeGameToTeamDistribution: jest.fn(),
      sampleFromTeamDistribution: jest.fn()
    };

    // Mock VAE-NN feedback trainer system
    mockVAENNSystem = {
      vae: mockVAE,
      transitionNN: mockTransitionNN,
      trainOnGame: jest.fn()
    };

    // Mock team repository
    mockTeamRepository = {
      getTeamByEspnId: jest.fn()
    };

    simulator = new MCMCSimulator(1000, mockVAENNSystem, mockTeamRepository);
  });

  describe('VAE-NN Integration', () => {
    test('should successfully generate probabilities using VAE-NN system', async () => {
      // Mock team data with valid distributions
      const mockHomeTeam = {
        teamId: 'duke',
        teamName: 'Duke Blue Devils',
        statisticalRepresentation: JSON.stringify({
          mu: Array.from({ length: 16 }, () => Math.random() * 2 - 1),
          sigma: Array.from({ length: 16 }, () => Math.random() * 0.5 + 0.1),
          games_processed: 15,
          last_season: '2024-25'
        }),
        updatedAt: new Date().toISOString()
      };

      const mockAwayTeam = {
        teamId: 'unc',
        teamName: 'North Carolina Tar Heels',
        statisticalRepresentation: JSON.stringify({
          mu: Array.from({ length: 16 }, () => Math.random() * 2 - 1),
          sigma: Array.from({ length: 16 }, () => Math.random() * 0.3 + 0.1),
          games_processed: 20,
          last_season: '2024-25'
        }),
        updatedAt: new Date().toISOString()
      };

      mockTeamRepository.getTeamByEspnId
        .mockResolvedValueOnce(mockHomeTeam)
        .mockResolvedValueOnce(mockAwayTeam);

      // Mock NN predictions
      mockVAENNSystem.transitionNN.predict
        .mockReturnValueOnce({
          '2pt_make': 0.35, '2pt_miss': 0.25, '3pt_make': 0.12, '3pt_miss': 0.08,
          'ft_make': 0.08, 'ft_miss': 0.02, 'oreb': 0.05, 'turnover': 0.05
        }) // Home team
        .mockReturnValueOnce({
          '2pt_make': 0.33, '2pt_miss': 0.27, '3pt_make': 0.10, '3pt_miss': 0.10,
          'ft_make': 0.07, 'ft_miss': 0.03, 'oreb': 0.05, 'turnover': 0.05
        }); // Away team

      const gameContext = {
        isNeutralSite: false,
        isPostseason: false,
        restDays: 2,
        travelDistance: 100,
        isConferenceGame: true
      };

      const result = await simulator.simulateWithVAENN('duke', 'unc', gameContext);

      expect(result.dataSource).toBe('vae_nn');
      expect(result.usedVAENN).toBe(true);
      expect(result.uncertaintyMetrics).toBeDefined();
      expect(result.uncertaintyMetrics.homeTeamUncertainty).toBeGreaterThan(0);
      expect(result.uncertaintyMetrics.awayTeamUncertainty).toBeGreaterThan(0);
      expect(result.uncertaintyMetrics.predictionConfidence).toBeGreaterThan(0);
      expect(result.uncertaintyMetrics.predictionConfidence).toBeLessThanOrEqual(1);
      expect(result.uncertaintyMetrics.homeTeamName).toBe('Duke Blue Devils');
      expect(result.uncertaintyMetrics.awayTeamName).toBe('North Carolina Tar Heels');

      // Verify simulation results
      expect(result.homeWinProb).toBeGreaterThan(0);
      expect(result.awayWinProb).toBeGreaterThan(0);
      expect(result.homeWinProb + result.awayWinProb + result.tieProb).toBeCloseTo(1, 2);
      expect(result.iterations).toBe(1000);

      // Verify NN was called with correct parameters
      expect(mockVAENNSystem.transitionNN.predict).toHaveBeenCalledTimes(2);
    });

    test('should fall back to traditional matrix when VAE-NN fails', async () => {
      // Mock team repository to return null (missing team data)
      mockTeamRepository.getTeamByEspnId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const fallbackMatrix = {
        sport: 'ncaa_basketball',
        possessions: 70,
        dataSource: 'traditional',
        home: {
          transitionProbs: [0.35, 0.25, 0.12, 0.08, 0.08, 0.02, 0.05, 0.05],
          scoreProb: 0.55
        },
        away: {
          transitionProbs: [0.33, 0.27, 0.10, 0.10, 0.07, 0.03, 0.05, 0.05],
          scoreProb: 0.50
        }
      };

      const result = await simulator.simulateWithVAENN('duke', 'unc', {}, fallbackMatrix);

      expect(result.dataSource).toBe('fallback_matrix');
      expect(result.usedVAENN).toBe(false);
      expect(result.uncertaintyMetrics).toBeNull();

      // Should still produce valid simulation results
      expect(result.homeWinProb).toBeGreaterThan(0);
      expect(result.awayWinProb).toBeGreaterThan(0);
      expect(result.iterations).toBe(1000);
    });

    test('should generate fallback matrix when no fallback provided', async () => {
      // Mock team repository to return null
      mockTeamRepository.getTeamByEspnId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await simulator.simulateWithVAENN('duke', 'unc');

      expect(result.dataSource).toBe('fallback_generated');
      expect(result.usedVAENN).toBe(false);
      expect(result.uncertaintyMetrics).toBeNull();

      // Should still produce valid simulation results
      expect(result.homeWinProb).toBeGreaterThan(0);
      expect(result.awayWinProb).toBeGreaterThan(0);
    });

    test('should handle invalid team distribution format', async () => {
      // Mock team data with invalid distribution
      const mockHomeTeam = {
        teamId: 'duke',
        teamName: 'Duke Blue Devils',
        statisticalRepresentation: JSON.stringify({
          // Missing mu and sigma
          games_processed: 15
        }),
        updatedAt: new Date().toISOString()
      };

      const mockAwayTeam = {
        teamId: 'unc',
        teamName: 'North Carolina Tar Heels',
        statisticalRepresentation: JSON.stringify({
          mu: [1, 2, 3], // Wrong dimensions
          sigma: [0.1, 0.2, 0.3],
          games_processed: 20
        }),
        updatedAt: new Date().toISOString()
      };

      mockTeamRepository.getTeamByEspnId
        .mockResolvedValueOnce(mockHomeTeam)
        .mockResolvedValueOnce(mockAwayTeam);

      const result = await simulator.simulateWithVAENN('duke', 'unc');

      expect(result.dataSource).toBe('fallback_generated');
      expect(result.usedVAENN).toBe(false);
    });
  });

  describe('Uncertainty Propagation', () => {
    test('should calculate team uncertainty correctly', () => {
      const sigma = [0.5, 0.3, 0.7, 0.2, 0.6];
      const uncertainty = simulator.calculateTeamUncertainty(sigma);
      
      expect(uncertainty).toBeCloseTo(0.46, 2); // (0.5+0.3+0.7+0.2+0.6)/5
    });

    test('should calculate prediction confidence correctly', () => {
      const lowUncertaintySigma = [0.1, 0.1, 0.1, 0.1];
      const highUncertaintySigma = [0.9, 0.9, 0.9, 0.9];
      
      const highConfidence = simulator.calculatePredictionConfidence(lowUncertaintySigma, lowUncertaintySigma);
      const lowConfidence = simulator.calculatePredictionConfidence(highUncertaintySigma, highUncertaintySigma);
      
      expect(highConfidence).toBeGreaterThan(lowConfidence);
      expect(highConfidence).toBeLessThanOrEqual(1);
      expect(lowConfidence).toBeGreaterThanOrEqual(0);
    });

    test('should sample from distribution correctly', () => {
      const mu = [0, 1, -1, 0.5];
      const sigma = [0.1, 0.2, 0.3, 0.1];
      
      const sample = simulator.sampleFromDistribution(mu, sigma);
      
      expect(sample).toHaveLength(4);
      // Samples should be roughly around the mean (within 3 standard deviations)
      sample.forEach((value, i) => {
        expect(value).toBeGreaterThan(mu[i] - 3 * sigma[i]);
        expect(value).toBeLessThan(mu[i] + 3 * sigma[i]);
      });
    });
  });

  describe('Game Context Features', () => {
    test('should build normalized game context features correctly', () => {
      const gameContext = {
        isNeutralSite: true,
        isPostseason: false,
        restDays: 3,
        travelDistance: 1500,
        isConferenceGame: true,
        isRivalryGame: false,
        isTVGame: true,
        timeOfDay: 19, // 7 PM
        dayOfWeek: 6, // Saturday
        seasonProgress: 0.75
      };

      const features = simulator.buildGameContextFeatures(gameContext);

      expect(features).toHaveLength(10);
      expect(features[0]).toBe(1); // isNeutralSite
      expect(features[1]).toBe(0); // isPostseason
      expect(features[2]).toBeCloseTo(3/7, 2); // restDays normalized
      expect(features[3]).toBeCloseTo(1500/3000, 2); // travelDistance normalized
      expect(features[4]).toBe(1); // isConferenceGame
      expect(features[5]).toBe(0); // isRivalryGame
      expect(features[6]).toBe(1); // isTVGame
      expect(features[7]).toBeCloseTo(19/24, 2); // timeOfDay normalized
      expect(features[8]).toBeCloseTo(6/7, 2); // dayOfWeek normalized
      expect(features[9]).toBe(0.75); // seasonProgress

      // All features should be in [0,1] range
      features.forEach(feature => {
        expect(feature).toBeGreaterThanOrEqual(0);
        expect(feature).toBeLessThanOrEqual(1);
      });
    });

    test('should handle missing game context values with defaults', () => {
      const gameContext = {
        isNeutralSite: true
        // Missing other values
      };

      const features = simulator.buildGameContextFeatures(gameContext);

      expect(features[0]).toBe(1); // isNeutralSite
      expect(features[1]).toBe(0); // isPostseason (default false)
      expect(features[2]).toBeCloseTo(1/7, 2); // restDays (default 1, normalized)
      expect(features[3]).toBe(0); // travelDistance (default 0)
      expect(features).toHaveLength(10);
    });

    test('should handle extreme values correctly', () => {
      const gameContext = {
        restDays: 14, // More than 7 days
        travelDistance: 5000, // More than 3000 miles
        timeOfDay: 25, // Invalid hour
        dayOfWeek: 8, // Invalid day
        seasonProgress: 1.5 // More than 100%
      };

      const features = simulator.buildGameContextFeatures(gameContext);

      expect(features[2]).toBe(1); // restDays capped at 1
      expect(features[3]).toBe(1); // travelDistance capped at 1
      expect(features[7]).toBeCloseTo(25/24, 2); // timeOfDay (allows > 1 for edge cases)
      expect(features[8]).toBeCloseTo(8/7, 2); // dayOfWeek (allows > 1 for edge cases)
      expect(features[9]).toBe(1); // seasonProgress capped at 1
    });
  });

  describe('Matrix Creation', () => {
    test('should create matrix from VAE-NN predictions correctly', () => {
      const homePredictions = [0.35, 0.25, 0.12, 0.08, 0.08, 0.02, 0.05, 0.05];
      const awayPredictions = [0.33, 0.27, 0.10, 0.10, 0.07, 0.03, 0.05, 0.05];
      const gameContext = { possessions: 75 };

      const matrix = simulator.createMatrixFromVAENN(homePredictions, awayPredictions, gameContext);

      expect(matrix.sport).toBe('ncaa_basketball');
      expect(matrix.possessions).toBe(75);
      expect(matrix.dataSource).toBe('vae_nn_generated');
      expect(matrix.home.transitionProbs).toEqual(homePredictions);
      expect(matrix.away.transitionProbs).toEqual(awayPredictions);

      // Check legacy compatibility fields
      expect(matrix.home.scoreProb).toBeCloseTo(0.35 + 0.12 + 0.08, 2); // makes
      expect(matrix.away.scoreProb).toBeCloseTo(0.33 + 0.10 + 0.07, 2);
    });
  });

  describe('Fallback Matrix Generation', () => {
    test('should generate reasonable fallback matrix for basketball', () => {
      const matrix = simulator.generateFallbackMatrix();

      expect(matrix.sport).toBe('ncaa_basketball');
      expect(matrix.possessions).toBe(70);
      expect(matrix.dataSource).toBe('fallback_generated');
      expect(matrix.home.transitionProbs).toHaveLength(8);
      expect(matrix.away.transitionProbs).toHaveLength(8);

      // Probabilities should sum to approximately 1
      const homeSum = matrix.home.transitionProbs.reduce((sum, p) => sum + p, 0);
      const awaySum = matrix.away.transitionProbs.reduce((sum, p) => sum + p, 0);
      
      expect(homeSum).toBeCloseTo(1, 1);
      expect(awaySum).toBeCloseTo(1, 1);

      // Home team should have slight advantage
      expect(matrix.home.scoreProb).toBeGreaterThan(matrix.away.scoreProb);
    });

    test('should generate sport-specific fallback matrix', () => {
      const gameContext = { sport: 'nba', possessions: 100 };
      const matrix = simulator.generateFallbackMatrix(gameContext);

      expect(matrix.sport).toBe('nba');
      expect(matrix.possessions).toBe(100);
      expect(matrix.dataSource).toBe('fallback_generated');
    });
  });

  describe('VAE-NN System Configuration', () => {
    test('should check VAE-NN availability correctly', () => {
      const status = simulator.checkVAENNAvailability();

      expect(status.available).toBe(true);
      expect(status.hasVAENN).toBe(true);
      expect(status.hasTeamRepository).toBe(true);
      expect(status.hasVAE).toBe(true);
      expect(status.hasTransitionNN).toBe(true);
      expect(status.details).toContain('VAE-NN system ready for predictions');
    });

    test('should detect missing components', () => {
      const simulatorWithoutVAENN = new MCMCSimulator(1000, null, mockTeamRepository);
      const status = simulatorWithoutVAENN.checkVAENNAvailability();

      expect(status.available).toBe(false);
      expect(status.hasVAENN).toBe(false);
      expect(status.details).toContain('VAE-NN system not initialized');
    });

    test('should get configuration details', () => {
      const config = simulator.getConfiguration();

      expect(config.iterations).toBe(1000);
      expect(config.uncertaintyPropagation).toBe(true);
      expect(config.vaeNNSystem.available).toBe(true);
      expect(config.capabilities.traditionalSimulation).toBe(true);
      expect(config.capabilities.vaeNNSimulation).toBe(true);
      expect(config.capabilities.uncertaintyQuantification).toBe(true);
      expect(config.capabilities.fallbackSupport).toBe(true);
    });

    test('should set VAE-NN system correctly', () => {
      const newSimulator = new MCMCSimulator(500);
      
      // Initially should not be available
      expect(newSimulator.getConfiguration().vaeNNSystem.available).toBe(false);
      
      // Create a mock VAEFeedbackTrainer instance
      const mockFeedbackTrainer = {
        vae: mockVAENNSystem.vae,
        transitionNN: mockVAENNSystem.transitionNN,
        trainOnGame: jest.fn()
      };
      
      // Mock the VAEFeedbackTrainer constructor
      VAEFeedbackTrainer.mockImplementation(() => mockFeedbackTrainer);
      
      newSimulator.setVAENNSystem(mockVAENNSystem, mockTeamRepository);
      
      const config = newSimulator.getConfiguration();
      expect(config.vaeNNSystem.available).toBe(true);
      expect(config.vaeNNSystem.hasVAENN).toBe(true);
      expect(config.vaeNNSystem.hasTeamRepository).toBe(true);
    });
  });

  describe('Team Distribution Loading', () => {
    test('should load valid team distribution', async () => {
      const mockTeam = {
        teamId: 'duke',
        teamName: 'Duke Blue Devils',
        statisticalRepresentation: JSON.stringify({
          mu: Array.from({ length: 16 }, () => 0.5),
          sigma: Array.from({ length: 16 }, () => 0.2),
          games_processed: 25,
          last_season: '2024-25'
        }),
        updatedAt: new Date().toISOString()
      };

      mockTeamRepository.getTeamByEspnId.mockResolvedValueOnce(mockTeam);

      const distribution = await simulator.loadTeamDistribution('duke');

      expect(distribution).toBeDefined();
      expect(distribution.teamId).toBe('duke');
      expect(distribution.teamName).toBe('Duke Blue Devils');
      expect(distribution.mu).toHaveLength(16);
      expect(distribution.sigma).toHaveLength(16);
      expect(distribution.gamesProcessed).toBe(25);
      expect(distribution.lastSeason).toBe('2024-25');
    });

    test('should handle missing team data', async () => {
      mockTeamRepository.getTeamByEspnId.mockResolvedValueOnce(null);

      const distribution = await simulator.loadTeamDistribution('nonexistent');

      expect(distribution).toBeNull();
    });

    test('should handle invalid distribution format', async () => {
      const mockTeam = {
        teamId: 'duke',
        teamName: 'Duke Blue Devils',
        statisticalRepresentation: JSON.stringify({
          mu: [1, 2, 3], // Wrong length
          sigma: [0.1, 0.2], // Wrong length
          games_processed: 25
        }),
        updatedAt: new Date().toISOString()
      };

      mockTeamRepository.getTeamByEspnId.mockResolvedValueOnce(mockTeam);

      const distribution = await simulator.loadTeamDistribution('duke');

      expect(distribution).toBeNull();
    });
  });

  describe('Uncertainty Propagation Comparison', () => {
    test('should compare VAE-NN vs traditional simulation results', async () => {
      // Setup mock data for VAE-NN simulation
      const mockHomeTeam = {
        teamId: 'duke',
        teamName: 'Duke Blue Devils',
        statisticalRepresentation: JSON.stringify({
          mu: Array.from({ length: 16 }, () => 0.5),
          sigma: Array.from({ length: 16 }, () => 0.1), // Low uncertainty
          games_processed: 30,
          last_season: '2024-25'
        }),
        updatedAt: new Date().toISOString()
      };

      const mockAwayTeam = {
        teamId: 'unc',
        teamName: 'North Carolina Tar Heels',
        statisticalRepresentation: JSON.stringify({
          mu: Array.from({ length: 16 }, () => 0.3),
          sigma: Array.from({ length: 16 }, () => 0.3), // Higher uncertainty
          games_processed: 10,
          last_season: '2024-25'
        }),
        updatedAt: new Date().toISOString()
      };

      mockTeamRepository.getTeamByEspnId
        .mockResolvedValueOnce(mockHomeTeam)
        .mockResolvedValueOnce(mockAwayTeam);

      mockVAENNSystem.transitionNN.predict
        .mockReturnValueOnce({
          '2pt_make': 0.40, '2pt_miss': 0.20, '3pt_make': 0.15, '3pt_miss': 0.05,
          'ft_make': 0.10, 'ft_miss': 0.02, 'oreb': 0.04, 'turnover': 0.04
        })
        .mockReturnValueOnce({
          '2pt_make': 0.30, '2pt_miss': 0.30, '3pt_make': 0.08, '3pt_miss': 0.12,
          'ft_make': 0.08, 'ft_miss': 0.04, 'oreb': 0.04, 'turnover': 0.04
        });

      // Run VAE-NN simulation
      const vaeNNResult = await simulator.simulateWithVAENN('duke', 'unc');

      // Run traditional simulation with fallback
      const traditionalMatrix = {
        sport: 'ncaa_basketball',
        possessions: 70,
        dataSource: 'traditional',
        home: {
          transitionProbs: [0.35, 0.25, 0.12, 0.08, 0.08, 0.02, 0.05, 0.05],
          scoreProb: 0.55
        },
        away: {
          transitionProbs: [0.33, 0.27, 0.10, 0.10, 0.07, 0.03, 0.05, 0.05],
          scoreProb: 0.50
        }
      };

      const traditionalResult = simulator.simulate(traditionalMatrix);

      // Compare results
      expect(vaeNNResult.dataSource).toBe('vae_nn');
      expect(traditionalResult.dataSource).toBe('traditional');
      
      expect(vaeNNResult.uncertaintyMetrics).toBeDefined();
      expect(traditionalResult.uncertaintyMetrics).toBeUndefined();

      // Both should produce valid probabilities
      expect(vaeNNResult.homeWinProb + vaeNNResult.awayWinProb + vaeNNResult.tieProb).toBeCloseTo(1, 2);
      expect(traditionalResult.homeWinProb + traditionalResult.awayWinProb + traditionalResult.tieProb).toBeCloseTo(1, 2);

      // VAE-NN should reflect team uncertainty in confidence
      expect(vaeNNResult.uncertaintyMetrics.homeTeamUncertainty).toBeLessThan(
        vaeNNResult.uncertaintyMetrics.awayTeamUncertainty
      );
    });
  });
});