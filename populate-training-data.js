const fs = require('fs');
const db = require('./src/database/connection');

async function findOrCreateTeam(db, statbroadcastGid, teamName) {
  if (!statbroadcastGid) {
    throw new Error('StatBroadcast GID is required');
  }
  
  // Try to find existing team by StatBroadcast GID
  const existing = await db.get(
    'SELECT team_id FROM teams WHERE statbroadcast_gid = ? AND sport = ?',
    [statbroadcastGid, 'mens-college-basketball']
  );
  
  if (existing) {
    return existing.team_id;
  }
  
  // Create new team - use StatBroadcast GID as team_id for simplicity
  const teamId = statbroadcastGid;
  
  await db.run(`
    INSERT INTO teams (
      team_id, statbroadcast_gid, team_name, sport,
      statistical_representation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    teamId,
    statbroadcastGid,
    teamName || `Team ${statbroadcastGid}`,
    'mens-college-basketball',
    JSON.stringify({
      mu: new Array(16).fill(0.0),
      sigma: new Array(16).fill(1.0),
      games_processed: 0,
      last_season: '2024-25',
      last_updated: new Date().toISOString()
    }),
    new Date().toISOString(),
    new Date().toISOString()
  ]);
  
  return teamId;
}

async function populateGameIds() {
  try {
    await db.initialize();
    
    // Load training dataset
    const data = JSON.parse(fs.readFileSync('data/training-dataset-basketball-only.json', 'utf8'));
    console.log('Loaded dataset with', data.dataset.length, 'games');
    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    
    // Process first 500 games for training
    for (const game of data.dataset.slice(0, 500)) {
      try {
        // Check if game already exists
        const existing = await db.get('SELECT * FROM game_ids WHERE game_id = ?', [game.gameId]);
        
        if (!existing) {
          // Get team IDs from StatBroadcast GIDs
          const homeGid = game.gameData?.teams?.home?.id || game.gameData?.metadata?.homeId;
          const awayGid = game.gameData?.teams?.visitor?.id || game.gameData?.metadata?.visitorId;
          
          // Find or create teams
          let homeTeamId = await findOrCreateTeam(db, homeGid, game.gameData?.teams?.home?.name);
          let awayTeamId = await findOrCreateTeam(db, awayGid, game.gameData?.teams?.visitor?.name);
          
          // Insert new game
          await db.run(`
            INSERT INTO game_ids (
              game_id, sport, home_team_id, away_team_id, game_date,
              transition_probabilities_home, transition_probabilities_away, labels_extracted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            game.gameId,
            'mens-college-basketball',
            homeTeamId,
            awayTeamId,
            game.gameData?.metadata?.date || '2024-01-01',
            JSON.stringify(game.transitionProbabilities?.home || {}),
            JSON.stringify(game.transitionProbabilities?.visitor || {}),
            1
          ]);
          inserted++;
        } else if (!existing.labels_extracted) {
          // Update existing game with labels
          await db.run(`
            UPDATE game_ids SET
              transition_probabilities_home = ?,
              transition_probabilities_away = ?,
              labels_extracted = 1
            WHERE game_id = ?
          `, [
            JSON.stringify(game.transitionProbabilities?.home || {}),
            JSON.stringify(game.transitionProbabilities?.visitor || {}),
            game.gameId
          ]);
          updated++;
        }
        
        if ((inserted + updated) % 10 === 0) {
          console.log('Progress:', { inserted, updated, errors });
        }
        
      } catch (error) {
        console.error('Error processing game', game.gameId, ':', error.message);
        errors++;
      }
    }
    
    console.log('Final results:', { inserted, updated, errors });
    
    // Verify the data
    const totalGames = await db.get('SELECT COUNT(*) as count FROM game_ids WHERE labels_extracted = 1');
    console.log('Total games with labels:', totalGames.count);
    
    await db.close();
    
  } catch (error) {
    console.error('Failed to populate game IDs:', error);
    process.exit(1);
  }
}

populateGameIds();