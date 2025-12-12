const IncrementalGameDiscovery = require('../../src/modules/sports/IncrementalGameDiscovery');
const dbConnection = require('../../src/database/connection');

describe('IncrementalGameDiscovery Integration', () => {
  let gameDiscovery;

  beforeAll(async () => {
    // Initialize database for testing
    await dbConnection.initialize();
  });

  beforeEach(() => {
    gameDiscovery = new IncrementalGameDiscovery({
      maxGamesPerRun: 5,
      autoProcessNewGames: false,
      rateLimitDelay: 100, // Fast for testing
      maxProcessingGames: 3
    });
  });

  afterEach(async () => {
    if (gameDiscovery) {
      await gameDiscovery.close();
    }
  });

  test('should initialize with correct parameters', () => {
    expect(gameDiscovery.maxGamesPerRun).toBe(5);
    expect(gameDiscovery.autoProcessNewGames).toBe(false);
    expect(gameDiscovery.rateLimitDelay).toBe(100);
    expect(gameDiscovery.maxProcessingGames).toBe(3);
  });

  test('should get active teams from database', async () => {
    const teams = await gameDiscovery.getActiveTeams();
    
    expect(Array.isArray(teams)).toBe(true);
    // Teams array can be empty in test environment
    expect(teams.length).toBeGreaterThanOrEqual(0);
    
    // Check that teams have required properties if any exist
    if (teams.length > 0) {
      const team = teams[0];
      expect(team).toHaveProperty('team_id');
      expect(team).toHaveProperty('statbroadcast_gid');
      expect(team).toHaveProperty('team_name');
      expect(team.sport).toBe('mens-college-basketball');
    }
  });

  test('should extract date from game ID correctly', () => {
    const testCases = [
      { gameId: 'game_20241201_test', expected: '2024-12-01' },
      { gameId: '20241215_duke_unc', expected: '2024-12-15' },
      { gameId: 'random_game_id', expectedPattern: /^\d{4}-\d{2}-\d{2}$/ }
    ];

    testCases.forEach(({ gameId, expected, expectedPattern }) => {
      const result = gameDiscovery.extractDateFromGameId(gameId);
      
      if (expected) {
        expect(result).toBe(expected);
      } else if (expectedPattern) {
        expect(result).toMatch(expectedPattern);
      }
    });
  });

  test('should get existing game IDs for team', async () => {
    // Test with a mock team ID
    const mockTeamId = 'test-team-id';
    const existingGameIds = await gameDiscovery.getExistingGameIdsForTeam(mockTeamId);
    
    expect(Array.isArray(existingGameIds)).toBe(true);
    // Should be able to handle teams with no games
    expect(existingGameIds.length).toBeGreaterThanOrEqual(0);
  });

  test('should get unprocessed games from database', async () => {
    const unprocessedGames = await gameDiscovery.getUnprocessedGames(5);
    
    expect(Array.isArray(unprocessedGames)).toBe(true);
    expect(unprocessedGames.length).toBeLessThanOrEqual(5);
    
    // Check structure of unprocessed games
    unprocessedGames.forEach(game => {
      expect(game).toHaveProperty('game_id');
      expect(game).toHaveProperty('game_date');
      expect(typeof game.game_id).toBe('string');
      expect(typeof game.game_date).toBe('string');
    });
  });

  test('should track discovery statistics', () => {
    const initialStats = gameDiscovery.getDiscoveryStats();
    
    expect(initialStats).toHaveProperty('totalRuns');
    expect(initialStats).toHaveProperty('successfulRuns');
    expect(initialStats).toHaveProperty('failedRuns');
    expect(initialStats).toHaveProperty('totalNewGames');
    expect(initialStats).toHaveProperty('totalProcessedGames');
    expect(initialStats).toHaveProperty('successRate');
    
    expect(initialStats.totalRuns).toBe(0);
    expect(initialStats.successRate).toBe(0);
    
    // Test reset functionality
    gameDiscovery.resetStats();
    const resetStats = gameDiscovery.getDiscoveryStats();
    expect(resetStats.totalRuns).toBe(0);
    expect(resetStats.totalNewGames).toBe(0);
  });

  test('should check running state correctly', () => {
    expect(gameDiscovery.isDiscoveryRunning()).toBe(false);
    
    // Test stop functionality
    gameDiscovery.stop();
    expect(gameDiscovery.shouldStop).toBe(true);
  });

  test('should handle discovery run results format', () => {
    const startTime = Date.now();
    const mockResults = {
      newGames: 10,
      processedGames: 5,
      teamsUpdated: 3,
      teamResults: [],
      errors: []
    };
    
    const results = gameDiscovery.getRunResults(startTime, mockResults);
    
    expect(results).toHaveProperty('runId');
    expect(results).toHaveProperty('startTime');
    expect(results).toHaveProperty('endTime');
    expect(results).toHaveProperty('runTime');
    expect(results).toHaveProperty('results');
    expect(results).toHaveProperty('statistics');
    
    expect(results.results.newGames).toBe(10);
    expect(results.results.processedGames).toBe(5);
    expect(results.results.teamsUpdated).toBe(3);
    expect(typeof results.runTime).toBe('number');
  });

  test('should update discovery statistics correctly', () => {
    const discoveryResult = { newGames: 5, teamsUpdated: 2 };
    const processingResult = { processedGames: 3 };
    const runTime = 1000;
    
    gameDiscovery.updateDiscoveryStats(discoveryResult, processingResult, runTime, true);
    
    const stats = gameDiscovery.getDiscoveryStats();
    expect(stats.totalRuns).toBe(1);
    expect(stats.successfulRuns).toBe(1);
    expect(stats.failedRuns).toBe(0);
    expect(stats.totalNewGames).toBe(5);
    expect(stats.totalProcessedGames).toBe(3);
    expect(stats.averageDiscoveryTime).toBe(1000);
    expect(stats.successRate).toBe(100);
  });

  test('should handle error scenarios gracefully', () => {
    // Test with null/undefined inputs
    expect(() => {
      gameDiscovery.extractDateFromGameId(null);
    }).not.toThrow();
    
    expect(() => {
      gameDiscovery.extractDateFromGameId(undefined);
    }).not.toThrow();
    
    // Test with invalid date patterns
    const result = gameDiscovery.extractDateFromGameId('invalid_game_id');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Should return current date format
  });
});