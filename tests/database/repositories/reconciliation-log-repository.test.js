const ReconciliationLogRepository = require('../../../src/database/repositories/ReconciliationLogRepository');
const dbConnection = require('../../../src/database/connection');

describe('ReconciliationLogRepository', () => {
  let repository;

  beforeAll(async () => {
    if (!dbConnection.isReady()) {
      await dbConnection.initialize();
    }
    
    // Run SQL migration for reconciliation_log table
    const fs = require('fs').promises;
    const path = require('path');
    
    const migration009 = await fs.readFile(
      path.join(__dirname, '../../../src/database/migrations/009_create_reconciliation_log.sql'),
      'utf-8'
    );
    
    // Split by semicolon and execute each statement
    const statements = migration009.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await dbConnection.run(statement);
      }
    }
  });

  beforeEach(async () => {
    repository = new ReconciliationLogRepository();
    await dbConnection.run('DELETE FROM reconciliation_log');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('startReconciliation', () => {
    test('should create a new reconciliation log entry', async () => {
      const result = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'startup'
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.changes).toBe(1);
    });

    test('should set status to running', async () => {
      const result = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'manual'
      });

      const log = await repository.getReconciliation(result.id);
      expect(log.status).toBe('running');
    });

    test('should set started_at timestamp', async () => {
      const result = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'scheduled'
      });

      const log = await repository.getReconciliation(result.id);
      expect(log.startedAt).toBeDefined();
    });
  });

  describe('completeReconciliation', () => {
    test('should update reconciliation with completion data', async () => {
      const start = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'startup'
      });

      await repository.completeReconciliation(start.id, {
        gamesFound: 50,
        gamesProcessed: 48,
        gamesFailed: 2,
        dataSources: 'ESPN,StatBroadcast'
      });

      const log = await repository.getReconciliation(start.id);
      expect(log.status).toBe('completed');
      expect(log.gamesFound).toBe(50);
      expect(log.gamesProcessed).toBe(48);
      expect(log.gamesFailed).toBe(2);
      expect(log.completedAt).toBeDefined();
    });

    test('should set completed_at timestamp', async () => {
      const start = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'manual'
      });

      const beforeComplete = await repository.getReconciliation(start.id);
      expect(beforeComplete.completedAt).toBeNull();

      await repository.completeReconciliation(start.id, {
        gamesFound: 10,
        gamesProcessed: 10,
        gamesFailed: 0
      });

      const afterComplete = await repository.getReconciliation(start.id);
      expect(afterComplete.completedAt).toBeDefined();
    });
  });

  describe('failReconciliation', () => {
    test('should mark reconciliation as failed with error message', async () => {
      const start = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'scheduled'
      });

      await repository.failReconciliation(start.id, 'Network timeout');

      const log = await repository.getReconciliation(start.id);
      expect(log.status).toBe('failed');
      expect(log.errorMessage).toBe('Network timeout');
      expect(log.completedAt).toBeDefined();
    });
  });

  describe('getReconciliation', () => {
    test('should retrieve reconciliation by ID', async () => {
      const start = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'manual'
      });

      const log = await repository.getReconciliation(start.id);

      expect(log).toBeDefined();
      expect(log.id).toBe(start.id);
      expect(log.dateRangeStart).toBe('2025-11-01');
      expect(log.dateRangeEnd).toBe('2025-11-07');
      expect(log.triggeredBy).toBe('manual');
    });

    test('should return null if not found', async () => {
      const log = await repository.getReconciliation('nonexistent-id');
      expect(log).toBeNull();
    });
  });

  describe('getRecentReconciliations', () => {
    test('should retrieve recent reconciliations ordered by date', async () => {
      await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'startup'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await repository.startReconciliation({
        dateRangeStart: '2025-11-08',
        dateRangeEnd: '2025-11-14',
        triggeredBy: 'scheduled'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await repository.startReconciliation({
        dateRangeStart: '2025-11-15',
        dateRangeEnd: '2025-11-21',
        triggeredBy: 'manual'
      });

      const recent = await repository.getRecentReconciliations(2);

      expect(recent).toHaveLength(2);
      expect(recent[0].dateRangeStart).toBe('2025-11-15');
      expect(recent[1].dateRangeStart).toBe('2025-11-08');
    });

    test('should limit results to specified count', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.startReconciliation({
          dateRangeStart: `2025-11-0${i + 1}`,
          dateRangeEnd: `2025-11-0${i + 7}`,
          triggeredBy: 'test'
        });
      }

      const recent = await repository.getRecentReconciliations(3);
      expect(recent).toHaveLength(3);
    });
  });

  describe('getReconciliationsByStatus', () => {
    test('should retrieve reconciliations by status', async () => {
      const start1 = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'startup'
      });

      const start2 = await repository.startReconciliation({
        dateRangeStart: '2025-11-08',
        dateRangeEnd: '2025-11-14',
        triggeredBy: 'scheduled'
      });

      await repository.completeReconciliation(start1.id, {
        gamesFound: 10,
        gamesProcessed: 10,
        gamesFailed: 0
      });

      const running = await repository.getReconciliationsByStatus('running');
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(start2.id);

      const completed = await repository.getReconciliationsByStatus('completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(start1.id);
    });
  });

  describe('getReconciliationStats', () => {
    test('should calculate statistics for completed reconciliations', async () => {
      const start1 = await repository.startReconciliation({
        dateRangeStart: '2025-11-01',
        dateRangeEnd: '2025-11-07',
        triggeredBy: 'startup'
      });

      await repository.completeReconciliation(start1.id, {
        gamesFound: 50,
        gamesProcessed: 48,
        gamesFailed: 2
      });

      const start2 = await repository.startReconciliation({
        dateRangeStart: '2025-11-08',
        dateRangeEnd: '2025-11-14',
        triggeredBy: 'scheduled'
      });

      await repository.completeReconciliation(start2.id, {
        gamesFound: 30,
        gamesProcessed: 30,
        gamesFailed: 0
      });

      const stats = await repository.getReconciliationStats();

      expect(stats.totalReconciliations).toBe(2);
      expect(stats.totalGamesFound).toBe(80);
      expect(stats.totalGamesProcessed).toBe(78);
      expect(stats.totalGamesFailed).toBe(2);
      expect(stats.successRate).toBeCloseTo(97.5, 1);
    });

    test('should handle zero reconciliations', async () => {
      const stats = await repository.getReconciliationStats();

      expect(stats.totalReconciliations).toBe(0);
      expect(stats.totalGamesFound).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });
});
