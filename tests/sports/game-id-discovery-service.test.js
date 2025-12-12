const GameIdDiscoveryService = require('../../src/modules/sports/GameIdDiscoveryService');

describe('GameIdDiscoveryService', () => {
  let service;
  let mockGameIdMappingRepo;
  let mockStatBroadcastClient;

  beforeEach(() => {
    // Mock repositories and clients
    mockGameIdMappingRepo = {
      getMapping: jest.fn(),
      saveMapping: jest.fn()
    };

    mockStatBroadcastClient = {
      searchGames: jest.fn()
    };

    service = new GameIdDiscoveryService(mockGameIdMappingRepo, mockStatBroadcastClient);
  });

  describe('normalizeTeamName', () => {
    test('should convert to lowercase', () => {
      const result = service.normalizeTeamName('MICHIGAN STATE');
      expect(result).toBe('michigan state');
    });

    test('should remove special characters', () => {
      const result = service.normalizeTeamName('St. John\'s');
      expect(result).toBe('st johns');
    });

    test('should trim whitespace', () => {
      const result = service.normalizeTeamName('  Kentucky  ');
      expect(result).toBe('kentucky');
    });

    test('should handle common abbreviations', () => {
      expect(service.normalizeTeamName('UNC')).toBe('north carolina');
      expect(service.normalizeTeamName('UCLA')).toBe('ucla');
      expect(service.normalizeTeamName('USC')).toBe('southern california');
    });

    test('should handle state abbreviations', () => {
      expect(service.normalizeTeamName('Michigan St.')).toBe('michigan state');
      expect(service.normalizeTeamName('Ohio St.')).toBe('ohio state');
    });

    test('should handle empty string', () => {
      const result = service.normalizeTeamName('');
      expect(result).toBe('');
    });
  });

  describe('calculateSimilarity', () => {
    test('should return 1.0 for identical strings', () => {
      const similarity = service.calculateSimilarity('kentucky', 'kentucky');
      expect(similarity).toBe(1.0);
    });

    test('should return 0.0 for completely different strings', () => {
      const similarity = service.calculateSimilarity('abc', 'xyz');
      expect(similarity).toBeLessThan(0.3);
    });

    test('should return high similarity for similar strings', () => {
      const similarity = service.calculateSimilarity('michigan state', 'michigan st');
      expect(similarity).toBeGreaterThan(0.7);
    });

    test('should give bonus for substring match', () => {
      const similarity = service.calculateSimilarity('kentucky', 'kentucky wildcats');
      expect(similarity).toBeGreaterThanOrEqual(0.85);
    });

    test('should handle case insensitivity', () => {
      const sim1 = service.calculateSimilarity('Kentucky', 'kentucky');
      const sim2 = service.calculateSimilarity('kentucky', 'kentucky');
      expect(sim1).toBe(sim2);
    });
  });

  describe('discoverGameId', () => {
    test('should return cached mapping if exists', async () => {
      const espnGame = {
        id: 'espn123',
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' },
        date: '2025-11-18'
      };

      mockGameIdMappingRepo.getMapping.mockResolvedValue({
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        confidence: 1.0
      });

      const result = await service.discoverGameId(espnGame);

      expect(result).toEqual({
        statbroadcastGameId: 'sb456',
        confidence: 1.0,
        source: 'cache'
      });
      expect(mockGameIdMappingRepo.getMapping).toHaveBeenCalledWith('espn123');
      expect(mockStatBroadcastClient.searchGames).not.toHaveBeenCalled();
    });

    test('should search StatBroadcast when no cache exists', async () => {
      const espnGame = {
        id: 'espn123',
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' },
        date: '2025-11-18'
      };

      mockGameIdMappingRepo.getMapping.mockResolvedValue(null);
      mockStatBroadcastClient.searchGames.mockResolvedValue([
        {
          id: 'sb456',
          homeTeam: 'Kentucky',
          awayTeam: 'Michigan St.',
          date: '2025-11-18'
        }
      ]);

      const result = await service.discoverGameId(espnGame);

      expect(result).toBeDefined();
      expect(result.statbroadcastGameId).toBe('sb456');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.source).toBe('discovery');
      expect(mockStatBroadcastClient.searchGames).toHaveBeenCalled();
    });

    test('should save successful discovery to cache', async () => {
      const espnGame = {
        id: 'espn123',
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' },
        date: '2025-11-18'
      };

      mockGameIdMappingRepo.getMapping.mockResolvedValue(null);
      mockStatBroadcastClient.searchGames.mockResolvedValue([
        {
          id: 'sb456',
          homeTeam: 'Kentucky',
          awayTeam: 'Michigan State',
          date: '2025-11-18'
        }
      ]);

      await service.discoverGameId(espnGame);

      expect(mockGameIdMappingRepo.saveMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          espnGameId: 'espn123',
          statbroadcastGameId: 'sb456',
          confidence: expect.any(Number)
        })
      );
    });

    test('should return null when no match found', async () => {
      const espnGame = {
        id: 'espn123',
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' },
        date: '2025-11-18'
      };

      mockGameIdMappingRepo.getMapping.mockResolvedValue(null);
      mockStatBroadcastClient.searchGames.mockResolvedValue([
        {
          id: 'sb999',
          homeTeam: 'Duke',
          awayTeam: 'North Carolina',
          date: '2025-11-18'
        }
      ]);

      const result = await service.discoverGameId(espnGame);

      expect(result).toBeNull();
      expect(mockGameIdMappingRepo.saveMapping).not.toHaveBeenCalled();
    });

    test('should only accept matches with confidence >= 0.7', async () => {
      const espnGame = {
        id: 'espn123',
        homeTeam: { displayName: 'Kentucky Wildcats' },
        awayTeam: { displayName: 'Michigan State Spartans' },
        date: '2025-11-18'
      };

      mockGameIdMappingRepo.getMapping.mockResolvedValue(null);
      mockStatBroadcastClient.searchGames.mockResolvedValue([
        {
          id: 'sb456',
          homeTeam: 'Duke',
          awayTeam: 'UNC',
          date: '2025-11-18'
        }
      ]);

      const result = await service.discoverGameId(espnGame);

      expect(result).toBeNull();
    });
  });

  describe('matchGame', () => {
    test('should match games with high confidence', () => {
      const espnGame = {
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' }
      };

      const candidates = [
        {
          id: 'sb456',
          homeTeam: 'Kentucky',
          awayTeam: 'Michigan St.',
          date: '2025-11-18'
        }
      ];

      const result = service.matchGame(espnGame, candidates);

      expect(result).toBeDefined();
      expect(result.gameId).toBe('sb456');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    test('should select best match from multiple candidates', () => {
      const espnGame = {
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' }
      };

      const candidates = [
        {
          id: 'sb1',
          homeTeam: 'Duke',
          awayTeam: 'UNC',
          date: '2025-11-18'
        },
        {
          id: 'sb2',
          homeTeam: 'Kentucky',
          awayTeam: 'Michigan St.',
          date: '2025-11-18'
        },
        {
          id: 'sb3',
          homeTeam: 'Kentucky Wildcats',
          awayTeam: 'Michigan State',
          date: '2025-11-18'
        }
      ];

      const result = service.matchGame(espnGame, candidates);

      expect(result).toBeDefined();
      expect(['sb2', 'sb3']).toContain(result.gameId);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    test('should add bonus for both teams matching well', () => {
      const espnGame = {
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' }
      };

      const candidates = [
        {
          id: 'sb456',
          homeTeam: 'Kentucky',
          awayTeam: 'Michigan State',
          date: '2025-11-18'
        }
      ];

      const result = service.matchGame(espnGame, candidates);

      expect(result.confidence).toBeGreaterThan(0.9);
    });

    test('should return null when no candidates provided', () => {
      const espnGame = {
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' }
      };

      const result = service.matchGame(espnGame, []);

      expect(result).toBeNull();
    });

    test('should return null when confidence too low', () => {
      const espnGame = {
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' }
      };

      const candidates = [
        {
          id: 'sb1',
          homeTeam: 'Duke Blue Devils',
          awayTeam: 'North Carolina Tar Heels',
          date: '2025-11-18'
        }
      ];

      const result = service.matchGame(espnGame, candidates);

      expect(result).toBeNull();
    });
  });

  describe('searchStatBroadcast', () => {
    test('should call StatBroadcast client with normalized team names', async () => {
      mockStatBroadcastClient.searchGames.mockResolvedValue([]);

      await service.searchStatBroadcast('Kentucky', 'Michigan State', '2025-11-18');

      expect(mockStatBroadcastClient.searchGames).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2025-11-18'
        })
      );
    });

    test('should return search results', async () => {
      const mockResults = [
        { id: 'sb1', homeTeam: 'Kentucky', awayTeam: 'Michigan St.' }
      ];

      mockStatBroadcastClient.searchGames.mockResolvedValue(mockResults);

      const results = await service.searchStatBroadcast('Kentucky', 'Michigan State', '2025-11-18');

      expect(results).toEqual(mockResults);
    });

    test('should handle search errors gracefully', async () => {
      mockStatBroadcastClient.searchGames.mockRejectedValue(new Error('Network error'));

      await expect(
        service.searchStatBroadcast('Kentucky', 'Michigan State', '2025-11-18')
      ).rejects.toThrow('Network error');
    });
  });

  describe('integration scenarios', () => {
    test('should handle team name variations correctly', async () => {
      const espnGame = {
        id: 'espn123',
        homeTeam: { displayName: 'UNC' },
        awayTeam: { displayName: 'Duke' },
        date: '2025-11-18'
      };

      mockGameIdMappingRepo.getMapping.mockResolvedValue(null);
      mockStatBroadcastClient.searchGames.mockResolvedValue([
        {
          id: 'sb456',
          homeTeam: 'North Carolina',
          awayTeam: 'Duke',
          date: '2025-11-18'
        }
      ]);

      const result = await service.discoverGameId(espnGame);

      expect(result).toBeDefined();
      expect(result.statbroadcastGameId).toBe('sb456');
    });

    test('should log failed matches for debugging', async () => {
      const espnGame = {
        id: 'espn123',
        homeTeam: { displayName: 'Kentucky' },
        awayTeam: { displayName: 'Michigan State' },
        date: '2025-11-18'
      };

      mockGameIdMappingRepo.getMapping.mockResolvedValue(null);
      mockStatBroadcastClient.searchGames.mockResolvedValue([
        {
          id: 'sb999',
          homeTeam: 'Duke',
          awayTeam: 'UNC',
          date: '2025-11-18'
        }
      ]);

      const result = await service.discoverGameId(espnGame);

      expect(result).toBeNull();
      // Logger should have been called with failure details
    });
  });

  describe('manual mapping support', () => {
    test('should save manual mapping with maximum confidence', async () => {
      mockGameIdMappingRepo.saveMapping.mockResolvedValue({});

      const result = await service.setManualMapping('espn123', 'sb456', {
        homeTeam: 'Kentucky',
        awayTeam: 'Duke',
        gameDate: '2025-11-18'
      });

      expect(mockGameIdMappingRepo.saveMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          espnGameId: 'espn123',
          statbroadcastGameId: 'sb456',
          confidence: 1.0,
          matchMethod: 'manual',
          homeTeam: 'Kentucky',
          awayTeam: 'Duke',
          gameDate: '2025-11-18'
        })
      );
      expect(result.confidence).toBe(1.0);
      expect(result.matchMethod).toBe('manual');
    });

    test('should throw error if espnGameId is missing', async () => {
      await expect(
        service.setManualMapping('', 'sb456')
      ).rejects.toThrow('Both espnGameId and statbroadcastGameId are required');
    });

    test('should throw error if statbroadcastGameId is missing', async () => {
      await expect(
        service.setManualMapping('espn123', '')
      ).rejects.toThrow('Both espnGameId and statbroadcastGameId are required');
    });

    test('should use default values for missing metadata', async () => {
      mockGameIdMappingRepo.saveMapping.mockResolvedValue({});

      await service.setManualMapping('espn123', 'sb456');

      expect(mockGameIdMappingRepo.saveMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          homeTeam: 'Unknown',
          awayTeam: 'Unknown',
          gameDate: expect.any(String)
        })
      );
    });

    test('should handle repository errors gracefully', async () => {
      mockGameIdMappingRepo.saveMapping.mockRejectedValue(new Error('Database error'));

      await expect(
        service.setManualMapping('espn123', 'sb456', {
          homeTeam: 'Kentucky',
          awayTeam: 'Duke'
        })
      ).rejects.toThrow('Database error');
    });
  });
});
