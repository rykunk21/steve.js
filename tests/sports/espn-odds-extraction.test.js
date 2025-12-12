const ESPNAPIClient = require('../../src/modules/sports/ESPNAPIClient');
const fs = require('fs').promises;
const path = require('path');

describe('ESPN Odds Extraction', () => {
  let espnClient;
  let realData;

  beforeAll(async () => {
    // Load real ESPN API response
    const fixtureData = await fs.readFile(
      path.join(__dirname, '../fixtures/espn-raw-response.json'),
      'utf8'
    );
    realData = JSON.parse(fixtureData);
  });

  beforeEach(() => {
    espnClient = new ESPNAPIClient();
  });

  describe('extractOddsFromCompetition', () => {
    test('should extract odds from all games that have them', () => {
      let gamesWithOdds = 0;
      let gamesWithoutOdds = 0;
      let successfulExtractions = 0;
      let failedExtractions = 0;

      realData.events.forEach(event => {
        const competition = event.competitions[0];
        
        // Check if ESPN provided odds
        const hasOddsInSource = competition.odds && competition.odds.length > 0;
        
        if (hasOddsInSource) {
          gamesWithOdds++;
          
          // Try to extract odds
          const extractedOdds = espnClient.extractOddsFromCompetition(competition);
          
          if (extractedOdds) {
            successfulExtractions++;
          } else {
            failedExtractions++;
            console.log(`Failed to extract odds for game: ${event.shortName}`);
          }
        } else {
          gamesWithoutOdds++;
        }
      });

      console.log(`\nOdds Extraction Summary:`);
      console.log(`Total games: ${realData.events.length}`);
      console.log(`Games with odds in source: ${gamesWithOdds}`);
      console.log(`Games without odds in source: ${gamesWithoutOdds}`);
      console.log(`Successful extractions: ${successfulExtractions}`);
      console.log(`Failed extractions: ${failedExtractions}`);

      // All games with odds should be extracted successfully
      expect(failedExtractions).toBe(0);
      expect(successfulExtractions).toBe(gamesWithOdds);
    });

    test('should extract complete odds data structure', () => {
      // Find first game with odds
      const gameWithOdds = realData.events.find(event => 
        event.competitions[0].odds && event.competitions[0].odds.length > 0
      );

      expect(gameWithOdds).toBeDefined();

      const competition = gameWithOdds.competitions[0];
      const odds = espnClient.extractOddsFromCompetition(competition);

      expect(odds).not.toBeNull();
      expect(odds).toHaveProperty('provider');
      expect(odds).toHaveProperty('spread');
      expect(odds).toHaveProperty('spreadOdds');
      expect(odds).toHaveProperty('moneyline');
      expect(odds).toHaveProperty('total');
      expect(odds).toHaveProperty('totalOdds');
    });

    test('should return null when no odds are available', () => {
      // Find first game without odds
      const gameWithoutOdds = realData.events.find(event => 
        !event.competitions[0].odds || event.competitions[0].odds.length === 0
      );

      if (gameWithoutOdds) {
        const competition = gameWithoutOdds.competitions[0];
        const odds = espnClient.extractOddsFromCompetition(competition);
        expect(odds).toBeNull();
      }
    });

    test('should return null when competition is null', () => {
      const odds = espnClient.extractOddsFromCompetition(null);
      expect(odds).toBeNull();
    });

    test('should return null when competition has no odds array', () => {
      const competition = { id: '123' };
      const odds = espnClient.extractOddsFromCompetition(competition);
      expect(odds).toBeNull();
    });

    test('should return null when odds array is empty', () => {
      const competition = { id: '123', odds: [] };
      const odds = espnClient.extractOddsFromCompetition(competition);
      expect(odds).toBeNull();
    });
  });

  describe('Full game transformation with odds', () => {
    test('should transform all games correctly with odds when available', () => {
      let transformedGames = 0;
      let gamesWithOdds = 0;
      let gamesWithoutOdds = 0;

      realData.events.forEach(event => {
        const competition = event.competitions[0];
        const competitors = competition.competitors || [];
        
        const homeTeam = competitors.find(c => c.homeAway === 'home');
        const awayTeam = competitors.find(c => c.homeAway === 'away');
        
        // Extract odds using the method
        const odds = espnClient.extractOddsFromCompetition(competition);
        
        // Simulate the game transformation (same as in ESPNAPIClient)
        const game = {
          id: event.id,
          sport: 'ncaa_basketball',
          name: event.name,
          shortName: event.shortName,
          date: new Date(event.date),
          status: event.status?.type?.name || 'scheduled',
          teams: {
            home: homeTeam ? {
              id: homeTeam.team?.id,
              name: homeTeam.team?.displayName,
              abbreviation: homeTeam.team?.abbreviation,
              logo: homeTeam.team?.logo,
              score: homeTeam.score,
              color: homeTeam.team?.color
            } : null,
            away: awayTeam ? {
              id: awayTeam.team?.id,
              name: awayTeam.team?.displayName,
              abbreviation: awayTeam.team?.abbreviation,
              logo: awayTeam.team?.logo,
              score: awayTeam.score,
              color: awayTeam.team?.color
            } : null
          },
          venue: competition?.venue?.fullName,
          espnUrl: `https://www.espn.com/mens-college-basketball/game/_/gameId/${event.id}`,
          displayName: event.shortName || event.name,
          commenceTime: new Date(event.date),
          odds: odds
        };

        transformedGames++;
        
        if (game.odds) {
          gamesWithOdds++;
        } else {
          gamesWithoutOdds++;
        }

        // Verify game structure
        expect(game).toHaveProperty('id');
        expect(game).toHaveProperty('teams');
        expect(game).toHaveProperty('odds');
        
        // If odds exist, verify structure
        if (game.odds) {
          expect(game.odds).toHaveProperty('provider');
          expect(game.odds).toHaveProperty('spread');
          expect(game.odds).toHaveProperty('moneyline');
          expect(game.odds).toHaveProperty('total');
        }
      });

      console.log(`\nGame Transformation Summary:`);
      console.log(`Total games transformed: ${transformedGames}`);
      console.log(`Games with odds: ${gamesWithOdds}`);
      console.log(`Games without odds: ${gamesWithoutOdds}`);

      expect(transformedGames).toBe(realData.events.length);
    });
  });

  describe('Odds extraction edge cases', () => {
    test('should handle partial odds data', () => {
      const competition = {
        odds: [{
          provider: { name: 'ESPN BET' },
          spread: 7.5,
          // Missing moneyline and total
        }]
      };

      const odds = espnClient.extractOddsFromCompetition(competition);

      expect(odds).not.toBeNull();
      expect(odds.spread).toBe(7.5);
      expect(odds.moneyline.home).toBeNull();
      expect(odds.moneyline.away).toBeNull();
      expect(odds.total).toBeNull();
    });

    test('should handle missing provider name', () => {
      const competition = {
        odds: [{
          spread: 3.5,
          overUnder: 150
        }]
      };

      const odds = espnClient.extractOddsFromCompetition(competition);

      expect(odds).not.toBeNull();
      expect(odds.provider).toBe('ESPN BET'); // Default fallback
      expect(odds.spread).toBe(3.5);
      expect(odds.total).toBe(150);
    });
  });
});
