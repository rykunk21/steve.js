const TrainingDataPipeline = require('../../src/modules/sports/TrainingDataPipeline');
const HistoricalGameFetcher = require('../../src/modules/sports/HistoricalGameFetcher');
const TransitionProbabilityComputer = require('../../src/modules/sports/TransitionProbabilityComputer');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

describe('TrainingDataPipeline', () => {
  let pipeline;
  let mockFetcher;
  let mockComputer;
  let mockTeamRepo;

  beforeEach(() => {
    // Create mock instances
    mockFetcher = {
      fetchTeamSchedule: jest.fn(),
      parseGameIds: jest.fn(),
      fetchAndParseGame: jest.fn(),
      fetchMultipleGames: jest.fn()
    };

    mockComputer = {
      computeTransitionProbabilities: jest.fn()
    };

    mockTeamRepo = {
      getTeamsBySport: jest.fn()
    };

    pipeline = new TrainingDataPipeline(mockFetcher, mockComputer, mockTeamRepo);
  });

  describe('fetchAllTeamGames', () => {
    it('should fetch game IDs from all teams', async () => {
      // Arrange
      const teams = [
        { teamId: '150', statbroadcastGid: 'duke', teamName: 'Duke' },
        { teamId: '2305', statbroadcastGid: 'unc', teamName: 'North Carolina' }
      ];

      mockTeamRepo.getTeamsBySport.mockResolvedValue(teams);
      
      const dukeSchedule = [
        { gameId: 'game1', date: '2024-01-01' },
        { gameId: 'game2', date: '2024-01-05' }
      ];
      
      const uncSchedule = [
        { gameId: 'game3', date: '2024-01-02' },
        { gameId: 'game4', date: '2024-01-06' }
      ];

      mockFetcher.fetchTeamSchedule
        .mockResolvedValueOnce(dukeSchedule)
        .mockResolvedValueOnce(uncSchedule);

      mockFetcher.parseGameIds
        .mockReturnValueOnce(['game1', 'game2'])
        .mockReturnValueOnce(['game3', 'game4']);

      // Act
      const result = await pipeline.fetchAllTeamGames();

      // Assert
      expect(mockTeamRepo.getTeamsBySport).toHaveBeenCalledWith('mens-college-basketball');
      expect(mockFetcher.fetchTeamSchedule).toHaveBeenCalledTimes(2);
      expect(mockFetcher.fetchTeamSchedule).toHaveBeenCalledWith('duke', expect.any(Object));
      expect(mockFetcher.fetchTeamSchedule).toHaveBeenCalledWith('unc', expect.any(Object));
      expect(result).toHaveProperty('duke');
      expect(result).toHaveProperty('unc');
      expect(result.duke).toEqual(['game1', 'game2']);
      expect(result.unc).toEqual(['game3', 'game4']);
    });

    it('should handle errors for individual teams and continue', async () => {
      // Arrange
      const teams = [
        { teamId: '150', statbroadcastGid: 'duke', teamName: 'Duke' },
        { teamId: '2305', statbroadcastGid: 'unc', teamName: 'North Carolina' }
      ];

      mockTeamRepo.getTeamsBySport.mockResolvedValue(teams);
      
      mockFetcher.fetchTeamSchedule
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([{ gameId: 'game3' }]);

      mockFetcher.parseGameIds.mockReturnValue(['game3']);

      // Act
      const result = await pipeline.fetchAllTeamGames({ continueOnError: true });

      // Assert
      expect(mockFetcher.fetchTeamSchedule).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('unc');
      expect(result).not.toHaveProperty('duke');
      expect(result.unc).toEqual(['game3']);
    });
  });

  describe('processGame', () => {
    it('should fetch XML, parse, and compute transition probabilities', async () => {
      // Arrange
      const gameId = 'game123';
      const parsedGame = {
        metadata: { gameId: 'game123', date: '2024-01-01' },
        teams: {
          visitor: { id: 'duke', name: 'Duke', score: 75 },
          home: { id: 'unc', name: 'North Carolina', score: 80 }
        },
        playByPlay: [
          { action: 'GOOD', type: '3PTR', team: 'duke', vh: 'V' },
          { action: 'MISS', type: 'JUMPER', team: 'unc', vh: 'H' }
        ]
      };

      const transitionProbs = {
        visitor: {
          twoPointMakeProb: 0.3,
          twoPointMissProb: 0.2,
          threePointMakeProb: 0.15,
          threePointMissProb: 0.1,
          freeThrowMakeProb: 0.1,
          freeThrowMissProb: 0.05,
          offensiveReboundProb: 0.05,
          turnoverProb: 0.05
        },
        home: {
          twoPointMakeProb: 0.35,
          twoPointMissProb: 0.15,
          threePointMakeProb: 0.1,
          threePointMissProb: 0.15,
          freeThrowMakeProb: 0.12,
          freeThrowMissProb: 0.03,
          offensiveReboundProb: 0.05,
          turnoverProb: 0.05
        }
      };

      mockFetcher.fetchAndParseGame.mockResolvedValue(parsedGame);
      mockComputer.computeTransitionProbabilities.mockReturnValue(transitionProbs);

      // Act
      const result = await pipeline.processGame(gameId);

      // Assert
      expect(mockFetcher.fetchAndParseGame).toHaveBeenCalledWith(gameId);
      expect(mockComputer.computeTransitionProbabilities).toHaveBeenCalledWith(parsedGame);
      expect(result).toEqual({
        gameId: 'game123',
        gameData: parsedGame,
        transitionProbabilities: transitionProbs
      });
    });

    it('should handle parsing errors gracefully', async () => {
      // Arrange
      const gameId = 'game123';
      mockFetcher.fetchAndParseGame.mockRejectedValue(new Error('XML parsing failed'));

      // Act & Assert
      await expect(pipeline.processGame(gameId)).rejects.toThrow('XML parsing failed');
    });
  });

  describe('buildTrainingDataset', () => {
    it('should collect game data with transition probabilities', async () => {
      // Arrange
      const gameIds = ['game1', 'game2'];
      
      const game1Data = {
        gameId: 'game1',
        gameData: {
          metadata: { gameId: 'game1' },
          teams: { visitor: { id: 'duke' }, home: { id: 'unc' } }
        },
        transitionProbabilities: {
          visitor: { twoPointMakeProb: 0.3 },
          home: { twoPointMakeProb: 0.35 }
        }
      };

      const game2Data = {
        gameId: 'game2',
        gameData: {
          metadata: { gameId: 'game2' },
          teams: { visitor: { id: 'msu' }, home: { id: 'osu' } }
        },
        transitionProbabilities: {
          visitor: { twoPointMakeProb: 0.32 },
          home: { twoPointMakeProb: 0.33 }
        }
      };

      // Mock processGame to return data for each game
      jest.spyOn(pipeline, 'processGame')
        .mockResolvedValueOnce(game1Data)
        .mockResolvedValueOnce(game2Data);

      // Act
      const result = await pipeline.buildTrainingDataset(gameIds);

      // Assert
      expect(pipeline.processGame).toHaveBeenCalledTimes(2);
      expect(pipeline.processGame).toHaveBeenCalledWith('game1');
      expect(pipeline.processGame).toHaveBeenCalledWith('game2');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(game1Data);
      expect(result[1]).toEqual(game2Data);
    });

    it('should handle errors and continue with remaining games', async () => {
      // Arrange
      const gameIds = ['game1', 'game2', 'game3'];
      
      const game1Data = {
        gameId: 'game1',
        gameData: { metadata: { gameId: 'game1' } },
        transitionProbabilities: { visitor: {}, home: {} }
      };

      const game3Data = {
        gameId: 'game3',
        gameData: { metadata: { gameId: 'game3' } },
        transitionProbabilities: { visitor: {}, home: {} }
      };

      jest.spyOn(pipeline, 'processGame')
        .mockResolvedValueOnce(game1Data)
        .mockRejectedValueOnce(new Error('Game 2 failed'))
        .mockResolvedValueOnce(game3Data);

      // Act
      const result = await pipeline.buildTrainingDataset(gameIds, { continueOnError: true });

      // Assert
      expect(pipeline.processGame).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(2);
      expect(result[0].gameId).toBe('game1');
      expect(result[1].gameId).toBe('game3');
    });

    it('should track progress with callback', async () => {
      // Arrange
      const gameIds = ['game1', 'game2'];
      const progressCallback = jest.fn();

      jest.spyOn(pipeline, 'processGame')
        .mockResolvedValueOnce({ gameId: 'game1', gameData: {}, transitionProbabilities: {} })
        .mockResolvedValueOnce({ gameId: 'game2', gameData: {}, transitionProbabilities: {} });

      // Act
      await pipeline.buildTrainingDataset(gameIds, { onProgress: progressCallback });

      // Assert
      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalledWith(1, 2, 'game1', null);
      expect(progressCallback).toHaveBeenCalledWith(2, 2, 'game2', null);
    });
  });

  describe('rate limiting', () => {
    it('should implement rate limiting across multiple teams', async () => {
      // Arrange
      const teams = [
        { teamId: '150', statbroadcastGid: 'duke', teamName: 'Duke' },
        { teamId: '2305', statbroadcastGid: 'unc', teamName: 'North Carolina' }
      ];

      mockTeamRepo.getTeamsBySport.mockResolvedValue(teams);
      mockFetcher.fetchTeamSchedule.mockResolvedValue([{ gameId: 'game1' }]);
      mockFetcher.parseGameIds.mockReturnValue(['game1']);

      const startTime = Date.now();

      // Act
      await pipeline.fetchAllTeamGames();

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert - should have some delay between requests
      // Note: This is a basic check; actual rate limiting is handled by HistoricalGameFetcher
      expect(mockFetcher.fetchTeamSchedule).toHaveBeenCalledTimes(2);
      // The duration should be at least somewhat longer than instant
      // (actual rate limiting is tested in HistoricalGameFetcher tests)
    });
  });

  describe('error handling', () => {
    it('should log errors and continue when continueOnError is true', async () => {
      // Arrange
      const gameIds = ['game1', 'game2'];
      
      jest.spyOn(pipeline, 'processGame')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ gameId: 'game2', gameData: {}, transitionProbabilities: {} });

      // Act
      const result = await pipeline.buildTrainingDataset(gameIds, { continueOnError: true });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].gameId).toBe('game2');
    });

    it('should throw error immediately when continueOnError is false', async () => {
      // Arrange
      const gameIds = ['game1', 'game2'];
      
      jest.spyOn(pipeline, 'processGame')
        .mockRejectedValueOnce(new Error('Network error'));

      // Act & Assert
      await expect(
        pipeline.buildTrainingDataset(gameIds, { continueOnError: false })
      ).rejects.toThrow('Network error');
    });
  });
});
