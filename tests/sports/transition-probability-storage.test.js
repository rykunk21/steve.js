const HistoricalGameRepository = require('../../src/database/repositories/HistoricalGameRepository');
const TransitionProbabilityComputer = require('../../src/modules/sports/TransitionProbabilityComputer');
const { getDatabase } = require('../../src/database/connection');

describe('Transition Probability Storage', () => {
  let repository;
  let computer;
  let db;

  beforeAll(async () => {
    db = await getDatabase();
    repository = new HistoricalGameRepository();
    computer = new TransitionProbabilityComputer();
  });

  afterEach(async () => {
    // Clean up test data
    await db.run('DELETE FROM historical_games WHERE id LIKE ?', ['test-%']);
  });

  describe('updateTransitionProbabilities', () => {
    test('should store transition probabilities as JSON', async () => {
      // Create a test game
      const gameId = 'test-game-1';
      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play, statbroadcast_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [gameId, 'mens-college-basketball', 2025, '2025-11-18', 'KEN', 'MSU', 66, 83, 1, '623619']);

      // Create transition probabilities
      const probabilities = {
        visitor: {
          twoPointMakeProb: 0.25,
          twoPointMissProb: 0.15,
          threePointMakeProb: 0.125,
          threePointMissProb: 0.175,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.075,
          turnoverProb: 0.075
        },
        home: {
          twoPointMakeProb: 0.2,
          twoPointMissProb: 0.2,
          threePointMakeProb: 0.1,
          threePointMissProb: 0.2,
          freeThrowMakeProb: 0.08,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.1,
          turnoverProb: 0.1
        }
      };

      // Store probabilities
      await repository.updateTransitionProbabilities(gameId, probabilities);

      // Retrieve and verify
      const game = await repository.getGameById(gameId);
      expect(game).toBeDefined();
      expect(game.transitionProbabilities).toBeDefined();
      expect(game.transitionProbabilities.visitor.twoPointMakeProb).toBeCloseTo(0.25, 4);
      expect(game.transitionProbabilities.home.threePointMakeProb).toBeCloseTo(0.1, 4);
    });

    test('should handle updating existing probabilities', async () => {
      const gameId = 'test-game-2';
      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play, statbroadcast_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [gameId, 'mens-college-basketball', 2025, '2025-11-18', 'KEN', 'MSU', 66, 83, 1, '623619']);

      const probabilities1 = {
        visitor: {
          twoPointMakeProb: 0.25,
          twoPointMissProb: 0.15,
          threePointMakeProb: 0.125,
          threePointMissProb: 0.175,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.075,
          turnoverProb: 0.075
        },
        home: {
          twoPointMakeProb: 0.2,
          twoPointMissProb: 0.2,
          threePointMakeProb: 0.1,
          threePointMissProb: 0.2,
          freeThrowMakeProb: 0.08,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.1,
          turnoverProb: 0.1
        }
      };

      await repository.updateTransitionProbabilities(gameId, probabilities1);

      // Update with new probabilities
      const probabilities2 = {
        visitor: {
          twoPointMakeProb: 0.3,
          twoPointMissProb: 0.1,
          threePointMakeProb: 0.15,
          threePointMissProb: 0.15,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.05,
          turnoverProb: 0.05
        },
        home: {
          twoPointMakeProb: 0.25,
          twoPointMissProb: 0.15,
          threePointMakeProb: 0.15,
          threePointMissProb: 0.15,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.075,
          turnoverProb: 0.075
        }
      };

      await repository.updateTransitionProbabilities(gameId, probabilities2);

      // Verify updated values
      const game = await repository.getGameById(gameId);
      expect(game.transitionProbabilities.visitor.twoPointMakeProb).toBeCloseTo(0.3, 4);
      expect(game.transitionProbabilities.home.twoPointMakeProb).toBeCloseTo(0.25, 4);
    });
  });

  describe('getGamesNeedingTransitionProbabilities', () => {
    test('should return games with play-by-play but no probabilities', async () => {
      // Create games with play-by-play
      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play, statbroadcast_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, ['test-game-3', 'mens-college-basketball', 2025, '2025-11-18', 'KEN', 'MSU', 66, 83, 1, '623619']);

      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play, statbroadcast_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, ['test-game-4', 'mens-college-basketball', 2025, '2025-11-19', 'DUKE', 'UNC', 75, 80, 1, '623620']);

      const games = await repository.getGamesNeedingTransitionProbabilities(10);

      expect(games.length).toBeGreaterThanOrEqual(2);
      const testGames = games.filter(g => g.id.startsWith('test-'));
      expect(testGames.length).toBe(2);
      expect(testGames.every(g => g.hasPlayByPlay)).toBe(true);
      expect(testGames.every(g => g.statbroadcastGameId)).toBeTruthy();
    });

    test('should not return games without play-by-play', async () => {
      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, ['test-game-5', 'mens-college-basketball', 2025, '2025-11-18', 'KEN', 'MSU', 66, 83, 0]);

      const games = await repository.getGamesNeedingTransitionProbabilities(10);
      const testGame = games.find(g => g.id === 'test-game-5');
      
      expect(testGame).toBeUndefined();
    });

    test('should not return games that already have probabilities', async () => {
      const gameId = 'test-game-6';
      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play, statbroadcast_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [gameId, 'mens-college-basketball', 2025, '2025-11-18', 'KEN', 'MSU', 66, 83, 1, '623619']);

      const probabilities = {
        visitor: {
          twoPointMakeProb: 0.25,
          twoPointMissProb: 0.15,
          threePointMakeProb: 0.125,
          threePointMissProb: 0.175,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.075,
          turnoverProb: 0.075
        },
        home: {
          twoPointMakeProb: 0.2,
          twoPointMissProb: 0.2,
          threePointMakeProb: 0.1,
          threePointMissProb: 0.2,
          freeThrowMakeProb: 0.08,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.1,
          turnoverProb: 0.1
        }
      };

      await repository.updateTransitionProbabilities(gameId, probabilities);

      const games = await repository.getGamesNeedingTransitionProbabilities(10);
      const testGame = games.find(g => g.id === gameId);
      
      expect(testGame).toBeUndefined();
    });
  });

  describe('getGamesWithTransitionProbabilities', () => {
    test('should return games with transition probabilities', async () => {
      const gameId = 'test-game-7';
      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play, statbroadcast_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [gameId, 'mens-college-basketball', 2025, '2025-11-18', 'KEN', 'MSU', 66, 83, 1, '623619']);

      const probabilities = {
        visitor: {
          twoPointMakeProb: 0.25,
          twoPointMissProb: 0.15,
          threePointMakeProb: 0.125,
          threePointMissProb: 0.175,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.075,
          turnoverProb: 0.075
        },
        home: {
          twoPointMakeProb: 0.2,
          twoPointMissProb: 0.2,
          threePointMakeProb: 0.1,
          threePointMissProb: 0.2,
          freeThrowMakeProb: 0.08,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.1,
          turnoverProb: 0.1
        }
      };

      await repository.updateTransitionProbabilities(gameId, probabilities);

      const games = await repository.getGamesWithTransitionProbabilities(10);
      const testGame = games.find(g => g.id === gameId);
      
      expect(testGame).toBeDefined();
      expect(testGame.transitionProbabilities).toBeDefined();
      expect(testGame.transitionProbabilities.visitor.twoPointMakeProb).toBeCloseTo(0.25, 4);
    });

    test('should parse JSON probabilities correctly', async () => {
      const gameId = 'test-game-8';
      await db.run(`
        INSERT INTO historical_games (
          id, sport, season, game_date,
          home_team_id, away_team_id, home_score, away_score,
          has_play_by_play, statbroadcast_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [gameId, 'mens-college-basketball', 2025, '2025-11-18', 'KEN', 'MSU', 66, 83, 1, '623619']);

      const probabilities = {
        visitor: {
          twoPointMakeProb: 0.25,
          twoPointMissProb: 0.15,
          threePointMakeProb: 0.125,
          threePointMissProb: 0.175,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.075,
          turnoverProb: 0.075
        },
        home: {
          twoPointMakeProb: 0.2,
          twoPointMissProb: 0.2,
          threePointMakeProb: 0.1,
          threePointMissProb: 0.2,
          freeThrowMakeProb: 0.08,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.1,
          turnoverProb: 0.1
        }
      };

      await repository.updateTransitionProbabilities(gameId, probabilities);

      const game = await repository.getGameById(gameId);
      
      expect(typeof game.transitionProbabilities).toBe('object');
      expect(typeof game.transitionProbabilities.visitor).toBe('object');
      expect(typeof game.transitionProbabilities.home).toBe('object');
    });
  });
});
