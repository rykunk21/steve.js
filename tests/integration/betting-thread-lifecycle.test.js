/**
 * Integration test for betting thread lifecycle
 * Tests core betting thread creation, deletion, and display functionality
 * 
 * NOTE: Implementation uses ESPN Scoreboard API odds (not ActionNetwork scraping)
 * ESPN provides odds directly in the game data response
 * 
 * Requirements Covered:
 * - Requirement 1.5: Admin creates betting thread for selected game
 * - Requirement 1A.2: Create thread button functionality
 * - Requirement 1A.4: Delete thread button functionality  
 * - Requirement 2.8: Handle missing odds gracefully
 * - Requirement 2B1.1-3: Thread title formatting (home/away favored)
 * - Requirement 2B1.5: Thread title shows "Odds Pending" when unavailable
 * - Requirement 2C.1: Visual spread bar display
 * - Requirement 2C.8: Odds pending display
 */

const BettingThreadManager = require('../../src/modules/sports/BettingThreadManager');
const { ChannelType } = require('discord.js');

describe('Betting Thread Lifecycle Integration Tests', () => {
  let threadManager;
  let mockGuild;
  let mockForumChannel;
  let mockThread;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock thread
    mockThread = {
      id: 'thread-123',
      name: 'Test Thread',
      send: jest.fn().mockResolvedValue({
        id: 'message-123',
        edit: jest.fn().mockResolvedValue(true),
        pin: jest.fn().mockResolvedValue(true)
      }),
      delete: jest.fn().mockResolvedValue(true),
      setName: jest.fn().mockResolvedValue(true)
    };

    // Mock forum channel
    mockForumChannel = {
      id: 'forum-123',
      name: 'nfl-betting',
      type: ChannelType.GuildForum,
      threads: {
        create: jest.fn().mockResolvedValue(mockThread),
        fetchActive: jest.fn().mockResolvedValue({
          threads: new Map()
        }),
        fetch: jest.fn().mockResolvedValue(mockThread)
      }
    };

    // Mock guild
    mockGuild = {
      id: 'guild-123',
      channels: {
        cache: new Map([['forum-123', mockForumChannel]]),
        fetch: jest.fn().mockResolvedValue(mockForumChannel)
      }
    };

    // Create thread manager with mocked dependencies
    threadManager = new BettingThreadManager();
    
    // Mock ESPN client with odds data from ESPN Scoreboard API
    threadManager.espnClient = {
      getUpcomingGames: jest.fn().mockResolvedValue([
        {
          id: 'game-123',
          sport: 'nfl',
          displayName: 'Chiefs @ Bills',
          date: new Date('2025-11-28T18:00:00Z'),
          teams: {
            away: {
              id: '12',
              name: 'Kansas City Chiefs',
              abbreviation: 'KC',
              logo: 'https://example.com/kc.png',
              color: '#E31837'
            },
            home: {
              id: '2',
              name: 'Buffalo Bills',
              abbreviation: 'BUF',
              logo: 'https://example.com/buf.png',
              color: '#00338D'
            }
          },
          venue: 'Highmark Stadium',
          status: 'scheduled',
          // ESPN Scoreboard API provides odds directly
          odds: {
            provider: 'ESPN BET',
            spread: -3.5,
            spreadOdds: {
              home: { line: '-3.5', odds: '-110' },
              away: { line: '+3.5', odds: '-110' }
            },
            moneyline: {
              home: '-180',
              away: '+150'
            },
            total: 47.5,
            totalOdds: {
              over: { odds: '-110' },
              under: { odds: '-110' }
            }
          }
        }
      ])
    };

    // Mock database
    threadManager.db = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([])
      })
    };
  });

  describe('Thread Creation - Requirement 1.5, 1A.2, 2.1', () => {
    test('should create betting thread with odds data', async () => {
      const thread = await threadManager.createBettingThread(mockGuild, 'nfl', 'game-123');

      // Verify thread was created
      expect(thread).toBeTruthy();
      expect(thread.id).toBe('thread-123');

      // Verify forum channel was used
      expect(mockForumChannel.threads.create).toHaveBeenCalled();

      // Verify thread title format (Requirement 2B1.1)
      const createCall = mockForumChannel.threads.create.mock.calls[0][0];
      expect(createCall.name).toMatch(/KC @ BUF \|/);
      expect(createCall.name).toContain('BUF -3.5');
    });

    test('should send spread bar as first message - Requirement 2C.1', async () => {
      const thread = await threadManager.createBettingThread(mockGuild, 'nfl', 'game-123');

      // Verify spread bar message was sent
      expect(mockThread.send).toHaveBeenCalled();
      
      const firstSendCall = mockThread.send.mock.calls[0][0];
      
      // Should contain emoji squares (Requirement 2C.2)
      expect(firstSendCall).toMatch(/🟦|🟥|🟧|🟨|🟩|🟪|🟫|⬜|⬛/);
    });

    test('should handle missing odds gracefully - Requirement 2.8, 2B1.5, 2C.8', async () => {
      // Mock ESPN game data without odds
      threadManager.espnClient.getUpcomingGames = jest.fn().mockResolvedValue([
        {
          id: 'game-456',
          sport: 'nfl',
          displayName: 'Packers @ Lions',
          date: new Date('2025-11-28T18:00:00Z'),
          teams: {
            away: {
              id: '9',
              name: 'Green Bay Packers',
              abbreviation: 'GB',
              logo: 'https://example.com/gb.png'
            },
            home: {
              id: '8',
              name: 'Detroit Lions',
              abbreviation: 'DET',
              logo: 'https://example.com/det.png'
            }
          },
          venue: 'Ford Field',
          status: 'scheduled',
          odds: null // ESPN doesn't have odds for this game
        }
      ]);

      const thread = await threadManager.createBettingThread(mockGuild, 'nfl', 'game-456');

      // Thread should still be created
      expect(thread).toBeTruthy();

      // Thread title should show "Odds Pending" (Requirement 2B1.5)
      const createCall = mockForumChannel.threads.create.mock.calls[0][0];
      expect(createCall.name).toContain('Odds Pending');
    });

    test('should not create duplicate threads - Requirement 1A.2', async () => {
      // Create first thread
      await threadManager.createBettingThread(mockGuild, 'nfl', 'game-123');
      
      // Verify thread is tracked
      expect(threadManager.hasThread('nfl', 'game-123')).toBe(true);

      // Attempt to create second thread
      const secondThread = await threadManager.createBettingThread(mockGuild, 'nfl', 'game-123');

      // Should return existing thread, not create new one
      expect(secondThread).toBe(null);
      expect(mockForumChannel.threads.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('Thread Deletion - Requirement 1A.4', () => {
    test('should delete existing betting thread', async () => {
      // Create thread first
      await threadManager.createBettingThread(mockGuild, 'nfl', 'game-123');
      
      // Verify thread exists
      expect(threadManager.hasThread('nfl', 'game-123')).toBe(true);

      // Delete thread
      const result = await threadManager.deleteBettingThread(mockGuild, 'nfl', 'game-123');

      // Verify deletion
      expect(result).toBe(true);
      expect(mockThread.delete).toHaveBeenCalled();
      expect(threadManager.hasThread('nfl', 'game-123')).toBe(false);
    });

    test('should handle deletion of non-existent thread', async () => {
      // Attempt to delete thread that doesn't exist
      const result = await threadManager.deleteBettingThread(mockGuild, 'nfl', 'nonexistent-game');

      // Should return false without error
      expect(result).toBe(false);
      expect(mockThread.delete).not.toHaveBeenCalled();
    });

    test('should handle deletion when thread no longer exists in Discord', async () => {
      // Create thread
      await threadManager.createBettingThread(mockGuild, 'nfl', 'game-123');

      // Mock thread.delete to throw error (thread already deleted in Discord)
      mockThread.delete.mockRejectedValue(new Error('Unknown Channel'));

      // Delete thread
      const result = await threadManager.deleteBettingThread(mockGuild, 'nfl', 'game-123');

      // Should still clean up tracking
      expect(result).toBe(true);
      expect(threadManager.hasThread('nfl', 'game-123')).toBe(false);
    });
  });

  describe('Thread Tracking', () => {
    test('should track multiple threads across different sports', async () => {
      // Mock NFL and NBA games with ESPN odds
      threadManager.espnClient.getUpcomingGames = jest.fn()
        .mockResolvedValueOnce([{
          id: 'game-nfl-1',
          sport: 'nfl',
          displayName: 'Chiefs @ Bills',
          date: new Date(),
          teams: {
            away: { id: '12', name: 'Kansas City Chiefs', abbreviation: 'KC', logo: 'https://example.com/kc.png' },
            home: { id: '2', name: 'Buffalo Bills', abbreviation: 'BUF', logo: 'https://example.com/buf.png' }
          },
          venue: 'Highmark Stadium',
          status: 'scheduled',
          odds: {
            provider: 'ESPN BET',
            spread: -3.5,
            spreadOdds: { home: { line: '-3.5', odds: '-110' }, away: { line: '+3.5', odds: '-110' } },
            moneyline: { home: '-180', away: '+150' },
            total: 47.5
          }
        }])
        .mockResolvedValueOnce([{
          id: 'game-nba-1',
          sport: 'nba',
          displayName: 'Lakers @ Celtics',
          date: new Date(),
          teams: {
            away: { id: '13', name: 'Los Angeles Lakers', abbreviation: 'LAL', logo: 'https://example.com/lal.png' },
            home: { id: '2', name: 'Boston Celtics', abbreviation: 'BOS', logo: 'https://example.com/bos.png' }
          },
          venue: 'TD Garden',
          status: 'scheduled',
          odds: {
            provider: 'ESPN BET',
            spread: -5.5,
            spreadOdds: { home: { line: '-5.5', odds: '-110' }, away: { line: '+5.5', odds: '-110' } },
            moneyline: { home: '-220', away: '+180' },
            total: 225.5
          }
        }]);

      // Create threads for different sports
      await threadManager.createBettingThread(mockGuild, 'nfl', 'game-nfl-1');
      await threadManager.createBettingThread(mockGuild, 'nba', 'game-nba-1');

      // Verify both are tracked
      expect(threadManager.hasThread('nfl', 'game-nfl-1')).toBe(true);
      expect(threadManager.hasThread('nba', 'game-nba-1')).toBe(true);
    });

    test('should refresh thread tracking from existing forum channels', async () => {
      // Mock existing threads in forum
      const existingThreads = new Map([
        ['existing-thread-1', { id: 'existing-thread-1', name: 'KC @ BUF | BUF -3.5' }],
        ['existing-thread-2', { id: 'existing-thread-2', name: 'GB @ DET | DET -7' }]
      ]);

      mockForumChannel.threads.fetchActive.mockResolvedValue({
        threads: existingThreads
      });

      // Refresh tracking
      await threadManager.refreshThreadTracking(mockGuild);

      // Verify threads were tracked
      expect(threadManager.createdThreads.size).toBeGreaterThan(0);
    });
  });

  describe('Odds Conversion', () => {
    test('should convert ESPN odds to BettingSnapshot format', () => {
      const gameData = {
        id: 'game-123',
        sport: 'nfl',
        teams: {
          away: { abbreviation: 'KC' },
          home: { abbreviation: 'BUF' }
        }
      };

      const odds = {
        spread: -3.5,
        spreadOdds: {
          home: { line: '-3.5', odds: '-110' },
          away: { line: '+3.5', odds: '-110' }
        },
        moneyline: {
          home: '-180',
          away: '+150'
        },
        total: 47.5,
        totalOdds: {
          over: { odds: '-110' },
          under: { odds: '-110' }
        }
      };

      const snapshot = threadManager.convertESPNOddsToBettingSnapshot(gameData, odds);

      // Verify conversion
      expect(snapshot.homeSpread).toBe(-3.5);
      expect(snapshot.awaySpread).toBe(3.5);
      expect(snapshot.homeMoneyline).toBe('-180');
      expect(snapshot.awayMoneyline).toBe('+150');
      expect(snapshot.total).toBe(47.5);
    });

    test('should handle spread sign correctly - Requirement 2B1.2, 2B1.3', () => {
      const gameData = {
        id: 'game-123',
        sport: 'nfl',
        teams: {
          away: { abbreviation: 'KC' },
          home: { abbreviation: 'BUF' }
        }
      };

      // Home team favored (negative spread)
      const homeFavoredOdds = {
        spread: -3.5,
        spreadOdds: {
          home: { line: '-3.5', odds: '-110' },
          away: { line: '+3.5', odds: '-110' }
        }
      };

      const snapshot1 = threadManager.convertESPNOddsToBettingSnapshot(gameData, homeFavoredOdds);
      expect(snapshot1.homeSpread).toBe(-3.5);
      expect(snapshot1.awaySpread).toBe(3.5);

      // Away team favored (positive home spread)
      const awayFavoredOdds = {
        spread: 2.5,
        spreadOdds: {
          home: { line: '+2.5', odds: '-110' },
          away: { line: '-2.5', odds: '-110' }
        }
      };

      const snapshot2 = threadManager.convertESPNOddsToBettingSnapshot(gameData, awayFavoredOdds);
      expect(snapshot2.homeSpread).toBe(2.5);
      expect(snapshot2.awaySpread).toBe(-2.5);
    });
  });
});
