const GameReconciliationService = require('../../src/modules/sports/GameReconciliationService');
const fs = require('fs');
const path = require('path');

describe('GameReconciliationService', () => {
  let service;
  let mockHistoricalGameRepo;
  let mockReconciliationLogRepo;
  let mockTeamRepo;
  let mockGameIdDiscoveryService;
  let mockStatBroadcastClient;
  let mockXMLGameParser;
  let mockESPNAPIClient;

  beforeEach(() => {
    // Create mocks
    mockHistoricalGameRepo = {
      getGamesByDateRange: jest.fn(),
      saveGame: jest.fn()
    };

    mockReconciliationLogRepo = {
      startReconciliation: jest.fn(),
      completeReconciliation: jest.fn(),
      failReconciliation: jest.fn()
    };

    mockTeamRepo = {
      getTeamByEspnId: jest.fn(),
      getTeamByStatBroadcastGid: jest.fn()
    };

    mockGameIdDiscoveryService = {
      discoverGameId: jest.fn()
    };

    mockStatBroadcastClient = {
      fetchGameXML: jest.fn(),
      getTeamSchedule: jest.fn()
    };

    mockXMLGameParser = {
      parseGameXML: jest.fn()
    };

    mockESPNAPIClient = {
      getGamesByDateRange: jest.fn()
    };

    // Create service instance
    service = new GameReconciliationService(
      mockHistoricalGameRepo,
      mockReconciliationLogRepo,
      mockTeamRepo,
      mockGameIdDiscoveryService,
      mockStatBroadcastClient,
      mockXMLGameParser,
      mockESPNAPIClient
    );
  });

  describe('reconcileGames', () => {
    it('should identify missing games by comparing ESPN to historical DB', async () => {
      // Arrange
      const startDate = new Date('2024-11-04');
      const endDate = new Date('2024-11-22');

      mockReconciliationLogRepo.startReconciliation.mockResolvedValue({
        id: 'recon-123'
      });

      // ESPN has 5 games for Michigan State
      mockESPNAPIClient.getGamesByDateRange.mockResolvedValue([
        { id: 'espn-623619', homeTeam: { id: '127', name: 'Michigan State' }, awayTeam: { name: 'Monmouth' }, date: '2024-11-04' },
        { id: 'espn-623620', homeTeam: { id: '127', name: 'Michigan State' }, awayTeam: { name: 'Niagara' }, date: '2024-11-08' },
        { id: 'espn-623621', homeTeam: { name: 'Kentucky' }, awayTeam: { id: '127', name: 'Michigan State' }, date: '2024-11-12' },
        { id: 'espn-623622', homeTeam: { id: '127', name: 'Michigan State' }, awayTeam: { name: 'Bowling Green' }, date: '2024-11-15' },
        { id: 'espn-623623', homeTeam: { id: '127', name: 'Michigan State' }, awayTeam: { name: 'Samford' }, date: '2024-11-22' }
      ]);

      // Historical DB has 2 games already processed
      mockHistoricalGameRepo.getGamesByDateRange.mockResolvedValue([
        { id: 'espn-623619' },
        { id: 'espn-623620' }
      ]);

      mockReconciliationLogRepo.completeReconciliation.mockResolvedValue({});

      // Act
      const result = await service.reconcileGames(startDate, endDate);

      // Assert
      expect(mockReconciliationLogRepo.startReconciliation).toHaveBeenCalled();
      expect(mockESPNAPIClient.getGamesByDateRange).toHaveBeenCalledWith(startDate, endDate);
      expect(mockHistoricalGameRepo.getGamesByDateRange).toHaveBeenCalledWith(startDate, endDate);
      expect(result.gamesFound).toBe(5);
      expect(result.missingGames).toBe(3); // 3 games need to be backfilled
    });
  });

  describe('reconcileRecentGames', () => {
    it('should reconcile games from the last N days', async () => {
      // Arrange
      const days = 7;
      
      mockReconciliationLogRepo.startReconciliation.mockResolvedValue({
        id: 'recon-456'
      });

      mockESPNAPIClient.getGamesByDateRange.mockResolvedValue([]);
      mockHistoricalGameRepo.getGamesByDateRange.mockResolvedValue([]);
      mockReconciliationLogRepo.completeReconciliation.mockResolvedValue({});

      // Act
      const result = await service.reconcileRecentGames(days);

      // Assert
      expect(mockReconciliationLogRepo.startReconciliation).toHaveBeenCalled();
      expect(mockESPNAPIClient.getGamesByDateRange).toHaveBeenCalled();
      
      // Verify date range is approximately last 7 days
      const call = mockESPNAPIClient.getGamesByDateRange.mock.calls[0];
      const startDate = call[0];
      const endDate = call[1];
      
      const daysDiff = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBe(days);
    });
  });

  describe('identifyMissingGames', () => {
    it('should identify games in ESPN but not in historical DB', () => {
      // Arrange
      const espnGames = [
        { id: 'espn-1' },
        { id: 'espn-2' },
        { id: 'espn-3' }
      ];

      const processedGames = [
        { id: 'espn-1' }
      ];

      // Act
      const missing = service.identifyMissingGames(espnGames, processedGames);

      // Assert
      expect(missing).toHaveLength(2);
      expect(missing[0].id).toBe('espn-2');
      expect(missing[1].id).toBe('espn-3');
    });

    it('should return empty array when all games are processed', () => {
      // Arrange
      const espnGames = [
        { id: 'espn-1' },
        { id: 'espn-2' }
      ];

      const processedGames = [
        { id: 'espn-1' },
        { id: 'espn-2' }
      ];

      // Act
      const missing = service.identifyMissingGames(espnGames, processedGames);

      // Assert
      expect(missing).toHaveLength(0);
    });
  });

  describe('backfillGame', () => {
    it('should backfill a single game using StatBroadcast XML data', async () => {
      // Arrange
      const espnGame = {
        id: 'espn-623621',
        homeTeam: { id: '96', name: 'Kentucky' },
        awayTeam: { id: '127', name: 'Michigan State' },
        date: '2024-11-12'
      };

      // Mock discovering the StatBroadcast game ID
      mockGameIdDiscoveryService.discoverGameId.mockResolvedValue({
        statbroadcastGameId: '623621',
        confidence: 0.95
      });

      // Mock fetching XML
      const mockXML = '<bbgame><venue><gameid>623621</gameid></venue></bbgame>';
      mockStatBroadcastClient.fetchGameXML.mockResolvedValue(mockXML);

      // Mock parsing XML
      mockXMLGameParser.parseGameXML.mockResolvedValue({
        metadata: {
          gameId: '623621',
          homeId: '96',
          homeName: 'Kentucky',
          visitorId: '127',
          visitorName: 'Michigan State',
          date: '11/12/2024'
        },
        status: { complete: true },
        teams: {
          home: { id: '96', name: 'Kentucky', score: 86, stats: { fgPct: 48.5 } },
          visitor: { id: '127', name: 'Michigan State', score: 77, stats: { fgPct: 42.1 } }
        }
      });

      mockHistoricalGameRepo.saveGame.mockResolvedValue({});

      // Act
      const result = await service.backfillGame(espnGame);

      // Assert
      expect(mockGameIdDiscoveryService.discoverGameId).toHaveBeenCalledWith(espnGame);
      expect(mockStatBroadcastClient.fetchGameXML).toHaveBeenCalledWith('623621');
      expect(mockXMLGameParser.parseGameXML).toHaveBeenCalledWith(mockXML);
      expect(mockHistoricalGameRepo.saveGame).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.statbroadcastGameId).toBe('623621');
    });

    it('should handle games where StatBroadcast ID cannot be discovered', async () => {
      // Arrange
      const espnGame = {
        id: 'espn-999',
        homeTeam: { name: 'Unknown Team' },
        awayTeam: { name: 'Another Team' },
        date: '2024-01-15'
      };

      mockGameIdDiscoveryService.discoverGameId.mockResolvedValue(null);

      // Act
      const result = await service.backfillGame(espnGame);

      // Assert
      expect(result.success).toBe(false);
      expect(result.reason).toContain('StatBroadcast ID not found');
      expect(mockStatBroadcastClient.fetchGameXML).not.toHaveBeenCalled();
    });

    it('should handle XML fetch failures gracefully', async () => {
      // Arrange
      const espnGame = {
        id: 'espn-123',
        homeTeam: { name: 'Duke' },
        awayTeam: { name: 'UNC' },
        date: '2024-01-15'
      };

      mockGameIdDiscoveryService.discoverGameId.mockResolvedValue({
        statbroadcastGameId: 'sb-456'
      });

      mockStatBroadcastClient.fetchGameXML.mockRejectedValue(
        new Error('HTTP 404')
      );

      // Act
      const result = await service.backfillGame(espnGame);

      // Assert
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Failed to fetch XML');
    });

    it('should skip duplicate games that are already in the database', async () => {
      // Arrange
      const espnGame = {
        id: 'espn-623619',
        homeTeam: { id: '127', name: 'Michigan State' },
        awayTeam: { name: 'Monmouth' },
        date: '2024-11-04'
      };

      mockGameIdDiscoveryService.discoverGameId.mockResolvedValue({
        statbroadcastGameId: '623619'
      });

      mockStatBroadcastClient.fetchGameXML.mockResolvedValue('<xml>data</xml>');
      mockXMLGameParser.parseGameXML.mockResolvedValue({
        metadata: { gameId: '623619' },
        status: { complete: true },
        teams: { home: { score: 81 }, visitor: { score: 57 } }
      });

      // Simulate duplicate error
      mockHistoricalGameRepo.saveGame.mockRejectedValue(
        new Error('UNIQUE constraint failed')
      );

      // Act
      const result = await service.backfillGame(espnGame);

      // Assert
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already in database');
    });
  });

  describe('backfillBatch', () => {
    it('should backfill multiple games with rate limiting', async () => {
      // Arrange
      const games = [
        { id: 'espn-1', homeTeam: { name: 'Duke' }, awayTeam: { name: 'UNC' } },
        { id: 'espn-2', homeTeam: { name: 'Kansas' }, awayTeam: { name: 'Kentucky' } }
      ];

      mockGameIdDiscoveryService.discoverGameId.mockResolvedValue({
        statbroadcastGameId: 'sb-123'
      });

      mockStatBroadcastClient.fetchGameXML.mockResolvedValue('<xml>data</xml>');

      mockXMLGameParser.parseGameXML.mockResolvedValue({
        metadata: { gameId: 'sb-123' },
        status: { complete: true },
        teams: {
          home: { score: 80, stats: {} },
          visitor: { score: 75, stats: {} }
        }
      });

      mockHistoricalGameRepo.saveGame.mockResolvedValue({});

      // Act
      const result = await service.backfillBatch(games);

      // Assert
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockHistoricalGameRepo.saveGame).toHaveBeenCalledTimes(2);
    });
  });
});
