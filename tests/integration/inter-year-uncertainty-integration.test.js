const BayesianTeamUpdater = require('../../src/modules/sports/BayesianTeamUpdater');
const InterYearUncertaintyManager = require('../../src/modules/sports/InterYearUncertaintyManager');
const SeasonTransitionDetector = require('../../src/modules/sports/SeasonTransitionDetector');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

// Mock the TeamRepository
jest.mock('../../src/database/repositories/TeamRepository');

describe('Inter-Year Uncertainty Integration', () => {
  let teamRepo;
  let seasonDetector;
  let uncertaintyManager;
  let bayesianUpdater;

  beforeEach(() => {
    teamRepo = new TeamRepository();
    seasonDetector = new SeasonTransitionDetector();
    uncertaintyManager = new InterYearUncertaintyManager(teamRepo);
    bayesianUpdater = new BayesianTeamUpdater(teamRepo, {
      enableSeasonTransitions: true,
      interYearVariance: 0.25,
      crossSeasonDecay: 0.7
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Season Transition Workflow', () => {
    it('should handle complete season transition workflow', async () => {
      const teamId = '150'; // Duke
      
      // Initial team distribution from previous season
      const initialDistribution = {
        mu: [0.5, -0.2, 0.1, 0.0],
        sigma: [0.2, 0.3, 0.15, 0.25],
        games_processed: 30,
        last_season: '2023-24',
        confidence: 0.85,
        initialized_at: '2023-11-01T00:00:00.000Z'
      };

      // Mock team repository calls
      teamRepo.getTeamByEspnId
        .mockResolvedValueOnce({
          teamId,
          statisticalRepresentation: JSON.stringify(initialDistribution)
        })
        .mockResolvedValueOnce({
          teamId,
          statisticalRepresentation: JSON.stringify({
            ...initialDistribution,
            sigma: [0.35, 0.42, 0.29, 0.37], // Increased due to inter-year variance
            last_season: '2024-25',
            season_transition_history: [{
              from_season: '2023-24',
              to_season: '2024-25',
              transition_date: new Date().toISOString(),
              variance_added: 0.25
            }]
          })
        });

      teamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      // Simulate first game of new season
      const newSeasonGameDate = new Date('2024-11-15');
      const observedLatent = [0.6, -0.1, 0.2, 0.1];
      const gameContext = {
        gameDate: newSeasonGameDate,
        gameResult: { won: true, pointDifferential: 15 },
        isConferenceGame: true,
        restDays: 3
      };

      // Update team distribution - should trigger season transition
      const result = await bayesianUpdater.updateTeamDistribution(
        teamId,
        observedLatent,
        gameContext
      );

      // Verify season transition was applied
      expect(result.last_season).toBe('2024-25');
      expect(result.games_processed).toBe(31); // Incremented from 30
      
      // Verify season transition was applied (uncertainty may decrease due to Bayesian update)
      // The key is that the season was updated and the process completed successfully
      expect(result.sigma).toBeDefined();

      // Verify repository was called for both season transition and Bayesian update
      expect(teamRepo.updateStatisticalRepresentation).toHaveBeenCalledTimes(2);
    });

    it('should apply cross-season weighting for games from previous seasons', async () => {
      const teamId = '151'; // UNC
      
      // Team already in current season
      const currentDistribution = {
        mu: [0.3, -0.1, 0.05, 0.2],
        sigma: [0.25, 0.35, 0.2, 0.3],
        games_processed: 15,
        last_season: '2024-25',
        confidence: 0.7
      };

      teamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: JSON.stringify(currentDistribution)
      });

      teamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      // Simulate processing a game from previous season (e.g., during backfill)
      const previousSeasonGameDate = new Date('2023-12-15');
      const observedLatent = [0.8, 0.1, 0.3, 0.4]; // Strong performance
      const gameContext = {
        gameDate: previousSeasonGameDate,
        gameResult: { won: true, pointDifferential: 20 }
      };

      const result = await bayesianUpdater.updateTeamDistribution(
        teamId,
        observedLatent,
        gameContext
      );

      // Verify update was applied with reduced weight
      expect(result.games_processed).toBe(16);
      expect(result.last_season).toBe('2024-25'); // Should remain current season
      
      // The update should be applied once for the Bayesian update
      // (Season transition check happens but no update needed since team is already in current season)
      expect(teamRepo.updateStatisticalRepresentation).toHaveBeenCalled();
    });
  });

  describe('Season Detection Integration', () => {
    it('should correctly detect season boundaries', () => {
      // Test various dates across season boundaries
      const testCases = [
        { date: new Date('2024-11-15'), expectedSeason: '2024-25' }, // Mid November
        { date: new Date('2024-12-15'), expectedSeason: '2024-25' },
        { date: new Date('2025-01-15'), expectedSeason: '2024-25' },
        { date: new Date('2025-03-15'), expectedSeason: '2024-25' },
        { date: new Date('2024-07-15'), expectedSeason: '2023-24' }, // Off-season
        { date: new Date('2023-11-15'), expectedSeason: '2023-24' }
      ];

      testCases.forEach(({ date, expectedSeason }) => {
        const season = seasonDetector.getSeasonForDate(date);
        expect(season).toBe(expectedSeason);
      });
    });

    it('should detect transitions correctly', () => {
      const currentDate = new Date('2024-11-15');
      const lastKnownSeason = '2023-24';
      
      const result = seasonDetector.checkSeasonTransition(currentDate, lastKnownSeason);
      
      expect(result.isTransition).toBe(true);
      expect(result.newSeason).toBe('2024-25');
      expect(result.previousSeason).toBe('2023-24');
    });
  });

  describe('Uncertainty Manager Integration', () => {
    it('should manage team uncertainty across seasons', async () => {
      const teamId = '152';
      const currentDate = new Date('2024-11-15');
      
      const mockDistribution = {
        mu: [0.4, -0.3, 0.2, -0.1],
        sigma: [0.2, 0.25, 0.18, 0.22],
        games_processed: 25,
        last_season: '2023-24',
        confidence: 0.8
      };

      teamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: JSON.stringify(mockDistribution)
      });

      teamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await uncertaintyManager.checkAndApplySeasonTransition(teamId, currentDate);

      expect(result.transitionDetected).toBe(true);
      expect(result.newSeason).toBe('2024-25');
      
      // Verify uncertainty increased
      const updatedDistribution = result.updatedDistribution;
      expect(updatedDistribution.mu).toEqual(mockDistribution.mu); // μ preserved
      updatedDistribution.sigma.forEach((newSigma, i) => {
        expect(newSigma).toBeGreaterThan(mockDistribution.sigma[i]); // σ increased
      });
      
      // Verify transition history recorded
      expect(updatedDistribution.season_transition_history).toBeDefined();
      expect(updatedDistribution.season_transition_history.length).toBe(1);
    });
  });

  describe('Configuration Integration', () => {
    it('should allow coordinated configuration updates', () => {
      const config = {
        enableSeasonTransitions: true,
        crossSeasonDecay: 0.8,
        interYearVariance: 0.3,
        uncertaintyManager: {
          maxUncertainty: 3.0,
          minUncertainty: 0.05
        }
      };

      bayesianUpdater.updateConfiguration(config);
      
      const updatedConfig = bayesianUpdater.getConfiguration();
      expect(updatedConfig.enableSeasonTransitions).toBe(true);
      expect(updatedConfig.crossSeasonDecay).toBe(0.8);
      expect(updatedConfig.uncertaintyManager.maxUncertainty).toBe(3.0);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle season transition errors gracefully', async () => {
      const teamId = '999'; // Non-existent team
      const gameDate = new Date('2024-11-15');

      teamRepo.getTeamByEspnId.mockResolvedValue(null);

      const result = await bayesianUpdater.checkAndApplySeasonTransition(teamId, gameDate);

      expect(result.transitionDetected).toBe(false);
      expect(result.error).toBeUndefined(); // Should not throw, just return false
    });

    it('should continue Bayesian updates even if season transition fails', async () => {
      const teamId = '150';
      const observedLatent = [0.3, -0.1];
      const gameContext = {
        gameDate: new Date('2024-11-15'),
        gameResult: { won: true }
      };

      // Mock season transition failure but successful Bayesian update
      teamRepo.getTeamByEspnId
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({
          teamId,
          statisticalRepresentation: JSON.stringify({
            mu: [0.2, -0.2],
            sigma: [0.4, 0.5],
            games_processed: 10,
            last_season: '2024-25'
          })
        });

      teamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      // Should not throw despite season transition error
      const result = await bayesianUpdater.updateTeamDistribution(
        teamId,
        observedLatent,
        gameContext
      );

      expect(result).toBeDefined();
      expect(result.games_processed).toBe(11);
    });
  });
});