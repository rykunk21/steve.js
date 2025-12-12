const XMLGameParser = require('../../src/modules/sports/XMLGameParser');
const fs = require('fs').promises;
const path = require('path');

describe('XMLGameParser', () => {
  let parser;
  let sampleXML;

  beforeAll(async () => {
    // Load the sample XML fixture
    const fixturePath = path.join(__dirname, '../fixtures/statbroadcast-game-sample.xml');
    sampleXML = await fs.readFile(fixturePath, 'utf-8');
  });

  beforeEach(() => {
    parser = new XMLGameParser();
  });

  describe('parseGameXML', () => {
    test('should parse game metadata correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      expect(result).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.gameId).toBe('16960');
      expect(result.metadata.statBroadcastId).toBe('623619');
      expect(result.metadata.date).toBe('11/18/2025');
      expect(result.metadata.location).toBe('Madison Square Garden - New York');
      expect(result.metadata.time).toBe('06:30 PM ET');
      expect(result.metadata.attendance).toBe('0');
      expect(result.metadata.neutralGame).toBe('N');
    });

    test('should parse team information correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      expect(result.teams).toBeDefined();
      expect(result.teams.visitor).toBeDefined();
      expect(result.teams.home).toBeDefined();

      // Visitor team
      expect(result.teams.visitor.id).toBe('MSU');
      expect(result.teams.visitor.name).toBe('Michigan St.');
      expect(result.teams.visitor.score).toBe(83);

      // Home team
      expect(result.teams.home.id).toBe('KEN');
      expect(result.teams.home.name).toBe('Kentucky');
      expect(result.teams.home.score).toBe(66);
    });

    test('should parse team aggregate statistics correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      const visitorStats = result.teams.visitor.stats;
      expect(visitorStats).toBeDefined();
      expect(visitorStats.fgm).toBe(32);
      expect(visitorStats.fga).toBe(64);
      expect(visitorStats.fgPct).toBe(50);
      expect(visitorStats.fg3m).toBe(11);
      expect(visitorStats.fg3a).toBe(22);
      expect(visitorStats.fg3Pct).toBe(50);
      expect(visitorStats.ftm).toBe(8);
      expect(visitorStats.fta).toBe(10);
      expect(visitorStats.ftPct).toBe(80);
      expect(visitorStats.rebounds).toBe(42);
      expect(visitorStats.offensiveRebounds).toBe(10);
      expect(visitorStats.defensiveRebounds).toBe(32);
      expect(visitorStats.assists).toBe(25);
      expect(visitorStats.turnovers).toBe(13);
      expect(visitorStats.steals).toBe(5);
      expect(visitorStats.blocks).toBe(4);
    });

    test('should parse advanced metrics correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      const visitorAdvanced = result.teams.visitor.advancedMetrics;
      expect(visitorAdvanced).toBeDefined();
      expect(visitorAdvanced.pointsInPaint).toBe(30);
      expect(visitorAdvanced.fastBreakPoints).toBe(8);
      expect(visitorAdvanced.secondChancePoints).toBe(8);
      expect(visitorAdvanced.possessionCount).toBe(71);
      expect(visitorAdvanced.benchPoints).toBe(34);

      const homeAdvanced = result.teams.home.advancedMetrics;
      expect(homeAdvanced).toBeDefined();
      expect(homeAdvanced.pointsInPaint).toBe(24);
      expect(homeAdvanced.fastBreakPoints).toBe(16);
      expect(homeAdvanced.possessionCount).toBe(68);
    });

    test('should parse player-level statistics correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      const visitorPlayers = result.teams.visitor.players;
      expect(visitorPlayers).toBeDefined();
      expect(Array.isArray(visitorPlayers)).toBe(true);
      expect(visitorPlayers.length).toBeGreaterThan(0);

      // Check first player (Kohler, Jaxon)
      const player = visitorPlayers.find(p => p.name === 'Kohler,Jaxon');
      expect(player).toBeDefined();
      expect(player.uniform).toBe('0');
      expect(player.code).toBe('1930360');
      expect(player.position).toBe('F');
      expect(player.stats.points).toBe(20);
      expect(player.stats.fgm).toBe(8);
      expect(player.stats.fga).toBe(12);
      expect(player.stats.rebounds).toBe(5);
      expect(player.stats.assists).toBe(2);
      expect(player.stats.minutes).toBe(27);
    });

    test('should parse period-by-period scoring correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      const visitorPeriods = result.teams.visitor.periodScoring;
      expect(visitorPeriods).toBeDefined();
      expect(Array.isArray(visitorPeriods)).toBe(true);
      expect(visitorPeriods.length).toBe(2);
      expect(visitorPeriods[0].period).toBe(1);
      expect(visitorPeriods[0].score).toBe(44);
      expect(visitorPeriods[1].period).toBe(2);
      expect(visitorPeriods[1].score).toBe(39);

      const homePeriods = result.teams.home.periodScoring;
      expect(homePeriods).toBeDefined();
      expect(homePeriods.length).toBe(2);
      expect(homePeriods[0].score).toBe(27);
      expect(homePeriods[1].score).toBe(39);
    });

    test('should handle malformed XML gracefully', async () => {
      const malformedXML = '<bbgame><invalid></bbgame>';
      
      await expect(parser.parseGameXML(malformedXML)).rejects.toThrow();
    });

    test('should handle missing optional fields gracefully', async () => {
      const minimalXML = `<?xml version="1.0"?>
        <bbgame>
          <venue gameid="123" sbid="456" date="11/18/2025" location="Test Arena" time="7:00 PM" 
                 visid="TEAM1" visname="Team One" homeid="TEAM2" homename="Team Two">
          </venue>
          <team vh="V" id="TEAM1" name="Team One">
            <linescore score="80"></linescore>
            <totals>
              <stats fgm="30" fga="60" tp="80"></stats>
            </totals>
          </team>
          <team vh="H" id="TEAM2" name="Team Two">
            <linescore score="75"></linescore>
            <totals>
              <stats fgm="28" fga="58" tp="75"></stats>
            </totals>
          </team>
        </bbgame>`;

      const result = await parser.parseGameXML(minimalXML);
      
      expect(result).toBeDefined();
      expect(result.metadata.gameId).toBe('123');
      expect(result.teams.visitor.score).toBe(80);
      expect(result.teams.home.score).toBe(75);
    });

    test('should calculate derived metrics correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      const visitorDerived = result.teams.visitor.derivedMetrics;
      expect(visitorDerived).toBeDefined();
      
      // Effective FG% = (FGM + 0.5 * 3PM) / FGA
      const expectedEfg = ((32 + 0.5 * 11) / 64) * 100;
      expect(visitorDerived.effectiveFgPct).toBeCloseTo(expectedEfg, 1);
      
      // True Shooting % = PTS / (2 * (FGA + 0.44 * FTA))
      const expectedTs = (83 / (2 * (64 + 0.44 * 10))) * 100;
      expect(visitorDerived.trueShootingPct).toBeCloseTo(expectedTs, 1);
      
      // Turnover rate = TO / (FGA + 0.44 * FTA + TO)
      const expectedToRate = (13 / (64 + 0.44 * 10 + 13)) * 100;
      expect(visitorDerived.turnoverRate).toBeCloseTo(expectedToRate, 1);
    });

    test('should extract exact possession count when available', async () => {
      const result = await parser.parseGameXML(sampleXML);

      expect(result.teams.visitor.advancedMetrics.possessionCount).toBe(71);
      expect(result.teams.home.advancedMetrics.possessionCount).toBe(68);
    });

    test('should parse game status correctly', async () => {
      const result = await parser.parseGameXML(sampleXML);

      expect(result.status).toBeDefined();
      expect(result.status.complete).toBe(true);
      expect(result.status.period).toBe(2);
      expect(result.status.clock).toBe('00:00');
    });

    test('should parse play-by-play sequences with shot types and results', async () => {
      const result = await parser.parseGameXML(sampleXML);

      expect(result.playByPlay).toBeDefined();
      expect(Array.isArray(result.playByPlay)).toBe(true);
      expect(result.playByPlay.length).toBeGreaterThan(0);

      // Find a made shot
      const madeShot = result.playByPlay.find(play => 
        play.action === 'GOOD' && play.type === 'LAYUP'
      );
      expect(madeShot).toBeDefined();
      expect(madeShot.team).toBeDefined();
      expect(madeShot.time).toBeDefined();
      expect(madeShot.checkname).toBeDefined();
      expect(madeShot.hscore).toBeDefined();
      expect(madeShot.vscore).toBeDefined();

      // Find a missed shot
      const missedShot = result.playByPlay.find(play => 
        play.action === 'MISS' && play.type === '3PTR'
      );
      expect(missedShot).toBeDefined();
      expect(missedShot.team).toBeDefined();
      expect(missedShot.time).toBeDefined();

      // Find a rebound
      const rebound = result.playByPlay.find(play => 
        play.action === 'REBOUND'
      );
      expect(rebound).toBeDefined();
      expect(rebound.type).toMatch(/DEF|OFF/);

      // Find a turnover
      const turnover = result.playByPlay.find(play => 
        play.action === 'TURNOVER'
      );
      expect(turnover).toBeDefined();
      expect(turnover.type).toBeDefined();

      // Find an assist
      const assist = result.playByPlay.find(play => 
        play.action === 'ASSIST'
      );
      expect(assist).toBeDefined();
    });

    test('should parse play-by-play with correct shot type classification', async () => {
      const result = await parser.parseGameXML(sampleXML);

      // Find 2-point shots
      const twoPointers = result.playByPlay.filter(play => 
        play.action === 'GOOD' && ['LAYUP', 'JUMPER', 'DUNK'].includes(play.type)
      );
      expect(twoPointers.length).toBeGreaterThan(0);

      // Find 3-point shots
      const threePointers = result.playByPlay.filter(play => 
        play.type === '3PTR'
      );
      expect(threePointers.length).toBeGreaterThan(0);

      // Find free throws
      const freeThrows = result.playByPlay.filter(play => 
        play.type === 'FT'
      );
      expect(freeThrows.length).toBeGreaterThan(0);
    });

    test('should parse play-by-play with game context', async () => {
      const result = await parser.parseGameXML(sampleXML);

      // Find plays with fast break indicator
      const fastBreak = result.playByPlay.find(play => 
        play.fastb === 'Y'
      );
      expect(fastBreak).toBeDefined();

      // Find plays with turnover leading to score
      const turnoverScore = result.playByPlay.find(play => 
        play.to === 'Y' && play.action === 'GOOD'
      );
      expect(turnoverScore).toBeDefined();

      // Find plays in paint
      const paintPlay = result.playByPlay.find(play => 
        play.paint === 'Y'
      );
      expect(paintPlay).toBeDefined();
    });

    test('should organize play-by-play by period', async () => {
      const result = await parser.parseGameXML(sampleXML);

      expect(result.playByPlay).toBeDefined();
      
      // Check that plays have period information
      const playsWithPeriod = result.playByPlay.filter(play => play.period);
      expect(playsWithPeriod.length).toBeGreaterThan(0);

      // Verify period 1 plays exist
      const period1Plays = result.playByPlay.filter(play => play.period === 1);
      expect(period1Plays.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    test('should throw error for empty XML', async () => {
      await expect(parser.parseGameXML('')).rejects.toThrow();
    });

    test('should throw error for null input', async () => {
      await expect(parser.parseGameXML(null)).rejects.toThrow();
    });

    test('should throw error for undefined input', async () => {
      await expect(parser.parseGameXML(undefined)).rejects.toThrow();
    });

    test('should log error details for malformed XML', async () => {
      const badXML = '<bbgame><unclosed>';
      
      try {
        await parser.parseGameXML(badXML);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toBeTruthy();
      }
    });
  });
});
