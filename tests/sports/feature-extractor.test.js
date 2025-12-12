const FeatureExtractor = require('../../src/modules/sports/FeatureExtractor');

describe('FeatureExtractor', () => {
  let featureExtractor;

  beforeEach(() => {
    featureExtractor = new FeatureExtractor();
  });

  describe('Offensive Efficiency Calculation', () => {
    test('should calculate offensive efficiency as points per 100 possessions', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          gameDate: '2024-01-05'
        }
      ];

      const offEff = featureExtractor.calculateOffensiveEfficiency(games, 'team1');

      // Team1 scored 80 + 85 = 165 points
      // Total possessions estimated from scores: (80+70)/2 + (75+85)/2 = 75 + 80 = 155
      // Expected: (165 / 155) * 100 ≈ 106.45
      expect(offEff).toBeGreaterThan(100);
      expect(offEff).toBeLessThan(115);
      expect(typeof offEff).toBe('number');
    });

    test('should return default value when no possessions', () => {
      const games = [];
      const offEff = featureExtractor.calculateOffensiveEfficiency(games, 'team1');
      expect(offEff).toBe(100);
    });

    test('should handle games with possession count data', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          possessionCount: 70,
          gameDate: '2024-01-01'
        }
      ];


      const offEff = featureExtractor.calculateOffensiveEfficiency(games, 'team1');

      // Expected: (80 / 70) * 100 ≈ 114.29
      expect(offEff).toBeCloseTo(114.29, 1);
    });
  });

  describe('Defensive Efficiency Calculation', () => {
    test('should calculate defensive efficiency as opponent points per 100 possessions', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          gameDate: '2024-01-05'
        }
      ];

      const defEff = featureExtractor.calculateDefensiveEfficiency(games, 'team1');

      // Team1 allowed 70 + 75 = 145 points
      // Opponent possessions estimated: same as team possessions
      // Expected: (145 / 155) * 100 ≈ 93.55
      expect(defEff).toBeGreaterThan(85);
      expect(defEff).toBeLessThan(100);
      expect(typeof defEff).toBe('number');
    });

    test('should return default value when no possessions', () => {
      const games = [];
      const defEff = featureExtractor.calculateDefensiveEfficiency(games, 'team1');
      expect(defEff).toBe(100);
    });
  });

  describe('Pace Calculation', () => {
    test('should calculate pace as possessions per game', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          gameDate: '2024-01-05'
        }
      ];

      const pace = featureExtractor.calculatePace(games, 'team1');


      // Average possessions per game: 155 / 2 = 77.5
      expect(pace).toBeGreaterThan(70);
      expect(pace).toBeLessThan(85);
      expect(typeof pace).toBe('number');
    });

    test('should return default value when no games', () => {
      const games = [];
      const pace = featureExtractor.calculatePace(games, 'team1');
      expect(pace).toBe(70);
    });
  });

  describe('Shooting Percentage Calculations', () => {
    test('should calculate effective field goal percentage', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          homeFieldGoalPct: 0.48,
          awayFieldGoalPct: 0.45,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          homeFieldGoalPct: 0.50,
          awayFieldGoalPct: 0.52,
          gameDate: '2024-01-05'
        }
      ];

      const efgPct = featureExtractor.calculateEffectiveFieldGoalPct(games, 'team1');

      // Team1: (0.48 + 0.52) / 2 = 0.50
      expect(efgPct).toBeCloseTo(0.50, 2);
    });

    test('should calculate three-point rate', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          homeThreePointPct: 0.35,
          awayThreePointPct: 0.30,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          homeThreePointPct: 0.40,
          awayThreePointPct: 0.38,
          gameDate: '2024-01-05'
        }
      ];

      const threeRate = featureExtractor.calculateThreePointRate(games, 'team1');


      // Team1: (0.35 + 0.38) / 2 = 0.365
      expect(threeRate).toBeCloseTo(0.365, 2);
    });

    test('should return default values when shooting data unavailable', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
        }
      ];

      const efgPct = featureExtractor.calculateEffectiveFieldGoalPct(games, 'team1');
      const threeRate = featureExtractor.calculateThreePointRate(games, 'team1');

      expect(efgPct).toBe(0.50);
      expect(threeRate).toBe(0.35);
    });
  });

  describe('Turnover and Rebound Rate Calculations', () => {
    test('should calculate turnover rate', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          homeTurnovers: 12,
          awayTurnovers: 15,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          homeTurnovers: 10,
          awayTurnovers: 11,
          gameDate: '2024-01-05'
        }
      ];

      const toRate = featureExtractor.calculateTurnoverRate(games, 'team1');

      // Team1 turnovers: 12 + 11 = 23
      // Total possessions: 155
      // Expected: 23 / 155 ≈ 0.148
      expect(toRate).toBeGreaterThan(0.10);
      expect(toRate).toBeLessThan(0.20);
      expect(typeof toRate).toBe('number');
    });

    test('should calculate offensive rebound rate', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          homeRebounds: 35,
          awayRebounds: 32,
          gameDate: '2024-01-01'
        }
      ];


      const orebRate = featureExtractor.calculateOffensiveReboundRate(games, 'team1');

      expect(orebRate).toBeGreaterThan(0);
      expect(orebRate).toBeLessThan(1);
      expect(typeof orebRate).toBe('number');
    });

    test('should calculate defensive rebound rate', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          homeRebounds: 35,
          awayRebounds: 32,
          gameDate: '2024-01-01'
        }
      ];

      const drebRate = featureExtractor.calculateDefensiveReboundRate(games, 'team1');

      expect(drebRate).toBeGreaterThan(0);
      expect(drebRate).toBeLessThan(1);
      expect(typeof drebRate).toBe('number');
    });

    test('should return default values when rebound data unavailable', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
        }
      ];

      const orebRate = featureExtractor.calculateOffensiveReboundRate(games, 'team1');
      const drebRate = featureExtractor.calculateDefensiveReboundRate(games, 'team1');

      expect(orebRate).toBe(0.30);
      expect(drebRate).toBe(0.70);
    });
  });

  describe('Recent Form Metrics', () => {
    test('should calculate recent form with win percentage', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          gameDate: '2024-01-05'
        },
        {
          homeTeamId: 'team1',
          awayTeamId: 'team3',
          homeScore: 90,
          awayScore: 88,
          gameDate: '2024-01-10'
        }
      ];


      const recentForm = featureExtractor.calculateRecentForm(games, 'team1', 3);

      // Team1 won 3 out of 3 games
      expect(recentForm.winPct).toBe(1.0);
      expect(recentForm.avgMargin).toBeGreaterThan(0);
      expect(typeof recentForm.momentum).toBe('number');
    });

    test('should calculate average margin in recent games', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          gameDate: '2024-01-05'
        }
      ];

      const recentForm = featureExtractor.calculateRecentForm(games, 'team1', 2);

      // Margins: +10, +10 = average +10
      expect(recentForm.avgMargin).toBe(10);
    });

    test('should calculate momentum from margin trends', () => {
      const games = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 70,
          awayScore: 80,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          gameDate: '2024-01-05'
        },
        {
          homeTeamId: 'team1',
          awayTeamId: 'team3',
          homeScore: 90,
          awayScore: 80,
          gameDate: '2024-01-10'
        },
        {
          homeTeamId: 'team3',
          awayTeamId: 'team1',
          homeScore: 70,
          awayScore: 95,
          gameDate: '2024-01-15'
        }
      ];

      const recentForm = featureExtractor.calculateRecentForm(games, 'team1', 4);

      // Margins: -10, +10, +10, +25 (improving trend)
      expect(recentForm.momentum).toBeGreaterThan(-1);
      expect(recentForm.momentum).toBeLessThanOrEqual(1);
    });

    test('should return default form when no games', () => {
      const games = [];
      const recentForm = featureExtractor.calculateRecentForm(games, 'team1', 5);

      expect(recentForm.winPct).toBe(0.5);
      expect(recentForm.avgMargin).toBe(0);
      expect(recentForm.momentum).toBe(0);
    });
  });


  describe('Feature Normalization', () => {
    test('should normalize all features to [0, 1] range', () => {
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

    test('should clamp values outside bounds to [0, 1]', () => {
      const rawFeatures = {
        offensiveEfficiency: 150, // Above max bound of 120
        defensiveEfficiency: 60,  // Below min bound of 80
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

      expect(normalized[0]).toBe(1.0); // Clamped to max
      expect(normalized[1]).toBe(0.0); // Clamped to min
      expect(normalized.every(f => f >= 0 && f <= 1)).toBe(true);
    });

    test('should handle features already in [0, 1] range', () => {
      const rawFeatures = {
        offensiveEfficiency: 100,
        defensiveEfficiency: 100,
        pace: 70,
        effectiveFieldGoalPct: 0.50,
        freeThrowRate: 0.25,
        threePointRate: 0.35,
        turnoverRate: 0.15,
        offensiveReboundRate: 0.30,
        defensiveReboundRate: 0.70,
        assistRate: 0.50,
        stealRate: 0.10,
        blockRate: 0.08,
        recentFormWinPct: 0.5,
        recentFormAvgMargin: 0,
        recentFormMomentum: 0
      };

      const normalized = featureExtractor.normalizeFeatures(rawFeatures);


      expect(normalized).toHaveLength(15);
      expect(normalized.every(f => f >= 0 && f <= 1)).toBe(true);
    });
  });

  describe('Full Feature Extraction Pipeline', () => {
    test('should extract complete feature vector from team games', () => {
      const teamGames = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          homeFieldGoalPct: 0.48,
          awayFieldGoalPct: 0.45,
          homeThreePointPct: 0.35,
          awayThreePointPct: 0.30,
          homeFreeThrowPct: 0.75,
          awayFreeThrowPct: 0.70,
          homeTurnovers: 12,
          awayTurnovers: 15,
          homeRebounds: 35,
          awayRebounds: 32,
          homeAssists: 18,
          awayAssists: 15,
          gameDate: '2024-01-01'
        },
        {
          homeTeamId: 'team2',
          awayTeamId: 'team1',
          homeScore: 75,
          awayScore: 85,
          homeFieldGoalPct: 0.50,
          awayFieldGoalPct: 0.52,
          homeThreePointPct: 0.40,
          awayThreePointPct: 0.38,
          homeFreeThrowPct: 0.80,
          awayFreeThrowPct: 0.78,
          homeTurnovers: 10,
          awayTurnovers: 11,
          homeRebounds: 38,
          awayRebounds: 36,
          homeAssists: 20,
          awayAssists: 19,
          gameDate: '2024-01-05'
        }
      ];

      const features = featureExtractor.extractFeatures(teamGames, 'team1');

      expect(features).toHaveLength(15);
      expect(features.every(f => typeof f === 'number')).toBe(true);
      expect(features.every(f => f >= 0 && f <= 1)).toBe(true);
    });

    test('should return default features when no games available', () => {
      const features = featureExtractor.extractFeatures([], 'team1');

      expect(features).toHaveLength(15);
      expect(features.every(f => f === 0.5)).toBe(true);
    });

    test('should handle partial game data gracefully', () => {
      const teamGames = [
        {
          homeTeamId: 'team1',
          awayTeamId: 'team2',
          homeScore: 80,
          awayScore: 70,
          gameDate: '2024-01-01'
          // Missing most statistical fields
        }
      ];

      const features = featureExtractor.extractFeatures(teamGames, 'team1');

      expect(features).toHaveLength(15);
      expect(features.every(f => f >= 0 && f <= 1)).toBe(true);
    });
  });

  describe('Helper Methods', () => {
    test('should return correct feature dimension', () => {
      const dim = featureExtractor.getFeatureDimension();
      expect(dim).toBe(15);
    });

    test('should return default features with correct dimension', () => {
      const defaultFeatures = featureExtractor.getDefaultFeatures();
      expect(defaultFeatures).toHaveLength(15);
      expect(defaultFeatures.every(f => f === 0.5)).toBe(true);
    });
  });
});
