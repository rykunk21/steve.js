const VAESystemValidator = require('../../scripts/validate-vae-nn-system');
const dbConnection = require('../../src/database/connection');
const logger = require('../../src/utils/logger');

// Mock dependencies
jest.mock('../../src/modules/sports/VAEFeatureExtractor');
jest.mock('../../src/modules/sports/VariationalAutoencoder');
jest.mock('../../src/modules/sports/TransitionProbabilityNN');
jest.mock('../../src/modules/sports/VAEFeedbackTrainer');
jest.mock('../../src/modules/sports/BayesianTeamUpdater');
jest.mock('../../src/database/repositories/TeamRepository');
jest.mock('../../src/database/connection');

describe('VAE System Validator', () => {
  let validator;
  let mockDbConnection;
  let mockTeamRepository;
  let mockFeedbackTrainer;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock database connection
    mockDbConnection = {
      all: jest.fn(),
      get: jest.fn()
    };
    dbConnection.all = mockDbConnection.all;
    dbConnection.get = mockDbConnection.get;

    // Mock team repository
    mockTeamRepository = {
      getTeamByEspnId: jest.fn()
    };

    // Mock feedback trainer
    mockFeedbackTrainer = {
      getTrainingStats: jest.fn(),
      monitorStability: jest.fn(),
      lossHistory: [],
      initialAlpha: 0.1,
      alphaDecayRate: 0.99,
      minAlpha: 0.001
    };

    validator = new VAESystemValidator();
    validator.teamRepository = mockTeamRepository;
    validator.feedbackTrainer = mockFeedbackTrainer;
  });

  describe('Initialization', () => {
    test('should initialize with all required components', () => {
      expect(validator.featureExtractor).toBeDefined();
      expect(validator.vae).toBeDefined();
      expect(validator.transitionNN).toBeDefined();
      expect(validator.teamRepository).toBeDefined();
      expect(validator.bayesianUpdater).toBeDefined();
      expect(validator.feedbackTrainer).toBeDefined();
      expect(validator.validationResults).toBeDefined();
    });

    test('should initialize validation results structure', () => {
      expect(validator.validationResults).toEqual({
        predictionAccuracy: {},
        teamDistributions: {},
        feedbackLoop: {},
        systemConvergence: {},
        calibrationMetrics: {}
      });
    });
  });

  describe('Prediction Accuracy Validation', () => {
    test('should handle no processed games', async () => {
      mockDbConnection.all.mockResolvedValue([]);

      await validator.validatePredictionAccuracy(10);

      expect(validator.validationResults.predictionAccuracy).toEqual({
        status: 'insufficient_data',
        gamesAnalyzed: 0,
        message: 'No processed games available'
      });
    });

    test('should validate prediction accuracy with sample games', async () => {
      const mockGames = [
        {
          game_id: 'game1',
          game_date: '2024-03-15',
          home_team_id: 'team1',
          away_team_id: 'team2'
        }
      ];

      const mockGameData = {
        metadata: { neutralGame: 'N', postseason: 'N' },
        transitionProbabilities: {
          home: {
            twoPointMakeProb: 0.5,
            twoPointMissProb: 0.3,
            threePointMakeProb: 0.1,
            threePointMissProb: 0.05,
            freeThrowMakeProb: 0.03,
            freeThrowMissProb: 0.01,
            offensiveReboundProb: 0.01,
            turnoverProb: 0.0
          },
          visitor: {
            twoPointMakeProb: 0.45,
            twoPointMissProb: 0.35,
            threePointMakeProb: 0.12,
            threePointMissProb: 0.06,
            freeThrowMakeProb: 0.015,
            freeThrowMissProb: 0.005,
            offensiveReboundProb: 0.0,
            turnoverProb: 0.0
          }
        }
      };

      const mockTeamDistribution = {
        mu: new Array(16).fill(0.5),
        sigma: new Array(16).fill(0.3)
      };

      mockDbConnection.all.mockResolvedValue(mockGames);
      validator.featureExtractor.processGame = jest.fn().mockResolvedValue(mockGameData);
      mockTeamRepository.getTeamByEspnId.mockResolvedValue({
        statisticalRepresentation: JSON.stringify(mockTeamDistribution)
      });
      validator.transitionNN.predict = jest.fn().mockReturnValue([0.5, 0.3, 0.1, 0.05, 0.03, 0.01, 0.01, 0.0]);

      await validator.validatePredictionAccuracy(1);

      expect(validator.validationResults.predictionAccuracy.status).toBe('completed');
      expect(validator.validationResults.predictionAccuracy.gamesAnalyzed).toBe(1);
      expect(validator.validationResults.predictionAccuracy.metrics).toBeDefined();
      expect(validator.validationResults.predictionAccuracy.metrics.meanAbsoluteError).toBeDefined();
    });

    test('should handle errors gracefully', async () => {
      mockDbConnection.all.mockRejectedValue(new Error('Database error'));

      await validator.validatePredictionAccuracy(10);

      expect(validator.validationResults.predictionAccuracy).toEqual({
        status: 'error',
        error: 'Database error'
      });
    });
  });

  describe('Team Distributions Validation', () => {
    test('should handle no teams with statistical representations', async () => {
      mockDbConnection.all.mockResolvedValue([]);

      await validator.validateTeamDistributions(10, 5);

      expect(validator.validationResults.teamDistributions).toEqual({
        status: 'insufficient_data',
        message: 'No teams with statistical representations found'
      });
    });

    test('should validate team distributions', async () => {
      const mockTeams = [
        {
          team_id: 'team1',
          team_name: 'Team 1',
          statistical_representation: JSON.stringify({
            mu: new Array(16).fill(0.5),
            sigma: new Array(16).fill(0.3),
            games_processed: 10
          }),
          updated_at: '2024-03-15T10:00:00Z'
        }
      ];

      mockDbConnection.all.mockResolvedValue(mockTeams);
      mockDbConnection.get.mockResolvedValue({ game_count: 10 });

      await validator.validateTeamDistributions(1, 5);

      expect(validator.validationResults.teamDistributions.status).toBe('completed');
      expect(validator.validationResults.teamDistributions.teamsAnalyzed).toBe(1);
      expect(validator.validationResults.teamDistributions.validTeams).toBe(1);
    });

    test('should detect invalid distribution structure', async () => {
      const mockTeams = [
        {
          team_id: 'team1',
          team_name: 'Team 1',
          statistical_representation: JSON.stringify({
            // Missing mu and sigma arrays
            games_processed: 10
          }),
          updated_at: '2024-03-15T10:00:00Z'
        }
      ];

      mockDbConnection.all.mockResolvedValue(mockTeams);

      await validator.validateTeamDistributions(1, 5);

      expect(validator.validationResults.teamDistributions.status).toBe('completed');
      expect(validator.validationResults.teamDistributions.distributionIssues).toBe(1);
    });

    test('should detect wrong dimensions', async () => {
      const mockTeams = [
        {
          team_id: 'team1',
          team_name: 'Team 1',
          statistical_representation: JSON.stringify({
            mu: new Array(10).fill(0.5), // Wrong dimension
            sigma: new Array(10).fill(0.3), // Wrong dimension
            games_processed: 10
          }),
          updated_at: '2024-03-15T10:00:00Z'
        }
      ];

      mockDbConnection.all.mockResolvedValue(mockTeams);

      await validator.validateTeamDistributions(1, 5);

      expect(validator.validationResults.teamDistributions.status).toBe('completed');
      expect(validator.validationResults.teamDistributions.distributionIssues).toBe(1);
    });
  });

  describe('Feedback Loop Validation', () => {
    test('should validate feedback loop effectiveness', async () => {
      const mockStats = {
        totalIterations: 100,
        feedbackTriggers: 30,
        convergenceAchieved: false,
        averageNNLoss: 0.5,
        averageVAELoss: 2.0,
        stability: {
          currentAlpha: 0.05,
          stable: true
        }
      };

      mockFeedbackTrainer.getTrainingStats.mockReturnValue(mockStats);
      mockFeedbackTrainer.monitorStability.mockReturnValue({
        stable: true,
        feedbackRate: 0.3,
        alphaDecayRate: 0.5,
        currentAlpha: 0.05
      });

      await validator.validateFeedbackLoop();

      expect(validator.validationResults.feedbackLoop.status).toBe('completed');
      expect(validator.validationResults.feedbackLoop.analysis.feedbackRate).toBe(0.3);
      expect(validator.validationResults.feedbackLoop.checks.feedbackTriggering).toBe(true);
      expect(validator.validationResults.feedbackLoop.checks.alphaDecaying).toBe(true);
    });

    test('should analyze loss trends when history is available', async () => {
      const mockLossHistory = [
        // Early losses (first 10) - high values
        { iteration: 1, nnLoss: 1.0, alpha: 0.1 },
        { iteration: 2, nnLoss: 0.95, alpha: 0.099 },
        { iteration: 3, nnLoss: 0.9, alpha: 0.098 },
        { iteration: 4, nnLoss: 0.85, alpha: 0.097 },
        { iteration: 5, nnLoss: 0.8, alpha: 0.096 },
        { iteration: 6, nnLoss: 0.75, alpha: 0.095 },
        { iteration: 7, nnLoss: 0.7, alpha: 0.094 },
        { iteration: 8, nnLoss: 0.65, alpha: 0.093 },
        { iteration: 9, nnLoss: 0.6, alpha: 0.092 },
        { iteration: 10, nnLoss: 0.55, alpha: 0.091 },
        // Recent losses (last 10) - low values
        { iteration: 11, nnLoss: 0.5, alpha: 0.09 },
        { iteration: 12, nnLoss: 0.45, alpha: 0.089 },
        { iteration: 13, nnLoss: 0.4, alpha: 0.088 },
        { iteration: 14, nnLoss: 0.35, alpha: 0.087 },
        { iteration: 15, nnLoss: 0.3, alpha: 0.086 },
        { iteration: 16, nnLoss: 0.25, alpha: 0.085 },
        { iteration: 17, nnLoss: 0.2, alpha: 0.084 },
        { iteration: 18, nnLoss: 0.15, alpha: 0.083 },
        { iteration: 19, nnLoss: 0.1, alpha: 0.082 },
        { iteration: 20, nnLoss: 0.05, alpha: 0.081 }
      ];

      validator.feedbackTrainer.lossHistory = mockLossHistory;

      const mockStats = {
        totalIterations: 20,
        feedbackTriggers: 6,
        convergenceAchieved: false,
        averageNNLoss: 0.3,
        averageVAELoss: 1.5,
        stability: {
          currentAlpha: 0.081,
          stable: true
        }
      };

      mockFeedbackTrainer.getTrainingStats.mockReturnValue(mockStats);
      mockFeedbackTrainer.monitorStability.mockReturnValue({
        stable: true,
        feedbackRate: 0.3,
        alphaDecayRate: 0.19,
        currentAlpha: 0.081
      });

      await validator.validateFeedbackLoop();

      expect(validator.validationResults.feedbackLoop.lossTrends).toBeDefined();
      
      // Debug the actual values
      const lossTrends = validator.validationResults.feedbackLoop.lossTrends;
      console.log('Loss trends:', lossTrends);
      
      // The logic compares recent (last 10) vs early (first 10)
      // With our data: recent = [0.2, 0.1] (avg 0.15), early = [1.0, 0.9] (avg 0.95)
      // So nnLossImproving should be true (0.15 < 0.95)
      expect(validator.validationResults.feedbackLoop.lossTrends.nnLossImproving).toBe(true);
      expect(validator.validationResults.feedbackLoop.lossTrends.historyLength).toBe(20);
    });
  });

  describe('System Convergence Validation', () => {
    test('should validate system convergence', async () => {
      const mockStats = {
        totalIterations: 50,
        convergenceAchieved: true,
        stability: {
          currentAlpha: 0.05
        }
      };

      mockFeedbackTrainer.getTrainingStats.mockReturnValue(mockStats);
      mockFeedbackTrainer.monitorStability.mockReturnValue({
        stable: true,
        feedbackRate: 0.2,
        alphaDecayRate: 0.5,
        currentAlpha: 0.05
      });

      await validator.validateSystemConvergence();

      expect(validator.validationResults.systemConvergence.status).toBe('completed');
      expect(validator.validationResults.systemConvergence.analysis.convergenceAchieved).toBe(true);
      expect(validator.validationResults.systemConvergence.checks.systemStable).toBe(true);
    });

    test('should analyze convergence timeline when history is available', async () => {
      const mockLossHistory = Array.from({ length: 20 }, (_, i) => ({
        iteration: i + 1,
        nnLoss: 1.0 - (i * 0.04), // Decreasing loss
        alpha: 0.1 * Math.pow(0.99, i)
      }));

      validator.feedbackTrainer.lossHistory = mockLossHistory;

      const mockStats = {
        totalIterations: 20,
        convergenceAchieved: false,
        stability: {
          currentAlpha: 0.08
        }
      };

      mockFeedbackTrainer.getTrainingStats.mockReturnValue(mockStats);
      mockFeedbackTrainer.monitorStability.mockReturnValue({
        stable: true,
        feedbackRate: 0.3,
        alphaDecayRate: 0.2,
        currentAlpha: 0.08
      });

      await validator.validateSystemConvergence();

      expect(validator.validationResults.systemConvergence.convergenceTimeline).toBeDefined();
      expect(validator.validationResults.systemConvergence.convergenceTimeline.isConverging).toBe(true);
    });
  });

  describe('Helper Methods', () => {
    test('should calculate prediction error correctly', () => {
      const predicted = [0.5, 0.3, 0.2];
      const actual = [0.6, 0.2, 0.2];

      const error = validator.calculatePredictionError(predicted, actual);

      expect(error.mae).toBeCloseTo(0.0667, 3);
      expect(error.mse).toBeCloseTo(0.0067, 3);
      expect(error.maxAbsError).toBeCloseTo(0.1, 10);
    });

    test('should calculate array statistics correctly', () => {
      const arr = [1, 2, 3, 4, 5];

      const stats = validator.calculateArrayStats(arr);

      expect(stats.mean).toBe(3);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(5);
      expect(stats.range).toBe(4);
      expect(stats.stdDev).toBeCloseTo(1.414, 3);
    });

    test('should calculate expected sigma range correctly', () => {
      const range5Games = validator.calculateExpectedSigmaRange(5);
      const range20Games = validator.calculateExpectedSigmaRange(20);

      expect(range20Games.expected).toBeLessThan(range5Games.expected);
      expect(range5Games.min).toBeGreaterThan(0);
      expect(range5Games.max).toBeGreaterThan(range5Games.min);
    });

    test('should calculate sigma decay trend correctly', () => {
      const teams = [
        { gameCount: 5, distribution: { sigma: { mean: 0.8 } } },
        { gameCount: 10, distribution: { sigma: { mean: 0.6 } } },
        { gameCount: 15, distribution: { sigma: { mean: 0.4 } } },
        { gameCount: 20, distribution: { sigma: { mean: 0.3 } } }
      ];

      const trend = validator.calculateSigmaDecayTrend(teams);

      expect(trend.isDecaying).toBe(true);
      expect(trend.correlation).toBeLessThan(0);
      expect(trend.dataPoints).toBe(4);
    });
  });

  describe('Report Generation', () => {
    test('should generate comprehensive validation report', () => {
      // Set up mock validation results
      validator.validationResults = {
        predictionAccuracy: {
          status: 'completed',
          summary: { excellent: true, acceptable: true },
          metrics: { meanAbsoluteError: 0.03 }
        },
        teamDistributions: {
          status: 'completed',
          summary: { healthyPercentage: 85, sigmaDecayingProperly: true }
        },
        feedbackLoop: {
          status: 'completed',
          summary: { effective: true, stable: true }
        },
        systemConvergence: {
          status: 'completed',
          summary: { converging: true, systemStable: true }
        },
        calibrationMetrics: {
          status: 'completed',
          summary: { wellCalibrated: true }
        }
      };

      const report = validator.generateValidationReport();

      expect(report.overallScore).toBe(25); // Each section gets 25 points, average is 25
      expect(report.criticalIssues).toHaveLength(0);
      expect(report.sections).toBeDefined();
      expect(report.timestamp).toBeDefined();
    });

    test('should identify critical issues in report', () => {
      // Set up validation results with issues
      validator.validationResults = {
        predictionAccuracy: {
          status: 'completed',
          summary: { excellent: false, acceptable: false },
          metrics: { meanAbsoluteError: 0.3 }
        },
        teamDistributions: {
          status: 'completed',
          summary: { healthyPercentage: 40, sigmaDecayingProperly: false }
        },
        feedbackLoop: {
          status: 'completed',
          summary: { effective: false, stable: false }
        },
        systemConvergence: {
          status: 'completed',
          summary: { converging: false, systemStable: false }
        }
      };

      const report = validator.generateValidationReport();

      expect(report.overallScore).toBeLessThan(50);
      expect(report.criticalIssues.length).toBeGreaterThan(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors', async () => {
      mockDbConnection.all.mockRejectedValue(new Error('Connection failed'));

      await validator.validatePredictionAccuracy(10);

      expect(validator.validationResults.predictionAccuracy.status).toBe('error');
      expect(validator.validationResults.predictionAccuracy.error).toBe('Connection failed');
    });

    test('should handle missing team data gracefully', async () => {
      const mockGames = [
        {
          game_id: 'game1',
          game_date: '2024-03-15',
          home_team_id: 'team1',
          away_team_id: 'team2'
        }
      ];

      mockDbConnection.all.mockResolvedValue(mockGames);
      validator.featureExtractor.processGame = jest.fn().mockResolvedValue({
        metadata: {},
        transitionProbabilities: { home: {}, visitor: {} }
      });
      mockTeamRepository.getTeamByEspnId.mockResolvedValue(null); // No team data

      await validator.validatePredictionAccuracy(1);

      expect(validator.validationResults.predictionAccuracy.status).toBe('completed');
      expect(validator.validationResults.predictionAccuracy.gamesAnalyzed).toBe(0);
    });
  });
});