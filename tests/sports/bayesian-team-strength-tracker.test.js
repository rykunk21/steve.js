const BayesianTeamStrengthTracker = require('../../src/modules/sports/BayesianTeamStrengthTracker');
const dbConnection = require('../../src/database/connection');

describe('BayesianTeamStrengthTracker', () => {
  let tracker;

  beforeAll(async () => {
    await dbConnection.initialize();
  });

  beforeEach(async () => {
    tracker = new BayesianTeamStrengthTracker(dbConnection);
    
    // Clean up test data
    await dbConnection.run('DELETE FROM team_strength_history');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('initializeTeamPrior', () => {
    it('should establish prior distributions for a new team', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      const prior = await tracker.initializeTeamPrior(teamId, sport, season);

      expect(prior).toBeDefined();
      expect(prior.offensiveRatingMean).toBeGreaterThan(0);
      expect(prior.offensiveRatingStd).toBeGreaterThan(0);
      expect(prior.defensiveRatingMean).toBeGreaterThan(0);
      expect(prior.defensiveRatingStd).toBeGreaterThan(0);
      expect(prior.gamesPlayed).toBe(0);
    });

    it('should use historical data when available', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Insert historical data from previous season
      await dbConnection.run(`
        INSERT INTO team_strength_history (
          team_id, sport, season, as_of_date,
          offensive_rating_mean, offensive_rating_std,
          defensive_rating_mean, defensive_rating_std,
          games_played, confidence_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [teamId, sport, 2024, '2024-03-31', 110.0, 5.0, 95.0, 5.0, 30, 0.95]);

      const prior = await tracker.initializeTeamPrior(teamId, sport, season);

      // Should regress toward mean but use historical data
      expect(prior.offensiveRatingMean).toBeCloseTo(105, 0); // Regressed from 110
      expect(prior.defensiveRatingMean).toBeCloseTo(97.5, 0); // Regressed from 95
      expect(prior.offensiveRatingStd).toBeGreaterThan(5.0); // Increased uncertainty
    });
  });

  describe('updatePosterior', () => {
    it('should update team strength after observing a game result', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Initialize prior
      await tracker.initializeTeamPrior(teamId, sport, season);

      // Observe a game result
      const gameResult = {
        teamScore: 85,
        opponentScore: 78,
        opponentStrength: {
          offensiveRatingMean: 100,
          defensiveRatingMean: 100
        },
        isHome: true
      };

      const posterior = await tracker.updatePosterior(teamId, sport, season, gameResult);

      expect(posterior).toBeDefined();
      expect(posterior.gamesPlayed).toBe(1);
      expect(posterior.offensiveRatingMean).toBeGreaterThan(100); // Won, so should increase
      expect(posterior.offensiveRatingStd).toBeLessThan(15); // Uncertainty should decrease
    });

    it('should accumulate evidence over multiple games', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      await tracker.initializeTeamPrior(teamId, sport, season);

      // Observe multiple games
      const games = [
        { teamScore: 85, opponentScore: 78, opponentStrength: { offensiveRatingMean: 100, defensiveRatingMean: 100 }, isHome: true },
        { teamScore: 92, opponentScore: 88, opponentStrength: { offensiveRatingMean: 105, defensiveRatingMean: 95 }, isHome: false },
        { teamScore: 78, opponentScore: 82, opponentStrength: { offensiveRatingMean: 110, defensiveRatingMean: 90 }, isHome: true }
      ];

      let posterior;
      for (const game of games) {
        posterior = await tracker.updatePosterior(teamId, sport, season, game);
      }

      expect(posterior.gamesPlayed).toBe(3);
      expect(posterior.confidenceLevel).toBeGreaterThan(0.5);
      expect(posterior.offensiveRatingStd).toBeLessThan(10); // Narrower confidence interval
    });
  });

  describe('getCurrentStrength', () => {
    it('should retrieve current posterior distribution for a team', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      await tracker.initializeTeamPrior(teamId, sport, season);

      const strength = await tracker.getCurrentStrength(teamId, sport, season);

      expect(strength).toBeDefined();
      expect(strength.offensiveRatingMean).toBeDefined();
      expect(strength.defensiveRatingMean).toBeDefined();
      expect(strength.gamesPlayed).toBe(0);
    });

    it('should return null for teams with no data', async () => {
      const strength = await tracker.getCurrentStrength('999', 'ncaa_basketball', 2025);

      expect(strength).toBeNull();
    });
  });

  describe('getConfidenceInterval', () => {
    it('should calculate confidence intervals for team strength', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      await tracker.initializeTeamPrior(teamId, sport, season);

      const ci = await tracker.getConfidenceInterval(teamId, sport, season, 0.95);

      expect(ci).toBeDefined();
      expect(ci.offensive).toBeDefined();
      expect(ci.offensive.lower).toBeLessThan(ci.offensive.mean);
      expect(ci.offensive.upper).toBeGreaterThan(ci.offensive.mean);
      expect(ci.defensive).toBeDefined();
      expect(ci.defensive.lower).toBeLessThan(ci.defensive.mean);
      expect(ci.defensive.upper).toBeGreaterThan(ci.defensive.mean);
    });
  });

  describe('regressTowardMean', () => {
    it('should apply regression for new season', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';

      // Set up previous season data
      await dbConnection.run(`
        INSERT INTO team_strength_history (
          team_id, sport, season, as_of_date,
          offensive_rating_mean, offensive_rating_std,
          defensive_rating_mean, defensive_rating_std,
          games_played, confidence_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [teamId, sport, 2024, '2024-03-31', 115.0, 3.0, 90.0, 3.0, 35, 0.98]);

      const regressed = await tracker.regressTowardMean(teamId, sport, 2024, 2025);

      expect(regressed).toBeDefined();
      expect(regressed.offensiveRatingMean).toBeLessThan(115.0); // Regressed toward 100
      expect(regressed.offensiveRatingMean).toBeGreaterThan(100.0);
      expect(regressed.offensiveRatingStd).toBeGreaterThan(3.0); // Increased uncertainty
    });
  });
});
