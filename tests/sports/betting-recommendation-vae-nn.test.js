const BettingRecommendationEngine = require('../../src/modules/sports/BettingRecommendationEngine');
const MCMCSimulator = require('../../src/modules/sports/MCMCSimulator');
const VAEFeedbackTrainer = require('../../src/modules/sports/VAEFeedbackTrainer');
const TeamRepository = require('../../src/database/repositories/TeamRepository');
const ESPNAPIClient = require('../../src/modules/sports/ESPNAPIClient');

// Mock the dependencies
jest.mock('../../src/modules/sports/MCMCSimulator');
jest.mock('../../src/modules/sports/VAEFeedbackTrainer');
jest.mock('../../src/database/repositories/TeamRepository');
jest.mock('../../src/modules/sports/ESPNAPIClient');

describe('BettingRecommendationEngine VAE-NN Integration', () => {
  let engine;
  let mockVAENNSystem;
  let mockTeamRepository;
  let mockESPNClient;
  let mockSimulator;

  beforeEach(() => {
    // Mock VAE-NN system
    mockVAENNSystem = {
      vae: { encodeGameToTeamDistribution: jest.fn() },
      transitionNN: { predict: jest.fn() },
      trainOnGame: jest.fn()
    };

    // Mock team repository
    mockTeamRepository = {
      getTeamByEspnId: jest.fn()
    };

    // Mock ESPN client
    mockESPNClient = {
      getTodaysGames: jest.fn()
    };

    // Mock simulator
    mockSimulator = {
      checkVAENNAvailability: jest.fn().mockReturnValue({
        available: false,
        hasVAENN: false,
        hasTeamRepository: false
      }),
      setVAENNSystem: jest.fn(),
      simulateWithVAENN: jest.fn(),
      simulate: jest.fn(),
      getConfiguration: jest.fn().mockReturnValue({
        iterations: 1000,
        uncertaintyPropagation: true
      })
    };

    MCMCSimulator.mockImplementation(() => mockSimulator);

    // Create engine with VAE-NN system
    engine = new BettingRecommendationEngine({
      iterations: 1000,
      vaeNNSystem: mockVAENNSystem,
      teamRepository: mockTeamRepository,
      espnClient: mockESPNClient,
      preferVAENN: true,
      includeUncertaintyMetrics: true
    });
  });

  describe('VAE-NN Integration', () => {
    test('should initialize with VAE-NN system', () => {
      expect(mockSimulator.setVAENNSystem).toHaveBeenCalledWith(mockVAENNSystem, mockTeamRepository);
      
      const config = engine.getConfiguration();
      expect(config.preferVAENN).toBe(true);
      expect(config.includeUncertaintyMetrics).toBe(true);
    });

    test('should generate VAE-NN recommendation when system is available', async () => {
      // Mock VAE-NN availability
      mockSimulator.checkVAENNAvailability.mockReturnValue({
        available: true,
        hasVAENN: true,
        hasTeamRepository: true
      });

      // Mock VAE-NN simulation results
      const mockSimulationResults = {
        usedVAENN: true,
        dataSource: 'vae_nn',
        homeWinProb: 0.65,
        awayWinProb: 0.35,
        avgHomeScore: 78.5,
        avgAwayScore: 72.3,
        avgMargin: 6.2,
        iterations: 1000,
        uncertaintyMetrics: {
          homeTeamName: 'Duke Blue Devils',
          awayTeamName: 'North Carolina Tar Heels',
          homeTeamUncertainty: 0.15,
          awayTeamUncertainty: 0.22,
          homeGamesProcessed: 25,
          awayGamesProcessed: 18,
          predictionConfidence: 0.85,
          homeLastSeason: '2024-25',
          awayLastSeason: '2024-25'
        }
      };

      mockSimulator.simulateWithVAENN.mockResolvedValue(mockSimulationResults);

      const gameData = {
        id: 'test-game',
        sport: 'ncaa_basketball',
        date: new Date(),
        teams: {
          home: { id: 'duke', name: 'Duke Blue Devils', abbreviation: 'DUKE' },
          away: { id: 'unc', name: 'North Carolina Tar Heels', abbreviation: 'UNC' }
        }
      };

      const bettingOdds = {
        homeMoneyline: -200, // 66.7% implied
        awayMoneyline: 170,  // 37% implied
        spreadLine: -4.5,
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        totalLine: 150.5,
        overOdds: -110,
        underOdds: -110
      };

      const recommendation = await engine.generateRecommendation(gameData, bettingOdds);

      expect(recommendation.method).toBe('VAE-NN');
      expect(recommendation.dataSource).toBe('vae_nn');
      expect(recommendation.uncertaintyMetrics).toBeDefined();
      expect(recommendation.uncertaintyMetrics.homeTeam.name).toBe('Duke Blue Devils');
      expect(recommendation.uncertaintyMetrics.predictionConfidence).toBe('85.0%');
      expect(recommendation.simulationData.predictionConfidence).toBe('85.0%');

      // Verify VAE-NN simulation was called
      expect(mockSimulator.simulateWithVAENN).toHaveBeenCalledWith(
        'duke',
        'unc',
        expect.objectContaining({
          isNeutralSite: false,
          sport: 'ncaa_basketball'
        })
      );
    });

    test('should fall back to traditional method when VAE-NN fails', async () => {
      // Mock VAE-NN availability but simulation failure
      mockSimulator.checkVAENNAvailability.mockReturnValue({
        available: true,
        hasVAENN: true,
        hasTeamRepository: true
      });

      // Mock VAE-NN simulation returning fallback result
      mockSimulator.simulateWithVAENN.mockResolvedValue({
        usedVAENN: false,
        dataSource: 'fallback_generated'
      });

      // Mock traditional simulation
      mockSimulator.simulate.mockReturnValue({
        homeWinProb: 0.60,
        awayWinProb: 0.40,
        avgHomeScore: 75,
        avgAwayScore: 70,
        avgMargin: 5,
        iterations: 1000
      });

      // Mock team stats aggregator to return valid stats
      engine.statsAggregator = {
        getMatchupStatistics: jest.fn().mockResolvedValue({
          home: { offensiveEfficiency: 110 },
          away: { offensiveEfficiency: 105 }
        })
      };

      // Mock matrix builder
      engine.matrixBuilder = {
        buildMatrix: jest.fn().mockReturnValue({
          sport: 'ncaa_basketball',
          home: { scoreProb: 0.55 },
          away: { scoreProb: 0.50 }
        })
      };

      const gameData = {
        id: 'test-game',
        sport: 'ncaa_basketball',
        date: new Date(),
        teams: {
          home: { id: 'duke', name: 'Duke Blue Devils', abbreviation: 'DUKE' },
          away: { id: 'unc', name: 'North Carolina Tar Heels', abbreviation: 'UNC' }
        }
      };

      const bettingOdds = {
        homeMoneyline: -150,
        awayMoneyline: 130
      };

      const recommendation = await engine.generateRecommendation(gameData, bettingOdds);

      expect(recommendation.method).toBe('MCMC');
      expect(recommendation.uncertaintyMetrics).toBeUndefined();
      
      // Should have tried VAE-NN first, then fallen back
      expect(mockSimulator.simulateWithVAENN).toHaveBeenCalled();
      expect(mockSimulator.simulate).toHaveBeenCalled();
    });

    test('should build game context correctly', () => {
      const gameData = {
        id: 'test-game',
        sport: 'ncaa_basketball',
        date: new Date('2025-02-15T19:00:00Z'), // February 15, 2025, 7 PM UTC (mid-season)
        neutralSite: true,
        postseason: false,
        conferenceGame: true,
        teams: {
          home: { id: 'duke', abbreviation: 'DUKE' },
          away: { id: 'unc', abbreviation: 'UNC' }
        }
      };

      const gameContext = engine.buildGameContext(gameData);

      expect(gameContext.isNeutralSite).toBe(true);
      expect(gameContext.isConferenceGame).toBe(true);
      expect(gameContext.sport).toBe('ncaa_basketball');
      expect(gameContext.timeOfDay).toBeGreaterThanOrEqual(0);
      expect(gameContext.timeOfDay).toBeLessThan(24);
      expect(gameContext.seasonProgress).toBeGreaterThanOrEqual(0);
      expect(gameContext.seasonProgress).toBeLessThanOrEqual(1);
    });

    test('should format uncertainty metrics correctly', () => {
      const uncertaintyMetrics = {
        homeTeamName: 'Duke Blue Devils',
        awayTeamName: 'North Carolina Tar Heels',
        homeTeamUncertainty: 0.12,
        awayTeamUncertainty: 0.28,
        homeGamesProcessed: 30,
        awayGamesProcessed: 15,
        predictionConfidence: 0.88,
        homeLastSeason: '2024-25',
        awayLastSeason: '2024-25'
      };

      const formatted = engine.formatUncertaintyMetrics(uncertaintyMetrics);

      expect(formatted.homeTeam.name).toBe('Duke Blue Devils');
      expect(formatted.homeTeam.uncertainty).toBe('12.0%');
      expect(formatted.awayTeam.uncertainty).toBe('28.0%');
      expect(formatted.predictionConfidence).toBe('88.0%');
      expect(formatted.confidenceLevel).toBe('High');
    });

    test('should get confidence level correctly', () => {
      expect(engine.getConfidenceLevel(0.95)).toBe('Very High');
      expect(engine.getConfidenceLevel(0.85)).toBe('High');
      expect(engine.getConfidenceLevel(0.75)).toBe('Moderate');
      expect(engine.getConfidenceLevel(0.65)).toBe('Low');
      expect(engine.getConfidenceLevel(0.55)).toBe('Very Low');
    });
  });

  describe('Today\'s Games Integration', () => {
    test('should fetch and generate recommendations for today\'s games', async () => {
      // Mock ESPN API response
      const mockGames = [
        {
          id: 'game1',
          date: new Date().toISOString(),
          competitions: [{
            neutralSite: false,
            competitors: [
              {
                homeAway: 'home',
                team: { id: 'duke', displayName: 'Duke Blue Devils', abbreviation: 'DUKE' }
              },
              {
                homeAway: 'away',
                team: { id: 'unc', displayName: 'North Carolina Tar Heels', abbreviation: 'UNC' }
              }
            ]
          }]
        }
      ];

      mockESPNClient.getTodaysGames.mockResolvedValue(mockGames);

      // Mock VAE-NN system availability and simulation
      mockSimulator.checkVAENNAvailability.mockReturnValue({ available: true });
      mockSimulator.simulateWithVAENN.mockResolvedValue({
        usedVAENN: true,
        dataSource: 'vae_nn',
        homeWinProb: 0.65,
        awayWinProb: 0.35,
        avgHomeScore: 78,
        avgAwayScore: 72,
        avgMargin: 6,
        iterations: 1000,
        uncertaintyMetrics: {
          homeTeamName: 'Duke Blue Devils',
          awayTeamName: 'North Carolina Tar Heels',
          predictionConfidence: 0.85
        }
      });

      const bettingOddsMap = {
        'game1': {
          homeMoneyline: -180,
          awayMoneyline: 160
        }
      };

      const recommendations = await engine.generateTodaysRecommendations(bettingOddsMap);

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].gameId).toBe('game1');
      expect(recommendations[0].matchup).toBe('UNC @ DUKE');
      expect(recommendations[0].recommendation.method).toBe('VAE-NN');
      expect(mockESPNClient.getTodaysGames).toHaveBeenCalledWith('mens-college-basketball');
    });

    test('should handle errors gracefully when generating today\'s recommendations', async () => {
      // Mock ESPN API to return games
      const mockGames = [
        {
          id: 'game1',
          date: new Date().toISOString(),
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { id: 'duke', displayName: 'Duke Blue Devils', abbreviation: 'DUKE' } },
              { homeAway: 'away', team: { id: 'unc', displayName: 'North Carolina Tar Heels', abbreviation: 'UNC' } }
            ]
          }]
        }
      ];

      mockESPNClient.getTodaysGames.mockResolvedValue(mockGames);

      // Mock simulation to throw error during VAE-NN generation
      mockSimulator.checkVAENNAvailability.mockReturnValue({ available: true });
      mockSimulator.simulateWithVAENN.mockRejectedValue(new Error('Simulation failed'));
      
      // Mock traditional method to also fail (no team stats)
      engine.statsAggregator = {
        getMatchupStatistics: jest.fn().mockResolvedValue({
          home: null, // No stats available
          away: null
        })
      };

      const recommendations = await engine.generateTodaysRecommendations();

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].recommendation.pick).toBe('No strong recommendation');
      expect(recommendations[0].recommendation.method).toBe('Fallback');
      expect(recommendations[0].recommendation.warning).toContain('Team statistics unavailable');
    });
  });

  describe('Configuration and Status', () => {
    test('should set VAE-NN system correctly', () => {
      const newVAENNSystem = {
        vae: { encodeGameToTeamDistribution: jest.fn() },
        transitionNN: { predict: jest.fn() }
      };

      engine.setVAENNSystem(newVAENNSystem);

      expect(engine.vaeNNSystem).toBe(newVAENNSystem);
      expect(mockSimulator.setVAENNSystem).toHaveBeenCalledWith(newVAENNSystem, mockTeamRepository);
    });

    test('should get simulation statistics with VAE-NN', async () => {
      mockSimulator.checkVAENNAvailability.mockReturnValue({ available: true });
      mockSimulator.simulateWithVAENN.mockResolvedValue({
        usedVAENN: true,
        dataSource: 'vae_nn',
        homeWinProb: 0.65,
        awayWinProb: 0.35,
        avgHomeScore: 78,
        avgAwayScore: 72,
        avgMargin: 6,
        marginStdDev: 12,
        iterations: 1000,
        uncertaintyMetrics: { predictionConfidence: 0.85 }
      });

      const gameData = {
        id: 'test-game',
        teams: {
          home: { id: 'duke' },
          away: { id: 'unc' }
        }
      };

      const stats = await engine.getSimulationStatistics(gameData);

      expect(stats.method).toBe('VAE-NN');
      expect(stats.dataSource).toBe('vae_nn');
      expect(stats.uncertaintyMetrics).toBeDefined();
      expect(stats.homeWinProb).toBe(0.65);
    });
  });
});