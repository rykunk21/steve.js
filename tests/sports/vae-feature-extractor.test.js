const VAEFeatureExtractor = require('../../src/modules/sports/VAEFeatureExtractor');
const XMLGameParser = require('../../src/modules/sports/XMLGameParser');
const fs = require('fs');
const path = require('path');

describe('VAEFeatureExtractor', () => {
  let extractor;
  let sampleGameData;

  beforeAll(async () => {
    extractor = new VAEFeatureExtractor();
    
    // Load sample XML data for testing
    const xmlPath = path.join(__dirname, '../fixtures/statbroadcast-game-sample.xml');
    if (fs.existsSync(xmlPath)) {
      const xmlData = fs.readFileSync(xmlPath, 'utf-8');
      const parser = new XMLGameParser();
      sampleGameData = await parser.parseGameXML(xmlData);
    }
  });

  afterAll(async () => {
    if (extractor) {
      await extractor.close();
    }
  });

  describe('Feature Extraction', () => {
    test('should extract 85-dimensional features from game data', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const features = extractor.extractGameFeatures(sampleGameData);
      
      expect(features).toHaveProperty('visitor');
      expect(features).toHaveProperty('home');
      
      // Check that we have approximately 85 features for each team (including defensive)
      const visitorFeatureCount = Object.keys(features.visitor).length;
      const homeFeatureCount = Object.keys(features.home).length;
      
      expect(visitorFeatureCount).toBeGreaterThan(80);
      expect(visitorFeatureCount).toBeLessThan(90);
      expect(homeFeatureCount).toBeGreaterThan(80);
      expect(homeFeatureCount).toBeLessThan(90);
    });

    test('should normalize features to [0,1] range', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const rawFeatures = extractor.extractGameFeatures(sampleGameData);
      const normalizedFeatures = {
        visitor: extractor.normalizeFeatures(rawFeatures.visitor),
        home: extractor.normalizeFeatures(rawFeatures.home)
      };

      // Check that all normalized features are in [0,1] range
      for (const [key, value] of Object.entries(normalizedFeatures.visitor)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }

      for (const [key, value] of Object.entries(normalizedFeatures.home)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    test('should extract basic shooting stats', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const features = extractor.extractGameFeatures(sampleGameData);
      
      // Check that basic shooting stats are present
      expect(features.visitor).toHaveProperty('fgm');
      expect(features.visitor).toHaveProperty('fga');
      expect(features.visitor).toHaveProperty('fgPct');
      expect(features.visitor).toHaveProperty('fg3m');
      expect(features.visitor).toHaveProperty('fg3a');
      expect(features.visitor).toHaveProperty('fg3Pct');
      expect(features.visitor).toHaveProperty('ftm');
      expect(features.visitor).toHaveProperty('fta');
      expect(features.visitor).toHaveProperty('ftPct');
    });

    test('should extract advanced metrics', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const features = extractor.extractGameFeatures(sampleGameData);
      
      // Check that advanced metrics are present
      expect(features.visitor).toHaveProperty('pointsInPaint');
      expect(features.visitor).toHaveProperty('fastBreakPoints');
      expect(features.visitor).toHaveProperty('secondChancePoints');
      expect(features.visitor).toHaveProperty('effectiveFgPct');
      expect(features.visitor).toHaveProperty('trueShootingPct');
      expect(features.visitor).toHaveProperty('turnoverRate');
    });

    test('should extract player-level features', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const features = extractor.extractGameFeatures(sampleGameData);
      
      // Check that player-level features are present
      expect(features.visitor).toHaveProperty('avgPlayerMinutes');
      expect(features.visitor).toHaveProperty('avgPlayerPlusMinus');
      expect(features.visitor).toHaveProperty('avgPlayerEfficiency');
      expect(features.visitor).toHaveProperty('topPlayerMinutes');
      expect(features.visitor).toHaveProperty('topPlayerPoints');
      expect(features.visitor).toHaveProperty('benchContribution');
    });

    test('should extract lineup features', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const features = extractor.extractGameFeatures(sampleGameData);
      
      // Check that lineup features are present
      expect(features.visitor).toHaveProperty('startingLineupMinutes');
      expect(features.visitor).toHaveProperty('startingLineupPoints');
      expect(features.visitor).toHaveProperty('rotationDepth');
      expect(features.visitor).toHaveProperty('lineupBalance');
    });

    test('should extract context features', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const features = extractor.extractGameFeatures(sampleGameData);
      
      // Check that context features are present
      expect(features.visitor).toHaveProperty('isNeutralSite');
      expect(features.visitor).toHaveProperty('isPostseason');
      expect(features.visitor).toHaveProperty('paceOfPlay');
      expect(features.visitor).toHaveProperty('gameLength');
    });

    test('should extract defensive features', () => {
      if (!sampleGameData) {
        console.log('Skipping test - no sample XML data available');
        return;
      }

      const features = extractor.extractGameFeatures(sampleGameData);
      
      // Check that defensive features are present
      expect(features.visitor).toHaveProperty('opponentFgPctAllowed');
      expect(features.visitor).toHaveProperty('opponentFg3PctAllowed');
      expect(features.visitor).toHaveProperty('defensiveReboundingPct');
      expect(features.visitor).toHaveProperty('pointsInPaintAllowed');
      expect(features.visitor).toHaveProperty('defensiveEfficiency');
      
      // Check that defensive features are normalized [0,1]
      expect(features.visitor.defensiveReboundingPct).toBeGreaterThanOrEqual(0);
      expect(features.visitor.defensiveReboundingPct).toBeLessThanOrEqual(1);
      expect(features.visitor.defensiveEfficiency).toBeGreaterThanOrEqual(0);
      expect(features.visitor.defensiveEfficiency).toBeLessThanOrEqual(1);
    });

    test('should handle empty player data gracefully', () => {
      const mockGameData = {
        metadata: {
          gameId: 'test123',
          neutralGame: 'N',
          postseason: 'N'
        },
        teams: {
          visitor: {
            id: 'team1',
            name: 'Team 1',
            stats: {
              fgm: 25, fga: 60, fgPct: 41.7,
              fg3m: 8, fg3a: 20, fg3Pct: 40.0,
              ftm: 15, fta: 20, ftPct: 75.0,
              rebounds: 35, offensiveRebounds: 10, defensiveRebounds: 25,
              assists: 15, turnovers: 12, steals: 8, blocks: 4,
              personalFouls: 18, technicalFouls: 1, points: 73
            },
            advancedMetrics: {
              pointsInPaint: 30, fastBreakPoints: 12, secondChancePoints: 8,
              pointsOffTurnovers: 15, benchPoints: 25, possessionCount: 70
            },
            derivedMetrics: {
              effectiveFgPct: 48.3, trueShootingPct: 52.1, turnoverRate: 16.2
            },
            periodScoring: [
              { period: 1, score: 35 },
              { period: 2, score: 38 }
            ],
            players: [] // Empty players array
          },
          home: {
            id: 'team2',
            name: 'Team 2',
            stats: {
              fgm: 28, fga: 65, fgPct: 43.1,
              fg3m: 6, fg3a: 18, fg3Pct: 33.3,
              ftm: 12, fta: 16, ftPct: 75.0,
              rebounds: 40, offensiveRebounds: 12, defensiveRebounds: 28,
              assists: 18, turnovers: 10, steals: 6, blocks: 6,
              personalFouls: 16, technicalFouls: 0, points: 74
            },
            advancedMetrics: {
              pointsInPaint: 35, fastBreakPoints: 8, secondChancePoints: 10,
              pointsOffTurnovers: 18, benchPoints: 20, possessionCount: 68
            },
            derivedMetrics: {
              effectiveFgPct: 47.7, trueShootingPct: 51.8, turnoverRate: 14.1
            },
            periodScoring: [
              { period: 1, score: 32 },
              { period: 2, score: 42 }
            ],
            players: [] // Empty players array
          }
        }
      };

      const features = extractor.extractGameFeatures(mockGameData);
      
      expect(features).toHaveProperty('visitor');
      expect(features).toHaveProperty('home');
      
      // Should have default values for player features
      expect(features.visitor.avgPlayerMinutes).toBe(0);
      expect(features.visitor.benchContribution).toBe(0);
      expect(features.visitor.rotationDepth).toBe(0);
    });
  });

  describe('Team Latent Distribution Initialization', () => {
    test('should initialize team latent distribution with correct structure', () => {
      const teamId = 'test-team-123';
      const distribution = extractor.initializeTeamLatentDistribution(teamId);
      
      expect(distribution).toHaveProperty('mu');
      expect(distribution).toHaveProperty('sigma');
      expect(distribution).toHaveProperty('games_processed');
      expect(distribution).toHaveProperty('last_updated');
      
      expect(distribution.mu).toHaveLength(16);
      expect(distribution.sigma).toHaveLength(16);
      expect(distribution.games_processed).toBe(0);
      
      // Check that mu values are small random values around 0
      for (const mu of distribution.mu) {
        expect(mu).toBeGreaterThanOrEqual(-0.1);
        expect(mu).toBeLessThanOrEqual(0.1);
      }
      
      // Check that sigma values are positive
      for (const sigma of distribution.sigma) {
        expect(sigma).toBeGreaterThan(0);
        expect(sigma).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Feature Bounds and Normalization', () => {
    test('should have feature bounds initialized', () => {
      expect(extractor.featureBounds).toBeDefined();
      expect(extractor.featureBounds).toHaveProperty('fgPct');
      expect(extractor.featureBounds).toHaveProperty('rebounds');
      expect(extractor.featureBounds).toHaveProperty('assists');
      
      // Check that bounds have min and max
      expect(extractor.featureBounds.fgPct).toHaveProperty('min');
      expect(extractor.featureBounds.fgPct).toHaveProperty('max');
    });

    test('should normalize features correctly', () => {
      const rawFeatures = {
        fgPct: 50,  // Should normalize to 0.5 (50/100)
        rebounds: 30, // Should normalize to 0.5 (30/60)
        assists: 20   // Should normalize to 0.5 (20/40)
      };

      const normalized = extractor.normalizeFeatures(rawFeatures);
      
      expect(normalized.fgPct).toBeCloseTo(0.5, 2);
      expect(normalized.rebounds).toBeCloseTo(0.5, 2);
      expect(normalized.assists).toBeCloseTo(0.5, 2);
    });

    test('should clamp normalized values to [0,1] range', () => {
      const rawFeatures = {
        fgPct: 150,  // Above max (100)
        rebounds: -10, // Below min (0)
        assists: 50    // Above max (40)
      };

      const normalized = extractor.normalizeFeatures(rawFeatures);
      
      expect(normalized.fgPct).toBe(1);
      expect(normalized.rebounds).toBe(0);
      expect(normalized.assists).toBe(1);
    });
  });

  describe('Helper Functions', () => {
    test('should calculate minute distribution correctly', () => {
      const players = [
        { stats: { minutes: 30 } },
        { stats: { minutes: 25 } },
        { stats: { minutes: 20 } },
        { stats: { minutes: 15 } },
        { stats: { minutes: 10 } }
      ];

      const distribution = extractor.calculateMinuteDistribution(players);
      
      expect(distribution).toBeGreaterThanOrEqual(0);
      expect(distribution).toBeLessThanOrEqual(1);
    });

    test('should calculate balance score correctly', () => {
      const players = [
        { stats: { points: 20 } },
        { stats: { points: 15 } },
        { stats: { points: 10 } },
        { stats: { points: 8 } },
        { stats: { points: 7 } }
      ];

      const balance = extractor.calculateBalanceScore(players);
      
      expect(balance).toBeGreaterThanOrEqual(0);
      expect(balance).toBeLessThanOrEqual(1);
    });

    test('should handle empty arrays gracefully', () => {
      expect(extractor.calculateMinuteDistribution([])).toBe(0);
      expect(extractor.calculateBalanceScore([])).toBe(0);
      expect(extractor.calculateTopPlayerUsage([])).toBe(0);
    });
  });
});