const FeatureExtractor = require('../../src/modules/sports/FeatureExtractor');
const TransitionProbabilityComputer = require('../../src/modules/sports/TransitionProbabilityComputer');
const GameRepresentationBuilder = require('../../src/modules/sports/GameRepresentationBuilder');
const TransitionMatrixMLP = require('../../src/modules/sports/TransitionMatrixMLP');
const ModelTrainer = require('../../src/modules/sports/ModelTrainer');
const OnlineLearner = require('../../src/modules/sports/OnlineLearner');
const BayesianFeatureUpdater = require('../../src/modules/sports/BayesianFeatureUpdater');
const ModelUpdateOrchestrator = require('../../src/modules/sports/ModelUpdateOrchestrator');

describe('Generative Transition Matrix System', () => {
  describe('FeatureExtractor', () => {
    let featureExtractor;

    beforeEach(() => {
      featureExtractor = new FeatureExtractor();
    });

    test('should extract features from team games', () => {
      const teamGames = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 75,
          awayScore: 70,
          gameDate: '2024-01-01',
          homeFieldGoalPct: 0.48,
          awayFieldGoalPct: 0.45,
          homeTurnovers: 12,
          awayTurnovers: 15
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 80,
          awayScore: 78,
          gameDate: '2024-01-05',
          homeFieldGoalPct: 0.50,
          awayFieldGoalPct: 0.49,
          homeTurnovers: 10,
          awayTurnovers: 11
        }
      ];

      const features = featureExtractor.extractFeatures(teamGames, 'team1');

      expect(features).toHaveLength(15);
      expect(features.every(f => f >= 0 && f <= 1)).toBe(true);
    });

    test('should return default features when no games available', () => {
      const features = featureExtractor.extractFeatures([], 'team1');

      expect(features).toHaveLength(15);
      expect(features.every(f => f === 0.5)).toBe(true);
    });

    test('should calculate offensive efficiency correctly', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 100,
          awayScore: 90,
          gameDate: '2024-01-01'
        }
      ];

      const offEff = featureExtractor.calculateOffensiveEfficiency(games, 'team1');

      expect(offEff).toBeGreaterThan(0);
      expect(offEff).toBeLessThan(200);
    });

    test('should normalize features to [0, 1] range', () => {
      const rawFeatures = {
        offensiveEfficiency: 110,
        defensiveEfficiency: 95,
        pace: 70,
        effectiveFieldGoalPct: 0.52,
        freeThrowRate: 0.28,
        threePointRate: 0.38,
        turnoverRate: 0.14,
        offensiveReboundRate: 0.32,
        defensiveReboundRate: 0.72,
        assistRate: 0.55,
        stealRate: 0.10,
        blockRate: 0.08,
        recentFormWinPct: 0.6,
        recentFormAvgMargin: 5,
        recentFormMomentum: 0.2
      };

      const normalized = featureExtractor.normalizeFeatures(rawFeatures);

      expect(normalized).toHaveLength(15);
      expect(normalized.every(f => f >= 0 && f <= 1)).toBe(true);
    });
  });

  describe('TransitionProbabilityComputer', () => {
    let computer;

    beforeEach(() => {
      computer = new TransitionProbabilityComputer();
    });

    test('should compute transition probabilities from game data', () => {
      const gameData = {
        metadata: {
          gameId: 'game1',
          date: '2024-01-01'
        },
        teams: {
          home: {
            name: 'Team A',
            score: 75,
            stats: {
              fgm: 28,
              fga: 60,
              fg3m: 8,
              fg3a: 20,
              ftm: 11,
              fta: 15,
              turnovers: 12,
              offensiveRebounds: 10
            },
            advancedMetrics: {
              possessionCount: 70
            },
            derivedMetrics: {
              effectiveFgPct: 50.0
            }
          },
          visitor: {
            name: 'Team B',
            score: 70,
            stats: {
              fgm: 26,
              fga: 58,
              fg3m: 6,
              fg3a: 18,
              ftm: 12,
              fta: 16,
              turnovers: 14,
              offensiveRebounds: 8
            },
            advancedMetrics: {
              possessionCount: 70
            },
            derivedMetrics: {
              effectiveFgPct: 48.0
            }
          }
        }
      };

      const matrix = computer.computeFromGameData(gameData);

      expect(matrix).toHaveProperty('home');
      expect(matrix).toHaveProperty('away');
      expect(matrix).toHaveProperty('possessions');
      expect(matrix.home.scoreProb).toBeGreaterThan(0);
      expect(matrix.home.scoreProb).toBeLessThan(1);
      expect(matrix.away.scoreProb).toBeGreaterThan(0);
      expect(matrix.away.scoreProb).toBeLessThan(1);
    });

    test('should validate transition matrix', () => {
      const validMatrix = {
        home: {
          scoreProb: 0.5,
          twoPointProb: 0.6,
          threePointProb: 0.3,
          freeThrowProb: 0.1,
          turnoverProb: 0.15,
          reboundProb: 0.3,
          freeThrowPct: 0.75
        },
        away: {
          scoreProb: 0.48,
          twoPointProb: 0.6,
          threePointProb: 0.3,
          freeThrowProb: 0.1,
          turnoverProb: 0.16,
          reboundProb: 0.28,
          freeThrowPct: 0.72
        }
      };

      expect(computer.validateMatrix(validMatrix)).toBe(true);
    });

    test('should convert matrix to array and back', () => {
      const matrix = {
        home: {
          scoreProb: 0.5,
          twoPointProb: 0.6,
          threePointProb: 0.3,
          freeThrowProb: 0.1,
          turnoverProb: 0.15,
          reboundProb: 0.3,
          freeThrowPct: 0.75,
          expectedPoints: 1.0
        },
        away: {
          scoreProb: 0.48,
          twoPointProb: 0.6,
          threePointProb: 0.3,
          freeThrowProb: 0.1,
          turnoverProb: 0.16,
          reboundProb: 0.28,
          freeThrowPct: 0.72,
          expectedPoints: 0.95
        }
      };

      const array = computer.matrixToArray(matrix);
      expect(array).toHaveLength(16);

      const reconstructed = computer.arrayToMatrix(array);
      expect(reconstructed.home.scoreProb).toBeCloseTo(matrix.home.scoreProb);
      expect(reconstructed.away.scoreProb).toBeCloseTo(matrix.away.scoreProb);
    });
  });

  describe('GameRepresentationBuilder', () => {
    let builder;
    let featureExtractor;

    beforeEach(() => {
      featureExtractor = new FeatureExtractor();
      builder = new GameRepresentationBuilder(featureExtractor);
    });

    test('should build game representation from team features', () => {
      const homeFeatures = new Array(15).fill(0.5);
      const awayFeatures = new Array(15).fill(0.5);
      const gameContext = {
        homeTeamId: 'team1',
        awayTeamId: 'team2',
        gameDate: new Date('2024-01-15'),
        isNeutralSite: false,
        seasonStartDate: new Date('2023-11-01')
      };

      const representation = builder.buildRepresentation(
        homeFeatures,
        awayFeatures,
        gameContext
      );

      expect(representation).toHaveLength(35); // 15 + 15 + 5
      expect(representation.every(v => v >= 0 && v <= 1)).toBe(true);
    });

    test('should validate game representation', () => {
      const validRep = new Array(35).fill(0.5);
      expect(builder.validateRepresentation(validRep)).toBe(true);

      const invalidRep = new Array(30).fill(0.5);
      expect(builder.validateRepresentation(invalidRep)).toBe(false);
    });

    test('should split representation into components', () => {
      const representation = new Array(35).fill(0.5);
      const components = builder.splitRepresentation(representation);

      expect(components.homeFeatures).toHaveLength(15);
      expect(components.awayFeatures).toHaveLength(15);
      expect(components.contextualFeatures).toHaveLength(5);
    });

    test('should handle neutral site games', () => {
      const homeFeatures = new Array(15).fill(0.5);
      const awayFeatures = new Array(15).fill(0.5);
      const gameContext = {
        homeTeamId: 'team1',
        awayTeamId: 'team2',
        gameDate: new Date('2024-01-15'),
        isNeutralSite: true,
        seasonStartDate: new Date('2023-11-01')
      };

      const representation = builder.buildRepresentation(
        homeFeatures,
        awayFeatures,
        gameContext
      );

      const components = builder.splitRepresentation(representation);
      // Neutral site indicator should be 1.0
      expect(components.contextualFeatures[1]).toBe(1.0);
    });
  });

  describe('TransitionMatrixMLP', () => {
    let mlp;

    beforeEach(() => {
      mlp = new TransitionMatrixMLP(35, 16);
    });

    test('should initialize with correct architecture', () => {
      expect(mlp.inputDim).toBe(35);
      expect(mlp.outputDim).toBe(16);
      expect(mlp.layers).toHaveLength(5);
    });

    test('should perform forward pass', () => {
      const input = new Array(35).fill(0.5);
      const output = mlp.forward(input);

      expect(output).toHaveLength(16);
      expect(output.every(v => v >= 0 && v <= 1)).toBe(true);
      
      // Output should sum to approximately 1 (softmax)
      const sum = output.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 1);
    });

    test('should compute loss correctly', () => {
      const predicted = [0.5, 0.3, 0.2];
      const actual = [0.6, 0.3, 0.1];

      const loss = mlp.computeLoss(predicted, actual);

      expect(loss).toBeGreaterThan(0);
      expect(isFinite(loss)).toBe(true);
    });

    test('should perform backward pass and update weights', () => {
      const input = new Array(35).fill(0.5);
      const target = new Array(16).fill(1/16); // Uniform distribution

      const initialOutput = mlp.forward(input);
      const initialLoss = mlp.computeLoss(initialOutput, target);

      // Perform multiple training steps
      for (let i = 0; i < 10; i++) {
        mlp.backward(input, target, 0.01);
      }

      const finalOutput = mlp.forward(input);
      const finalLoss = mlp.computeLoss(finalOutput, target);

      // Loss should decrease after training
      expect(finalLoss).toBeLessThan(initialLoss);
    });

    test('should save and load model state', () => {
      const input = new Array(35).fill(0.5);
      const output1 = mlp.forward(input);

      const state = mlp.toJSON();
      expect(state).toHaveProperty('weights');
      expect(state).toHaveProperty('biases');

      const mlp2 = new TransitionMatrixMLP();
      mlp2.fromJSON(state);

      const output2 = mlp2.forward(input);

      // Outputs should be identical
      for (let i = 0; i < output1.length; i++) {
        expect(output2[i]).toBeCloseTo(output1[i]);
      }
    });

    test('should count parameters correctly', () => {
      const paramCount = mlp.countParameters();
      
      // Should have weights and biases for all layers
      expect(paramCount).toBeGreaterThan(0);
      
      // Rough calculation: (35*128 + 128) + (128*64 + 64) + (64*32 + 32) + (32*16 + 16)
      const expectedMin = 35*128 + 128*64 + 64*32 + 32*16;
      expect(paramCount).toBeGreaterThan(expectedMin);
    });
  });

  describe('BayesianFeatureUpdater', () => {
    let updater;
    let mockTeamRepo;
    let mockFeatureExtractor;

    beforeEach(() => {
      mockTeamRepo = {
        getTeamByEspnId: jest.fn(),
        updateStatisticalRepresentation: jest.fn(),
        updateLastSynced: jest.fn()
      };

      mockFeatureExtractor = new FeatureExtractor();
      updater = new BayesianFeatureUpdater(mockTeamRepo, mockFeatureExtractor);
    });

    test('should calculate learning rate based on games played', () => {
      const newTeamRate = updater.calculateLearningRate(3);
      const developingTeamRate = updater.calculateLearningRate(7);
      const establishedTeamRate = updater.calculateLearningRate(15);

      expect(newTeamRate).toBeGreaterThan(developingTeamRate);
      expect(developingTeamRate).toBeGreaterThan(establishedTeamRate);
    });

    test('should calculate uncertainty that decreases with games', () => {
      const uncertainty0 = updater.calculateUncertainty(0);
      const uncertainty5 = updater.calculateUncertainty(5);
      const uncertainty20 = updater.calculateUncertainty(20);

      expect(uncertainty0).toBeGreaterThan(uncertainty5);
      expect(uncertainty5).toBeGreaterThan(uncertainty20);
      expect(uncertainty20).toBeGreaterThanOrEqual(0.1); // Minimum uncertainty
    });

    test('should apply Bayesian update correctly', () => {
      const currentFeatures = new Array(15).fill(0.5);
      const delta = new Array(15).fill(0.1);
      const learningRate = 0.1;
      const uncertainty = 0.5;

      const updated = updater.applyBayesianUpdate(
        currentFeatures,
        delta,
        learningRate,
        uncertainty
      );

      expect(updated).toHaveLength(15);
      // Features should have moved in direction of delta
      expect(updated[0]).toBeGreaterThan(currentFeatures[0]);
    });

    test('should clamp features to valid range', () => {
      const features = [-0.5, 0.3, 0.7, 1.5, 2.0];
      const clamped = updater.clampFeatures(features);

      expect(clamped.every(f => f >= 0 && f <= 1)).toBe(true);
      expect(clamped[0]).toBe(0);
      expect(clamped[1]).toBe(0.3);
      expect(clamped[3]).toBe(1);
    });

    test('should apply regression toward mean', () => {
      const extremeFeatures = [0.1, 0.9, 0.2, 0.8];
      const regressed = updater.applyRegressionToMean(extremeFeatures, 0.1);

      // Features should move toward 0.5
      expect(regressed[0]).toBeGreaterThan(extremeFeatures[0]);
      expect(regressed[1]).toBeLessThan(extremeFeatures[1]);
    });
  });

  describe('ModelUpdateOrchestrator', () => {
    let orchestrator;
    let mockHistoricalRepo;
    let mockTeamRepo;
    let mockXmlParser;

    beforeEach(() => {
      mockHistoricalRepo = {
        getTeamGameHistory: jest.fn().mockResolvedValue([])
      };

      mockTeamRepo = {
        getTeamByEspnId: jest.fn().mockResolvedValue({
          teamId: 'team1',
          statisticalRepresentation: JSON.stringify(new Array(15).fill(0.5))
        }),
        updateStatisticalRepresentation: jest.fn().mockResolvedValue({}),
        updateLastSynced: jest.fn().mockResolvedValue({})
      };

      mockXmlParser = {
        parseGameXML: jest.fn().mockResolvedValue({
          metadata: {
            gameId: 'game1',
            date: '2024-01-01'
          },
          teams: {
            home: {
              name: 'Team A',
              score: 75,
              stats: {
                fgm: 28,
                fga: 60,
                fg3m: 8,
                fg3a: 20,
                ftm: 11,
                fta: 15,
                turnovers: 12,
                offensiveRebounds: 10,
                rebounds: 35
              },
              advancedMetrics: {
                possessionCount: 70
              },
              derivedMetrics: {
                effectiveFgPct: 50.0
              }
            },
            visitor: {
              name: 'Team B',
              score: 70,
              stats: {
                fgm: 26,
                fga: 58,
                fg3m: 6,
                fg3a: 18,
                ftm: 12,
                fta: 16,
                turnovers: 14,
                offensiveRebounds: 8,
                rebounds: 33
              },
              advancedMetrics: {
                possessionCount: 70
              },
              derivedMetrics: {
                effectiveFgPct: 48.0
              }
            }
          }
        })
      };

      orchestrator = new ModelUpdateOrchestrator(
        mockHistoricalRepo,
        mockTeamRepo,
        mockXmlParser
      );
    });

    test('should extract game statistics correctly', () => {
      const gameData = {
        teams: {
          home: {
            score: 75,
            stats: { turnovers: 12, rebounds: 35 },
            advancedMetrics: { possessionCount: 70 },
            derivedMetrics: { effectiveFgPct: 50.0 }
          },
          visitor: {
            score: 70,
            stats: { turnovers: 14, rebounds: 33 },
            advancedMetrics: { possessionCount: 70 },
            derivedMetrics: { effectiveFgPct: 48.0 }
          }
        }
      };

      const stats = orchestrator.extractGameStatistics(gameData);

      expect(stats).toHaveProperty('home');
      expect(stats).toHaveProperty('away');
      expect(stats.home.score).toBe(75);
      expect(stats.away.score).toBe(70);
      expect(stats.home.possessions).toBe(70);
    });

    test('should get and reset metrics', () => {
      orchestrator.metrics.totalUpdates = 10;
      orchestrator.metrics.successfulUpdates = 8;
      orchestrator.metrics.failedUpdates = 2;

      const metrics = orchestrator.getMetrics();
      expect(metrics.successRate).toBe(80);

      orchestrator.resetMetrics();
      expect(orchestrator.metrics.totalUpdates).toBe(0);
    });

    test('should configure orchestrator', () => {
      orchestrator.configure({
        enableMLPUpdate: false,
        enableFeatureUpdate: true
      });

      expect(orchestrator.config.enableMLPUpdate).toBe(false);
      expect(orchestrator.config.enableFeatureUpdate).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    test('should complete full pipeline from features to prediction', () => {
      // Create components
      const featureExtractor = new FeatureExtractor();
      const gameRepBuilder = new GameRepresentationBuilder(featureExtractor);
      const mlp = new TransitionMatrixMLP(35, 16);
      const computer = new TransitionProbabilityComputer();

      // Create mock team games
      const homeGames = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team3',
          homeScore: 80,
          awayScore: 75,
          gameDate: '2024-01-01',
          homeFieldGoalPct: 0.50,
          awayFieldGoalPct: 0.48
        }
      ];

      const awayGames = [
        {
          homeTeamId: 'team4',
          awayTeamId: 'team2',
          homeScore: 70,
          awayScore: 72,
          gameDate: '2024-01-01',
          homeFieldGoalPct: 0.46,
          awayFieldGoalPct: 0.49
        }
      ];

      // Extract features
      const homeFeatures = featureExtractor.extractFeatures(homeGames, 'team1');
      const awayFeatures = featureExtractor.extractFeatures(awayGames, 'team2');

      expect(homeFeatures).toHaveLength(15);
      expect(awayFeatures).toHaveLength(15);

      // Build game representation
      const gameContext = {
        homeTeamId: 'team1',
        awayTeamId: 'team2',
        gameDate: new Date('2024-01-15'),
        isNeutralSite: false,
        seasonStartDate: new Date('2023-11-01')
      };

      const representation = gameRepBuilder.buildRepresentation(
        homeFeatures,
        awayFeatures,
        gameContext
      );

      expect(representation).toHaveLength(35);

      // Generate prediction with MLP
      const prediction = mlp.forward(representation);

      expect(prediction).toHaveLength(16);
      expect(prediction.every(v => v >= 0 && v <= 1)).toBe(true);

      // Convert to matrix format
      const matrix = computer.arrayToMatrix(prediction);

      expect(matrix).toHaveProperty('home');
      expect(matrix).toHaveProperty('away');
      expect(matrix.home.scoreProb).toBeGreaterThan(0);
      expect(matrix.home.scoreProb).toBeLessThan(1);
    });

    test('should train model and improve predictions', () => {
      const mlp = new TransitionMatrixMLP(35, 16);
      
      // Create training data
      const input = new Array(35).fill(0.5);
      const target = new Array(16).fill(1/16);

      // Measure initial loss
      const initialOutput = mlp.forward(input);
      const initialLoss = mlp.computeLoss(initialOutput, target);

      // Train for multiple epochs
      for (let epoch = 0; epoch < 50; epoch++) {
        mlp.backward(input, target, 0.01);
      }

      // Measure final loss
      const finalOutput = mlp.forward(input);
      const finalLoss = mlp.computeLoss(finalOutput, target);

      // Loss should decrease significantly
      expect(finalLoss).toBeLessThan(initialLoss * 0.9);
    });
  });
});
