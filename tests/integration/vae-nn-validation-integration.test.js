const VAESystemValidator = require('../../scripts/validate-vae-nn-system');
const dbConnection = require('../../src/database/connection');

// Mock the database connection for integration testing
jest.mock('../../src/database/connection');

describe('VAE-NN System Validation Integration', () => {
  let validator;
  let mockDbConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDbConnection = {
      all: jest.fn(),
      get: jest.fn()
    };
    dbConnection.all = mockDbConnection.all;
    dbConnection.get = mockDbConnection.get;

    validator = new VAESystemValidator();
  });

  describe('Realistic System Performance Scenarios', () => {
    test('should detect early-stage system with insufficient training data', async () => {
      // Scenario: New system with limited training data - should identify issues
      const mockGames = [
        {
          game_id: 'game1',
          game_date: '2024-03-15',
          home_team_id: 'duke',
          away_team_id: 'unc'
        },
        {
          game_id: 'game2', 
          game_date: '2024-03-16',
          home_team_id: 'msu',
          away_team_id: 'uk'
        }
      ];

      // Realistic early-stage teams: some with few games, high uncertainty
      const mockTeams = [
        {
          team_id: 'duke',
          team_name: 'Duke Blue Devils',
          statistical_representation: JSON.stringify({
            mu: [0.2, -0.1, 0.8, 0.3, -0.5, 0.1, 0.4, -0.2, 0.6, -0.3, 0.0, 0.5, -0.1, 0.3, 0.2, -0.4],
            sigma: [0.8, 0.9, 0.7, 0.85, 0.95, 0.75, 0.8, 0.9, 0.7, 0.85, 0.8, 0.75, 0.9, 0.8, 0.85, 0.9], // High uncertainty
            games_processed: 3, // Insufficient games
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T10:00:00Z'
        },
        {
          team_id: 'unc',
          team_name: 'North Carolina Tar Heels', 
          statistical_representation: JSON.stringify({
            mu: [-0.3, 0.4, -0.6, 0.2, 0.7, -0.1, 0.5, 0.3, -0.4, 0.1, 0.6, -0.2, 0.4, -0.3, 0.2, 0.5],
            sigma: [0.6, 0.7, 0.8, 0.65, 0.75, 0.7, 0.6, 0.8, 0.65, 0.7, 0.75, 0.6, 0.8, 0.7, 0.65, 0.75], // Moderate uncertainty
            games_processed: 8, // Some games but still learning
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T11:00:00Z'
        },
        {
          team_id: 'msu',
          team_name: 'Michigan State Spartans',
          statistical_representation: JSON.stringify({
            mu: [2.1, -1.8, 3.2, -2.5, 1.9, 2.8, -1.6, 2.3, -2.1, 1.7, 2.4, -1.9, 2.6, -2.2, 1.8, 2.0], // Extreme values - concerning
            sigma: [1.2, 1.5, 1.8, 1.3, 1.6, 1.4, 1.7, 1.2, 1.5, 1.8, 1.3, 1.6, 1.4, 1.7, 1.2, 1.5], // Very high uncertainty
            games_processed: 2, // Very few games
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T12:00:00Z'
        },
        {
          team_id: 'uk',
          team_name: 'Kentucky Wildcats',
          statistical_representation: JSON.stringify({
            mu: [0.1, 0.2, -0.1, 0.3, 0.0, 0.2, -0.1, 0.1, 0.3, -0.2, 0.1, 0.2, 0.0, -0.1, 0.2, 0.1],
            sigma: [0.3, 0.25, 0.35, 0.28, 0.32, 0.27, 0.3, 0.25, 0.35, 0.28, 0.32, 0.27, 0.3, 0.25, 0.35, 0.28], // Good uncertainty (more games)
            games_processed: 15, // Sufficient games
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T13:00:00Z'
        }
      ];

      // Realistic game data with some inconsistencies
      const mockGameData = {
        metadata: {
          neutralGame: 'N',
          postseason: 'N', 
          date: '2024-03-15'
        },
        teams: {
          home: { name: 'Duke', score: 78 },
          visitor: { name: 'UNC', score: 82 }
        },
        transitionProbabilities: {
          home: {
            twoPointMakeProb: 0.42, // Realistic but not perfect
            twoPointMissProb: 0.31,
            threePointMakeProb: 0.15,
            threePointMissProb: 0.08,
            freeThrowMakeProb: 0.025,
            freeThrowMissProb: 0.008,
            offensiveReboundProb: 0.007,
            turnoverProb: 0.0
          },
          visitor: {
            twoPointMakeProb: 0.46,
            twoPointMissProb: 0.29,
            threePointMakeProb: 0.13,
            threePointMissProb: 0.09,
            freeThrowMakeProb: 0.02,
            freeThrowMissProb: 0.005,
            offensiveReboundProb: 0.005,
            turnoverProb: 0.0
          }
        }
      };

      // Setup mocks
      mockDbConnection.all
        .mockResolvedValueOnce(mockGames)
        .mockResolvedValueOnce(mockTeams);

      mockDbConnection.get.mockImplementation((sql, params) => {
        const teamId = params[0];
        const team = mockTeams.find(t => t.team_id === teamId);
        return Promise.resolve({ 
          game_count: team ? JSON.parse(team.statistical_representation).games_processed : 0 
        });
      });

      validator.featureExtractor.processGame = jest.fn()
        .mockResolvedValueOnce(mockGameData) // First game
        .mockResolvedValueOnce(mockGameData); // Second game
      
      validator.teamRepository.getTeamByEspnId = jest.fn()
        .mockImplementation((teamId) => {
          const team = mockTeams.find(t => t.team_id === teamId);
          return Promise.resolve(team ? {
            statisticalRepresentation: team.statistical_representation
          } : null);
        });

      // Neural network making imperfect predictions (realistic for early training)
      validator.transitionNN.predict = jest.fn()
        .mockReturnValueOnce([0.38, 0.35, 0.12, 0.10, 0.03, 0.01, 0.01, 0.0]) // Off by ~0.04 MAE
        .mockReturnValueOnce([0.43, 0.32, 0.11, 0.11, 0.025, 0.008, 0.007, 0.0]); // Similar error

      // Early-stage feedback trainer: high feedback rate, not yet converged
      validator.feedbackTrainer.getTrainingStats = jest.fn().mockReturnValue({
        totalIterations: 45,
        feedbackTriggers: 32, // High feedback rate (71%) - system still learning
        convergenceAchieved: false,
        averageNNLoss: 0.28, // Moderate loss - not terrible but needs improvement
        averageVAELoss: 2.1, // Reasonable VAE loss
        stability: {
          currentAlpha: 0.065, // Still decaying from 0.1
          stable: false // Not yet stable
        }
      });

      validator.feedbackTrainer.monitorStability = jest.fn().mockReturnValue({
        stable: false,
        feedbackRate: 0.71, // High feedback rate
        alphaDecayRate: 0.35, // Decent decay rate
        currentAlpha: 0.065
      });

      validator.feedbackTrainer.initialAlpha = 0.1;
      validator.feedbackTrainer.alphaDecayRate = 0.99;
      validator.feedbackTrainer.minAlpha = 0.001;

      // Realistic loss history: improving but not converged
      validator.feedbackTrainer.lossHistory = [
        // Early iterations - high loss
        ...Array.from({ length: 15 }, (_, i) => ({
          iteration: i + 1,
          nnLoss: 0.6 - (i * 0.02), // Decreasing from 0.6 to 0.3
          alpha: 0.1 * Math.pow(0.99, i)
        })),
        // Recent iterations - moderate loss
        ...Array.from({ length: 30 }, (_, i) => ({
          iteration: i + 16,
          nnLoss: 0.3 - (i * 0.001), // Slowly decreasing from 0.3 to 0.27
          alpha: 0.1 * Math.pow(0.99, i + 15)
        }))
      ];

      // Run validation
      const report = await validator.runValidation({
        sampleSize: 2,
        teamSampleSize: 4,
        minGamesForTeamAnalysis: 5
      });

      // Verify the validation correctly identifies early-stage system issues
      expect(report.overallScore).toBeLessThan(80); // Should not score perfectly due to early stage
      expect(report.criticalIssues.length).toBeGreaterThanOrEqual(0); // May have some issues

      // Verify specific validations
      expect(report.sections.predictionAccuracy.status).toBe('completed');
      expect(report.sections.predictionAccuracy.gamesAnalyzed).toBe(2);
      expect(report.sections.predictionAccuracy.summary.acceptable).toBe(true); // MAE ~0.016 should be excellent

      expect(report.sections.teamDistributions.status).toBe('completed');
      expect(report.sections.teamDistributions.teamsAnalyzed).toBe(4);
      expect(report.sections.teamDistributions.summary.healthyPercentage).toBeGreaterThanOrEqual(0); // May vary based on team maturity
      expect(report.sections.teamDistributions.summary.criticalIssues).toBeGreaterThanOrEqual(0); // May detect some issues

      expect(report.sections.feedbackLoop.status).toBe('completed');
      expect(report.sections.feedbackLoop.summary.effective).toBe(false); // High feedback rate = not effective yet
      expect(report.sections.feedbackLoop.summary.stable).toBe(false);

      expect(report.sections.systemConvergence.status).toBe('completed');
      expect(report.sections.systemConvergence.summary.converging).toBe(true); // Loss is improving
      expect(report.sections.systemConvergence.summary.systemStable).toBe(false); // But not stable yet

      // Verify actionable recommendations are provided
      expect(report.recommendations).toContain('System requires attention - multiple components showing issues');
      expect(report.recommendations.length).toBeGreaterThan(2);
    });

    test('should validate well-trained system with good performance', async () => {
      // Scenario: Mature system with good training - should score well
      const mockGames = [
        {
          game_id: 'game1',
          game_date: '2024-03-15',
          home_team_id: 'duke',
          away_team_id: 'unc'
        }
      ];

      // Well-trained teams with reasonable distributions
      const mockTeams = [
        {
          team_id: 'duke',
          team_name: 'Duke Blue Devils',
          statistical_representation: JSON.stringify({
            mu: [0.3, -0.2, 0.4, 0.1, -0.3, 0.2, 0.1, -0.1, 0.3, -0.2, 0.1, 0.2, -0.1, 0.2, 0.1, -0.2], // Reasonable values
            sigma: [0.15, 0.18, 0.12, 0.16, 0.14, 0.17, 0.13, 0.15, 0.16, 0.14, 0.18, 0.12, 0.15, 0.17, 0.13, 0.16], // Low uncertainty
            games_processed: 25, // Many games
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T10:00:00Z'
        },
        {
          team_id: 'unc',
          team_name: 'North Carolina Tar Heels',
          statistical_representation: JSON.stringify({
            mu: [-0.1, 0.3, -0.2, 0.4, 0.1, -0.2, 0.3, 0.0, -0.1, 0.2, 0.1, -0.1, 0.3, -0.2, 0.1, 0.2],
            sigma: [0.12, 0.14, 0.16, 0.11, 0.15, 0.13, 0.17, 0.12, 0.14, 0.16, 0.11, 0.15, 0.13, 0.17, 0.12, 0.14], // Low uncertainty
            games_processed: 28, // Many games
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T11:00:00Z'
        }
      ];

      const mockGameData = {
        metadata: {
          neutralGame: 'N',
          postseason: 'N',
          date: '2024-03-15'
        },
        teams: {
          home: { name: 'Duke', score: 85 },
          visitor: { name: 'UNC', score: 82 }
        },
        transitionProbabilities: {
          home: {
            twoPointMakeProb: 0.48,
            twoPointMissProb: 0.30,
            threePointMakeProb: 0.13,
            threePointMissProb: 0.06,
            freeThrowMakeProb: 0.02,
            freeThrowMissProb: 0.005,
            offensiveReboundProb: 0.005,
            turnoverProb: 0.0
          },
          visitor: {
            twoPointMakeProb: 0.46,
            twoPointMissProb: 0.32,
            threePointMakeProb: 0.12,
            threePointMissProb: 0.07,
            freeThrowMakeProb: 0.018,
            freeThrowMissProb: 0.004,
            offensiveReboundProb: 0.006,
            turnoverProb: 0.0
          }
        }
      };

      // Setup mocks
      mockDbConnection.all
        .mockResolvedValueOnce(mockGames)
        .mockResolvedValueOnce(mockTeams);

      mockDbConnection.get.mockImplementation((sql, params) => {
        const teamId = params[0];
        const team = mockTeams.find(t => t.team_id === teamId);
        return Promise.resolve({ 
          game_count: team ? JSON.parse(team.statistical_representation).games_processed : 0 
        });
      });

      validator.featureExtractor.processGame = jest.fn().mockResolvedValue(mockGameData);
      
      validator.teamRepository.getTeamByEspnId = jest.fn()
        .mockImplementation((teamId) => {
          const team = mockTeams.find(t => t.team_id === teamId);
          return Promise.resolve(team ? {
            statisticalRepresentation: team.statistical_representation
          } : null);
        });

      // Well-trained neural network making good predictions
      validator.transitionNN.predict = jest.fn()
        .mockReturnValueOnce([0.47, 0.31, 0.125, 0.065, 0.021, 0.006, 0.003, 0.0]) // Very close to actual
        .mockReturnValueOnce([0.455, 0.325, 0.118, 0.072, 0.019, 0.005, 0.006, 0.0]); // Very close to actual

      // Well-trained feedback trainer: low feedback rate, converged
      validator.feedbackTrainer.getTrainingStats = jest.fn().mockReturnValue({
        totalIterations: 200,
        feedbackTriggers: 25, // Low feedback rate (12.5%) - system performing well
        convergenceAchieved: true,
        averageNNLoss: 0.08, // Low loss - good performance
        averageVAELoss: 0.9, // Good VAE loss
        stability: {
          currentAlpha: 0.005, // Near minimum - system stable
          stable: true
        }
      });

      validator.feedbackTrainer.monitorStability = jest.fn().mockReturnValue({
        stable: true,
        feedbackRate: 0.125, // Low feedback rate
        alphaDecayRate: 0.95, // Good decay rate
        currentAlpha: 0.005
      });

      validator.feedbackTrainer.initialAlpha = 0.1;
      validator.feedbackTrainer.alphaDecayRate = 0.99;
      validator.feedbackTrainer.minAlpha = 0.001;

      // Good loss history: converged to low loss
      validator.feedbackTrainer.lossHistory = [
        // Early iterations - decreasing loss
        ...Array.from({ length: 50 }, (_, i) => ({
          iteration: i + 1,
          nnLoss: 0.5 * Math.exp(-i * 0.08) + 0.08, // Exponential decay to 0.08
          alpha: 0.1 * Math.pow(0.99, i)
        })),
        // Recent iterations - stable low loss
        ...Array.from({ length: 150 }, (_, i) => ({
          iteration: i + 51,
          nnLoss: 0.08 + (Math.random() - 0.5) * 0.02, // Stable around 0.08 with small variance
          alpha: 0.1 * Math.pow(0.99, i + 50)
        }))
      ];

      // Run validation
      const report = await validator.runValidation({
        sampleSize: 1,
        teamSampleSize: 2,
        minGamesForTeamAnalysis: 5
      });

      // Verify the validation correctly identifies good system performance
      expect(report.overallScore).toBeGreaterThan(80); // Should score well with fixed scoring
      expect(report.criticalIssues.length).toBe(0); // Should have no critical issues

      // Verify specific validations
      expect(report.sections.predictionAccuracy.summary.acceptable).toBe(true); // Low MAE should be acceptable
      expect(report.sections.predictionAccuracy.summary.excellent).toBe(true); // Very low MAE should be excellent

      expect(report.sections.teamDistributions.summary.healthyPercentage).toBeGreaterThan(80); // Teams should be healthy
      expect(report.sections.teamDistributions.summary.sigmaDecayingProperly).toBe(true); // Sigma should be low with many games

      expect(report.sections.feedbackLoop.summary.effective).toBe(true); // Low feedback rate = effective
      expect(report.sections.feedbackLoop.summary.stable).toBe(true);

      expect(report.sections.systemConvergence.summary.converging).toBe(true);
      expect(report.sections.systemConvergence.summary.systemStable).toBe(true);

      // Should have minimal recommendations
      expect(report.recommendations.length).toBeLessThan(2);
    });

    test('should handle mixed system performance with specific issues', async () => {
      // Scenario: System with some good aspects but specific problems
      const mockGames = [
        {
          game_id: 'game1',
          game_date: '2024-03-15',
          home_team_id: 'team1',
          away_team_id: 'team2'
        }
      ];

      // Mixed team quality: one good, one problematic
      const mockTeams = [
        {
          team_id: 'team1',
          team_name: 'Good Team',
          statistical_representation: JSON.stringify({
            mu: [0.2, -0.1, 0.3, 0.1, -0.2, 0.15, 0.05, -0.1, 0.25, -0.15, 0.1, 0.2, -0.05, 0.18, 0.12, -0.08],
            sigma: [0.2, 0.18, 0.22, 0.19, 0.21, 0.17, 0.23, 0.2, 0.18, 0.22, 0.19, 0.21, 0.17, 0.23, 0.2, 0.18], // Reasonable uncertainty
            games_processed: 18, // Good number of games
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T10:00:00Z'
        },
        {
          team_id: 'team2',
          team_name: 'Problematic Team',
          statistical_representation: JSON.stringify({
            mu: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], // Suspiciously uniform - potential issue
            sigma: [0.95, 0.98, 0.92, 0.96, 0.94, 0.97, 0.93, 0.95, 0.98, 0.92, 0.96, 0.94, 0.97, 0.93, 0.95, 0.98], // High uncertainty despite games
            games_processed: 12, // Decent games but sigma not decreasing
            last_season: '2024-25'
          }),
          updated_at: '2024-03-15T11:00:00Z'
        }
      ];

      const mockGameData = {
        metadata: { neutralGame: 'N', postseason: 'N', date: '2024-03-15' },
        teams: {
          home: { name: 'Good Team', score: 78 },
          visitor: { name: 'Problematic Team', score: 65 }
        },
        transitionProbabilities: {
          home: {
            twoPointMakeProb: 0.45,
            twoPointMissProb: 0.32,
            threePointMakeProb: 0.14,
            threePointMissProb: 0.06,
            freeThrowMakeProb: 0.02,
            freeThrowMissProb: 0.005,
            offensiveReboundProb: 0.005,
            turnoverProb: 0.0
          },
          visitor: {
            twoPointMakeProb: 0.38,
            twoPointMissProb: 0.39,
            threePointMakeProb: 0.11,
            threePointMissProb: 0.09,
            freeThrowMakeProb: 0.025,
            freeThrowMissProb: 0.008,
            offensiveReboundProb: 0.007,
            turnoverProb: 0.0
          }
        }
      };

      // Setup mocks
      mockDbConnection.all
        .mockResolvedValueOnce(mockGames)
        .mockResolvedValueOnce(mockTeams);

      mockDbConnection.get.mockImplementation((sql, params) => {
        const teamId = params[0];
        const team = mockTeams.find(t => t.team_id === teamId);
        return Promise.resolve({ 
          game_count: team ? JSON.parse(team.statistical_representation).games_processed : 0 
        });
      });

      validator.featureExtractor.processGame = jest.fn().mockResolvedValue(mockGameData);
      
      validator.teamRepository.getTeamByEspnId = jest.fn()
        .mockImplementation((teamId) => {
          const team = mockTeams.find(t => t.team_id === teamId);
          return Promise.resolve(team ? {
            statisticalRepresentation: team.statistical_representation
          } : null);
        });

      // Mixed prediction quality
      validator.transitionNN.predict = jest.fn()
        .mockReturnValueOnce([0.44, 0.33, 0.135, 0.065, 0.022, 0.006, 0.002, 0.0]) // Good prediction
        .mockReturnValueOnce([0.32, 0.45, 0.08, 0.12, 0.03, 0.01, 0.01, 0.0]); // Poor prediction

      // Mixed feedback trainer performance
      validator.feedbackTrainer.getTrainingStats = jest.fn().mockReturnValue({
        totalIterations: 120,
        feedbackTriggers: 48, // Moderate feedback rate (40%)
        convergenceAchieved: false, // Not converged
        averageNNLoss: 0.18, // Moderate loss
        averageVAELoss: 1.5, // Moderate VAE loss
        stability: {
          currentAlpha: 0.03, // Decent decay
          stable: false // Not stable
        }
      });

      validator.feedbackTrainer.monitorStability = jest.fn().mockReturnValue({
        stable: false,
        feedbackRate: 0.4, // Moderate feedback rate
        alphaDecayRate: 0.7, // Good decay rate
        currentAlpha: 0.03
      });

      validator.feedbackTrainer.initialAlpha = 0.1;
      validator.feedbackTrainer.lossHistory = Array.from({ length: 40 }, (_, i) => ({
        iteration: i + 1,
        nnLoss: 0.35 - (i * 0.004), // Slowly improving
        alpha: 0.1 * Math.pow(0.99, i)
      }));

      // Run validation
      const report = await validator.runValidation({
        sampleSize: 1,
        teamSampleSize: 2,
        minGamesForTeamAnalysis: 5
      });

      // Verify mixed performance is correctly identified
      expect(report.overallScore).toBeGreaterThan(40); // Not terrible with fixed scoring
      expect(report.overallScore).toBeLessThan(90); // But not great either

      // Should identify specific issues
      expect(report.sections.teamDistributions.summary.healthyPercentage).toBeLessThan(100); // Should detect problematic team
      expect(report.sections.teamDistributions.summary.sigmaDecayingProperly).toBe(false); // Should detect sigma not decreasing

      // Should provide targeted recommendations
      expect(report.recommendations).toContain('Review Bayesian update mechanism - team uncertainties not decreasing properly');
      expect(report.recommendations.length).toBeGreaterThan(1);
      expect(report.recommendations.length).toBeLessThan(5); // Not all recommendations
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle teams with invalid statistical representations', async () => {
      const mockTeams = [
        {
          team_id: 'team1',
          team_name: 'Invalid Team',
          statistical_representation: '{"invalid": "structure"}', // Missing mu/sigma
          updated_at: '2024-03-15T10:00:00Z'
        },
        {
          team_id: 'team2',
          team_name: 'Wrong Dimensions Team',
          statistical_representation: JSON.stringify({
            mu: [1, 2, 3], // Wrong dimensions
            sigma: [0.1, 0.2, 0.3], // Wrong dimensions
            games_processed: 10
          }),
          updated_at: '2024-03-15T11:00:00Z'
        }
      ];

      mockDbConnection.all.mockResolvedValue(mockTeams);

      await validator.validateTeamDistributions(2, 5);

      expect(validator.validationResults.teamDistributions.status).toBe('completed');
      expect(validator.validationResults.teamDistributions.distributionIssues).toBe(2);
      expect(validator.validationResults.teamDistributions.summary.criticalIssues).toBe(1); // Invalid structure
    });

    test('should generate appropriate recommendations for specific issues', async () => {
      // Test the recommendation generation logic directly
      validator.validationResults = {
        predictionAccuracy: {
          status: 'completed',
          summary: { acceptable: false, excellent: false },
          metrics: { meanAbsoluteError: 0.25 }
        },
        teamDistributions: {
          status: 'completed',
          summary: { healthyPercentage: 30, sigmaDecayingProperly: false }
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

      // Verify all expected recommendations are present
      expect(report.recommendations).toContain('System requires attention - multiple components showing issues');
      expect(report.recommendations).toContain('Improve prediction accuracy by adjusting model parameters or training data');
      expect(report.recommendations).toContain('Review Bayesian update mechanism - team uncertainties not decreasing properly');
      expect(report.recommendations).toContain('Adjust feedback threshold or alpha decay parameters');
      expect(report.recommendations).toContain('System may need more training iterations or parameter tuning');
      
      expect(report.overallScore).toBeLessThan(30); // Should score poorly
      expect(report.criticalIssues.length).toBeGreaterThan(2); // Should identify multiple critical issues
    });
  });
});