const TeamNameMatcher = require('../../src/modules/sports/TeamNameMatcher');

describe('TeamNameMatcher', () => {
  let matcher;

  beforeEach(() => {
    matcher = new TeamNameMatcher();
  });

  describe('normalizeTeamName', () => {
    test('should convert to lowercase', () => {
      expect(matcher.normalizeTeamName('KANSAS')).toBe('kansas');
    });

    test('should remove special characters', () => {
      expect(matcher.normalizeTeamName('Miami (FL)')).toBe('miami fl');
    });

    test('should collapse multiple spaces', () => {
      expect(matcher.normalizeTeamName('Notre   Dame')).toBe('notre dame');
    });

    test('should trim whitespace', () => {
      expect(matcher.normalizeTeamName('  Duke  ')).toBe('duke');
    });

    test('should handle empty string', () => {
      expect(matcher.normalizeTeamName('')).toBe('');
    });

    test('should handle null', () => {
      expect(matcher.normalizeTeamName(null)).toBe('');
    });
  });

  describe('calculateSimilarity', () => {
    test('should return 1.0 for exact matches', () => {
      expect(matcher.calculateSimilarity('Kansas', 'Kansas')).toBe(1.0);
    });

    test('should return 1.0 for case-insensitive matches', () => {
      expect(matcher.calculateSimilarity('Kansas', 'KANSAS')).toBe(1.0);
    });

    test('should return high score for substring matches', () => {
      // "Kansas" contains "Kans" as a substring
      const score = matcher.calculateSimilarity('Kansas', 'Kans');
      expect(score).toBeGreaterThanOrEqual(0.85);
    });

    test('should handle abbreviations with Levenshtein distance', () => {
      // "KU" is an abbreviation, not a substring of "Kansas"
      // It should still get a reasonable score via Levenshtein distance
      const score = matcher.calculateSimilarity('Kansas', 'KU');
      expect(score).toBeGreaterThan(0.0);
      expect(score).toBeLessThan(0.5); // Not a high match
    });

    test('should return 0.0 for completely different strings', () => {
      const score = matcher.calculateSimilarity('Kansas', 'Duke');
      expect(score).toBeLessThan(0.5);
    });

    test('should handle empty strings', () => {
      expect(matcher.calculateSimilarity('', '')).toBe(0.0);
      expect(matcher.calculateSimilarity('Kansas', '')).toBe(0.0);
    });
  });

  describe('levenshteinDistance', () => {
    test('should return 0 for identical strings', () => {
      expect(matcher.levenshteinDistance('test', 'test')).toBe(0);
    });

    test('should return correct distance for single character difference', () => {
      expect(matcher.levenshteinDistance('test', 'best')).toBe(1);
    });

    test('should return correct distance for multiple differences', () => {
      expect(matcher.levenshteinDistance('kitten', 'sitting')).toBe(3);
    });
  });

  describe('matchGames', () => {
    test('should match games with exact team names', () => {
      const espnGames = [{
        awayTeam: { name: 'Kansas', abbreviation: 'KU' },
        homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
      }];

      const actionNetworkGames = [{
        awayTeam: { name: 'Kansas', abbreviation: 'KU' },
        homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
      }];

      const matches = matcher.matchGames(espnGames, actionNetworkGames);
      
      expect(matches).toHaveLength(1);
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0.7);
    });

    test('should match games with similar team names', () => {
      const espnGames = [{
        awayTeam: { name: 'Kansas Jayhawks', abbreviation: 'KU' },
        homeTeam: { name: 'Duke Blue Devils', abbreviation: 'DUKE' }
      }];

      const actionNetworkGames = [{
        awayTeam: { name: 'Kansas', abbreviation: 'KU' },
        homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
      }];

      const matches = matcher.matchGames(espnGames, actionNetworkGames);
      
      expect(matches).toHaveLength(1);
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0.7);
    });

    test('should not match games below confidence threshold', () => {
      const espnGames = [{
        awayTeam: { name: 'Kansas', abbreviation: 'KU' },
        homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
      }];

      const actionNetworkGames = [{
        awayTeam: { name: 'Arizona', abbreviation: 'ARIZ' },
        homeTeam: { name: 'UCLA', abbreviation: 'UCLA' }
      }];

      const matches = matcher.matchGames(espnGames, actionNetworkGames);
      
      expect(matches).toHaveLength(0);
    });

    test('should prevent duplicate matching', () => {
      const espnGames = [
        {
          awayTeam: { name: 'Kansas', abbreviation: 'KU' },
          homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
        },
        {
          awayTeam: { name: 'Kansas', abbreviation: 'KU' },
          homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
        }
      ];

      const actionNetworkGames = [{
        awayTeam: { name: 'Kansas', abbreviation: 'KU' },
        homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
      }];

      const matches = matcher.matchGames(espnGames, actionNetworkGames);
      
      // Should only match once
      expect(matches).toHaveLength(1);
    });

    test('should add bonus for high confidence matches', () => {
      const espnGames = [{
        awayTeam: { name: 'Kansas', abbreviation: 'KU' },
        homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
      }];

      const actionNetworkGames = [{
        awayTeam: { name: 'Kansas', abbreviation: 'KU' },
        homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
      }];

      const matches = matcher.matchGames(espnGames, actionNetworkGames);
      
      expect(matches).toHaveLength(1);
      // With bonus, confidence should be very high
      expect(matches[0].confidence).toBeGreaterThan(0.9);
    });
  });

  describe('generateMatchReport', () => {
    test('should generate comprehensive match report', () => {
      const espnGames = [
        {
          awayTeam: { name: 'Kansas', abbreviation: 'KU' },
          homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
        },
        {
          awayTeam: { name: 'Arizona', abbreviation: 'ARIZ' },
          homeTeam: { name: 'UCLA', abbreviation: 'UCLA' }
        }
      ];

      const actionNetworkGames = [
        {
          awayTeam: { name: 'Kansas', abbreviation: 'KU' },
          homeTeam: { name: 'Duke', abbreviation: 'DUKE' }
        }
      ];

      const matches = matcher.matchGames(espnGames, actionNetworkGames);
      const report = matcher.generateMatchReport(espnGames, actionNetworkGames, matches);

      expect(report.metrics.totalEspnGames).toBe(2);
      expect(report.metrics.totalActionNetworkGames).toBe(1);
      expect(report.metrics.matchedGames).toBe(1);
      expect(report.metrics.unmatchedGames).toBe(1);
      expect(report.successfulMatches).toHaveLength(1);
      expect(report.failedMatches).toHaveLength(1);
    });
  });
});
