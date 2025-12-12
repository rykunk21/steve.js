const StatBroadcastClient = require('./StatBroadcastClient');
const XMLGameParser = require('./XMLGameParser');
const TransitionProbabilityComputer = require('./TransitionProbabilityComputer');
const TeamRepository = require('../../database/repositories/TeamRepository');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');

/**
 * VAE-based feature extraction from StatBroadcast game XML
 * Extracts comprehensive 80-dimensional features and computes transition probabilities
 */
class VAEFeatureExtractor {
  constructor() {
    this.client = new StatBroadcastClient();
    this.parser = new XMLGameParser();
    this.transitionComputer = new TransitionProbabilityComputer();
    this.teamRepository = new TeamRepository();
    
    // Feature normalization bounds (will be updated based on observed data)
    this.featureBounds = this.initializeFeatureBounds();
  }

  /**
   * Initialize feature bounds for normalization
   * These bounds are based on typical basketball statistics ranges
   * @returns {Object} - Feature bounds for normalization
   */
  initializeFeatureBounds() {
    return {
      // Shooting percentages (0-100%)
      fgPct: { min: 0, max: 100 },
      fg3Pct: { min: 0, max: 100 },
      ftPct: { min: 0, max: 100 },
      
      // Shot attempts (0-100 per game)
      fga: { min: 0, max: 100 },
      fg3a: { min: 0, max: 50 },
      fta: { min: 0, max: 50 },
      
      // Rebounds (0-60 per game)
      rebounds: { min: 0, max: 60 },
      offensiveRebounds: { min: 0, max: 30 },
      defensiveRebounds: { min: 0, max: 50 },
      
      // Other stats
      assists: { min: 0, max: 40 },
      turnovers: { min: 0, max: 30 },
      steals: { min: 0, max: 20 },
      blocks: { min: 0, max: 15 },
      personalFouls: { min: 0, max: 30 },
      points: { min: 0, max: 150 },
      
      // Advanced metrics
      pointsInPaint: { min: 0, max: 80 },
      fastBreakPoints: { min: 0, max: 40 },
      secondChancePoints: { min: 0, max: 30 },
      pointsOffTurnovers: { min: 0, max: 40 },
      benchPoints: { min: 0, max: 80 },
      possessionCount: { min: 50, max: 120 },
      
      // Derived metrics
      effectiveFgPct: { min: 0, max: 100 },
      trueShootingPct: { min: 0, max: 100 },
      turnoverRate: { min: 0, max: 50 },
      
      // Player-level aggregates (per game averages)
      avgPlayerMinutes: { min: 0, max: 40 },
      avgPlayerPlusMinus: { min: -30, max: 30 },
      avgPlayerEfficiency: { min: -10, max: 40 },
      topPlayerMinutes: { min: 0, max: 40 },
      topPlayerPoints: { min: 0, max: 50 },
      
      // Lineup metrics (estimated ranges)
      startingLineupMinutes: { min: 0, max: 200 },
      benchContribution: { min: 0, max: 1 },
      lineupEfficiency: { min: -50, max: 50 },
      
      // Defensive metrics (0-1 normalized ranges)
      opponentFgPctAllowed: { min: 0, max: 100 },
      opponentFg3PctAllowed: { min: 0, max: 100 },
      defensiveReboundingPct: { min: 0, max: 1 },
      pointsInPaintAllowed: { min: 0, max: 1 },
      defensiveEfficiency: { min: 0, max: 1 }
    };
  }

  /**
   * Fetch game XML from StatBroadcast archive
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<string>} - XML content
   */
  async fetchGameXML(gameId) {
    try {
      logger.debug('Fetching game XML for feature extraction', { gameId });
      
      const xml = await this.client.fetchGameXML(gameId);
      
      if (!xml || xml.trim().length === 0) {
        throw new Error(`Empty XML response for game ${gameId}`);
      }
      
      return xml;
    } catch (error) {
      logger.error('Failed to fetch game XML', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Extract comprehensive 85-dimensional features from parsed game data
   * @param {Object} gameData - Parsed game data from XMLGameParser
   * @returns {Object} - Feature vectors for both teams
   */
  extractGameFeatures(gameData) {
    try {
      const { teams, metadata } = gameData;
      
      if (!teams || !teams.visitor || !teams.home) {
        throw new Error('Invalid game data: missing team information');
      }

      // Extract features for both teams (pass opponent data for defensive metrics)
      const visitorFeatures = this.extractTeamFeatures(teams.visitor, metadata, teams.home);
      const homeFeatures = this.extractTeamFeatures(teams.home, metadata, teams.visitor);

      logger.debug('Extracted game features', {
        gameId: metadata.gameId,
        visitorFeatureDim: Object.keys(visitorFeatures).length,
        homeFeatureDim: Object.keys(homeFeatures).length
      });

      return {
        visitor: visitorFeatures,
        home: homeFeatures
      };

    } catch (error) {
      logger.error('Failed to extract game features', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Extract features for a single team
   * @param {Object} teamData - Team data from parsed game
   * @param {Object} metadata - Game metadata
   * @param {Object} opponentData - Opponent team data for defensive metrics
   * @returns {Object} - 88-dimensional feature vector (added defensive features)
   */
  extractTeamFeatures(teamData, metadata, opponentData = null) {
    const features = {};
    
    // Basic shooting stats (9 features)
    features.fgm = teamData.stats.fgm || 0;
    features.fga = teamData.stats.fga || 0;
    features.fgPct = teamData.stats.fgPct || 0;
    features.fg3m = teamData.stats.fg3m || 0;
    features.fg3a = teamData.stats.fg3a || 0;
    features.fg3Pct = teamData.stats.fg3Pct || 0;
    features.ftm = teamData.stats.ftm || 0;
    features.fta = teamData.stats.fta || 0;
    features.ftPct = teamData.stats.ftPct || 0;

    // Rebounding stats (3 features)
    features.rebounds = teamData.stats.rebounds || 0;
    features.offensiveRebounds = teamData.stats.offensiveRebounds || 0;
    features.defensiveRebounds = teamData.stats.defensiveRebounds || 0;

    // Other basic stats (7 features)
    features.assists = teamData.stats.assists || 0;
    features.turnovers = teamData.stats.turnovers || 0;
    features.steals = teamData.stats.steals || 0;
    features.blocks = teamData.stats.blocks || 0;
    features.personalFouls = teamData.stats.personalFouls || 0;
    features.technicalFouls = teamData.stats.technicalFouls || 0;
    features.points = teamData.stats.points || 0;

    // Advanced metrics (10 features)
    features.pointsInPaint = teamData.advancedMetrics.pointsInPaint || 0;
    features.fastBreakPoints = teamData.advancedMetrics.fastBreakPoints || 0;
    features.secondChancePoints = teamData.advancedMetrics.secondChancePoints || 0;
    features.pointsOffTurnovers = teamData.advancedMetrics.pointsOffTurnovers || 0;
    features.benchPoints = teamData.advancedMetrics.benchPoints || 0;
    features.possessionCount = teamData.advancedMetrics.possessionCount || 0;
    features.ties = teamData.advancedMetrics.ties || 0;
    features.leads = teamData.advancedMetrics.leads || 0;
    features.largestLead = teamData.advancedMetrics.largestLead || 0;
    features.biggestRun = teamData.advancedMetrics.biggestRun || 0;

    // Derived metrics (3 features)
    features.effectiveFgPct = teamData.derivedMetrics.effectiveFgPct || 0;
    features.trueShootingPct = teamData.derivedMetrics.trueShootingPct || 0;
    features.turnoverRate = teamData.derivedMetrics.turnoverRate || 0;

    // Player-level aggregated features (20 features)
    const playerFeatures = this.extractPlayerFeatures(teamData.players);
    Object.assign(features, playerFeatures);

    // Lineup combination features (15 features)
    const lineupFeatures = this.extractLineupFeatures(teamData.players);
    Object.assign(features, lineupFeatures);

    // Game context features (8 features)
    const contextFeatures = this.extractContextFeatures(metadata, teamData);
    Object.assign(features, contextFeatures);

    // Shooting distribution features (8 features)
    const shootingFeatures = this.extractShootingDistribution(teamData.stats);
    Object.assign(features, shootingFeatures);

    // Defensive features (5 features) - requires opponent data
    const defensiveFeatures = this.extractDefensiveFeatures(teamData, opponentData);
    Object.assign(features, defensiveFeatures);

    return features;
  }

  /**
   * Extract player-level aggregated features
   * @param {Array} players - Array of player data
   * @returns {Object} - Player-level features (20 dimensions)
   */
  extractPlayerFeatures(players) {
    if (!players || players.length === 0) {
      return this.getEmptyPlayerFeatures();
    }

    const activePlayers = players.filter(p => p.stats.minutes > 0);
    
    if (activePlayers.length === 0) {
      return this.getEmptyPlayerFeatures();
    }

    // Calculate aggregated statistics
    const totalMinutes = activePlayers.reduce((sum, p) => sum + p.stats.minutes, 0);
    const avgMinutes = totalMinutes / activePlayers.length;
    
    const totalPlusMinus = activePlayers.reduce((sum, p) => sum + p.stats.plusMinus, 0);
    const avgPlusMinus = totalPlusMinus / activePlayers.length;
    
    const totalEfficiency = activePlayers.reduce((sum, p) => sum + p.stats.efficiency, 0);
    const avgEfficiency = totalEfficiency / activePlayers.length;

    // Find top performers
    const topScorer = activePlayers.reduce((max, p) => 
      p.stats.points > max.stats.points ? p : max, activePlayers[0]);
    
    const topMinutesPlayer = activePlayers.reduce((max, p) => 
      p.stats.minutes > max.stats.minutes ? p : max, activePlayers[0]);

    // Calculate bench vs starter metrics
    const starters = activePlayers.filter(p => p.gamesStarted > 0 || p.stats.minutes >= 20);
    const bench = activePlayers.filter(p => p.gamesStarted === 0 && p.stats.minutes < 20);
    
    const starterPoints = starters.reduce((sum, p) => sum + p.stats.points, 0);
    const benchPoints = bench.reduce((sum, p) => sum + p.stats.points, 0);
    const totalPoints = starterPoints + benchPoints;
    
    const benchContribution = totalPoints > 0 ? benchPoints / totalPoints : 0;

    return {
      avgPlayerMinutes: avgMinutes,
      avgPlayerPlusMinus: avgPlusMinus,
      avgPlayerEfficiency: avgEfficiency,
      topPlayerMinutes: topMinutesPlayer.stats.minutes,
      topPlayerPoints: topScorer.stats.points,
      topPlayerRebounds: topScorer.stats.rebounds,
      topPlayerAssists: topScorer.stats.assists,
      playersUsed: activePlayers.length,
      starterMinutes: starters.reduce((sum, p) => sum + p.stats.minutes, 0),
      benchMinutes: bench.reduce((sum, p) => sum + p.stats.minutes, 0),
      benchContribution: benchContribution,
      starterEfficiency: starters.length > 0 ? 
        starters.reduce((sum, p) => sum + p.stats.efficiency, 0) / starters.length : 0,
      benchEfficiency: bench.length > 0 ? 
        bench.reduce((sum, p) => sum + p.stats.efficiency, 0) / bench.length : 0,
      depthScore: Math.min(activePlayers.length / 8, 1), // Normalized depth score
      minuteDistribution: this.calculateMinuteDistribution(activePlayers),
      topPlayerUsage: this.calculateTopPlayerUsage(activePlayers),
      balanceScore: this.calculateBalanceScore(activePlayers),
      clutchPerformance: this.calculateClutchPerformance(activePlayers),
      experienceLevel: this.calculateExperienceLevel(activePlayers),
      versatilityScore: this.calculateVersatilityScore(activePlayers)
    };
  }

  /**
   * Get empty player features for games with no player data
   * @returns {Object} - Empty player features
   */
  getEmptyPlayerFeatures() {
    return {
      avgPlayerMinutes: 0, avgPlayerPlusMinus: 0, avgPlayerEfficiency: 0,
      topPlayerMinutes: 0, topPlayerPoints: 0, topPlayerRebounds: 0,
      topPlayerAssists: 0, playersUsed: 0, starterMinutes: 0,
      benchMinutes: 0, benchContribution: 0, starterEfficiency: 0,
      benchEfficiency: 0, depthScore: 0, minuteDistribution: 0,
      topPlayerUsage: 0, balanceScore: 0, clutchPerformance: 0,
      experienceLevel: 0, versatilityScore: 0
    };
  }

  /**
   * Calculate minute distribution metric
   * @param {Array} players - Active players
   * @returns {number} - Minute distribution score (0-1)
   */
  calculateMinuteDistribution(players) {
    if (players.length === 0) return 0;
    
    const minutes = players.map(p => p.stats.minutes);
    const totalMinutes = minutes.reduce((sum, m) => sum + m, 0);
    
    if (totalMinutes === 0) return 0;
    
    // Calculate Gini coefficient for minute distribution
    const sortedMinutes = minutes.sort((a, b) => a - b);
    const n = sortedMinutes.length;
    let sum = 0;
    
    for (let i = 0; i < n; i++) {
      sum += (2 * (i + 1) - n - 1) * sortedMinutes[i];
    }
    
    const gini = sum / (n * totalMinutes);
    return Math.abs(gini); // Return absolute value as distribution metric
  }

  /**
   * Calculate top player usage rate
   * @param {Array} players - Active players
   * @returns {number} - Top player usage (0-1)
   */
  calculateTopPlayerUsage(players) {
    if (players.length === 0) return 0;
    
    const totalMinutes = players.reduce((sum, p) => sum + p.stats.minutes, 0);
    const maxMinutes = Math.max(...players.map(p => p.stats.minutes));
    
    return totalMinutes > 0 ? maxMinutes / totalMinutes : 0;
  }

  /**
   * Calculate team balance score
   * @param {Array} players - Active players
   * @returns {number} - Balance score (0-1)
   */
  calculateBalanceScore(players) {
    if (players.length === 0) return 0;
    
    // Balance based on points distribution
    const points = players.map(p => p.stats.points);
    const totalPoints = points.reduce((sum, p) => sum + p, 0);
    
    if (totalPoints === 0) return 0;
    
    const contributions = points.map(p => p / totalPoints);
    const entropy = -contributions.reduce((sum, c) => 
      c > 0 ? sum + c * Math.log2(c) : sum, 0);
    
    // Normalize entropy to 0-1 scale
    const maxEntropy = Math.log2(players.length);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  /**
   * Calculate clutch performance metric
   * @param {Array} players - Active players
   * @returns {number} - Clutch performance score
   */
  calculateClutchPerformance(players) {
    // Simplified clutch metric based on plus/minus and efficiency
    if (players.length === 0) return 0;
    
    const avgPlusMinus = players.reduce((sum, p) => sum + p.stats.plusMinus, 0) / players.length;
    const avgEfficiency = players.reduce((sum, p) => sum + p.stats.efficiency, 0) / players.length;
    
    // Combine plus/minus and efficiency for clutch score
    return Math.max(0, (avgPlusMinus + avgEfficiency) / 20); // Normalize to 0-1
  }

  /**
   * Calculate experience level
   * @param {Array} players - Active players
   * @returns {number} - Experience level (0-1)
   */
  calculateExperienceLevel(players) {
    if (players.length === 0) return 0;
    
    // Use class information if available, otherwise use games played
    const experienceScores = players.map(p => {
      if (p.class) {
        const classMap = { 'FR': 0.25, 'SO': 0.5, 'JR': 0.75, 'SR': 1.0 };
        return classMap[p.class] || 0.5;
      }
      return Math.min(p.gamesPlayed / 30, 1); // Normalize games played
    });
    
    return experienceScores.reduce((sum, s) => sum + s, 0) / experienceScores.length;
  }

  /**
   * Calculate versatility score
   * @param {Array} players - Active players
   * @returns {number} - Versatility score (0-1)
   */
  calculateVersatilityScore(players) {
    if (players.length === 0) return 0;
    
    // Versatility based on how many players contribute in multiple categories
    let versatileCount = 0;
    
    for (const player of players) {
      const stats = player.stats;
      let categories = 0;
      
      if (stats.points > 5) categories++;
      if (stats.rebounds > 3) categories++;
      if (stats.assists > 2) categories++;
      if (stats.steals > 1) categories++;
      if (stats.blocks > 1) categories++;
      
      if (categories >= 3) versatileCount++;
    }
    
    return versatileCount / players.length;
  }

  /**
   * Extract lineup combination features
   * @param {Array} players - Array of player data
   * @returns {Object} - Lineup features (15 dimensions)
   */
  extractLineupFeatures(players) {
    if (!players || players.length === 0) {
      return this.getEmptyLineupFeatures();
    }

    const activePlayers = players.filter(p => p.stats.minutes > 0);
    
    // Starting lineup analysis (players with most minutes)
    const sortedByMinutes = activePlayers.sort((a, b) => b.stats.minutes - a.stats.minutes);
    const startingFive = sortedByMinutes.slice(0, 5);
    
    const startingLineupMinutes = startingFive.reduce((sum, p) => sum + p.stats.minutes, 0);
    const startingLineupPoints = startingFive.reduce((sum, p) => sum + p.stats.points, 0);
    const startingLineupEfficiency = startingFive.length > 0 ? 
      startingFive.reduce((sum, p) => sum + p.stats.efficiency, 0) / startingFive.length : 0;

    // Bench analysis
    const bench = sortedByMinutes.slice(5);
    const benchMinutes = bench.reduce((sum, p) => sum + p.stats.minutes, 0);
    const benchPoints = bench.reduce((sum, p) => sum + p.stats.points, 0);
    
    const totalPoints = startingLineupPoints + benchPoints;
    const benchContribution = totalPoints > 0 ? benchPoints / totalPoints : 0;

    // Rotation patterns
    const rotationDepth = Math.min(activePlayers.length, 10);
    const minutesDistribution = this.calculateMinuteDistribution(activePlayers);

    return {
      startingLineupMinutes: startingLineupMinutes,
      startingLineupPoints: startingLineupPoints,
      startingLineupEfficiency: startingLineupEfficiency,
      benchContribution: benchContribution,
      benchMinutes: benchMinutes,
      benchPoints: benchPoints,
      rotationDepth: rotationDepth,
      minutesDistribution: minutesDistribution,
      lineupBalance: this.calculateLineupBalance(startingFive),
      substitutionRate: this.calculateSubstitutionRate(activePlayers),
      depthUtilization: Math.min(activePlayers.length / 8, 1),
      starterDominance: this.calculateStarterDominance(startingFive, bench),
      lineupVersatility: this.calculateLineupVersatility(startingFive),
      benchImpact: this.calculateBenchImpact(bench),
      rotationEfficiency: this.calculateRotationEfficiency(activePlayers)
    };
  }

  /**
   * Get empty lineup features
   * @returns {Object} - Empty lineup features
   */
  getEmptyLineupFeatures() {
    return {
      startingLineupMinutes: 0, startingLineupPoints: 0, startingLineupEfficiency: 0,
      benchContribution: 0, benchMinutes: 0, benchPoints: 0,
      rotationDepth: 0, minutesDistribution: 0, lineupBalance: 0,
      substitutionRate: 0, depthUtilization: 0, starterDominance: 0,
      lineupVersatility: 0, benchImpact: 0, rotationEfficiency: 0
    };
  }

  /**
   * Calculate lineup balance
   * @param {Array} startingFive - Starting five players
   * @returns {number} - Balance score (0-1)
   */
  calculateLineupBalance(startingFive) {
    if (startingFive.length === 0) return 0;
    
    const minutes = startingFive.map(p => p.stats.minutes);
    const avgMinutes = minutes.reduce((sum, m) => sum + m, 0) / minutes.length;
    
    if (avgMinutes === 0) return 0;
    
    // Calculate coefficient of variation
    const variance = minutes.reduce((sum, m) => sum + Math.pow(m - avgMinutes, 2), 0) / minutes.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / avgMinutes;
    
    // Return inverse of CV as balance score (lower CV = higher balance)
    return Math.max(0, 1 - cv);
  }

  /**
   * Calculate substitution rate
   * @param {Array} players - All active players
   * @returns {number} - Substitution rate metric
   */
  calculateSubstitutionRate(players) {
    // Simplified substitution rate based on number of players used
    const playersUsed = players.length;
    return Math.min(playersUsed / 10, 1); // Normalize to 0-1
  }

  /**
   * Calculate starter dominance
   * @param {Array} starters - Starting players
   * @param {Array} bench - Bench players
   * @returns {number} - Starter dominance (0-1)
   */
  calculateStarterDominance(starters, bench) {
    const starterMinutes = starters.reduce((sum, p) => sum + p.stats.minutes, 0);
    const benchMinutes = bench.reduce((sum, p) => sum + p.stats.minutes, 0);
    const totalMinutes = starterMinutes + benchMinutes;
    
    return totalMinutes > 0 ? starterMinutes / totalMinutes : 0;
  }

  /**
   * Calculate lineup versatility
   * @param {Array} lineup - Lineup players
   * @returns {number} - Versatility score (0-1)
   */
  calculateLineupVersatility(lineup) {
    if (lineup.length === 0) return 0;
    
    // Count players who contribute in multiple statistical categories
    let versatileCount = 0;
    
    for (const player of lineup) {
      const stats = player.stats;
      let categories = 0;
      
      if (stats.points > 0) categories++;
      if (stats.rebounds > 0) categories++;
      if (stats.assists > 0) categories++;
      if (stats.steals > 0) categories++;
      if (stats.blocks > 0) categories++;
      
      if (categories >= 3) versatileCount++;
    }
    
    return versatileCount / lineup.length;
  }

  /**
   * Calculate bench impact
   * @param {Array} bench - Bench players
   * @returns {number} - Bench impact score
   */
  calculateBenchImpact(bench) {
    if (bench.length === 0) return 0;
    
    const totalPlusMinus = bench.reduce((sum, p) => sum + p.stats.plusMinus, 0);
    const avgPlusMinus = totalPlusMinus / bench.length;
    
    // Normalize plus/minus to 0-1 scale
    return Math.max(0, (avgPlusMinus + 20) / 40);
  }

  /**
   * Calculate rotation efficiency
   * @param {Array} players - All players
   * @returns {number} - Rotation efficiency (0-1)
   */
  calculateRotationEfficiency(players) {
    if (players.length === 0) return 0;
    
    const totalEfficiency = players.reduce((sum, p) => sum + p.stats.efficiency, 0);
    const avgEfficiency = totalEfficiency / players.length;
    
    // Normalize efficiency to 0-1 scale
    return Math.max(0, Math.min(1, (avgEfficiency + 10) / 30));
  }

  /**
   * Extract game context features
   * @param {Object} metadata - Game metadata
   * @param {Object} teamData - Team data
   * @returns {Object} - Context features (8 dimensions)
   */
  extractContextFeatures(metadata, teamData) {
    return {
      isNeutralSite: metadata.neutralGame === 'Y' ? 1 : 0,
      isPostseason: metadata.postseason === 'Y' ? 1 : 0,
      gameLength: this.calculateGameLength(teamData.periodScoring),
      paceOfPlay: this.calculatePaceOfPlay(teamData),
      competitiveBalance: this.calculateCompetitiveBalance(teamData),
      gameFlow: this.calculateGameFlow(teamData.periodScoring),
      intensityLevel: this.calculateIntensityLevel(teamData),
      gameContext: this.calculateGameContext(metadata)
    };
  }

  /**
   * Calculate game length (number of periods)
   * @param {Array} periodScoring - Period scoring data
   * @returns {number} - Number of periods
   */
  calculateGameLength(periodScoring) {
    return periodScoring ? periodScoring.length : 2;
  }

  /**
   * Calculate pace of play
   * @param {Object} teamData - Team data
   * @returns {number} - Pace metric
   */
  calculatePaceOfPlay(teamData) {
    const possessions = teamData.advancedMetrics.possessionCount || 70;
    // Normalize possessions to 0-1 scale (typical range 60-90)
    return Math.max(0, Math.min(1, (possessions - 60) / 30));
  }

  /**
   * Calculate competitive balance
   * @param {Object} teamData - Team data
   * @returns {number} - Balance metric based on leads/ties
   */
  calculateCompetitiveBalance(teamData) {
    const ties = teamData.advancedMetrics.ties || 0;
    const leads = teamData.advancedMetrics.leads || 0;
    const largestLead = teamData.advancedMetrics.largestLead || 0;
    
    // Higher ties and lower largest lead indicate more competitive game
    const competitiveness = (ties / 10) - (largestLead / 30);
    return Math.max(0, Math.min(1, (competitiveness + 1) / 2));
  }

  /**
   * Calculate game flow
   * @param {Array} periodScoring - Period scoring data
   * @returns {number} - Game flow metric
   */
  calculateGameFlow(periodScoring) {
    if (!periodScoring || periodScoring.length === 0) return 0;
    
    // Calculate scoring variance across periods
    const scores = periodScoring.map(p => p.score);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;
    
    // Normalize variance to 0-1 scale
    return Math.min(1, variance / 100);
  }

  /**
   * Calculate intensity level
   * @param {Object} teamData - Team data
   * @returns {number} - Intensity metric
   */
  calculateIntensityLevel(teamData) {
    const fouls = teamData.stats.personalFouls || 0;
    const turnovers = teamData.stats.turnovers || 0;
    const steals = teamData.stats.steals || 0;
    
    // Higher fouls, turnovers, and steals indicate higher intensity
    const intensity = (fouls + turnovers + steals) / 50;
    return Math.min(1, intensity);
  }

  /**
   * Calculate game context
   * @param {Object} metadata - Game metadata
   * @returns {number} - Context importance (0-1)
   */
  calculateGameContext(metadata) {
    let context = 0;
    
    // Postseason games are more important
    if (metadata.postseason === 'Y') context += 0.5;
    
    // Neutral site games often more important
    if (metadata.neutralGame === 'Y') context += 0.3;
    
    // Conference games (inferred from competition name)
    if (metadata.competitionName && metadata.competitionName.toLowerCase().includes('conference')) {
      context += 0.2;
    }
    
    return Math.min(1, context);
  }

  /**
   * Extract shooting distribution features
   * @param {Object} stats - Team statistics
   * @returns {Object} - Shooting distribution features (8 dimensions)
   */
  extractShootingDistribution(stats) {
    const totalFga = stats.fga || 0;
    const totalFta = stats.fta || 0;
    
    return {
      twoPointAttemptRate: totalFga > 0 ? (stats.fga - stats.fg3a) / totalFga : 0,
      threePointAttemptRate: totalFga > 0 ? stats.fg3a / totalFga : 0,
      freeThrowRate: totalFga > 0 ? totalFta / totalFga : 0,
      twoPointAccuracy: (stats.fga - stats.fg3a) > 0 ? (stats.fgm - stats.fg3m) / (stats.fga - stats.fg3a) : 0,
      threePointAccuracy: stats.fg3a > 0 ? stats.fg3m / stats.fg3a : 0,
      freeThrowAccuracy: totalFta > 0 ? stats.ftm / totalFta : 0,
      shotSelection: this.calculateShotSelection(stats),
      shootingEfficiency: this.calculateShootingEfficiency(stats)
    };
  }

  /**
   * Calculate shot selection metric
   * @param {Object} stats - Team statistics
   * @returns {number} - Shot selection quality (0-1)
   */
  calculateShotSelection(stats) {
    const totalFga = stats.fga || 0;
    if (totalFga === 0) return 0;
    
    // Good shot selection: higher 3PT rate and lower mid-range
    const threePointRate = stats.fg3a / totalFga;
    
    // Assume good shot selection is 30-40% three-point attempts
    const optimalThreeRate = 0.35;
    const deviation = Math.abs(threePointRate - optimalThreeRate);
    
    return Math.max(0, 1 - (deviation / 0.35));
  }

  /**
   * Calculate shooting efficiency
   * @param {Object} stats - Team statistics
   * @returns {number} - Overall shooting efficiency (0-1)
   */
  calculateShootingEfficiency(stats) {
    const totalFga = stats.fga || 0;
    const totalFta = stats.fta || 0;
    
    if (totalFga === 0 && totalFta === 0) return 0;
    
    // Calculate effective field goal percentage
    const efg = totalFga > 0 ? (stats.fgm + 0.5 * stats.fg3m) / totalFga : 0;
    
    // Calculate true shooting percentage
    const tsDenominator = 2 * (totalFga + 0.44 * totalFta);
    const ts = tsDenominator > 0 ? stats.points / tsDenominator : 0;
    
    // Combine EFG and TS for overall efficiency
    return Math.min(1, (efg + ts) / 2);
  }

  /**
   * Extract defensive features based on opponent performance
   * @param {Object} teamData - This team's data
   * @param {Object} opponentData - Opponent team's data
   * @returns {Object} - Defensive features (5 dimensions)
   */
  extractDefensiveFeatures(teamData, opponentData) {
    if (!opponentData) {
      return this.getEmptyDefensiveFeatures();
    }

    const opponentStats = opponentData.stats;
    const opponentAdvanced = opponentData.advancedMetrics;
    const teamStats = teamData.stats;
    const teamAdvanced = teamData.advancedMetrics;

    // Calculate defensive metrics based on what the opponent achieved
    const defensiveFeatures = {
      // Opponent shooting defense (how well we defended their shots)
      opponentFgPctAllowed: opponentStats.fgPct || 0,
      opponentFg3PctAllowed: opponentStats.fg3Pct || 0,
      
      // Defensive rebounding effectiveness
      defensiveReboundingPct: this.calculateDefensiveReboundingPct(teamStats, opponentStats),
      
      // Points allowed in key areas (normalized)
      pointsInPaintAllowed: this.normalizeDefensiveMetric(opponentAdvanced.pointsInPaint || 0, 0, 60),
      
      // Overall defensive efficiency (points allowed per possession)
      defensiveEfficiency: this.calculateDefensiveEfficiency(opponentStats, opponentAdvanced)
    };

    return defensiveFeatures;
  }

  /**
   * Get empty defensive features when opponent data is unavailable
   * @returns {Object} - Empty defensive features
   */
  getEmptyDefensiveFeatures() {
    return {
      opponentFgPctAllowed: 0,
      opponentFg3PctAllowed: 0,
      defensiveReboundingPct: 0,
      pointsInPaintAllowed: 0,
      defensiveEfficiency: 0
    };
  }

  /**
   * Calculate defensive rebounding percentage
   * @param {Object} teamStats - This team's stats
   * @param {Object} opponentStats - Opponent's stats
   * @returns {number} - Defensive rebounding percentage (0-1)
   */
  calculateDefensiveReboundingPct(teamStats, opponentStats) {
    const teamDefReb = teamStats.defensiveRebounds || 0;
    const opponentOffReb = opponentStats.offensiveRebounds || 0;
    const totalDefensiveRebounds = teamDefReb + opponentOffReb;
    
    return totalDefensiveRebounds > 0 ? teamDefReb / totalDefensiveRebounds : 0;
  }

  /**
   * Normalize defensive metric to 0-1 scale
   * @param {number} value - Raw value
   * @param {number} min - Minimum expected value
   * @param {number} max - Maximum expected value
   * @returns {number} - Normalized value (0-1)
   */
  normalizeDefensiveMetric(value, min, max) {
    const range = max - min;
    return range > 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0;
  }

  /**
   * Calculate defensive efficiency (lower is better, so we invert it)
   * @param {Object} opponentStats - Opponent's stats
   * @param {Object} opponentAdvanced - Opponent's advanced metrics
   * @returns {number} - Defensive efficiency metric (0-1, higher is better defense)
   */
  calculateDefensiveEfficiency(opponentStats, opponentAdvanced) {
    const opponentPoints = opponentStats.points || 0;
    const opponentPossessions = opponentAdvanced.possessionCount || 70; // Default estimate
    
    if (opponentPossessions === 0) return 0;
    
    // Points per possession allowed (lower is better)
    const pointsPerPossession = opponentPoints / opponentPossessions;
    
    // Typical range is 0.8 to 1.4 points per possession
    // Invert so higher values mean better defense
    const normalizedEfficiency = Math.max(0, Math.min(1, (1.4 - pointsPerPossession) / 0.6));
    
    return normalizedEfficiency;
  }

  /**
   * Normalize features to [0,1] range
   * @param {Object} features - Raw feature vector
   * @returns {Object} - Normalized feature vector
   */
  normalizeFeatures(features) {
    const normalized = {};
    
    for (const [key, value] of Object.entries(features)) {
      const bounds = this.featureBounds[key];
      
      if (bounds) {
        // Normalize using min-max scaling
        const range = bounds.max - bounds.min;
        normalized[key] = range > 0 ? Math.max(0, Math.min(1, (value - bounds.min) / range)) : 0;
      } else {
        // For features without defined bounds, assume they're already normalized or use default
        normalized[key] = Math.max(0, Math.min(1, value));
      }
    }
    
    return normalized;
  }

  /**
   * Initialize team latent distribution with random values
   * @param {string} teamId - Team ID
   * @returns {Object} - Initial latent distribution N(μ, σ²)
   */
  initializeTeamLatentDistribution(teamId) {
    const dimensions = 16;
    const mu = Array(dimensions).fill(0).map(() => Math.random() * 0.2 - 0.1); // Small random values around 0
    const sigma = Array(dimensions).fill(0).map(() => 0.5 + Math.random() * 0.5); // Initial uncertainty
    
    return {
      mu: mu,
      sigma: sigma,
      games_processed: 0,
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Mark game as processed in the database
   * @param {string} gameId - Game ID to mark as processed
   * @returns {Promise<void>}
   */
  async markGameAsProcessed(gameId) {
    try {
      await dbConnection.run(
        'UPDATE game_ids SET processed = 1, updated_at = ? WHERE game_id = ?',
        [new Date().toISOString(), gameId]
      );
      
      logger.debug('Marked game as processed', { gameId });
    } catch (error) {
      logger.error('Failed to mark game as processed', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process a single game: fetch XML, extract features, compute transition probabilities
   * @param {string} gameId - StatBroadcast game ID
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results
   */
  async processGame(gameId, options = {}) {
    try {
      logger.info('Processing game for VAE feature extraction', { gameId });

      // Fetch and parse game XML
      const xml = await this.fetchGameXML(gameId);
      const gameData = await this.parser.parseGameXML(xml);

      // Extract features for both teams
      const rawFeatures = this.extractGameFeatures(gameData);
      
      // Normalize features to [0,1] range
      const normalizedFeatures = {
        visitor: this.normalizeFeatures(rawFeatures.visitor),
        home: this.normalizeFeatures(rawFeatures.home)
      };

      // Compute transition probabilities as ground truth
      const transitionProbabilities = this.transitionComputer.computeTransitionProbabilities(gameData);

      // Initialize team latent distributions if they don't exist
      const visitorTeamId = gameData.teams.visitor.id;
      const homeTeamId = gameData.teams.home.id;

      await this.ensureTeamLatentDistributions(visitorTeamId, homeTeamId);

      // Mark game as processed
      await this.markGameAsProcessed(gameId);

      const result = {
        gameId,
        metadata: gameData.metadata,
        features: normalizedFeatures,
        transitionProbabilities,
        teams: {
          visitor: { id: visitorTeamId, name: gameData.teams.visitor.name },
          home: { id: homeTeamId, name: gameData.teams.home.name }
        },
        featureDimensions: Object.keys(normalizedFeatures.visitor).length
      };

      logger.info('Game processing completed', {
        gameId,
        visitorTeam: result.teams.visitor.name,
        homeTeam: result.teams.home.name,
        featureDimensions: result.featureDimensions
      });

      return result;

    } catch (error) {
      logger.error('Failed to process game', {
        gameId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Ensure team latent distributions exist in database
   * @param {string} visitorTeamId - Visitor team ID
   * @param {string} homeTeamId - Home team ID
   * @returns {Promise<void>}
   */
  async ensureTeamLatentDistributions(visitorTeamId, homeTeamId) {
    try {
      // Check and initialize visitor team
      const visitorTeam = await this.teamRepository.getTeamByEspnId(visitorTeamId);
      if (visitorTeam && !visitorTeam.statisticalRepresentation) {
        const initialDistribution = this.initializeTeamLatentDistribution(visitorTeamId);
        await this.teamRepository.updateStatisticalRepresentation(visitorTeamId, initialDistribution);
        
        logger.debug('Initialized latent distribution for visitor team', {
          teamId: visitorTeamId
        });
      }

      // Check and initialize home team
      const homeTeam = await this.teamRepository.getTeamByEspnId(homeTeamId);
      if (homeTeam && !homeTeam.statisticalRepresentation) {
        const initialDistribution = this.initializeTeamLatentDistribution(homeTeamId);
        await this.teamRepository.updateStatisticalRepresentation(homeTeamId, initialDistribution);
        
        logger.debug('Initialized latent distribution for home team', {
          teamId: homeTeamId
        });
      }

    } catch (error) {
      logger.error('Failed to ensure team latent distributions', {
        visitorTeamId,
        homeTeamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process multiple games in batch
   * @param {Array<string>} gameIds - Array of game IDs to process
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Array of processing results
   */
  async processGameBatch(gameIds, options = {}) {
    const { continueOnError = true, onProgress = null } = options;
    const results = [];
    const errors = [];

    logger.info('Processing game batch for VAE feature extraction', {
      totalGames: gameIds.length
    });

    for (let i = 0; i < gameIds.length; i++) {
      const gameId = gameIds[i];
      
      try {
        const result = await this.processGame(gameId);
        results.push(result);

        if (onProgress) {
          onProgress(i + 1, gameIds.length, gameId, null);
        }

      } catch (error) {
        const errorInfo = { gameId, error: error.message, index: i + 1 };
        errors.push(errorInfo);

        logger.error('Failed to process game in batch', errorInfo);

        if (onProgress) {
          onProgress(i + 1, gameIds.length, gameId, error);
        }

        if (!continueOnError) {
          throw error;
        }
      }
    }

    logger.info('Game batch processing completed', {
      requested: gameIds.length,
      successful: results.length,
      failed: errors.length
    });

    return results;
  }

  /**
   * Get unprocessed games from database
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Array of unprocessed game IDs
   */
  async getUnprocessedGames(options = {}) {
    try {
      const { limit = null, orderBy = 'game_date ASC' } = options;
      
      let sql = 'SELECT game_id, game_date, home_team_id, away_team_id FROM game_ids WHERE processed = 0';
      
      if (orderBy) {
        sql += ` ORDER BY ${orderBy}`;
      }
      
      if (limit) {
        sql += ` LIMIT ${limit}`;
      }

      const rows = await dbConnection.all(sql);
      
      logger.info('Retrieved unprocessed games', {
        count: rows.length,
        limit,
        orderBy
      });

      return rows;

    } catch (error) {
      logger.error('Failed to get unprocessed games', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Close resources
   * @returns {Promise<void>}
   */
  async close() {
    try {
      await this.client.closeBrowser();
      logger.debug('VAE feature extractor resources closed');
    } catch (error) {
      logger.error('Error closing VAE feature extractor resources', {
        error: error.message
      });
    }
  }
}

module.exports = VAEFeatureExtractor;