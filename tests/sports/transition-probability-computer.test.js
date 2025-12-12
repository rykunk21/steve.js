const TransitionProbabilityComputer = require('../../src/modules/sports/TransitionProbabilityComputer');

describe('TransitionProbabilityComputer', () => {
  let computer;

  beforeEach(() => {
    computer = new TransitionProbabilityComputer();
  });

  describe('countPossessionOutcomes', () => {
    test('should count 2-point makes from play-by-play', () => {
      const playByPlay = [
        { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: 'JUMPER', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: 'DUNK', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.twoPointMakes).toBe(2);
    });

    test('should count 2-point misses from play-by-play', () => {
      const playByPlay = [
        { action: 'MISS', type: 'LAYUP', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: 'JUMPER', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: 'DUNK', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.twoPointMisses).toBe(2);
    });

    test('should count 3-point makes from play-by-play', () => {
      const playByPlay = [
        { action: 'GOOD', type: '3PTR', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: '3PTR', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: '3PTR', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.threePointMakes).toBe(2);
    });

    test('should count 3-point misses from play-by-play', () => {
      const playByPlay = [
        { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: '3PTR', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.threePointMisses).toBe(2);
    });

    test('should count free throw makes from play-by-play', () => {
      const playByPlay = [
        { action: 'GOOD', type: 'FT', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: 'FT', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: 'FT', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.freeThrowMakes).toBe(2);
    });

    test('should count free throw misses from play-by-play', () => {
      const playByPlay = [
        { action: 'MISS', type: 'FT', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: 'FT', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: 'FT', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.freeThrowMisses).toBe(2);
    });

    test('should count offensive rebounds from play-by-play', () => {
      const playByPlay = [
        { action: 'REBOUND', type: 'OFF', team: 'MSU', vh: 'V' },
        { action: 'REBOUND', type: 'OFF', team: 'MSU', vh: 'V' },
        { action: 'REBOUND', type: 'OFF', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.offensiveRebounds).toBe(2);
    });

    test('should count defensive rebounds from play-by-play', () => {
      const playByPlay = [
        { action: 'REBOUND', type: 'DEF', team: 'MSU', vh: 'V' },
        { action: 'REBOUND', type: 'DEF', team: 'MSU', vh: 'V' },
        { action: 'REBOUND', type: 'DEF', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.defensiveRebounds).toBe(2);
    });

    test('should count turnovers from play-by-play', () => {
      const playByPlay = [
        { action: 'TURNOVER', type: 'BADPASS', team: 'MSU', vh: 'V' },
        { action: 'TURNOVER', type: 'TRAVEL', team: 'MSU', vh: 'V' },
        { action: 'TURNOVER', type: 'LOSTBALL', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.turnovers).toBe(2);
    });

    test('should only count plays for specified team', () => {
      const playByPlay = [
        { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: 'LAYUP', team: 'KEN', vh: 'H' },
        { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: '3PTR', team: 'KEN', vh: 'H' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.twoPointMakes).toBe(1);
      expect(result.threePointMisses).toBe(1);
    });

    test('should handle empty play-by-play array', () => {
      const playByPlay = [];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.twoPointMakes).toBe(0);
      expect(result.twoPointMisses).toBe(0);
      expect(result.threePointMakes).toBe(0);
      expect(result.threePointMisses).toBe(0);
      expect(result.freeThrowMakes).toBe(0);
      expect(result.freeThrowMisses).toBe(0);
      expect(result.offensiveRebounds).toBe(0);
      expect(result.defensiveRebounds).toBe(0);
      expect(result.turnovers).toBe(0);
    });

    test('should handle mixed possession outcomes', () => {
      const playByPlay = [
        { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V' },
        { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V' },
        { action: 'REBOUND', type: 'OFF', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: 'JUMPER', team: 'MSU', vh: 'V' },
        { action: 'TURNOVER', type: 'BADPASS', team: 'MSU', vh: 'V' },
        { action: 'GOOD', type: 'FT', team: 'MSU', vh: 'V' }
      ];

      const result = computer.countPossessionOutcomes(playByPlay, 'MSU', 'V');

      expect(result.twoPointMakes).toBe(2);
      expect(result.threePointMisses).toBe(1);
      expect(result.offensiveRebounds).toBe(1);
      expect(result.turnovers).toBe(1);
      expect(result.freeThrowMakes).toBe(1);
    });
  });

  describe('calculateTransitionProbabilities', () => {
    test('should calculate empirical probabilities from counts', () => {
      const counts = {
        twoPointMakes: 20,
        twoPointMisses: 10,
        threePointMakes: 10,
        threePointMisses: 15,
        freeThrowMakes: 8,
        freeThrowMisses: 2,
        offensiveRebounds: 5,
        defensiveRebounds: 0,
        turnovers: 10
      };

      const result = computer.calculateTransitionProbabilities(counts);

      // Total possessions = 20 + 10 + 10 + 15 + 8 + 2 + 5 + 10 = 80
      expect(result.twoPointMakeProb).toBeCloseTo(20 / 80, 4);
      expect(result.twoPointMissProb).toBeCloseTo(10 / 80, 4);
      expect(result.threePointMakeProb).toBeCloseTo(10 / 80, 4);
      expect(result.threePointMissProb).toBeCloseTo(15 / 80, 4);
      expect(result.freeThrowMakeProb).toBeCloseTo(8 / 80, 4);
      expect(result.freeThrowMissProb).toBeCloseTo(2 / 80, 4);
      expect(result.offensiveReboundProb).toBeCloseTo(5 / 80, 4);
      expect(result.turnoverProb).toBeCloseTo(10 / 80, 4);
    });

    test('should normalize probabilities to sum to 1.0', () => {
      const counts = {
        twoPointMakes: 20,
        twoPointMisses: 10,
        threePointMakes: 10,
        threePointMisses: 15,
        freeThrowMakes: 8,
        freeThrowMisses: 2,
        offensiveRebounds: 5,
        defensiveRebounds: 0,
        turnovers: 10
      };

      const result = computer.calculateTransitionProbabilities(counts);

      const sum = result.twoPointMakeProb + result.twoPointMissProb +
                  result.threePointMakeProb + result.threePointMissProb +
                  result.freeThrowMakeProb + result.freeThrowMissProb +
                  result.offensiveReboundProb + result.turnoverProb;

      expect(sum).toBeCloseTo(1.0, 6);
    });

    test('should handle edge case with few possessions', () => {
      const counts = {
        twoPointMakes: 2,
        twoPointMisses: 1,
        threePointMakes: 1,
        threePointMisses: 1,
        freeThrowMakes: 0,
        freeThrowMisses: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        turnovers: 0
      };

      const result = computer.calculateTransitionProbabilities(counts);

      // Total = 5 possessions
      expect(result.twoPointMakeProb).toBeCloseTo(2 / 5, 4);
      expect(result.twoPointMissProb).toBeCloseTo(1 / 5, 4);
      expect(result.threePointMakeProb).toBeCloseTo(1 / 5, 4);
      expect(result.threePointMissProb).toBeCloseTo(1 / 5, 4);
      expect(result.freeThrowMakeProb).toBe(0);
      expect(result.freeThrowMissProb).toBe(0);
      expect(result.offensiveReboundProb).toBe(0);
      expect(result.turnoverProb).toBe(0);
    });

    test('should handle zero possessions gracefully', () => {
      const counts = {
        twoPointMakes: 0,
        twoPointMisses: 0,
        threePointMakes: 0,
        threePointMisses: 0,
        freeThrowMakes: 0,
        freeThrowMisses: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        turnovers: 0
      };

      const result = computer.calculateTransitionProbabilities(counts);

      // Should return uniform distribution or zeros
      expect(result.twoPointMakeProb).toBe(0);
      expect(result.twoPointMissProb).toBe(0);
      expect(result.threePointMakeProb).toBe(0);
      expect(result.threePointMissProb).toBe(0);
      expect(result.freeThrowMakeProb).toBe(0);
      expect(result.freeThrowMissProb).toBe(0);
      expect(result.offensiveReboundProb).toBe(0);
      expect(result.turnoverProb).toBe(0);
    });

    test('should calculate offensive rebound rate correctly', () => {
      const counts = {
        twoPointMakes: 10,
        twoPointMisses: 20,
        threePointMakes: 5,
        threePointMisses: 15,
        freeThrowMakes: 5,
        freeThrowMisses: 5,
        offensiveRebounds: 10,
        defensiveRebounds: 0,
        turnovers: 5
      };

      const result = computer.calculateTransitionProbabilities(counts);

      // Total = 75
      expect(result.offensiveReboundProb).toBeCloseTo(10 / 75, 4);
    });
  });

  describe('computeTransitionProbabilities', () => {
    test('should compute probabilities from complete game data', () => {
      const gameData = {
        playByPlay: [
          { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V' },
          { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V' },
          { action: 'REBOUND', type: 'OFF', team: 'MSU', vh: 'V' },
          { action: 'GOOD', type: 'JUMPER', team: 'MSU', vh: 'V' },
          { action: 'TURNOVER', type: 'BADPASS', team: 'MSU', vh: 'V' },
          { action: 'GOOD', type: 'FT', team: 'MSU', vh: 'V' },
          { action: 'GOOD', type: '3PTR', team: 'MSU', vh: 'V' },
          { action: 'MISS', type: 'LAYUP', team: 'MSU', vh: 'V' }
        ],
        teams: {
          visitor: { id: 'MSU', name: 'Michigan St.' },
          home: { id: 'KEN', name: 'Kentucky' }
        }
      };

      const result = computer.computeTransitionProbabilities(gameData);

      expect(result).toBeDefined();
      expect(result.visitor).toBeDefined();
      expect(result.home).toBeDefined();
      expect(result.visitor.twoPointMakeProb).toBeGreaterThan(0);
      expect(result.visitor.threePointMakeProb).toBeGreaterThan(0);
      expect(result.visitor.offensiveReboundProb).toBeGreaterThan(0);
      expect(result.visitor.turnoverProb).toBeGreaterThan(0);
    });

    test('should compute probabilities for both teams', () => {
      const gameData = {
        playByPlay: [
          { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V' },
          { action: 'GOOD', type: 'LAYUP', team: 'KEN', vh: 'H' },
          { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V' },
          { action: 'MISS', type: '3PTR', team: 'KEN', vh: 'H' }
        ],
        teams: {
          visitor: { id: 'MSU', name: 'Michigan St.' },
          home: { id: 'KEN', name: 'Kentucky' }
        }
      };

      const result = computer.computeTransitionProbabilities(gameData);

      expect(result.visitor).toBeDefined();
      expect(result.home).toBeDefined();
      expect(result.visitor.twoPointMakeProb).toBeGreaterThan(0);
      expect(result.home.twoPointMakeProb).toBeGreaterThan(0);
    });

    test('should validate probabilities sum to 1.0 for each team', () => {
      const gameData = {
        playByPlay: [
          { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V' },
          { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V' },
          { action: 'TURNOVER', type: 'BADPASS', team: 'MSU', vh: 'V' },
          { action: 'GOOD', type: 'LAYUP', team: 'KEN', vh: 'H' },
          { action: 'MISS', type: 'JUMPER', team: 'KEN', vh: 'H' }
        ],
        teams: {
          visitor: { id: 'MSU', name: 'Michigan St.' },
          home: { id: 'KEN', name: 'Kentucky' }
        }
      };

      const result = computer.computeTransitionProbabilities(gameData);

      const visitorSum = result.visitor.twoPointMakeProb + result.visitor.twoPointMissProb +
                         result.visitor.threePointMakeProb + result.visitor.threePointMissProb +
                         result.visitor.freeThrowMakeProb + result.visitor.freeThrowMissProb +
                         result.visitor.offensiveReboundProb + result.visitor.turnoverProb;

      const homeSum = result.home.twoPointMakeProb + result.home.twoPointMissProb +
                      result.home.threePointMakeProb + result.home.threePointMissProb +
                      result.home.freeThrowMakeProb + result.home.freeThrowMissProb +
                      result.home.offensiveReboundProb + result.home.turnoverProb;

      expect(visitorSum).toBeCloseTo(1.0, 6);
      expect(homeSum).toBeCloseTo(1.0, 6);
    });

    test('should handle overtime games', () => {
      const gameData = {
        playByPlay: [
          { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V', period: 1 },
          { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V', period: 2 },
          { action: 'GOOD', type: 'LAYUP', team: 'MSU', vh: 'V', period: 3 }, // OT
          { action: 'MISS', type: '3PTR', team: 'MSU', vh: 'V', period: 3 }
        ],
        teams: {
          visitor: { id: 'MSU', name: 'Michigan St.' },
          home: { id: 'KEN', name: 'Kentucky' }
        }
      };

      const result = computer.computeTransitionProbabilities(gameData);

      expect(result).toBeDefined();
      expect(result.visitor.twoPointMakeProb).toBeGreaterThan(0);
      // Should include all periods including overtime
    });

    test('should handle games with no play-by-play data', () => {
      const gameData = {
        playByPlay: [],
        teams: {
          visitor: { id: 'MSU', name: 'Michigan St.' },
          home: { id: 'KEN', name: 'Kentucky' }
        }
      };

      const result = computer.computeTransitionProbabilities(gameData);

      expect(result).toBeDefined();
      expect(result.visitor).toBeDefined();
      expect(result.home).toBeDefined();
      // Should return zeros or handle gracefully
    });
  });

  describe('validateProbabilities', () => {
    test('should validate that probabilities sum to 1.0', () => {
      const probabilities = {
        twoPointMakeProb: 0.25,
        twoPointMissProb: 0.15,
        threePointMakeProb: 0.125,
        threePointMissProb: 0.175,
        freeThrowMakeProb: 0.1,
        freeThrowMissProb: 0.05,
        offensiveReboundProb: 0.075,
        turnoverProb: 0.075
      };

      const isValid = computer.validateProbabilities(probabilities);

      expect(isValid).toBe(true);
    });

    test('should reject probabilities that do not sum to 1.0', () => {
      const probabilities = {
        twoPointMakeProb: 0.3,
        twoPointMissProb: 0.2,
        threePointMakeProb: 0.1,
        threePointMissProb: 0.1,
        freeThrowMakeProb: 0.1,
        freeThrowMissProb: 0.05,
        offensiveReboundProb: 0.05,
        turnoverProb: 0.05
      };

      const isValid = computer.validateProbabilities(probabilities);

      expect(isValid).toBe(false);
    });

    test('should reject negative probabilities', () => {
      const probabilities = {
        twoPointMakeProb: -0.1,
        twoPointMissProb: 0.3,
        threePointMakeProb: 0.2,
        threePointMissProb: 0.2,
        freeThrowMakeProb: 0.1,
        freeThrowMissProb: 0.1,
        offensiveReboundProb: 0.1,
        turnoverProb: 0.1
      };

      const isValid = computer.validateProbabilities(probabilities);

      expect(isValid).toBe(false);
    });

    test('should reject probabilities greater than 1.0', () => {
      const probabilities = {
        twoPointMakeProb: 1.5,
        twoPointMissProb: 0.0,
        threePointMakeProb: 0.0,
        threePointMissProb: 0.0,
        freeThrowMakeProb: 0.0,
        freeThrowMissProb: 0.0,
        offensiveReboundProb: 0.0,
        turnoverProb: 0.0
      };

      const isValid = computer.validateProbabilities(probabilities);

      expect(isValid).toBe(false);
    });

    test('should allow small floating point errors', () => {
      const probabilities = {
        twoPointMakeProb: 0.25,
        twoPointMissProb: 0.15,
        threePointMakeProb: 0.125,
        threePointMissProb: 0.175,
        freeThrowMakeProb: 0.1,
        freeThrowMissProb: 0.05,
        offensiveReboundProb: 0.075,
        turnoverProb: 0.0750001 // Small floating point error
      };

      const isValid = computer.validateProbabilities(probabilities);

      expect(isValid).toBe(true);
    });
  });
});
