const TransitionProbabilityExtractor = require('../../src/modules/sports/TransitionProbabilityExtractor');
const XMLGameParser = require('../../src/modules/sports/XMLGameParser');
const TransitionProbabilityComputer = require('../../src/modules/sports/TransitionProbabilityComputer');
const HistoricalGameFetcher = require('../../src/modules/sports/HistoricalGameFetcher');
const GameIdsRepository = require('../../src/database/repositories/GameIdsRepository');

// Mock dependencies
jest.mock('../../src/modules/sports/XMLGameParser');
jest.mock('../../src/modules/sports/TransitionProbabilityComputer');
jest.mock('../../src/modules/sports/HistoricalGameFetcher');
jest.mock('../../src/database/repositories/GameIdsRepository');

describe('TransitionProbabilityExtractor', () => {
  let extractor;
  let mockXMLParser;
  let mockProbabilityComputer;
  let mockGameFetcher;
  let mockGameIdsRepo;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockXMLParser = {
      parseGameXML: jest.fn()
    };
    mockProbabilityComputer = {
      computeTransitionProbabilities: jest.fn()
    };
    mockGameFetcher = {
      fetchGameXML: jest.fn()
    };
    mockGameIdsRepo = {
      getGameById: jest.fn(),
      saveTransitionProbabilities: jest.fn(),
      getGamesWithoutLabels: jest.fn(),
      count: jest.fn()
    };

    // Mock constructors
    XMLGameParser.mockImplementation(() => mockXMLParser);
    TransitionProbabilityComputer.mockImplementation(() => mockProbabilityComputer);
    HistoricalGameFetcher.mockImplementation(() => mockGameFetcher);
    GameIdsRepository.mockImplementation(() => mockGameIdsRepo);

    extractor = new TransitionProbabilityExtractor();
  });

  describe('convertToVector', () => {
    it('should convert transition probabilities to 8-dimensional vector', () => {
      const probabilities = {
        twoPointMakeProb: 0.25,
        twoPointMissProb: 0.15,
        threePointMakeProb: 0.10,
        threePointMissProb: 0.20,
        freeThrowMakeProb: 0.08,
        freeThrowMissProb: 0.02,
        offensiveReboundProb: 0.12,
        turnoverProb: 0.08
      };

      const vector = extractor.convertToVector(probabilities);

      expect(vector).toHaveLength(8);
      expect(vector).toEqual([0.25, 0.15, 0.10, 0.20, 0.08, 0.02, 0.12, 0.08]);
    });

    it('should handle missing probabilities with zeros', () => {
      const probabilities = {
        twoPointMakeProb: 0.5,
        threePointMakeProb: 0.3
        // Missing other probabilities
      };

      const vector = extractor.convertToVector(probabilities);

      expect(vector).toHaveLength(8);
      expect(vector).toEqual([0.5, 0, 0.3, 0, 0, 0, 0, 0]);
    });
  });

  describe('validateTransitionVector', () => {
    it('should validate a proper transition vector', () => {
      const vector = [0.25, 0.15, 0.10, 0.20, 0.08, 0.02, 0.12, 0.08]; // sums to 1.0

      expect(() => {
        extractor.validateTransitionVector(vector, 'home');
      }).not.toThrow();
    });

    it('should throw error for wrong length vector', () => {
      const vector = [0.25, 0.15, 0.10]; // only 3 elements

      expect(() => {
        extractor.validateTransitionVector(vector, 'home');
      }).toThrow('Invalid transition vector for home team: must be 8-dimensional array');
    });

    it('should throw error for negative probabilities', () => {
      const vector = [0.25, -0.15, 0.10, 0.20, 0.08, 0.02, 0.12, 0.08];

      expect(() => {
        extractor.validateTransitionVector(vector, 'home');
      }).toThrow('Invalid probability at index 1 for home team');
    });

    it('should throw error for probabilities > 1.0', () => {
      const vector = [0.25, 1.5, 0.10, 0.20, 0.08, 0.02, 0.12, 0.08];

      expect(() => {
        extractor.validateTransitionVector(vector, 'home');
      }).toThrow('Invalid probability at index 1 for home team');
    });

    it('should throw error if vector does not sum to 1.0', () => {
      const vector = [0.25, 0.15, 0.10, 0.20, 0.08, 0.02, 0.12, 0.05]; // sums to 0.97

      expect(() => {
        extractor.validateTransitionVector(vector, 'home');
      }).toThrow('Transition vector for home team does not sum to 1.0');
    });
  });

  describe('extractGameTransitionProbabilities', () => {
    const mockGameData = {
      metadata: {
        gameId: 'test-game-123',
        date: '2024-01-15'
      },
      teams: {
        home: { name: 'Duke', id: 'duke' },
        visitor: { name: 'UNC', id: 'unc' }
      },
      playByPlay: []
    };

    const mockTransitionProbs = {
      home: {
        twoPointMakeProb: 0.25,
        twoPointMissProb: 0.15,
        threePointMakeProb: 0.10,
        threePointMissProb: 0.20,
        freeThrowMakeProb: 0.08,
        freeThrowMissProb: 0.02,
        offensiveReboundProb: 0.12,
        turnoverProb: 0.08
      },
      visitor: {
        twoPointMakeProb: 0.30,
        twoPointMissProb: 0.10,
        threePointMakeProb: 0.15,
        threePointMissProb: 0.15,
        freeThrowMakeProb: 0.10,
        freeThrowMissProb: 0.05,
        offensiveReboundProb: 0.10,
        turnoverProb: 0.05
      }
    };

    beforeEach(() => {
      mockGameFetcher.fetchGameXML.mockResolvedValue('<xml>mock data</xml>');
      mockXMLParser.parseGameXML.mockResolvedValue(mockGameData);
      mockProbabilityComputer.computeTransitionProbabilities.mockReturnValue(mockTransitionProbs);
    });

    it('should successfully extract transition probabilities for a game', async () => {
      const result = await extractor.extractGameTransitionProbabilities('test-game-123');

      expect(mockGameFetcher.fetchGameXML).toHaveBeenCalledWith('test-game-123');
      expect(mockXMLParser.parseGameXML).toHaveBeenCalledWith('<xml>mock data</xml>');
      expect(mockProbabilityComputer.computeTransitionProbabilities).toHaveBeenCalledWith(mockGameData);

      expect(result).toHaveProperty('home');
      expect(result).toHaveProperty('away');
      expect(result).toHaveProperty('metadata');

      expect(result.home).toHaveLength(8);
      expect(result.away).toHaveLength(8);
      expect(result.metadata.gameId).toBe('test-game-123');
      expect(result.metadata.homeTeam).toBe('Duke');
      expect(result.metadata.awayTeam).toBe('UNC');
    });

    it('should throw error if XML data is not found', async () => {
      mockGameFetcher.fetchGameXML.mockResolvedValue(null);

      await expect(extractor.extractGameTransitionProbabilities('test-game-123'))
        .rejects.toThrow('No XML data found for game test-game-123');
    });

    it('should throw error if game data is invalid', async () => {
      mockXMLParser.parseGameXML.mockResolvedValue(null);

      await expect(extractor.extractGameTransitionProbabilities('test-game-123'))
        .rejects.toThrow('Invalid game data structure for game test-game-123');
    });

    it('should throw error if transition probabilities computation fails', async () => {
      mockProbabilityComputer.computeTransitionProbabilities.mockReturnValue(null);

      await expect(extractor.extractGameTransitionProbabilities('test-game-123'))
        .rejects.toThrow('Failed to compute transition probabilities for game test-game-123');
    });
  });

  describe('getExtractionStatistics', () => {
    it('should return extraction statistics', async () => {
      mockGameIdsRepo.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(75)  // extracted
        .mockResolvedValueOnce(25)  // pending
        .mockResolvedValueOnce(60); // processed

      const stats = await extractor.getExtractionStatistics();

      expect(stats).toEqual({
        total: 100,
        extracted: 75,
        pending: 25,
        processed: 60,
        extractionRate: '75.00',
        processingRate: '60.00'
      });
    });

    it('should handle zero total games', async () => {
      mockGameIdsRepo.count.mockResolvedValue(0);

      const stats = await extractor.getExtractionStatistics();

      expect(stats.extractionRate).toBe(0);
      expect(stats.processingRate).toBe(0);
    });
  });

  describe('extractAllPendingTransitionProbabilities', () => {
    it('should return early if no pending games', async () => {
      mockGameIdsRepo.getGamesWithoutLabels.mockResolvedValue([]);

      const result = await extractor.extractAllPendingTransitionProbabilities();

      expect(result).toEqual({
        processed: 0,
        failed: 0,
        skipped: 0,
        errors: []
      });
    });

    it('should process pending games', async () => {
      const pendingGames = [
        { gameId: 'game1' },
        { gameId: 'game2' }
      ];

      mockGameIdsRepo.getGamesWithoutLabels.mockResolvedValue(pendingGames);
      mockGameIdsRepo.getGameById.mockResolvedValue(null); // No existing games

      // Mock successful extraction
      mockGameFetcher.fetchGameXML.mockResolvedValue('<xml>data</xml>');
      mockXMLParser.parseGameXML.mockResolvedValue({
        metadata: { gameId: 'test', date: '2024-01-15' },
        teams: { home: { name: 'A' }, visitor: { name: 'B' } }
      });
      mockProbabilityComputer.computeTransitionProbabilities.mockReturnValue({
        home: {
          twoPointMakeProb: 0.25, twoPointMissProb: 0.15, threePointMakeProb: 0.10,
          threePointMissProb: 0.20, freeThrowMakeProb: 0.08, freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.12, turnoverProb: 0.08
        },
        visitor: {
          twoPointMakeProb: 0.30, twoPointMissProb: 0.10, threePointMakeProb: 0.15,
          threePointMissProb: 0.15, freeThrowMakeProb: 0.10, freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.10, turnoverProb: 0.05
        }
      });

      mockGameIdsRepo.saveTransitionProbabilities.mockResolvedValue({});

      const result = await extractor.extractAllPendingTransitionProbabilities({
        batchSize: 1
      });

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockGameIdsRepo.saveTransitionProbabilities).toHaveBeenCalledTimes(2);
    });
  });
});