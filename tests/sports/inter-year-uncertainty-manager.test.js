const InterYearUncertaintyManager = require('../../src/modules/sports/InterYearUncertaintyManager');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

// Mock the TeamRepository
jest.mock('../../src/database/repositories/TeamRepository');

describe('InterYearUncertaintyManager', () => {
  let manager;
  let mockTeamRepo;

  beforeEach(() => {
    mockTeamRepo = new TeamRepository();
    manager = new InterYearUncertaintyManager(mockTeamRepo);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAndApplySeasonTransition', () => {
    it('should detect season transition and apply variance increase', async () => {
      const teamId = '150'; // Duke
      const currentDate = new Date('2024-11-15'); // New season
      
      const mockDistribution = {
        mu: [0.5, -0.2, 0.1, 0.0],
        sigma: [0.3, 0.4, 0.2, 0.5],
        games_processed: 25,
        last_season: '2023-24',
        confidence: 0.8
      };

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: JSON.stringify(mockDistribution)
      });

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await manager.checkAndApplySeasonTransition(teamId, currentDate);

      expect(result.transitionDetected).toBe(true);
      expect(result.newSeason).toBe('2024-25');
      expect(result.previousSeason).toBe('2023-24');
      expect(result.updatedDistribution).toBeDefined();
      
      // Check that μ values are preserved
      expect(result.updatedDistribution.mu).toEqual(mockDistribution.mu);
      
      // Check that σ values increased
      result.updatedDistribution.sigma.forEach((newSigma, i) => {
        expect(newSigma).toBeGreaterThan(mockDistribution.sigma[i]);
      });

      // Check that last_season was updated
      expect(result.updatedDistribution.last_season).toBe('2024-25');
      
      // Check that transition history was recorded
      expect(result.updatedDistribution.season_transition_history).toBeDefined();
      expect(result.updatedDistribution.season_transition_history.length).toBe(1);
    });

    it('should not apply transition when no season change detected', async () => {
      const teamId = '150';
      const currentDate = new Date('2024-12-15'); // Same season
      
      const mockDistribution = {
        mu: [0.5, -0.2, 0.1, 0.0],
        sigma: [0.3, 0.4, 0.2, 0.5],
        games_processed: 25,
        last_season: '2024-25',
        confidence: 0.8
      };

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: JSON.stringify(mockDistribution)
      });

      const result = await manager.checkAndApplySeasonTransition(teamId, currentDate);

      expect(result.transitionDetected).toBe(false);
      expect(result.updatedDistribution).toEqual(mockDistribution);
      expect(mockTeamRepo.updateStatisticalRepresentation).not.toHaveBeenCalled();
    });

    it('should handle team with no statistical representation', async () => {
      const teamId = '999';
      const currentDate = new Date('2024-11-15');

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: null
      });

      const result = await manager.checkAndApplySeasonTransition(teamId, currentDate);

      expect(result.transitionDetected).toBe(false);
      expect(result.updatedDistribution).toBeNull();
    });
  });

  describe('applyInterYearVarianceIncrease', () => {
    it('should correctly increase sigma values while preserving mu', async () => {
      const teamId = '150';
      const currentDistribution = {
        mu: [0.5, -0.2, 0.1, 0.0],
        sigma: [0.3, 0.4, 0.2, 0.5],
        games_processed: 25,
        last_season: '2023-24'
      };

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await manager.applyInterYearVarianceIncrease(
        teamId,
        currentDistribution,
        '2024-25',
        '2023-24'
      );

      // μ values should be preserved (with preserve skill factor = 1.0)
      expect(result.mu).toEqual(currentDistribution.mu);

      // σ values should increase
      result.sigma.forEach((newSigma, i) => {
        const expectedVariance = (currentDistribution.sigma[i] ** 2) + manager.interYearVariance;
        const expectedSigma = Math.sqrt(expectedVariance);
        expect(newSigma).toBeCloseTo(expectedSigma, 4);
      });

      // Metadata should be updated
      expect(result.last_season).toBe('2024-25');
      expect(result.season_transition_history).toBeDefined();
      expect(result.season_transition_history.length).toBe(1);
      expect(result.last_updated).toBeDefined();
    });

    it('should respect maximum uncertainty bounds', async () => {
      const teamId = '150';
      const currentDistribution = {
        mu: [0.5, -0.2],
        sigma: [1.8, 1.9], // High initial uncertainty
        games_processed: 5,
        last_season: '2023-24'
      };

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await manager.applyInterYearVarianceIncrease(
        teamId,
        currentDistribution,
        '2024-25',
        '2023-24'
      );

      // σ values should be clamped to maxUncertainty
      result.sigma.forEach(sigma => {
        expect(sigma).toBeLessThanOrEqual(manager.maxUncertainty);
      });
    });

    it('should respect minimum uncertainty bounds', async () => {
      const teamId = '150';
      const currentDistribution = {
        mu: [0.5, -0.2],
        sigma: [0.05, 0.03], // Very low initial uncertainty
        games_processed: 50,
        last_season: '2023-24'
      };

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await manager.applyInterYearVarianceIncrease(
        teamId,
        currentDistribution,
        '2024-25',
        '2023-24'
      );

      // σ values should be at least minUncertainty
      result.sigma.forEach(sigma => {
        expect(sigma).toBeGreaterThanOrEqual(manager.minUncertainty);
      });
    });
  });

  describe('batchApplySeasonTransitions', () => {
    it('should process multiple teams and return results', async () => {
      const teamIds = ['150', '151', '152'];
      const currentDate = new Date('2024-11-15');

      // Mock different scenarios for each team
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
            mu: [0.2], sigma: [0.4], last_season: '2024-25'
          })
        })
        .mockResolvedValueOnce({
          teamId: '152',
          statisticalRepresentation: null
        });

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const results = await manager.batchApplySeasonTransitions(teamIds, currentDate);

      expect(results).toHaveLength(3);
      expect(results[0].transitionDetected).toBe(true); // Team 150: transition needed
      expect(results[1].transitionDetected).toBe(false); // Team 151: already in current season
      expect(results[2].transitionDetected).toBe(false); // Team 152: no representation
    });
  });

  describe('getTeamsNeedingSeasonTransition', () => {
    it('should identify teams needing season updates', async () => {
      const currentDate = new Date('2024-11-15');
      const sport = 'mens-college-basketball';

      const mockTeams = [
        {
          teamId: '150',
          teamName: 'Duke',
          statisticalRepresentation: JSON.stringify({
            mu: [0.5], sigma: [0.3], last_season: '2023-24'
          })
        },
        {
          teamId: '151',
          teamName: 'UNC',
          statisticalRepresentation: JSON.stringify({
            mu: [0.2], sigma: [0.4], last_season: '2024-25'
          })
        },
        {
          teamId: '152',
          teamName: 'State',
          statisticalRepresentation: null
        }
      ];

      mockTeamRepo.getTeamsBySport.mockResolvedValue(mockTeams);

      const teamsNeedingUpdate = await manager.getTeamsNeedingSeasonTransition(currentDate, sport);

      expect(teamsNeedingUpdate).toHaveLength(1);
      expect(teamsNeedingUpdate[0].teamId).toBe('150');
      expect(teamsNeedingUpdate[0].needsTransition).toBe(true);
      expect(teamsNeedingUpdate[0].lastKnownSeason).toBe('2023-24');
      expect(teamsNeedingUpdate[0].currentSeason).toBe('2024-25');
    });
  });

  describe('manualSeasonTransition', () => {
    it('should manually trigger season transition for a team', async () => {
      const teamId = '150';
      const newSeason = '2024-25';
      const previousSeason = '2023-24';

      const mockDistribution = {
        mu: [0.5, -0.2],
        sigma: [0.3, 0.4],
        last_season: '2023-24'
      };

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: JSON.stringify(mockDistribution)
      });

      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});

      const result = await manager.manualSeasonTransition(teamId, newSeason, previousSeason);

      expect(result.last_season).toBe(newSeason);
      expect(result.season_transition_history).toBeDefined();
      expect(result.season_transition_history[0].from_season).toBe(previousSeason);
      expect(result.season_transition_history[0].to_season).toBe(newSeason);
    });

    it('should throw error for team without statistical representation', async () => {
      const teamId = '999';
      const newSeason = '2024-25';

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId,
        statisticalRepresentation: null
      });

      await expect(manager.manualSeasonTransition(teamId, newSeason))
        .rejects.toThrow('No statistical representation found for team 999');
    });
  });

  describe('getSeasonTransitionStatistics', () => {
    it('should return comprehensive transition statistics', async () => {
      const sport = 'mens-college-basketball';
      
      // Get the actual current season from the manager
      const currentSeason = manager.seasonDetector.getCurrentSeason();

      const mockTeams = [
        {
          teamId: '150',
          statisticalRepresentation: JSON.stringify({
            mu: [0.5], sigma: [0.3], last_season: currentSeason,
            season_transition_history: [{ from_season: '2023-24', to_season: currentSeason }]
          })
        },
        {
          teamId: '151',
          statisticalRepresentation: JSON.stringify({
            mu: [0.2], sigma: [0.4], last_season: '2023-24'
          })
        },
        {
          teamId: '152',
          statisticalRepresentation: null
        }
      ];

      mockTeamRepo.getTeamsBySport.mockResolvedValue(mockTeams);

      const stats = await manager.getSeasonTransitionStatistics(sport);

      expect(stats.totalTeams).toBe(3);
      expect(stats.teamsWithRepresentation).toBe(2);
      expect(stats.teamsInCurrentSeason).toBe(1);
      expect(stats.teamsNeedingTransition).toBe(1);
      expect(stats.totalTransitions).toBe(1);
      expect(stats.seasonDistribution[currentSeason]).toBe(1);
      expect(stats.seasonDistribution['2023-24']).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should allow custom configuration', () => {
      const customManager = new InterYearUncertaintyManager(mockTeamRepo, {
        interYearVariance: 0.5,
        maxUncertainty: 3.0,
        minUncertainty: 0.05
      });

      const config = customManager.getConfiguration();
      expect(config.interYearVariance).toBe(0.5);
      expect(config.maxUncertainty).toBe(3.0);
      expect(config.minUncertainty).toBe(0.05);
    });

    it('should update configuration', () => {
      manager.updateConfiguration({
        interYearVariance: 0.3,
        logAdjustments: false
      });

      const config = manager.getConfiguration();
      expect(config.interYearVariance).toBe(0.3);
      expect(config.logAdjustments).toBe(false);
    });
  });
});