#!/usr/bin/env node

/**
 * Match StatBroadcast GIDs with ESPN Team IDs
 * Fetches current NCAA basketball games from ESPN and matches teams
 * Run with: node scripts/match-espn-team-ids.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');

// Load StatBroadcast GIDs
const statbroadcastGids = require('../data/statbroadcast-gids.json');

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate string similarity (Levenshtein distance)
 */
function calculateSimilarity(str1, str2) {
  const s1 = normalizeTeamName(str1);
  const s2 = normalizeTeamName(str2);
  
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (s1.charAt(i - 1) === s2.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return maxLen === 0 ? 1.0 : 1.0 - distance / maxLen;
}

/**
 * Fetch ESPN teams from multiple sources
 */
async function fetchEspnTeams() {
  const teams = new Map();
  
  try {
    // Strategy 1: Fetch from teams API (all Division I teams)
    logger.info('Fetching all NCAA Division I teams from ESPN...');
    
    try {
      const teamsUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=400';
      const teamsResponse = await axios.get(teamsUrl);
      
      if (teamsResponse.data.sports && teamsResponse.data.sports[0]) {
        const leagues = teamsResponse.data.sports[0].leagues || [];
        leagues.forEach(league => {
          const leagueTeams = league.teams || [];
          leagueTeams.forEach(teamWrapper => {
            const team = teamWrapper.team;
            if (team && team.id) {
              teams.set(team.id, {
                teamId: team.id,
                teamName: team.displayName || team.name,
                location: team.location,
                abbreviation: team.abbreviation,
                shortName: team.shortDisplayName || team.name
              });
            }
          });
        });
      }
      
      logger.info(`Found ${teams.size} teams from teams API`);
    } catch (error) {
      logger.warn('Teams API failed, trying alternative approach:', error.message);
    }
    
    // Strategy 2: Fetch from recent games (last 30 days)
    if (teams.size < 50) {
      logger.info('Fetching teams from recent games...');
      
      const dates = [];
      for (let i = 0; i < 30; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dates.push(date.toISOString().split('T')[0].replace(/-/g, ''));
      }
      
      for (const date of dates) {
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}&limit=300`;
          const response = await axios.get(url);
          const events = response.data.events || [];
          
          events.forEach(event => {
            const competitions = event.competitions || [];
            competitions.forEach(competition => {
              const competitors = competition.competitors || [];
              competitors.forEach(competitor => {
                const team = competitor.team;
                if (team && team.id) {
                  teams.set(team.id, {
                    teamId: team.id,
                    teamName: team.displayName || team.name,
                    location: team.location,
                    abbreviation: team.abbreviation,
                    shortName: team.shortDisplayName || team.name
                  });
                }
              });
            });
          });
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          logger.debug(`Failed to fetch games for ${date}:`, error.message);
        }
      }
      
      logger.info(`Found ${teams.size} total teams after scanning recent games`);
    }
    
    return Array.from(teams.values());
    
  } catch (error) {
    logger.error('Failed to fetch ESPN teams:', error.message);
    return Array.from(teams.values());
  }
}

/**
 * Match StatBroadcast teams with ESPN teams
 */
function matchTeams(statbroadcastTeams, espnTeams) {
  const matches = [];
  const unmatched = [];
  
  statbroadcastTeams.forEach(sbTeam => {
    let bestMatch = null;
    let bestScore = 0;
    
    espnTeams.forEach(espnTeam => {
      // Try matching against different name variations
      const scores = [
        calculateSimilarity(sbTeam.teamName, espnTeam.teamName),
        calculateSimilarity(sbTeam.teamName, espnTeam.location),
        calculateSimilarity(sbTeam.teamName, espnTeam.shortName)
      ];
      
      const maxScore = Math.max(...scores);
      
      if (maxScore > bestScore) {
        bestScore = maxScore;
        bestMatch = espnTeam;
      }
    });
    
    if (bestMatch && bestScore >= 0.7) {
      matches.push({
        teamId: bestMatch.teamId,
        statbroadcastGid: sbTeam.statbroadcastGid,
        teamName: sbTeam.teamName,
        espnName: bestMatch.teamName,
        matchConfidence: bestScore.toFixed(3),
        sport: 'mens-college-basketball'
      });
    } else {
      unmatched.push({
        teamName: sbTeam.teamName,
        statbroadcastGid: sbTeam.statbroadcastGid,
        bestMatch: bestMatch ? bestMatch.teamName : 'none',
        bestScore: bestScore.toFixed(3)
      });
    }
  });
  
  return { matches, unmatched };
}

/**
 * Main function
 */
async function main() {
  try {
    logger.info('Starting ESPN team ID matching...');
    
    // Fetch ESPN teams from current games
    const espnTeams = await fetchEspnTeams();
    
    if (espnTeams.length === 0) {
      logger.warn('No ESPN teams found. Try running on a day with more games.');
      process.exit(1);
    }
    
    // Match teams
    logger.info('Matching StatBroadcast teams with ESPN teams...');
    const { matches, unmatched } = matchTeams(statbroadcastGids, espnTeams);
    
    // Save matches
    const matchesPath = path.join(__dirname, '../data/team-id-matches.json');
    fs.writeFileSync(matchesPath, JSON.stringify(matches, null, 2));
    logger.info(`Saved ${matches.length} matches to ${matchesPath}`);
    
    // Save unmatched
    const unmatchedPath = path.join(__dirname, '../data/team-id-unmatched.json');
    fs.writeFileSync(unmatchedPath, JSON.stringify(unmatched, null, 2));
    logger.info(`Saved ${unmatched.length} unmatched teams to ${unmatchedPath}`);
    
    // Print summary
    console.log('\n=== Team Matching Summary ===');
    console.log(`Total StatBroadcast teams: ${statbroadcastGids.length}`);
    console.log(`Total ESPN teams found: ${espnTeams.length}`);
    console.log(`Matched teams: ${matches.length}`);
    console.log(`Unmatched teams: ${unmatched.length}`);
    
    console.log('\nSample matches:');
    matches.slice(0, 10).forEach(match => {
      console.log(`  ${match.teamName} (${match.statbroadcastGid}) -> ESPN ID ${match.teamId} (confidence: ${match.matchConfidence})`);
    });
    
    if (unmatched.length > 0) {
      console.log('\nSample unmatched teams:');
      unmatched.slice(0, 10).forEach(team => {
        console.log(`  ${team.teamName} (${team.statbroadcastGid}) - best: ${team.bestMatch} (${team.bestScore})`);
      });
    }
    
    console.log(`\nNote: Run this script on multiple days to capture more teams.`);
    console.log(`Matched teams saved to: ${matchesPath}`);
    console.log(`Unmatched teams saved to: ${unmatchedPath}`);
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Failed to match team IDs:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { matchTeams, calculateSimilarity };
