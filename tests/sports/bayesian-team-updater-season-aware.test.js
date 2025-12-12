const BayesianTeamUpdater = require('../../src/modules/sports/BayesianTeamUpdater');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

// Mock the TeamRepository
jest.mock('../../src/database/repositories/TeamRepository');

describe('BayesianTeamUpdater - Season Aware Features', () => {
  let updater;
  let mockTeamRepo;

  beforeEach(() => {
    mockTeamRepo = new TeamRepository();
    updater = new BayesianTeamUpdater(mockTeamRepo, {
      enableSeasonTransitions: true,
      crossSeasonDecay: 0.7,
      interYearVariance: 0.25
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAndApplySeasonTransition', () => {
    it('should detect and apply season transition during update', async () => {
      const teamId = '150';
      const gameDate = new Date('2024-11-15'); // New season

      const mockDistribution = {
        mu: [0.5, -0.2],
        sigma: [0.3, 0.4],
        games_processed: 20,
        last_season: '2023-24',
        confidence: 0.8
      };

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: JSON.stringify(mockDistribution)
      });

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await updater.checkAndApplySeasonTransition(teamId, gameDate);

      expect(result.transitionDetected).toBe(true);
      expect(result.newSeason).toBe('2024-25');
      expect(result.previousSeason).toBe('2023-24');
    });

    it('should not apply transition when season transitions are disabled', async () => {
      const disabledUpdater = new BayesianTeamUpdater(mockTeamRepo, {
        enableSeasonTransitions: false
      });

      const teamId = '150';
      const gameDate = new Date('2024-11-15');

      const result = await disabledUpdater.checkAndApplySeasonTransition(teamId, gameDate);

      expect(result.transitionDetected).toBe(false);
      expect(mockTeamRepo.getTeamByEspnId).not.toHaveBeenCalled();
    });
  });

  describe('calculateSeasonAwareWeight', () => {
    it('should return full weight for same season games', () => {
      const gameContext = {
        gameDate: new Date('2024-12-15')
      };

      const currentDistribution = {
        last_season: '2024-25'
      };

      const weight = updater.calculateSeasonAwareWeight(gameContext, currentDistribution);
      expect(weight).toBe(1.0);
    });

    it('should apply decay for cross-season games', () => {
      const gameContext = {
        gameDate: new Date('2023-12-15') // Previous season
      };

      const currentDistribution = {
        last_season: '2024-25'
      };

      const weight = updater.calculateSeasonAwareWeight(gameContext, currentDistribution);
      expect(weight).toBe(0.7); // crossSeasonDecay^1
    });

    it('should apply exponential decay for multiple seasons ago', () => {
      const gameContext = {
        gameDate: new Date('2022-12-15') // Two seasons ago
      };

      const currentDistribution = {
        last_season: '2024-25'
      };

      const weight = updater.calculateSeasonAwareWeight(gameContext, currentDistribution);
      expect(weight).toBeCloseTo(0.49, 2); // crossSeasonDecay^2 = 0.7^2
    });

    it('should return full weight when season transitions disabled', () => {
      const disabledUpdater = new BayesianTeamUpdater(mockTeamRepo, {
        enableSeasonTransitions: false
      });

      const gameContext = {
        gameDate: new Date('2023-12-15')
      };

      const currentDistribution = {
        last_season: '2024-25'
      };

      const weight = disabledUpdater.calculateSeasonAwareWeight(gameContext, currentDistribution);
      expect(weight).toBe(1.0);
    });

    it('should return full weight when no season information available', () => {
      const gameContext = {}; // No gameDate

      const currentDistribution = {
        last_season: '2024-25'
      };

      const weight = updater.calculateSeasonAwareWeight(gameContext, currentDistribution);
      expect(weight).toBe(1.0);
    });
  });

  describe('updateTeamDistribution with season awareness', () => {
    it('should check for season transitions before updating', async () => {
      const teamId = '150';
      const observedLatent = [0.3, -0.1];
      const gameContext = {
        gameDate: new Date('2024-11-15'),
        gameResult: { won: true, pointDifferential: 10 }
      };

      const mockDistribution = {
        mu: [0.2, -0.2],
        sigma: [0.4, 0.5],
        games_processed: 15,
        last_season: '2023-24',
        confidence: 0.7
      };

      const updatedDistributionAfterTransition = {
        ...mockDistribution,
        sigma: [0.5, 0.6], // Increased due to inter-year variance
        last_season: '2024-25',
        season_transition_history: [{
          from_season: '2023-24',
          to_season: '2024-25',
          transition_date: new Date().toISOString(),
          variance_added: 0.25
        }]
      };

      // First call returns original distribution, second call returns updated distribution after season transition
      mockTeamRepo.getTeamByEspnId
        .mockResolvedValueOnce({
          teamId,
          statisticalRepresentation: JSON.stringify(mockDistribution)
        })
        .mockResolvedValueOnce({
          teamId,
          statisticalRepresentation: JSON.stringify(updatedDistributionAfterTransition)
        });

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await updater.updateTeamDistribution(teamId, observedLatent, gameContext);

      // Should have updated the distribution
      expect(result).toBeDefined();
      expect(result.games_processed).toBe(16);
      expect(result.last_season).toBe('2024-25'); // Should be updated to new season

      // Should have called update twice: once for season transition, once for Bayesian update
      expect(mockTeamRepo.updateStatisticalRepresentation).toHaveBeenCalledTimes(2);
    });

    it('should apply season-aware weighting to observations', async () => {
      const teamId = '150';
      const observedLatent = [0.3, -0.1];
      
      // Game from previous season
      const gameContext = {
        gameDate: new Date('2023-12-15'), // Previous season
        gameResult: { won: true, pointDifferential: 10 }
      };

      const mockDistribution = {
        mu: [0.2, -0.2],
        sigma: [0.4, 0.5],
        games_processed: 15,
        last_season: '2024-25', // Current season
        confidence: 0.7
      };

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: JSON.stringify(mockDistribution)
      });

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await updater.updateTeamDistribution(teamId, observedLatent, gameContext);

      // Should have applied the update with reduced weight
      expect(result).toBeDefined();
      expect(result.games_processed).toBe(16);
      
      // The update should be less significant due to cross-season decay
      // (This is hard to test precisely without mocking the Bayesian update math)
      expect(mockTeamRepo.updateStatisticalRepresentation).toHaveBeenCalled();
    });
  });

  describe('initializeTeamDistribution with season tracking', () => {
    it('should initialize with current season', () => {
      const teamId = '150';
      const distribution = updater.initializeTeamDistribution(teamId, 2);

      expect(distribution.last_season).toBeDefined();
      expect(distribution.last_season).toMatch(/^\d{4}-\d{2}$/); // Season format
      expect(distribution.mu).toEqual([0.0, 0.0]);
      expect(distribution.sigma).toEqual([1.0, 1.0]); // initialUncertainty
    });
  });

  describe('triggerSeasonTransitionsForAllTeams', () => {
    it('should trigger season transitions for all teams', async () => {
      const currentDate = new Date('2024-11-15');
      const sport = 'mens-college-basketball';

      const mockTeams = [
        { teamId: '150', teamName: 'Duke' },
        { teamId: '151', teamName: 'UNC' }
      ];

      mockTeamRepo.getTeamsBySport.mockResolvedValue(mockTeams);
      
      // Mock team distributions
      mockTeamRepo.getTeamByEspnId
        .mockResolvedValueOnce({
          teamId: '150',
          statisticalRepresentation: JSON.stringify({
            mu: [0.5], sigma: [0.3], last_season: '2023-24'
          })
        })
        .mockResolvedValueOnce({
          teamId: '151',
          statisticalRepresentation: JSON.stringify({
            mu: [0.2], sigma: [0.4], last_season: '2023-24'
          })
        });

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const results = await updater.triggerSeasonTransitionsForAllTeams(currentDate, sport);

      expect(results).toHaveLength(2);
      expect(results.every(r => r.transitionDetected)).toBe(true);
    });

    it('should return empty array when season transitions disabled', async () => {
      const disabledUpdater = new BayesianTeamUpdater(mockTeamRepo, {
        enableSeasonTransitions: false
      });

      const currentDate = new Date('2024-11-15');
      const results = await disabledUpdater.triggerSeasonTransitionsForAllTeams(currentDate);

      expect(results).toEqual([]);
    });
  });

  describe('configuration', () => {
    it('should include season-aware parameters in configuration', () => {
      const config = updater.getConfiguration();

      expect(config.enableSeasonTransitions).toBe(true);
      expect(config.crossSeasonDecay).toBe(0.7);
      expect(config.uncertaintyManager).toBeDefined();
    });

    it('should update season-aware configuration', () => {
      updater.updateConfiguration({
        enableSeasonTransitions: false,
        crossSeasonDecay: 0.8,
        uncertaintyManager: {
          interYearVariance: 0.3
        }
      });

      const config = updater.getConfiguration();
      expect(config.enableSeasonTransitions).toBe(false);
      expect(config.crossSeasonDecay).toBe(0.8);
    });
  });
});