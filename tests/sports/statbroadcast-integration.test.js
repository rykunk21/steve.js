const TransitionMatrixBuilder = require('../../src/modules/sports/TransitionMatrixBuilder');
const BayesianTeamStrengthTracker = require('../../src/modules/sports/BayesianTeamStrengthTracker');
const XMLGameParser = require('../../src/modules/sports/XMLGameParser');
const dbConnection = require('../../src/database/connection');
const fs = require('fs').promises;
const path = require('path');

/**
 * Integration tests for StatBroadcast data integration into MCMC pipeline
 * Tests Requirements 18.9, 18.10
 */
describe('StatBroadcast Integration Tests', () => {
  let parser;
  let matrixBuilder;
  let strengthTracker;
  let sampleXML;

  beforeAll(async () => {
    // Initialize database
    await dbConnection.initialize();

    // Load sample XML fixture
    const fixturePath = path.join(__dirname, '../fixtures/statbroadcast-game-sample.xml');
    sampleXML = await fs.readFile(fixturePath, 'utf-8');

    // Initialize parser
    parser = new XMLGameParser();
  });

  beforeEach(async () => {
    // Clean up test data
    await dbConnection.run('DELETE FROM team_strength_history');

    matrixBuilder = new TransitionMatrixBuilder();
    strengthTracker = new BayesianTeamStrengthTracker(dbConnection);
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('TransitionMatrixBuilder.buildFromStatBroadcastXML', () => {
    it('should build transition matrix from StatBroadcast XML data', async () => {
      // Parse XML first
      const gameData = await parser.parseGameXML(sampleXML);

      // Build matrix from XML data
      const matrix = matrixBuilder.buildFromStatBroadcastXML(gameData, 'ncaa_basketball');

      // Verify matrix structure
      expect(matrix).toBeDefined();
      expect(matrix.home).toBeDefined();
      expect(matrix.away).toBeDefined();
      expect(matrix.possessions).toBeDefined();
      expect(matrix.sport).toBe('ncaa_basketball');
      expect(matrix.dataSource).toBe('statbroadcast');
    });

    it('should use exact possession count from XML instead of estimation', async () => {
      const gameData = await parser.parseGameXML(sampleXML);

      const matrix = matrixBuilder.buildFromStatBroadcastXML(gameData, 'ncaa_basketball');

      // Verify possession count comes from XML
      const homeAdvancedMetrics = gameData.teams.home.advancedMetrics;
      const visitorAdvancedMetrics = gameData.teams.visitor.advancedMetrics;

      // Should use actual possession count, not estimated
      expect(matrix.possessions).toBeGreaterThan(0);
      
      // If XML has possession count, it should be used
      if (homeAdvancedMetrics.possessionCount > 0) {
        expect(matrix.possessions).toBe(homeAdvancedMetrics.possessionCount);
      }
    });

    it('should extract shot distribution from team statistics', async () => {
      const gameData = await parser.parseGameXML(sampleXML);

      const matrix = matrixBuilder.buildFromStatBroadcastXML(gameData, 'ncaa_basketball');

      // Verify shot distribution is extracted
      expect(matrix.home.twoPointProb).toBeDefined();
      expect(matrix.home.threePointProb).toBeDefined();
      expect(matrix.home.freeThrowProb).toBeDefined();
      
      expect(matrix.away.twoPointProb).toBeDefined();
      expect(matrix.away.threePointProb).toBeDefined();
      expect(matrix.away.freeThrowProb).toBeDefined();

      // Each probability should be valid (between 0 and 1)
      expect(matrix.home.twoPointProb).toBeGreaterThanOrEqual(0);
      expect(matrix.home.twoPointProb).toBeLessThanOrEqual(1.0);
      expect(matrix.home.threePointProb).toBeGreaterThanOrEqual(0);
      expect(matrix.home.threePointProb).toBeLessThanOrEqual(1.0);
      expect(matrix.home.freeThrowProb).toBeGreaterThanOrEqual(0);
      expect(matrix.home.freeThrowProb).toBeLessThanOrEqual(1.0);
    });

    it('should calculate turnover and rebound probabilities from XML stats', async () => {
      const gameData = await parser.parseGameXML(sampleXML);

      const matrix = matrixBuilder.buildFromStatBroadcastXML(gameData, 'ncaa_basketball');

      // Verify turnover and rebound rates
      expect(matrix.home.turnoverProb).toBeDefined();
      expect(matrix.home.reboundProb).toBeDefined();
      expect(matrix.away.turnoverProb).toBeDefined();
      expect(matrix.away.reboundProb).toBeDefined();

      // Should be valid probabilities
      expect(matrix.home.turnoverProb).toBeGreaterThanOrEqual(0);
      expect(matrix.home.turnoverProb).toBeLessThanOrEqual(1);
      expect(matrix.home.reboundProb).toBeGreaterThanOrEqual(0);
      expect(matrix.home.reboundProb).toBeLessThanOrEqual(1);
    });

    it('should prefer StatBroadcast data over aggregate stats when available', async () => {
      const gameData = await parser.parseGameXML(sampleXML);

      // Build matrix with StatBroadcast data
      const matrixFromXML = matrixBuilder.buildFromStatBroadcastXML(gameData, 'ncaa_basketball');

      // Build matrix with aggregate stats (old method)
      const aggregateStats = {
        offensiveEfficiency: 105,
        defensiveEfficiency: 95,
        pace: 70,
        effectiveFieldGoalPct: 0.52,
        turnoverRate: 0.15,
        offensiveReboundRate: 0.30,
        freeThrowRate: 0.25,
        recentForm: [1, 1, 0, 1, 1]
      };

      const matrixFromAggregate = matrixBuilder.buildMatrix(
        aggregateStats,
        aggregateStats,
        'ncaa_basketball',
        false
      );

      // StatBroadcast matrix should have more accurate data
      expect(matrixFromXML.dataSource).toBe('statbroadcast');
      expect(matrixFromAggregate.dataSource).toBeUndefined();

      // Possession counts should differ (XML is exact, aggregate is estimated)
      expect(matrixFromXML.possessions).not.toBe(matrixFromAggregate.possessions);
    });
  });

  describe('BayesianTeamStrengthTracker with StatBroadcast data', () => {
    it('should update team strength using StatBroadcast game data', async () => {
      const gameData = await parser.parseGameXML(sampleXML);

      // Initialize team priors
      const homeTeamId = gameData.metadata.homeId || 'test_home';
      const visitorTeamId = gameData.metadata.visitorId || 'test_visitor';

      await strengthTracker.initializeTeamPrior(homeTeamId, 'ncaa_basketball', 2024);
      await strengthTracker.initializeTeamPrior(visitorTeamId, 'ncaa_basketball', 2024);

      // Get opponent strength
      const visitorStrength = await strengthTracker.getCurrentStrength(visitorTeamId, 'ncaa_basketball', 2024);

      // Update home team with game result
      const gameResult = {
        teamScore: gameData.teams.home.score,
        opponentScore: gameData.teams.visitor.score,
        isHome: true,
        opponentStrength: visitorStrength
      };

      const updatedStrength = await strengthTracker.updatePosterior(
        homeTeamId,
        'ncaa_basketball',
        2024,
        gameResult
      );

      // Verify update occurred
      expect(updatedStrength.gamesPlayed).toBe(1);
      expect(updatedStrength.offensiveRatingMean).toBeDefined();
      expect(updatedStrength.defensiveRatingMean).toBeDefined();
      expect(updatedStrength.confidenceLevel).toBeGreaterThan(0);
    });

    it('should reduce uncertainty after processing StatBroadcast game', async () => {
      const gameData = await parser.parseGameXML(sampleXML);

      const teamId = gameData.metadata.homeId || 'test_team';

      // Initialize prior
      const prior = await strengthTracker.initializeTeamPrior(teamId, 'ncaa_basketball', 2024);
      const priorStd = prior.offensiveRatingStd;

      // Get opponent strength
      const opponentId = gameData.metadata.visitorId || 'test_opponent';
      await strengthTracker.initializeTeamPrior(opponentId, 'ncaa_basketball', 2024);
      const opponentStrength = await strengthTracker.getCurrentStrength(opponentId, 'ncaa_basketball', 2024);

      // Update with game result
      const gameResult = {
        teamScore: gameData.teams.home.score,
        opponentScore: gameData.teams.visitor.score,
        isHome: true,
        opponentStrength: opponentStrength
      };

      const posterior = await strengthTracker.updatePosterior(
        teamId,
        'ncaa_basketball',
        2024,
        gameResult
      );

      // Posterior should have lower uncertainty
      expect(posterior.offensiveRatingStd).toBeLessThan(priorStd);
      expect(posterior.confidenceLevel).toBeGreaterThan(prior.confidenceLevel);
    });
  });

  describe('Integration: Full pipeline with StatBroadcast data', () => {
    it('should build matrix and update strength using StatBroadcast data', async () => {
      const gameData = await parser.parseGameXML(sampleXML);

      const homeTeamId = gameData.metadata.homeId || 'test_home';
      const visitorTeamId = gameData.metadata.visitorId || 'test_visitor';

      // Initialize teams
      await strengthTracker.initializeTeamPrior(homeTeamId, 'ncaa_basketball', 2024);
      await strengthTracker.initializeTeamPrior(visitorTeamId, 'ncaa_basketball', 2024);

      // Build transition matrix from XML
      const matrix = matrixBuilder.buildFromStatBroadcastXML(gameData, 'ncaa_basketball');

      // Verify matrix uses StatBroadcast data
      expect(matrix.dataSource).toBe('statbroadcast');
      expect(matrix.possessions).toBeGreaterThan(0);

      // Update team strengths
      const visitorStrength = await strengthTracker.getCurrentStrength(visitorTeamId, 'ncaa_basketball', 2024);
      const homeStrength = await strengthTracker.getCurrentStrength(homeTeamId, 'ncaa_basketball', 2024);

      const homeResult = {
        teamScore: gameData.teams.home.score,
        opponentScore: gameData.teams.visitor.score,
        isHome: true,
        opponentStrength: visitorStrength
      };

      const visitorResult = {
        teamScore: gameData.teams.visitor.score,
        opponentScore: gameData.teams.home.score,
        isHome: false,
        opponentStrength: homeStrength
      };

      const updatedHome = await strengthTracker.updatePosterior(homeTeamId, 'ncaa_basketball', 2024, homeResult);
      const updatedVisitor = await strengthTracker.updatePosterior(visitorTeamId, 'ncaa_basketball', 2024, visitorResult);

      // Both teams should be updated
      expect(updatedHome.gamesPlayed).toBe(1);
      expect(updatedVisitor.gamesPlayed).toBe(1);
    });
  });
});
