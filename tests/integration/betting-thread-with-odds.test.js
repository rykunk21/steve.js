#!/usr/bin/env node

/**
 * Test script to verify betting thread creation with progress bars and betting information
 */

const BettingSnapshot = require('../src/database/models/BettingSnapshot');
const BettingThreadManager = require('../src/modules/sports/BettingThreadManager');

console.log('🧪 Testing Betting Thread with Odds Display\n');

// Test 1: Progress bar generation
console.log('1. Testing Progress Bar Generation:');
console.log('=====================================');

const testSpreads = [
  { spread: -7, description: 'Home favored by 7' },
  { spread: -3.5, description: 'Home favored by 3.5' },
  { spread: 0, description: 'Pick\'em' },
  { spread: 3.5, description: 'Away favored by 3.5' },
  { spread: 7, description: 'Away favored by 7' },
  { spread: -14, description: 'Home heavily favored' },
  { spread: 14, description: 'Away heavily favored' }
];

testSpreads.forEach(test => {
  const snapshot = new BettingSnapshot({ spreadLine: test.spread });
  const progressBar = snapshot.generateSpreadProgressBar();
  console.log(`${test.description.padEnd(25)} | ${progressBar} | (${test.spread > 0 ? '+' : ''}${test.spread})`);
});

console.log('\n2. Testing Display Summary:');
console.log('===========================');

// Test 2: Display summary with full betting data
const fullSnapshot = new BettingSnapshot({
  gameId: 'test_game',
  sport: 'nfl',
  homeMoneyline: -150,
  awayMoneyline: 130,
  spreadLine: -3.5,
  homeSpreadOdds: -110,
  awaySpreadOdds: -110,
  totalLine: 47.5,
  overOdds: -105,
  underOdds: -115,
  source: 'ActionNetwork',
  sportsbook: 'DraftKings',
  scrapedAt: new Date()
});

const summary = fullSnapshot.getDisplaySummary();
console.log('Full Betting Summary:');
console.log(JSON.stringify(summary, null, 2));

console.log('\n3. Testing Thread Name Generation:');
console.log('==================================');

// Test 3: Thread name with progress bar
const mockGameData = {
  id: 'test_game',
  teams: {
    away: { abbreviation: 'NO', name: 'New Orleans Saints' },
    home: { abbreviation: 'CHI', name: 'Chicago Bears' }
  },
  displayName: 'Saints at Bears'
};

// Mock BettingThreadManager for testing
const mockClient = { user: { id: 'test' } };
const threadManager = new BettingThreadManager(mockClient);

const threadNameWithOdds = threadManager.createThreadNameWithOdds(mockGameData, fullSnapshot);
console.log(`Thread Name: ${threadNameWithOdds}`);

console.log('\n4. Testing Team Matching Logic:');
console.log('===============================');

const testMatches = [
  {
    espnTeams: { home: 'LAR', away: 'NO' },
    bettingTeams: { home: 'LA', away: 'NO' },
    shouldMatch: true
  },
  {
    espnTeams: { home: 'JAX', away: 'TEN' },
    bettingTeams: { home: 'JAC', away: 'TEN' },
    shouldMatch: true
  },
  {
    espnTeams: { home: 'GB', away: 'MIN' },
    bettingTeams: { home: 'GB', away: 'MIN' },
    shouldMatch: true
  },
  {
    espnTeams: { home: 'DAL', away: 'NYG' },
    bettingTeams: { home: 'HOU', away: 'IND' },
    shouldMatch: false
  }
];

testMatches.forEach((test, index) => {
  const matches = threadManager.teamsMatch(test.espnTeams, test.bettingTeams);
  const result = matches === test.shouldMatch ? '✅' : '❌';
  console.log(`${result} Test ${index + 1}: ${test.espnTeams.away}@${test.espnTeams.home} vs ${test.bettingTeams.away}@${test.bettingTeams.home} = ${matches}`);
});

console.log('\n5. Testing Embed Creation:');
console.log('==========================');

// Test 5: Create embed with betting data
async function testEmbedCreation() {
  try {
    const embed = await threadManager.createGameEmbedWithOdds('nfl', mockGameData, fullSnapshot);
    
    console.log('Embed Title:', embed.data.title);
    console.log('Embed Color:', embed.data.color);
    console.log('Embed Description:', embed.data.description?.substring(0, 100) + '...');
    console.log('Embed Fields:');
    embed.data.fields?.forEach((field, index) => {
      console.log(`  ${index + 1}. ${field.name}: ${field.value.substring(0, 50)}...`);
    });
    console.log('Embed Footer:', embed.data.footer?.text);
    
  } catch (error) {
    console.error('Error creating embed:', error.message);
  }
}

testEmbedCreation();

console.log('\n✅ Betting Thread Odds Display Test Complete!');