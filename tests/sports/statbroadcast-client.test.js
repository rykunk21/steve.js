const StatBroadcastClient = require('../../src/modules/sports/StatBroadcastClient');

describe('StatBroadcastClient', () => {
  let client;

  beforeEach(() => {
    client = new StatBroadcastClient();
  });

  describe('getTeamSchedule', () => {
    test('should fetch and parse team schedule', async () => {
      // This test will use a real request to StatBroadcast
      // Using Michigan State as a known team
      const schedule = await client.getTeamSchedule('msu', {
        season: '2024-25'
      });

      expect(schedule).toBeDefined();
      expect(Array.isArray(schedule)).toBe(true);
      
      if (schedule.length > 0) {
        const game = schedule[0];
        expect(game).toHaveProperty('gameId');
        expect(game).toHaveProperty('date');
        expect(game).toHaveProperty('opponent');
      }
    }, 10000); // 10 second timeout for network request

    test('should filter games by date range', async () => {
      const schedule = await client.getTeamSchedule('msu', {
        startDate: '2024-11-01',
        endDate: '2024-11-30'
      });

      expect(Array.isArray(schedule)).toBe(true);
      
      // All games should be within the date range
      schedule.forEach(game => {
        const gameDate = new Date(game.date);
        expect(gameDate >= new Date('2024-11-01')).toBe(true);
        expect(gameDate <= new Date('2024-11-30')).toBe(true);
      });
    }, 10000);

    test('should handle invalid GID gracefully', async () => {
      const schedule = await client.getTeamSchedule('invalid-gid-12345');

      // Should return empty array or handle error gracefully
      expect(Array.isArray(schedule)).toBe(true);
    }, 10000);
  });

  describe('fetchGameXML', () => {
    test('should fetch XML for a valid game ID', async () => {
      // Using a known game ID from the fixture
      const gameId = '623619'; // Michigan State vs Kentucky from our test fixture

      const xml = await client.fetchGameXML(gameId);

      expect(xml).toBeDefined();
      expect(typeof xml).toBe('string');
      expect(xml).toContain('<?xml');
      expect(xml).toContain('<bbgame');
    }, 10000);

    test('should handle invalid game ID', async () => {
      await expect(
        client.fetchGameXML('invalid-game-id-99999999')
      ).rejects.toThrow();
    }, 10000);
  });

  describe('parseScheduleHTML', () => {
    test('should parse game IDs from HTML', () => {
      const sampleHTML = `
        <html>
          <body>
            <table>
              <tr>
                <td><a href="statbroadcast.com?id=123456">Game 1</a></td>
                <td>11/15/2024</td>
                <td>vs Duke</td>
              </tr>
              <tr>
                <td><a href="statbroadcast.com?id=123457">Game 2</a></td>
                <td>11/18/2024</td>
                <td>@ UNC</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const games = client.parseScheduleHTML(sampleHTML);

      expect(games).toHaveLength(2);
      expect(games[0].gameId).toBe('123456');
      expect(games[1].gameId).toBe('123457');
    });

    test('should handle empty HTML', () => {
      const games = client.parseScheduleHTML('<html><body></body></html>');
      expect(games).toEqual([]);
    });

    test('should handle malformed HTML gracefully', () => {
      const games = client.parseScheduleHTML('<html><invalid>');
      expect(Array.isArray(games)).toBe(true);
    });
  });

  describe('rate limiting', () => {
    test('should respect rate limits between requests', async () => {
      const start = Date.now();

      // Make two requests
      await client.fetchGameXML('623619');
      await client.fetchGameXML('623619');

      const elapsed = Date.now() - start;

      // Should have at least 1 second delay between requests
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    }, 15000);
  });
});
