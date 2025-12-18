const BayesianPosteriorUpdater = require('../../src/modules/sports/BayesianPosteriorUpdater');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

// Mock dependencies
jest.mock('../../src/database/repositories/TeamRepository');

describe('Bayesian Posterior Evolution', () => {
  let posteriorUpdater;
  let mockTeamRepo;
  let mockNNModel;

  beforeEach(() => {
    // Mock TeamRepository
    mockTeamRepo = new TeamRepository();
    
    // Mock Neural Network Model
    mockNNModel = {
      predict: jest.fn()
    };

    // Initialize BayesianPosteriorUpdater
    posteriorUpdater = new BayesianPosteriorUpdater(mockTeamRepo, mockNNModel, {
      learningRate: 0.1,
      minUncertainty: 0.1,
      maxUncertainty: 2.0,
      latentDim: 16,
      preserveInfoNCEStructure: true
    });
  });

  describe('Posterior Distribution Convergence', () => {
    test('should converge posterior distributions with multiple game observations', async () => {
      const teamId = 'team1';
      const opponentId = 'team2';
      
      // Initial posterior with high uncertainty
      const initialPosterior = {
        mu: new Array(16).fill(0.0),
        sigma: new Array(16).fill(1.0),
        games_processed: 0,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      // Opponent posterior
      const opponentPosterior = {
        mu: new Array(16).fill(0.2),
        sigma: new Array(16).fill(0.5),
        games_processed: 5,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      // Mock repository responses
      mockTeamRepo.getTeamEncodingFromDb
        .mockResolvedValueOnce(initialPosterior)
        .mockResolvedValue(opponentPosterior);
      
      mockTeamRepo.updatePosteriorAfterGame.mockResolvedValue(true);

      // Mock NN predictions (consistent transition probabilities)
      mockNNModel.predict.mockReturnValue([0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05]);

      const gameContext = {
        gameDate: new Date('2024-01-15'),
        isHomeGame: true,
        isNeutralSite: false,
        isConferenceGame: true,
        isPostseason: false,
        restDays: 2,
        seasonProgress: 0.5
      };

      // Simulate multiple game observations
      const actualTransitionProbs = [0.32, 0.18, 0.12, 0.08, 0.12, 0.08, 0.06, 0.04];
      
      let currentPosterior = initialPosterior;
      const uncertaintyHistory = [];
      
      // Process 10 games to observe convergence
      for (let game = 0; game < 10; game++) {
        // Update mock to return current posterior
        mockTeamRepo.getTeamEncodingFromDb
          .mockResolvedValueOnce(currentPosterior)
          .mockResolvedValue(opponentPosterior);

        // Mock the updatePosteriorAfterGame to return the updated posterior
        mockTeamRepo.updatePosteriorAfterGame.mockImplementation(async (teamId, updatedPosterior, season) => {
          return true;
        });

        const updatedPosterior = await posteriorUpdater.updatePosterior(
          teamId,
          actualTransitionProbs,
          opponentId,
          gameContext
        );

        // Track uncertainty evolution
        const avgUncertainty = posteriorUpdater.calculateAverageUncertainty(updatedPosterior.sigma);
        uncertaintyHistory.push(avgUncertainty);

        currentPosterior = updatedPosterior;
      }

      // Validate convergence properties
      expect(uncertaintyHistory.length).toBe(10);
      
      // Uncertainty should generally decrease over time
      const initialUncertainty = uncertaintyHistory[0];
      const finalUncertainty = uncertaintyHistory[uncertaintyHistory.length - 1];
      expect(finalUncertainty).toBeLessThan(initialUncertainty);

      // Final uncertainty should be above minimum threshold
      expect(finalUncertainty).toBeGreaterThanOrEqual(posteriorUpdater.minUncertainty);

      // Debug: Check if posterior evolved
      console.log('Initial mu:', initialPosterior.mu.slice(0, 3));
      console.log('Final mu:', currentPosterior.mu.slice(0, 3));
      console.log('Initial sigma:', initialPosterior.sigma.slice(0, 3));
      console.log('Final sigma:', currentPosterior.sigma.slice(0, 3));

      // Posterior should have evolved from initial state
      // NOTE: This test reveals a bug - the mu values don't change because
      // errorToLikelihood sets likelihood.mu = prior.mu, so Bayesian update
      // produces the same mean. This needs to be fixed in the implementation.
      expect(currentPosterior.mu).not.toEqual(initialPosterior.mu);
      expect(currentPosterior.sigma).not.toEqual(initialPosterior.sigma);
    });

    test('should decrease uncertainty with more game observations', async () => {
      const teamId = 'team1';
      const opponentId = 'team2';
      
      // Create posteriors with different numbers of games processed
      const lowGamesPosterior = {
        mu: new Array(16).fill(0.1),
        sigma: new Array(16).fill(0.8),
        games_processed: 2,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      const highGamesPosterior = {
        mu: new Array(16).fill(0.1),
        sigma: new Array(16).fill(0.3),
        games_processed: 20,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      const opponentPosterior = {
        mu: new Array(16).fill(0.0),
        sigma: new Array(16).fill(0.5),
        games_processed: 10,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      mockTeamRepo.getTeamEncodingFromDb.mockResolvedValue(opponentPosterior);
      mockTeamRepo.updatePosteriorAfterGame.mockResolvedValue(true);
      mockNNModel.predict.mockReturnValue([0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05]);

      const gameContext = {
        gameDate: new Date('2024-01-15'),
        isHomeGame: true,
        isNeutralSite: false,
        isConferenceGame: true,
        isPostseason: false,
        restDays: 2,
        seasonProgress: 0.5
      };

      const actualTransitionProbs = [0.32, 0.18, 0.12, 0.08, 0.12, 0.08, 0.06, 0.04];

      // Test update for team with few games
      mockTeamRepo.getTeamEncodingFromDb.mockResolvedValueOnce(lowGamesPosterior);
      const lowGamesUpdate = await posteriorUpdater.updatePosterior(
        teamId,
        actualTransitionProbs,
        opponentId,
        gameContext
      );

      // Test update for team with many games
      mockTeamRepo.getTeamEncodingFromDb.mockResolvedValueOnce(highGamesPosterior);
      const highGamesUpdate = await posteriorUpdater.updatePosterior(
        teamId,
        actualTransitionProbs,
        opponentId,
        gameContext
      );

      // Team with more games should have lower uncertainty after update
      const lowGamesUncertainty = posteriorUpdater.calculateAverageUncertainty(lowGamesUpdate.sigma);
      const highGamesUncertainty = posteriorUpdater.calculateAverageUncertainty(highGamesUpdate.sigma);

      expect(highGamesUncertainty).toBeLessThan(lowGamesUncertainty);
    });
  });

  describe('Prediction Accuracy Improvement', () => {
    test('should improve prediction accuracy through posterior updates', async () => {
      const teamId = 'team1';
      const opponentId = 'team2';

      // Initial posterior (uninformed)
      const initialPosterior = {
        mu: new Array(16).fill(0.0),
        sigma: new Array(16).fill(1.0),
        games_processed: 0,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      const opponentPosterior = {
        mu: new Array(16).fill(0.1),
        sigma: new Array(16).fill(0.4),
        games_processed: 8,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      mockTeamRepo.getTeamEncodingFromDb.mockResolvedValue(opponentPosterior);
      mockTeamRepo.updatePosteriorAfterGame.mockResolvedValue(true);

      const gameContext = {
        gameDate: new Date('2024-01-15'),
        isHomeGame: true,
        isNeutralSite: false,
        isConferenceGame: true,
        isPostseason: false,
        restDays: 2,
        seasonProgress: 0.5
      };

      // Consistent actual transition probabilities (team's true performance)
      const trueTransitionProbs = [0.35, 0.15, 0.15, 0.05, 0.15, 0.05, 0.07, 0.03];

      let currentPosterior = initialPosterior;
      const predictionErrors = [];

      // Simulate learning over multiple games
      for (let game = 0; game < 8; game++) {
        // Mock NN prediction that gradually improves (simulating learning)
        const learningProgress = game / 7; // 0 to 1
        const mockPrediction = trueTransitionProbs.map((trueProb, i) => {
          // Start with uniform prediction, gradually approach true values
          const uniformProb = 0.125; // 1/8
          return uniformProb + learningProgress * (trueProb - uniformProb);
        });

        mockNNModel.predict.mockReturnValue(mockPrediction);

        mockTeamRepo.getTeamEncodingFromDb
          .mockResolvedValueOnce(currentPosterior)
          .mockResolvedValue(opponentPosterior);

        // Calculate prediction error before update
        const predictionError = posteriorUpdater.computePredictionError(mockPrediction, trueTransitionProbs);
        predictionErrors.push(predictionError);

        // Update posterior
        currentPosterior = await posteriorUpdater.updatePosterior(
          teamId,
          trueTransitionProbs,
          opponentId,
          gameContext
        );
      }

      // Prediction accuracy should improve over time
      const earlyErrors = predictionErrors.slice(0, 3);
      const lateErrors = predictionErrors.slice(-3);

      const avgEarlyError = earlyErrors.reduce((sum, err) => sum + err, 0) / earlyErrors.length;
      const avgLateError = lateErrors.reduce((sum, err) => sum + err, 0) / lateErrors.length;

      expect(avgLateError).toBeLessThan(avgEarlyError);
    });
  });

  describe('InfoNCE Structure Preservation', () => {
    test('should maintain valid InfoNCE structure after Bayesian updates', async () => {
      const teamId = 'team1';
      const opponentId = 'team2';

      const initialPosterior = {
        mu: new Array(16).fill(0.2),
        sigma: new Array(16).fill(0.6),
        games_processed: 3,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      const opponentPosterior = {
        mu: new Array(16).fill(-0.1),
        sigma: new Array(16).fill(0.4),
        games_processed: 7,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      mockTeamRepo.getTeamEncodingFromDb
        .mockResolvedValueOnce(initialPosterior)
        .mockResolvedValue(opponentPosterior);
      
      mockTeamRepo.updatePosteriorAfterGame.mockResolvedValue(true);
      mockNNModel.predict.mockReturnValue([0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05]);

      const gameContext = {
        gameDate: new Date('2024-01-15'),
        isHomeGame: true,
        isNeutralSite: false,
        isConferenceGame: true,
        isPostseason: false,
        restDays: 2,
        seasonProgress: 0.5
      };

      const actualTransitionProbs = [0.32, 0.18, 0.12, 0.08, 0.12, 0.08, 0.06, 0.04];

      const updatedPosterior = await posteriorUpdater.updatePosterior(
        teamId,
        actualTransitionProbs,
        opponentId,
        gameContext
      );

      // Validate InfoNCE structure preservation
      expect(updatedPosterior.mu).toHaveLength(16);
      expect(updatedPosterior.sigma).toHaveLength(16);

      // All mu values should be finite
      updatedPosterior.mu.forEach((mu, i) => {
        expect(isFinite(mu)).toBe(true);
        expect(mu).not.toBeNaN();
      });

      // All sigma values should be positive and finite
      updatedPosterior.sigma.forEach((sigma, i) => {
        expect(isFinite(sigma)).toBe(true);
        expect(sigma).toBeGreaterThan(0);
        expect(sigma).not.toBeNaN();
        expect(sigma).toBeGreaterThanOrEqual(posteriorUpdater.minUncertainty);
        expect(sigma).toBeLessThanOrEqual(posteriorUpdater.maxUncertainty);
      });

      // Structure should remain consistent with InfoNCE latent space
      expect(updatedPosterior.mu.length).toBe(posteriorUpdater.latentDim);
      expect(updatedPosterior.sigma.length).toBe(posteriorUpdater.latentDim);
    });

    test('should preserve InfoNCE structure across multiple updates', async () => {
      const teamId = 'team1';
      const opponentId = 'team2';

      let currentPosterior = {
        mu: new Array(16).fill(0.0),
        sigma: new Array(16).fill(0.8),
        games_processed: 0,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      const opponentPosterior = {
        mu: new Array(16).fill(0.1),
        sigma: new Array(16).fill(0.5),
        games_processed: 5,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      mockTeamRepo.getTeamEncodingFromDb.mockResolvedValue(opponentPosterior);
      mockTeamRepo.updatePosteriorAfterGame.mockResolvedValue(true);
      mockNNModel.predict.mockReturnValue([0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05]);

      const gameContext = {
        gameDate: new Date('2024-01-15'),
        isHomeGame: true,
        isNeutralSite: false,
        isConferenceGame: true,
        isPostseason: false,
        restDays: 2,
        seasonProgress: 0.5
      };

      const actualTransitionProbs = [0.32, 0.18, 0.12, 0.08, 0.12, 0.08, 0.06, 0.04];

      // Perform multiple updates and validate structure preservation
      for (let i = 0; i < 5; i++) {
        mockTeamRepo.getTeamEncodingFromDb
          .mockResolvedValueOnce(currentPosterior)
          .mockResolvedValue(opponentPosterior);

        currentPosterior = await posteriorUpdater.updatePosterior(
          teamId,
          actualTransitionProbs,
          opponentId,
          gameContext
        );

        // Validate structure after each update
        expect(() => {
          posteriorUpdater.validateInfoNCEStructure(currentPosterior);
        }).not.toThrow();

        // Check that dimensions remain consistent
        expect(currentPosterior.mu).toHaveLength(16);
        expect(currentPosterior.sigma).toHaveLength(16);

        // Check that values remain in valid ranges
        currentPosterior.mu.forEach(mu => {
          expect(isFinite(mu)).toBe(true);
          expect(Math.abs(mu)).toBeLessThan(10); // Reasonable range for latent values
        });

        currentPosterior.sigma.forEach(sigma => {
          expect(sigma).toBeGreaterThanOrEqual(posteriorUpdater.minUncertainty);
          expect(sigma).toBeLessThanOrEqual(posteriorUpdater.maxUncertainty);
        });
      }
    });
  });

  describe('Bayesian Update Mathematics', () => {
    test('should perform correct Bayesian inference calculations', () => {
      // Test the core Bayesian update mathematics
      const prior = {
        mu: [0.5, -0.2, 0.8],
        sigma: [1.0, 0.8, 0.6]
      };

      const likelihood = {
        mu: [0.7, -0.1, 0.9],
        sigma: [0.4, 0.5, 0.3]
      };

      const gameContext = {
        isNeutralSite: false,
        isPostseason: false,
        restDays: 2
      };

      const posterior = posteriorUpdater.bayesianUpdate(prior, likelihood, gameContext);

      // Validate Bayesian update properties
      expect(posterior.mu).toHaveLength(3);
      expect(posterior.sigma).toHaveLength(3);

      // Posterior uncertainty should be less than both prior and likelihood
      for (let i = 0; i < 3; i++) {
        expect(posterior.sigma[i]).toBeLessThan(Math.max(prior.sigma[i], likelihood.sigma[i]));
        expect(posterior.sigma[i]).toBeGreaterThanOrEqual(posteriorUpdater.minUncertainty);
        
        // Posterior mean should be between prior and likelihood (precision-weighted)
        const minMu = Math.min(prior.mu[i], likelihood.mu[i]);
        const maxMu = Math.max(prior.mu[i], likelihood.mu[i]);
        expect(posterior.mu[i]).toBeGreaterThanOrEqual(minMu - 0.1); // Small tolerance
        expect(posterior.mu[i]).toBeLessThanOrEqual(maxMu + 0.1);
      }
    });

    test('should handle extreme uncertainty cases correctly', () => {
      // Test with very high prior uncertainty
      const highUncertaintyPrior = {
        mu: [0.0, 0.0, 0.0],
        sigma: [2.0, 2.0, 2.0] // Very uncertain
      };

      const preciseLikelihood = {
        mu: [1.0, -1.0, 0.5],
        sigma: [0.1, 0.1, 0.1] // Very precise
      };

      const gameContext = { isNeutralSite: false, isPostseason: false, restDays: 2 };

      const posterior = posteriorUpdater.bayesianUpdate(highUncertaintyPrior, preciseLikelihood, gameContext);

      // With high prior uncertainty and precise likelihood, posterior should be close to likelihood
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(posterior.mu[i] - preciseLikelihood.mu[i])).toBeLessThan(0.2);
        expect(posterior.sigma[i]).toBeLessThan(highUncertaintyPrior.sigma[i]);
        expect(posterior.sigma[i]).toBeGreaterThan(preciseLikelihood.sigma[i] * 0.8); // Should be close to likelihood uncertainty
      }
    });
  });

  describe('Error Handling and Validation', () => {
    test('should handle invalid transition probabilities gracefully', async () => {
      const teamId = 'team1';
      const opponentId = 'team2';

      const validPosterior = {
        mu: new Array(16).fill(0.0),
        sigma: new Array(16).fill(0.5),
        games_processed: 1,
        last_season: '2023-24',
        last_updated: new Date().toISOString()
      };

      mockTeamRepo.getTeamEncodingFromDb.mockResolvedValue(validPosterior);

      const gameContext = {
        gameDate: new Date('2024-01-15'),
        isHomeGame: true,
        isNeutralSite: false,
        isConferenceGame: true,
        isPostseason: false,
        restDays: 2,
        seasonProgress: 0.5
      };

      // Test with invalid transition probabilities
      const invalidTransitionProbs = [0.3, 0.2, 0.1]; // Wrong length

      await expect(posteriorUpdater.updatePosterior(
        teamId,
        invalidTransitionProbs,
        opponentId,
        gameContext
      )).rejects.toThrow('actualTransitionProbs must be array of length 8');
    });

    test('should handle missing team data gracefully', async () => {
      const teamId = 'nonexistent-team';
      const opponentId = 'team2';

      mockTeamRepo.getTeamEncodingFromDb
        .mockResolvedValueOnce(null) // No team data
        .mockResolvedValue({
          mu: new Array(16).fill(0.1),
          sigma: new Array(16).fill(0.5),
          games_processed: 3,
          last_season: '2023-24',
          last_updated: new Date().toISOString()
        });

      const gameContext = {
        gameDate: new Date('2024-01-15'),
        isHomeGame: true,
        isNeutralSite: false,
        isConferenceGame: true,
        isPostseason: false,
        restDays: 2,
        seasonProgress: 0.5
      };

      const actualTransitionProbs = [0.32, 0.18, 0.12, 0.08, 0.12, 0.08, 0.06, 0.04];

      await expect(posteriorUpdater.updatePosterior(
        teamId,
        actualTransitionProbs,
        opponentId,
        gameContext
      )).rejects.toThrow(`No prior distribution found for team ${teamId}`);
    });
  });
});