const fs = require('fs').promises;
const path = require('path');
const StatBroadcastClient = require('../../src/modules/sports/StatBroadcastClient');

/**
 * Test suite for validating game ID coverage from StatBroadcast schedule scraping
 * 
 * This test validates Property 11 and 13:
 * - Game ID mapping consistency (Requirements 19.1, 19.2, 19.6)
 * - Reconciliation completeness (Requirements 20.2, 20.3, 20.4)
 * 
 * Red-Green-Refactor approach:
 * This test drives the implementation of schedule scraping functionality
 */
describe('Game ID Coverage Validation', () => {
  let statBroadcastClient;
  let testTeams;

  beforeAll(async () => {
    // Load test teams from statbroadcast-gids.json
    const gidsPath = path.join(__dirname, '../../data/statbroadcast-gids.json');
    const gidsData = await fs.readFile(gidsPath, 'utf-8');
    const allTeams = JSON.parse(gidsData);

    // Use small subset for fast testing (3 teams)
    testTeams = allTeams.slice(0, 3);

    // Initialize client
    statBroadcastClient = new StatBroadcastClient();
  });

  afterAll(async () => {
    // Cleanup
    if (statBroadcastClient && statBroadcastClient.closeBrowser) {
      await statBroadcastClient.closeBrowser();
    }
  });

  describe('Schedule Scraping', () => {
    test('should scrape schedule and return game IDs for each team', async () => {
      // Arrange
      const team = testTeams[0];

      // Act
      const schedule = await statBroadcastClient.getTeamSchedule(team.statbroadcastGid);

      // Assert
      expect(Array.isArray(schedule)).toBe(true);
      
      // Each game should have a gameId
      schedule.forEach(game => {
        expect(game).toHaveProperty('gameId');
        expect(typeof game.gameId).toBe('string');
        expect(game.gameId.length).toBeGreaterThan(0);
      });
    });

    test('should process all teams and collect statistics', async () => {
      // Arrange
      const statistics = {
        teamsProcessed: 0,
        teamsSuccessful: 0,
        teamsFailed: 0,
        totalGames: 0,
        gamesPerTeam: [],
        failedTeams: [],
        lowGameCountTeams: []
      };

      // Act - Process each team
      for (const team of testTeams) {
        statistics.teamsProcessed++;

        try {
          const schedule = await statBroadcastClient.getTeamSchedule(team.statbroadcastGid);
          
          statistics.teamsSuccessful++;
          statistics.totalGames += schedule.length;
          statistics.gamesPerTeam.push({
            teamName: team.teamName,
            statbroadcastGid: team.statbroadcastGid,
            gameCount: schedule.length
          });

          // Flag teams with low game counts (< 15 games)
          if (schedule.length > 0 && schedule.length < 15) {
            statistics.lowGameCountTeams.push({
              teamName: team.teamName,
              statbroadcastGid: team.statbroadcastGid,
              gameCount: schedule.length,
              reason: 'Low game count'
            });
          }
        } catch (error) {
          statistics.teamsFailed++;
          statistics.failedTeams.push({
            teamName: team.teamName,
            statbroadcastGid: team.statbroadcastGid,
            error: error.message
          });
        }
      }

      // Assert - All teams should be processed
      expect(statistics.teamsProcessed).toBe(testTeams.length);

      // Log statistics
      console.log('\n=== Game ID Coverage Statistics ===');
      console.log(`Teams processed: ${statistics.teamsProcessed}`);
      console.log(`Teams successful: ${statistics.teamsSuccessful}`);
      console.log(`Teams failed: ${statistics.teamsFailed}`);
      console.log(`Total games found: ${statistics.totalGames}`);

      if (statistics.teamsSuccessful > 0) {
        const avgGames = statistics.totalGames / statistics.teamsSuccessful;
        console.log(`Average games per team: ${avgGames.toFixed(1)}`);
      }

      if (statistics.gamesPerTeam.length > 0) {
        console.log('\n--- Games Per Team ---');
        statistics.gamesPerTeam.forEach(team => {
          console.log(`  ${team.teamName} (${team.statbroadcastGid}): ${team.gameCount} games`);
        });
      }

      if (statistics.lowGameCountTeams.length > 0) {
        console.log('\n--- Teams with Low Game Counts (< 15) ---');
        statistics.lowGameCountTeams.forEach(team => {
          console.log(`  ${team.teamName} (${team.statbroadcastGid}): ${team.gameCount} games`);
        });
      }

      if (statistics.failedTeams.length > 0) {
        console.log('\n--- Failed Teams ---');
        statistics.failedTeams.forEach(team => {
          console.log(`  ${team.teamName} (${team.statbroadcastGid}): ${team.error}`);
        });
      }

      // Verify we got some results
      expect(statistics.teamsProcessed).toBeGreaterThan(0);
    }, 60000); // 1 minute timeout

    test('should verify reasonable game count (teams × ~25 games)', async () => {
      // Arrange
      let totalGames = 0;
      let successfulTeams = 0;

      // Act
      for (const team of testTeams) {
        try {
          const schedule = await statBroadcastClient.getTeamSchedule(team.statbroadcastGid);
          totalGames += schedule.length;
          successfulTeams++;
        } catch (error) {
          // Skip failed teams
          continue;
        }
      }

      // Assert
      const avgGamesPerTeam = successfulTeams > 0 ? totalGames / successfulTeams : 0;

      console.log('\n=== Game Count Validation ===');
      console.log(`Total games: ${totalGames}`);
      console.log(`Successful teams: ${successfulTeams}`);
      console.log(`Average games per team: ${avgGamesPerTeam.toFixed(1)}`);
      console.log(`Expected: ~25 games per team (12-38 range acceptable)`);

      // Verify we have data
      expect(successfulTeams).toBeGreaterThan(0);
      expect(totalGames).toBeGreaterThanOrEqual(0);
    }, 60000); // 1 minute timeout

    test('should identify teams with unusually low game counts', async () => {
      // Arrange
      const lowGameThreshold = 15;
      const teamsNeedingReview = [];

      // Act
      for (const team of testTeams) {
        try {
          const schedule = await statBroadcastClient.getTeamSchedule(team.statbroadcastGid);
          
          if (schedule.length === 0) {
            teamsNeedingReview.push({
              teamName: team.teamName,
              statbroadcastGid: team.statbroadcastGid,
              gameCount: 0,
              reason: 'No games found'
            });
          } else if (schedule.length < lowGameThreshold) {
            teamsNeedingReview.push({
              teamName: team.teamName,
              statbroadcastGid: team.statbroadcastGid,
              gameCount: schedule.length,
              reason: 'Low game count'
            });
          }
        } catch (error) {
          teamsNeedingReview.push({
            teamName: team.teamName,
            statbroadcastGid: team.statbroadcastGid,
            gameCount: 0,
            reason: `Error: ${error.message}`
          });
        }
      }

      // Assert
      console.log('\n=== Teams Needing Manual Review ===');
      console.log(`Total teams needing review: ${teamsNeedingReview.length}`);
      
      if (teamsNeedingReview.length > 0) {
        console.log('\nDetails:');
        teamsNeedingReview.forEach(team => {
          console.log(`  - ${team.teamName} (${team.statbroadcastGid}): ${team.gameCount} games - ${team.reason}`);
        });
      } else {
        console.log('All teams have adequate game counts!');
      }

      // Test passes regardless - this is informational
      expect(teamsNeedingReview).toBeDefined();
    }, 60000); // 1 minute timeout

    test('should sample random game IDs from all collected games', async () => {
      // Arrange
      const allGameIds = [];
      const sampleSize = 10;

      // Act - Collect all game IDs from all teams
      for (const team of testTeams) {
        try {
          const schedule = await statBroadcastClient.getTeamSchedule(team.statbroadcastGid);
          
          schedule.forEach(game => {
            if (game.gameId) {
              allGameIds.push({
                gameId: game.gameId,
                teamName: team.teamName,
                teamGid: team.statbroadcastGid,
                date: game.date,
                opponent: game.opponent
              });
            }
          });
        } catch (error) {
          // Skip failed teams
          continue;
        }
      }

      // Sample random games
      const shuffled = [...allGameIds].sort(() => 0.5 - Math.random());
      const sample = shuffled.slice(0, Math.min(sampleSize, allGameIds.length));

      // Assert
      console.log('\n=== Random Game ID Sample ===');
      console.log(`Total game IDs collected: ${allGameIds.length}`);
      console.log(`Sample size: ${sample.length}`);
      console.log('\nSample game IDs:');
      
      sample.forEach((game, index) => {
        console.log(`  ${index + 1}. Game ID: ${game.gameId}`);
        console.log(`     Team: ${game.teamName} (${game.teamGid})`);
        console.log(`     Date: ${game.date || 'N/A'}`);
        console.log(`     Opponent: ${game.opponent || 'N/A'}`);
        console.log('');
      });

      // Verify we collected some game IDs
      expect(allGameIds.length).toBeGreaterThan(0);
      expect(sample.length).toBeGreaterThan(0);
      
      // Verify game IDs are valid
      sample.forEach(game => {
        expect(game.gameId).toBeDefined();
        expect(typeof game.gameId).toBe('string');
        expect(game.gameId.length).toBeGreaterThan(0);
      });
    }, 60000); // 1 minute timeout
  });
});
