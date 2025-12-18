const tf = require('@tensorflow/tfjs');
const InfoNCEVAE = require('../../src/modules/sports/InfoNCEVAE');
const FrozenVAEEncoder = require('../../src/modules/sports/FrozenVAEEncoder');
const BayesianTeamUpdater = require('../../src/modules/sports/BayesianTeamUpdater');
const TransitionProbabilityNN = require('../../src/modules/sports/TransitionProbabilityNN');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

// Mock database dependencies
jest.mock('../../src/database/repositories/TeamRepository');
jest.mock('../../src/modules/sports/InfoNCEDataSampler', () => {
  return jest.fn().mockImplementation(() => ({
    sampleContrastivePair: jest.fn().mockImplementation(async (gameId, numNegatives) => {
      // Generate realistic transition probability vectors
      const generateTransitionProbs = () => {
        const probs = new Array(8).fill(0).map(() => Math.random() * 0.3);
        const sum = probs.reduce((a, b) => a + b, 0);
        return probs.map(p => p / sum); // Normalize to sum to 1
      };

      return {
        positive: {
          home: generateTransitionProbs(),
          away: generateTransitionProbs()
        },
        negatives: Array.from({ length: numNegatives }, () => generateTransitionProbs())
      };
    }),
    getCacheStats: jest.fn().mockReturnValue({
      cacheSize: 100,
      sampleCount: 50,
      cacheRefreshInterval: 100
    })
  }));
});

describe('End-to-End System Stability', () => {
  let infoNCEVAE;
  let frozenEncoder;
  let bayesianUpdater;
  let transitionNN;
  let mockTeamRepo;

  beforeEach(() => {
    // Initialize components
    infoNCEVAE = new InfoNCEVAE(80, 16, 0.1);
    mockTeamRepo = new TeamRepository();
    bayesianUpdater = new BayesianTeamUpdater(mockTeamRepo, {
      initialUncertainty: 1.0,
      minUncertainty: 0.1,
      enableSeasonTransitions: false
    });
    transitionNN = new TransitionProbabilityNN(64, 8); // 64 input (2 teams * 32), 8 output
  });

  afterEach(() => {
    if (infoNCEVAE) {
      infoNCEVAE.dispose();
    }
    if (frozenEncoder) {
      frozenEncoder.dispose();
    }
    if (transitionNN) {
      transitionNN.dispose();
    }
  });

  describe('Extended Training Stability', () => {
    test('should maintain stable training over extended sessions without mode collapse', async () => {
      const trainingHistory = [];
      const stabilityMetrics = [];
      
      // Extended training simulation
      for (let epoch = 0; epoch < 50; epoch++) {
        const epochLosses = [];
        
        // Train on multiple games per epoch
        for (let game = 0; game < 5; game++) {
          const inputFeatures = new Array(80).fill(0).map(() => Math.random());
          const gameId = `stability-epoch-${epoch}-game-${game}`;
          
          try {
            const result = await infoNCEVAE.trainStepWithInfoNCE(
              inputFeatures,
              gameId,
              Math.random() > 0.5 ? 'home' : 'away'
            );
            
            epochLosses.push({
              total: result.totalLoss,
              reconstruction: result.reconstructionLoss,
              kl: result.klLoss,
              infoNCE: result.infoNCELoss,
              lambda: result.lambda
            });
          } catch (error) {
            // Training should not fail catastrophically
            expect(error.message).not.toContain('NaN');
            expect(error.message).not.toContain('Infinity');
          }
        }
        
        if (epochLosses.length > 0) {
          // Calculate epoch averages
          const epochAvg = {
            epoch,
            total: epochLosses.reduce((sum, loss) => sum + loss.total, 0) / epochLosses.length,
            reconstruction: epochLosses.reduce((sum, loss) => sum + loss.reconstruction, 0) / epochLosses.length,
            kl: epochLosses.reduce((sum, loss) => sum + loss.kl, 0) / epochLosses.length,
            infoNCE: epochLosses.reduce((sum, loss) => sum + loss.infoNCE, 0) / epochLosses.length,
            lambda: epochLosses[0].lambda
          };
          
          trainingHistory.push(epochAvg);
          
          // Calculate stability metrics every 10 epochs
          if (epoch > 0 && epoch % 10 === 0) {
            const recentHistory = trainingHistory.slice(-10);
            const totalLosses = recentHistory.map(h => h.total);
            const avgLoss = totalLosses.reduce((a, b) => a + b, 0) / totalLosses.length;
            const variance = totalLosses.reduce((acc, loss) => acc + Math.pow(loss - avgLoss, 2), 0) / totalLosses.length;
            const stability = variance / (avgLoss * avgLoss); // Coefficient of variation
            
            stabilityMetrics.push({
              epoch,
              avgLoss,
              variance,
              stability,
              isStable: stability < 0.5 // Reasonable stability threshold
            });
          }
        }
      }

      // Verify training stability
      expect(trainingHistory.length).toBeGreaterThan(40); // Most epochs should succeed
      
      // Check for mode collapse indicators
      const recentLosses = trainingHistory.slice(-10);
      const avgRecentTotal = recentLosses.reduce((sum, h) => sum + h.total, 0) / recentLosses.length;
      const avgRecentInfoNCE = recentLosses.reduce((sum, h) => sum + h.infoNCE, 0) / recentLosses.length;
      
      // Losses should not collapse to near zero
      expect(avgRecentTotal).toBeGreaterThan(0.1);
      expect(avgRecentInfoNCE).toBeGreaterThan(0.01);
      
      // Losses should not explode to infinity
      expect(avgRecentTotal).toBeLessThan(100);
      expect(isFinite(avgRecentTotal)).toBe(true);
      
      // System should achieve some stability over time
      if (stabilityMetrics.length > 0) {
        const finalStability = stabilityMetrics[stabilityMetrics.length - 1];
        expect(finalStability.stability).toBeLessThan(2.0); // Reasonable upper bound
      }
    });

    test('should handle diverse input patterns without degradation', async () => {
      const inputPatterns = [
        // High-scoring offensive teams
        () => new Array(80).fill(0).map((_, i) => i < 20 ? 0.8 + Math.random() * 0.2 : Math.random() * 0.3),
        // Defensive teams
        () => new Array(80).fill(0).map((_, i) => i >= 20 && i < 40 ? 0.8 + Math.random() * 0.2 : Math.random() * 0.3),
        // Balanced teams
        () => new Array(80).fill(0).map(() => 0.4 + Math.random() * 0.2),
        // Extreme outliers
        () => new Array(80).fill(0).map(() => Math.random() > 0.9 ? Math.random() : 0.1),
        // Random teams
        () => new Array(80).fill(0).map(() => Math.random())
      ];

      const patternResults = [];

      for (let patternIdx = 0; patternIdx < inputPatterns.length; patternIdx++) {
        const pattern = inputPatterns[patternIdx];
        const patternLosses = [];

        // Train on this pattern for multiple iterations
        for (let iter = 0; iter < 10; iter++) {
          const inputFeatures = pattern();
          const gameId = `pattern-${patternIdx}-iter-${iter}`;

          try {
            const result = await infoNCEVAE.trainStepWithInfoNCE(
              inputFeatures,
              gameId,
              'home'
            );

            patternLosses.push(result.totalLoss);
          } catch (error) {
            // Should handle all patterns gracefully
            fail(`Pattern ${patternIdx} failed: ${error.message}`);
          }
        }

        const avgLoss = patternLosses.reduce((a, b) => a + b, 0) / patternLosses.length;
        const maxLoss = Math.max(...patternLosses);
        const minLoss = Math.min(...patternLosses);

        patternResults.push({
          pattern: patternIdx,
          avgLoss,
          maxLoss,
          minLoss,
          range: maxLoss - minLoss
        });

        // Each pattern should produce reasonable losses
        expect(avgLoss).toBeGreaterThan(0.01);
        expect(avgLoss).toBeLessThan(50);
        expect(isFinite(avgLoss)).toBe(true);
      }

      // All patterns should produce losses in similar ranges (no catastrophic failures)
      const avgLosses = patternResults.map(r => r.avgLoss);
      const overallAvg = avgLosses.reduce((a, b) => a + b, 0) / avgLosses.length;
      
      for (const avgLoss of avgLosses) {
        expect(avgLoss).toBeLessThan(overallAvg * 5); // No pattern should be 5x worse
        expect(avgLoss).toBeGreaterThan(overallAvg / 5); // No pattern should be 5x better
      }
    });
  });

  describe('Historical Data Performance', () => {
    test('should maintain consistent performance on historical-like data', async () => {
      // Simulate historical game data with realistic patterns
      const historicalGames = [];
      
      // Generate games with seasonal patterns
      for (let season = 0; season < 3; season++) {
        for (let game = 0; game < 30; game++) {
          // Simulate team improvement over season
          const seasonProgress = game / 30;
          const basePerformance = 0.3 + seasonProgress * 0.4; // Teams improve over season
          
          const homeTeamFeatures = new Array(80).fill(0).map(() => 
            basePerformance + (Math.random() - 0.5) * 0.2
          );
          const awayTeamFeatures = new Array(80).fill(0).map(() => 
            basePerformance + (Math.random() - 0.5) * 0.2
          );

          historicalGames.push({
            gameId: `historical-s${season}-g${game}`,
            homeFeatures: homeTeamFeatures,
            awayFeatures: awayTeamFeatures,
            season,
            gameNumber: game
          });
        }
      }

      // Train on historical data
      const performanceMetrics = [];
      
      for (let i = 0; i < historicalGames.length; i++) {
        const game = historicalGames[i];
        
        try {
          // Train on both teams
          const homeResult = await infoNCEVAE.trainStepWithInfoNCE(
            game.homeFeatures,
            game.gameId,
            'home'
          );
          
          const awayResult = await infoNCEVAE.trainStepWithInfoNCE(
            game.awayFeatures,
            game.gameId,
            'away'
          );

          // Track performance every 10 games
          if (i % 10 === 0) {
            performanceMetrics.push({
              gameIndex: i,
              season: game.season,
              homeLoss: homeResult.totalLoss,
              awayLoss: awayResult.totalLoss,
              avgLoss: (homeResult.totalLoss + awayResult.totalLoss) / 2
            });
          }
        } catch (error) {
          fail(`Historical game ${i} failed: ${error.message}`);
        }
      }

      // Verify consistent performance across seasons
      const seasonMetrics = [0, 1, 2].map(season => {
        const seasonData = performanceMetrics.filter(m => m.season === season);
        if (seasonData.length === 0) return null;
        
        const avgLoss = seasonData.reduce((sum, m) => sum + m.avgLoss, 0) / seasonData.length;
        return { season, avgLoss, gameCount: seasonData.length };
      }).filter(m => m !== null);

      // Performance should be consistent across seasons
      if (seasonMetrics.length > 1) {
        const losses = seasonMetrics.map(m => m.avgLoss);
        const maxLoss = Math.max(...losses);
        const minLoss = Math.min(...losses);
        
        // No season should be dramatically different
        expect(maxLoss / minLoss).toBeLessThan(3.0);
      }

      // Overall performance should be stable
      const allLosses = performanceMetrics.map(m => m.avgLoss);
      const overallAvg = allLosses.reduce((a, b) => a + b, 0) / allLosses.length;
      expect(overallAvg).toBeGreaterThan(0.1);
      expect(overallAvg).toBeLessThan(20);
    });
  });

  describe('Integrated System Stability', () => {
    test('should maintain stability with frozen encoder and Bayesian updates', async () => {
      // First, train InfoNCE VAE
      const pretrainingGames = 20;
      for (let i = 0; i < pretrainingGames; i++) {
        const inputFeatures = new Array(80).fill(0).map(() => Math.random());
        const gameId = `pretrain-${i}`;
        
        await infoNCEVAE.trainStepWithInfoNCE(inputFeatures, gameId, 'home');
      }

      // Create frozen encoder
      frozenEncoder = new FrozenVAEEncoder(infoNCEVAE);
      
      // Verify encoder is frozen
      const initialWeights = await frozenEncoder.getEncoderWeights();
      
      // Simulate game-by-game processing with Bayesian updates
      const teams = ['team1', 'team2', 'team3', 'team4'];
      const teamStates = {};
      
      // Initialize team states
      for (const teamId of teams) {
        teamStates[teamId] = {
          team_id: teamId,
          statisticalRepresentation: JSON.stringify({
            mu: new Array(16).fill(0.0),
            sigma: new Array(16).fill(1.0),
            games_processed: 0,
            last_season: '2023-24',
            last_updated: '2024-01-01'
          })
        };
      }

      const systemMetrics = [];

      // Process games with integrated system
      for (let gameIdx = 0; gameIdx < 30; gameIdx++) {
        const homeTeam = teams[gameIdx % teams.length];
        const awayTeam = teams[(gameIdx + 1) % teams.length];
        
        // Generate game features
        const homeFeatures = new Array(80).fill(0).map(() => Math.random());
        const awayFeatures = new Array(80).fill(0).map(() => Math.random());
        
        try {
          // Encode teams using frozen encoder
          const homeEncoding = frozenEncoder.encodeToTeamDistribution(homeFeatures);
          const awayEncoding = frozenEncoder.encodeToTeamDistribution(awayFeatures);
          
          // Mock team repository calls
          mockTeamRepo.getTeamByEspnId
            .mockResolvedValueOnce(teamStates[homeTeam])
            .mockResolvedValueOnce(teamStates[awayTeam]);
          mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue(true);
          
          // Update team distributions with Bayesian inference
          const homeUpdate = await bayesianUpdater.updateTeamDistribution(
            homeTeam,
            homeEncoding.mu,
            { opponent_strength: 0.5, gameDate: '2024-01-15' }
          );
          
          const awayUpdate = await bayesianUpdater.updateTeamDistribution(
            awayTeam,
            awayEncoding.mu,
            { opponent_strength: 0.5, gameDate: '2024-01-15' }
          );
          
          // Update team states
          teamStates[homeTeam] = {
            ...teamStates[homeTeam],
            statisticalRepresentation: JSON.stringify(homeUpdate)
          };
          teamStates[awayTeam] = {
            ...teamStates[awayTeam],
            statisticalRepresentation: JSON.stringify(awayUpdate)
          };
          
          // Track system metrics
          systemMetrics.push({
            gameIdx,
            homeTeam,
            awayTeam,
            homeGamesProcessed: homeUpdate.games_processed,
            awayGamesProcessed: awayUpdate.games_processed,
            homeUncertainty: homeUpdate.sigma.reduce((a, b) => a + b, 0) / homeUpdate.sigma.length,
            awayUncertainty: awayUpdate.sigma.reduce((a, b) => a + b, 0) / awayUpdate.sigma.length
          });
          
        } catch (error) {
          fail(`Integrated system failed at game ${gameIdx}: ${error.message}`);
        }
      }

      // Verify encoder weights haven't changed
      const finalWeights = await frozenEncoder.getEncoderWeights();
      
      for (const [layerName, initialWeight] of Object.entries(initialWeights)) {
        const finalWeight = finalWeights[layerName];
        const initialData = initialWeight.dataSync();
        const finalData = finalWeight.dataSync();
        
        for (let i = 0; i < initialData.length; i++) {
          expect(Math.abs(initialData[i] - finalData[i])).toBeLessThan(1e-10);
        }
      }

      // Verify Bayesian updates are working
      const finalMetrics = systemMetrics[systemMetrics.length - 1];
      expect(finalMetrics.homeGamesProcessed).toBeGreaterThan(0);
      expect(finalMetrics.awayGamesProcessed).toBeGreaterThan(0);
      
      // Uncertainty should generally decrease over time
      const teamUncertainties = {};
      for (const metric of systemMetrics) {
        if (!teamUncertainties[metric.homeTeam]) {
          teamUncertainties[metric.homeTeam] = [];
        }
        if (!teamUncertainties[metric.awayTeam]) {
          teamUncertainties[metric.awayTeam] = [];
        }
        teamUncertainties[metric.homeTeam].push(metric.homeUncertainty);
        teamUncertainties[metric.awayTeam].push(metric.awayUncertainty);
      }

      // Check that uncertainty trends downward for teams with multiple games
      for (const [teamId, uncertainties] of Object.entries(teamUncertainties)) {
        if (uncertainties.length > 5) {
          const early = uncertainties.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
          const late = uncertainties.slice(-3).reduce((a, b) => a + b, 0) / 3;
          expect(late).toBeLessThanOrEqual(early * 1.1); // Allow small variance
        }
      }
    });
  });

  describe('Prediction Stability', () => {
    test('should produce stable and reasonable predictions over time', async () => {
      // Train system first
      for (let i = 0; i < 15; i++) {
        const inputFeatures = new Array(80).fill(0).map(() => Math.random());
        await infoNCEVAE.trainStepWithInfoNCE(inputFeatures, `train-${i}`, 'home');
      }

      frozenEncoder = new FrozenVAEEncoder(infoNCEVAE);
      
      // Generate predictions for consistent input
      const testInput = new Array(80).fill(0.5); // Consistent test input
      const predictions = [];

      for (let i = 0; i < 20; i++) {
        try {
          const encoding = frozenEncoder.encodeToTeamDistribution(testInput);
          
          // Predictions should be consistent for same input
          predictions.push({
            iteration: i,
            mu: [...encoding.mu],
            sigma: [...encoding.sigma]
          });
        } catch (error) {
          fail(`Prediction failed at iteration ${i}: ${error.message}`);
        }
      }

      // Verify prediction stability
      expect(predictions.length).toBe(20);

      // All predictions should be identical (frozen encoder)
      const firstPrediction = predictions[0];
      for (let i = 1; i < predictions.length; i++) {
        const currentPrediction = predictions[i];
        
        for (let j = 0; j < firstPrediction.mu.length; j++) {
          expect(Math.abs(currentPrediction.mu[j] - firstPrediction.mu[j])).toBeLessThan(1e-10);
          expect(Math.abs(currentPrediction.sigma[j] - firstPrediction.sigma[j])).toBeLessThan(1e-10);
        }
      }

      // Predictions should be reasonable
      const avgMu = firstPrediction.mu.reduce((a, b) => a + b, 0) / firstPrediction.mu.length;
      const avgSigma = firstPrediction.sigma.reduce((a, b) => a + b, 0) / firstPrediction.sigma.length;

      expect(Math.abs(avgMu)).toBeLessThan(5.0); // Reasonable latent range
      expect(avgSigma).toBeGreaterThan(0);
      expect(avgSigma).toBeLessThan(3.0);
      expect(firstPrediction.mu.every(val => isFinite(val))).toBe(true);
      expect(firstPrediction.sigma.every(val => isFinite(val) && val > 0)).toBe(true);
    });
  });

  describe('Memory and Resource Management', () => {
    test('should manage TensorFlow.js memory efficiently during extended operation', async () => {
      const initialMemory = tf.memory();
      
      // Simulate extended operation
      for (let i = 0; i < 100; i++) {
        const inputFeatures = new Array(80).fill(0).map(() => Math.random());
        const gameId = `memory-test-${i}`;
        
        try {
          await infoNCEVAE.trainStepWithInfoNCE(inputFeatures, gameId, 'home');
          
          // Check memory periodically
          if (i % 20 === 0) {
            const currentMemory = tf.memory();
            
            // Memory usage shouldn't grow unboundedly
            const memoryGrowth = currentMemory.numTensors - initialMemory.numTensors;
            expect(memoryGrowth).toBeLessThan(1000); // Reasonable tensor count growth
            
            // No memory leaks (unreasonable growth)
            expect(currentMemory.numBytes).toBeLessThan(initialMemory.numBytes * 10);
          }
        } catch (error) {
          fail(`Memory test failed at iteration ${i}: ${error.message}`);
        }
      }

      const finalMemory = tf.memory();
      
      // Final memory usage should be reasonable
      const tensorGrowth = finalMemory.numTensors - initialMemory.numTensors;
      expect(tensorGrowth).toBeLessThan(500); // Should not accumulate too many tensors
    });
  });
});