const GameIdMappingRepository = require('../../../src/database/repositories/GameIdMappingRepository');
const dbConnection = require('../../../src/database/connection');

describe('GameIdMappingRepository', () => {
  let repository;

  beforeAll(async () => {
    // Ensure test database is set up
    if (!dbConnection.isReady()) {
      await dbConnection.initialize();
    }
    
    // Run SQL migrations for StatBroadcast tables
    const fs = require('fs').promises;
    const path = require('path');
    
    const migration007 = await fs.readFile(
      path.join(__dirname, '../../../src/database/migrations/007_create_statbroadcast_game_ids.sql'),
      'utf-8'
    );
    
    // Split by semicolon and execute each statement
    const statements = migration007.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await dbConnection.run(statement);
      }
    }
  });

  beforeEach(async () => {
    repository = new GameIdMappingRepository();
    
    // Clean up test data
    await dbConnection.run('DELETE FROM statbroadcast_game_ids');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('saveMapping', () => {
    test('should save a new game ID mapping', async () => {
      const mapping = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95,
        matchMethod: 'discovery'
      };

      const result = await repository.saveMapping(mapping);

      expect(result).toBeDefined();
      expect(result.changes).toBe(1);
    });

    test('should update existing mapping if ESPN game ID already exists', async () => {
      const mapping1 = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.85
      };

      await repository.saveMapping(mapping1);

      const mapping2 = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb789',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      await repository.saveMapping(mapping2);

      const retrieved = await repository.getMapping('espn123');
      expect(retrieved.statbroadcastGameId).toBe('sb789');
      expect(retrieved.confidence).toBe(0.95);
    });

    test('should set discovered_at timestamp automatically', async () => {
      const mapping = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      await repository.saveMapping(mapping);

      const retrieved = await repository.getMapping('espn123');
      expect(retrieved.discoveredAt).toBeDefined();
    });
  });

  describe('getMapping', () => {
    test('should retrieve mapping by ESPN game ID', async () => {
      const mapping = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      await repository.saveMapping(mapping);

      const retrieved = await repository.getMapping('espn123');

      expect(retrieved).toBeDefined();
      expect(retrieved.espnGameId).toBe('espn123');
      expect(retrieved.statbroadcastGameId).toBe('sb456');
      expect(retrieved.homeTeam).toBe('Kentucky');
      expect(retrieved.awayTeam).toBe('Michigan State');
      expect(retrieved.confidence).toBe(0.95);
    });

    test('should return null if mapping not found', async () => {
      const retrieved = await repository.getMapping('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getMappingBySbId', () => {
    test('should retrieve mapping by StatBroadcast game ID', async () => {
      const mapping = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      await repository.saveMapping(mapping);

      const retrieved = await repository.getMappingBySbId('sb456');

      expect(retrieved).toBeDefined();
      expect(retrieved.espnGameId).toBe('espn123');
      expect(retrieved.statbroadcastGameId).toBe('sb456');
    });

    test('should return null if mapping not found', async () => {
      const retrieved = await repository.getMappingBySbId('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getMappingsByDate', () => {
    test('should retrieve all mappings for a specific date', async () => {
      const mapping1 = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      const mapping2 = {
        espnGameId: 'espn124',
        statbroadcastGameId: 'sb457',
        homeTeam: 'Duke',
        awayTeam: 'UNC',
        gameDate: '2025-11-18',
        confidence: 0.90
      };

      const mapping3 = {
        espnGameId: 'espn125',
        statbroadcastGameId: 'sb458',
        homeTeam: 'Kansas',
        awayTeam: 'Villanova',
        gameDate: '2025-11-19',
        confidence: 0.88
      };

      await repository.saveMapping(mapping1);
      await repository.saveMapping(mapping2);
      await repository.saveMapping(mapping3);

      const retrieved = await repository.getMappingsByDate('2025-11-18');

      expect(retrieved).toHaveLength(2);
      expect(retrieved.map(m => m.espnGameId)).toContain('espn123');
      expect(retrieved.map(m => m.espnGameId)).toContain('espn124');
    });

    test('should return empty array if no mappings for date', async () => {
      const retrieved = await repository.getMappingsByDate('2025-12-25');
      expect(retrieved).toEqual([]);
    });
  });

  describe('updateLastFetched', () => {
    test('should update last_fetched timestamp', async () => {
      const mapping = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      await repository.saveMapping(mapping);

      const before = await repository.getMapping('espn123');
      const beforeTimestamp = before.lastFetched;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      await repository.updateLastFetched('espn123');

      const after = await repository.getMapping('espn123');
      expect(after.lastFetched).not.toBe(beforeTimestamp);
    });
  });

  describe('updateDataQuality', () => {
    test('should update data quality field', async () => {
      const mapping = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      await repository.saveMapping(mapping);

      await repository.updateDataQuality('espn123', 'full');

      const retrieved = await repository.getMapping('espn123');
      expect(retrieved.dataQuality).toBe('full');
    });

    test('should only accept valid data quality values', async () => {
      const mapping = {
        espnGameId: 'espn123',
        statbroadcastGameId: 'sb456',
        homeTeam: 'Kentucky',
        awayTeam: 'Michigan State',
        gameDate: '2025-11-18',
        confidence: 0.95
      };

      await repository.saveMapping(mapping);

      await expect(
        repository.updateDataQuality('espn123', 'invalid')
      ).rejects.toThrow();
    });
  });
});
