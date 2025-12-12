const {
  generateRandomLatentDistribution,
  validateLatentDistribution,
  calculateDistributionStats,
  hasRecentGames
} = require('../../scripts/initialize-team-latent-distributions');

describe('Initialize Team Latent Distributions', () => {
  describe('generateRandomLatentDistribution', () => {
    test('should generate valid distribution with default parameters', () => {
      const distribution = generateRandomLatentDistribution();
      
      expect(distribution).toHaveProperty('mu');
      expect(distribution).toHaveProperty('sigma');
      expect(distribution).toHaveProperty('games_processed');
      expect(distribution).toHaveProperty('last_season');
      expect(distribution).toHaveProperty('initialized_at');
      expect(distribution).toHaveProperty('last_updated');
      
      expect(distribution.mu).toHaveLength(16);
      expect(distribution.sigma).toHaveLength(16);
      expect(distribution.games_processed).toBe(0);
      expect(distribution.last_season).toBe('2024-25');
      
      // Check mu values are small random values around 0
      for (const mu of distribution.mu) {
        expect(mu).toBeGreaterThanOrEqual(-0.1);
        expect(mu).toBeLessThanOrEqual(0.1);
      }
      
      // Check sigma values are positive (default is for teams with recent games)
      for (const sigma of distribution.sigma) {
        expect(sigma).toBeGreaterThan(0);
        expect(sigma).toBeLessThanOrEqual(2.0); // Allow for random variation
      }
    });

    test('should generate higher sigma values for teams without recent games', () => {
      const distributionWithRecentGames = generateRandomLatentDistribution(16, true);
      const distributionWithoutRecentGames = generateRandomLatentDistribution(16, false);
      
      // Teams without recent games should have higher average sigma
      const avgSigmaWithRecent = distributionWithRecentGames.sigma.reduce((sum, val) => sum + val, 0) / 16;
      const avgSigmaWithoutRecent = distributionWithoutRecentGames.sigma.reduce((sum, val) => sum + val, 0) / 16;
      
      expect(avgSigmaWithoutRecent).toBeGreaterThan(avgSigmaWithRecent);
      
      // Teams with recent games should have sigma around 1.0
      expect(avgSigmaWithRecent).toBeGreaterThan(0.8);
      expect(avgSigmaWithRecent).toBeLessThan(1.2);
      
      // Teams without recent games should have sigma around 1.5
      expect(avgSigmaWithoutRecent).toBeGreaterThan(1.2);
      expect(avgSigmaWithoutRecent).toBeLessThan(1.8);
    });

    test('should generate different distributions on multiple calls', () => {
      const dist1 = generateRandomLatentDistribution();
      const dist2 = generateRandomLatentDistribution();
      
      // Should not be identical (very low probability)
      expect(dist1.mu).not.toEqual(dist2.mu);
      expect(dist1.sigma).not.toEqual(dist2.sigma);
    });
  });

  describe('validateLatentDistribution', () => {
    test('should validate correct distribution structure', () => {
      const validDistribution = {
        mu: Array(16).fill(0),
        sigma: Array(16).fill(1),
        games_processed: 0,
        last_season: '2024-25'
      };
      
      expect(validateLatentDistribution(validDistribution)).toBe(true);
    });

    test('should reject invalid mu array', () => {
      const invalidDistribution = {
        mu: Array(15).fill(0), // Wrong length
        sigma: Array(16).fill(1),
        games_processed: 0,
        last_season: '2024-25'
      };
      
      expect(validateLatentDistribution(invalidDistribution)).toBe(false);
    });

    test('should reject invalid sigma array', () => {
      const invalidDistribution = {
        mu: Array(16).fill(0),
        sigma: Array(16).fill(-1), // Negative values
        games_processed: 0,
        last_season: '2024-25'
      };
      
      expect(validateLatentDistribution(invalidDistribution)).toBe(false);
    });

    test('should reject invalid games_processed', () => {
      const invalidDistribution = {
        mu: Array(16).fill(0),
        sigma: Array(16).fill(1),
        games_processed: -1, // Negative
        last_season: '2024-25'
      };
      
      expect(validateLatentDistribution(invalidDistribution)).toBe(false);
    });

    test('should accept distribution without last_season for backward compatibility', () => {
      const validDistribution = {
        mu: Array(16).fill(0),
        sigma: Array(16).fill(1),
        games_processed: 0
        // No last_season field
      };
      
      expect(validateLatentDistribution(validDistribution)).toBe(true);
    });

    test('should reject null or undefined input', () => {
      expect(validateLatentDistribution(null)).toBe(false);
      expect(validateLatentDistribution(undefined)).toBe(false);
      expect(validateLatentDistribution({})).toBe(false);
    });
  });

  describe('calculateDistributionStats', () => {
    test('should calculate correct statistics', () => {
      const distribution = {
        mu: [0, 0.1, -0.1, 0.05],
        sigma: [1, 1.2, 0.8, 1.1]
      };
      
      const stats = calculateDistributionStats(distribution);
      
      expect(stats).toHaveProperty('mu');
      expect(stats).toHaveProperty('sigma');
      expect(stats.mu).toHaveProperty('mean');
      expect(stats.mu).toHaveProperty('std');
      expect(stats.sigma).toHaveProperty('mean');
      expect(stats.sigma).toHaveProperty('min');
      expect(stats.sigma).toHaveProperty('max');
      
      // Check calculated values
      expect(parseFloat(stats.mu.mean)).toBeCloseTo(0.0125, 3);
      expect(parseFloat(stats.sigma.mean)).toBeCloseTo(1.025, 3);
      expect(parseFloat(stats.sigma.min)).toBe(0.8);
      expect(parseFloat(stats.sigma.max)).toBe(1.2);
    });
  });
});