const HistoricalGameFetcher = require('../../src/modules/sports/HistoricalGameFetcher');
const StatBroadcastClient = require('../../src/modules/sports/StatBroadcastClient');
const XMLGameParser = require('../../src/modules/sports/XMLGameParser');

describe('HistoricalGameFetcher', () => {
  let fetcher;
  let mockClient;
  let mockParser;

  beforeEach(() => {
    // Create mock instances
    mockClient = {
      getTeamSchedule: jest.fn(),
      fetchGameXML: jest.fn()
    };

    mockParser = {
      parseGameXML: jest.fn()
    };

    fetcher = new HistoricalGameFetcher(mockClient, mockParser);
  });

  describe('fetchTeamSchedule', () => {
    test('should fetch schedule from StatBroadcast endpoint', async () => {
      // Arrange
      const teamGid = 'duke';
      const mockSchedule = [
        { gameId: '123456', date: '2024-11-15', opponent: 'UNC' },
        { gameId: '123457', date: '2024-11-18', opponent: 'Kentucky' }
      ];

      mockClient.getTeamSchedule.mockResolvedValue(mockSchedule);

      // Act
      const result = await fetcher.fetchTeamSchedule(teamGid);

      // Assert
      expect(mockClient.getTeamSchedule).toHaveBeenCalledWith(teamGid, {});
      expect(result).toEqual(mockSchedule);
      expect(result).toHaveLength(2);
    });

    test('should pass options to StatBroadcast client', async () => {
      // Arrange
      const teamGid = 'msu';
      const options = {
        startDate: '2024-11-01',
        endDate: '2024-11-30'
      };

      mockClient.getTeamSchedule.mockResolvedValue([]);

      // Act
      await fetcher.fetchTeamSchedule(teamGid, options);

      // Assert
      expect(mockClient.getTeamSchedule).toHaveBeenCalledWith(teamGid, options);
    });

    test('should handle schedule fetch failures', async () => {
      // Arrange
      const teamGid = 'invalid-team';
      mockClient.getTeamSchedule.mockRejectedValue(new Error('Team not found'));

      // Act & Assert
      await expect(fetcher.fetchTeamSchedule(teamGid)).rejects.toThrow('Team not found');
    });
  });

  describe('parseGameIds', () => {
    test('should extract game IDs from schedule response', () => {
      // Arrange
      const schedule = [
        { gameId: '123456', date: '2024-11-15', opponent: 'UNC' },
        { gameId: '123457', date: '2024-11-18', opponent: 'Kentucky' },
        { gameId: '123458', date: '2024-11-20', opponent: 'Duke' }
      ];

      // Act
      const gameIds = fetcher.parseGameIds(schedule);

      // Assert
      expect(gameIds).toEqual(['123456', '123457', '123458']);
      expect(gameIds).toHaveLength(3);
    });

    test('should handle empty schedule', () => {
      // Arrange
      const schedule = [];

      // Act
      const gameIds = fetcher.parseGameIds(schedule);

      // Assert
      expect(gameIds).toEqual([]);
    });

    test('should filter out games without gameId', () => {
      // Arrange
      const schedule = [
        { gameId: '123456', date: '2024-11-15' },
        { date: '2024-11-18' }, // Missing gameId
        { gameId: '123458', date: '2024-11-20' }
      ];

      // Act
      const gameIds = fetcher.parseGameIds(schedule);

      // Assert
      expect(gameIds).toEqual(['123456', '123458']);
      expect(gameIds).toHaveLength(2);
    });
  });

  describe('constructXMLArchiveURL', () => {
    test('should construct XML archive URLs from game IDs', () => {
      // Arrange
      const gameId = '123456';

      // Act
      const url = fetcher.constructXMLArchiveURL(gameId);

      // Assert
      expect(url).toBe('http://archive.statbroadcast.com/123456.xml');
    });

    test('should handle numeric game IDs', () => {
      // Arrange
      const gameId = 123456;

      // Act
      const url = fetcher.constructXMLArchiveURL(gameId);

      // Assert
      expect(url).toBe('http://archive.statbroadcast.com/123456.xml');
    });
  });

  describe('fetchGameXML', () => {
    test('should fetch XML from archive', async () => {
      // Arrange
      const gameId = '123456';
      const mockXML = '<?xml version="1.0"?><bbgame></bbgame>';

      mockClient.fetchGameXML.mockResolvedValue(mockXML);

      // Act
      const result = await fetcher.fetchGameXML(gameId);

      // Assert
      expect(mockClient.fetchGameXML).toHaveBeenCalledWith(gameId);
      expect(result).toBe(mockXML);
    });

    test('should handle XML fetch failures', async () => {
      // Arrange
      const gameId = 'invalid-game';
      mockClient.fetchGameXML.mockRejectedValue(new Error('Game not found'));

      // Act & Assert
      await expect(fetcher.fetchGameXML(gameId)).rejects.toThrow('Game not found');
    });
  });

  describe('fetchAndParseGame', () => {
    test('should fetch and parse a complete game', async () => {
      // Arrange
      const gameId = '123456';
      const mockXML = '<?xml version="1.0"?><bbgame></bbgame>';
      const mockParsedGame = {
        metadata: { gameId: '123456', date: '2024-11-15' },
        teams: { home: {}, visitor: {} },
        playByPlay: []
      };

      mockClient.fetchGameXML.mockResolvedValue(mockXML);
      mockParser.parseGameXML.mockResolvedValue(mockParsedGame);

      // Act
      const result = await fetcher.fetchAndParseGame(gameId);

      // Assert
      expect(mockClient.fetchGameXML).toHaveBeenCalledWith(gameId);
      expect(mockParser.parseGameXML).toHaveBeenCalledWith(mockXML);
      expect(result).toEqual(mockParsedGame);
    });

    test('should handle parsing failures', async () => {
      // Arrange
      const gameId = '123456';
      const mockXML = 'invalid xml';

      mockClient.fetchGameXML.mockResolvedValue(mockXML);
      mockParser.parseGameXML.mockRejectedValue(new Error('Invalid XML'));

      // Act & Assert
      await expect(fetcher.fetchAndParseGame(gameId)).rejects.toThrow('Invalid XML');
    });
  });

  describe('rate limiting', () => {
    test('should implement rate limiting between schedule requests', async () => {
      // Arrange
      const teamGid1 = 'duke';
      const teamGid2 = 'unc';

      mockClient.getTeamSchedule.mockResolvedValue([]);

      // Act
      const start = Date.now();
      await fetcher.fetchTeamSchedule(teamGid1);
      await fetcher.fetchTeamSchedule(teamGid2);
      const elapsed = Date.now() - start;

      // Assert
      // Should have at least 1 second delay between requests
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });

    test('should implement rate limiting between game fetches', async () => {
      // Arrange
      const gameId1 = '123456';
      const gameId2 = '123457';

      mockClient.fetchGameXML.mockResolvedValue('<?xml version="1.0"?><bbgame></bbgame>');

      // Act
      const start = Date.now();
      await fetcher.fetchGameXML(gameId1);
      await fetcher.fetchGameXML(gameId2);
      const elapsed = Date.now() - start;

      // Assert
      // Should have at least 1 second delay between requests
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('error handling', () => {
    test('should handle network errors gracefully', async () => {
      // Arrange
      const teamGid = 'duke';
      mockClient.getTeamSchedule.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(fetcher.fetchTeamSchedule(teamGid)).rejects.toThrow('Network error');
    });

    test('should handle invalid team GID', async () => {
      // Arrange
      const teamGid = 'invalid-team-12345';
      mockClient.getTeamSchedule.mockRejectedValue(new Error('Invalid resource (redirect)'));

      // Act & Assert
      await expect(fetcher.fetchTeamSchedule(teamGid)).rejects.toThrow('Invalid resource');
    });

    test('should handle XML parsing errors', async () => {
      // Arrange
      const gameId = '123456';
      mockClient.fetchGameXML.mockResolvedValue('invalid xml content');
      mockParser.parseGameXML.mockRejectedValue(new Error('XML parsing failed'));

      // Act & Assert
      await expect(fetcher.fetchAndParseGame(gameId)).rejects.toThrow('XML parsing failed');
    });
  });

  describe('batch operations', () => {
    test('should fetch multiple games with rate limiting', async () => {
      // Arrange
      const gameIds = ['123456', '123457', '123458'];
      const mockXML = '<?xml version="1.0"?><bbgame></bbgame>';
      const mockParsedGame = {
        metadata: { gameId: '123456' },
        teams: {},
        playByPlay: []
      };

      mockClient.fetchGameXML.mockResolvedValue(mockXML);
      mockParser.parseGameXML.mockResolvedValue(mockParsedGame);

      // Act
      const start = Date.now();
      const results = await fetcher.fetchMultipleGames(gameIds);
      const elapsed = Date.now() - start;

      // Assert
      expect(results).toHaveLength(3);
      // Should have at least 2 seconds delay for 3 requests (2 intervals)
      expect(elapsed).toBeGreaterThanOrEqual(2000);
    });

    test('should continue processing after individual game failures', async () => {
      // Arrange
      const gameIds = ['123456', '123457', '123458'];
      const mockXML = '<?xml version="1.0"?><bbgame></bbgame>';
      const mockParsedGame = {
        metadata: { gameId: '123456' },
        teams: {},
        playByPlay: []
      };

      mockClient.fetchGameXML
        .mockResolvedValueOnce(mockXML)
        .mockRejectedValueOnce(new Error('Game not found'))
        .mockResolvedValueOnce(mockXML);

      mockParser.parseGameXML.mockResolvedValue(mockParsedGame);

      // Act
      const results = await fetcher.fetchMultipleGames(gameIds, { continueOnError: true });

      // Assert
      expect(results).toHaveLength(2); // Only successful games
      expect(results.every(r => r !== null)).toBe(true);
    });
  });
});
