#!/usr/bin/env node

/**
 * VAE-NN System Performance Validation Script
 * 
 * Validates the VAE-NN system performance by:
 * - Sampling recent games and comparing predicted vs actual transition probabilities
 * - Verifying team latent distributions have reasonable μ and decreasing σ over time
 * - Checking that VAE feedback loop is improving NN predictions
 * - Monitoring α decay and system convergence
 * - Logging validation metrics (prediction accuracy, calibration, team uncertainty)
 * 
 * Requirements: Model validation, system performance
 */

const VAEFeatureExtractor = require('../src/modules/sports/VAEFeatureExtractor');
const VariationalAutoencoder = require('../src/modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('../src/modules/sports/TransitionProbabilityNN');
const VAEFeedbackTrainer = require('../src/modules/sports/VAEFeedbackTrainer');
const BayesianTeamUpdater = require('../src/modules/sports/BayesianTeamUpdater');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

class VAESystemValidator {
  constructor() {
    this.featureExtractor = new VAEFeatureExtractor();
    this.vae = new VariationalAutoencoder(88, 16);
    this.transitionNN = new TransitionProbabilityNN(10);
    this.teamRepository = new TeamRepository();
    this.bayesianUpdater = new BayesianTeamUpdater(this.teamRepository);
    
    this.feedbackTrainer = new VAEFeedbackTrainer(this.vae, this.transitionNN, {
      feedbackThreshold: 0.5,
      initialAlpha: 0.1,
      alphaDecayRate: 0.99,
      minAlpha: 0.001
    });

    this.validationResults = {
      predictionAccuracy: {},
      teamDistributions: {},
      feedbackLoop: {},
      systemConvergence: {},
      calibrationMetrics: {}
    };
  }

  /**
   * Run complete VAE-NN system validation
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} - Validation results
   */
  async runValidation(options = {}) {
    const {
      sampleSize = 20,
      teamSampleSize = 10,
      minGamesForTeamAnalysis = 5,
      calibrationBins = 10
    } = options;

    logger.info('Starting VAE-NN system validation', {
      sampleSize,
      teamSampleSize,
      minGamesForTeamAnalysis,
      calibrationBins
    });

    try {
      // 1. Sample recent games and validate predictions
      await this.validatePredictionAccuracy(sampleSize);

      // 2. Verify team latent distributions
      await this.validateTeamDistributions(teamSampleSize, minGamesForTeamAnalysis);

      // 3. Check VAE feedback loop effectiveness
      await this.validateFeedbackLoop();

      // 4. Monitor α decay and system convergence
      await this.validateSystemConvergence();

      // 5. Calculate calibration metrics
      await this.validateCalibration(calibrationBins);

      // 6. Generate comprehensive report
      const report = this.generateValidationReport();

      logger.info('VAE-NN system validation completed', {
        overallScore: report.overallScore,
        criticalIssues: report.criticalIssues.length,
        recommendations: report.recommendations.length
      });

      return report;

    } catch (error) {
      logger.error('VAE-NN system validation failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Validate prediction accuracy by comparing predicted vs actual transition probabilities
   * @param {number} sampleSize - Number of recent games to sample
   */
  async validatePredictionAccuracy(sampleSize) {
    logger.info('Validating prediction accuracy', { sampleSize });

    try {
      // Get recent processed games
      const recentGames = await dbConnection.all(`
        SELECT game_id, game_date, home_team_id, away_team_id 
        FROM game_ids 
        WHERE processed = 1 AND sport = 'mens-college-basketball'
        ORDER BY game_date DESC 
        LIMIT ?
      `, [sampleSize]);

      if (recentGames.length === 0) {
        logger.warn('No processed games found for prediction validation');
        this.validationResults.predictionAccuracy = {
          status: 'insufficient_data',
          gamesAnalyzed: 0,
          message: 'No processed games available'
        };
        return;
      }

      const predictions = [];
      const errors = [];

      for (const gameInfo of recentGames) {
        try {
          // Extract game data
          const gameData = await this.featureExtractor.processGame(gameInfo.game_id);
          
          // Get team distributions
          const homeTeam = await this.teamRepository.getTeamByEspnId(gameInfo.home_team_id);
          const awayTeam = await this.teamRepository.getTeamByEspnId(gameInfo.away_team_id);

          if (!homeTeam?.statisticalRepresentation || !awayTeam?.statisticalRepresentation) {
            logger.debug('Skipping game due to missing team data', {
              gameId: gameInfo.game_id,
              homeTeamId: gameInfo.home_team_id,
              awayTeamId: gameInfo.away_team_id,
              homeTeamFound: !!homeTeam,
              awayTeamFound: !!awayTeam,
              homeTeamHasStats: !!homeTeam?.statisticalRepresentation,
              awayTeamHasStats: !!awayTeam?.statisticalRepresentation
            });
            continue; // Skip games with missing team data
          }

          const homeDistribution = JSON.parse(homeTeam.statisticalRepresentation);
          const awayDistribution = JSON.parse(awayTeam.statisticalRepresentation);

          // Build game context
          const gameContext = this.buildGameContext(gameData.metadata);

          // Generate predictions
          const homePrediction = this.transitionNN.predict(
            homeDistribution.mu,
            homeDistribution.sigma,
            awayDistribution.mu,
            awayDistribution.sigma,
            gameContext
          );

          const awayPrediction = this.transitionNN.predict(
            awayDistribution.mu,
            awayDistribution.sigma,
            homeDistribution.mu,
            homeDistribution.sigma,
            gameContext
          );

          // Get actual transition probabilities
          const homeActual = this.convertTransitionProbsToArray(gameData.transitionProbabilities.home);
          const awayActual = this.convertTransitionProbsToArray(gameData.transitionProbabilities.visitor);

          // Calculate prediction errors
          const homeError = this.calculatePredictionError(homePrediction, homeActual);
          const awayError = this.calculatePredictionError(awayPrediction, awayActual);

          predictions.push({
            gameId: gameInfo.game_id,
            gameDate: gameInfo.game_date,
            home: {
              teamId: gameInfo.home_team_id,
              predicted: homePrediction,
              actual: homeActual,
              error: homeError
            },
            away: {
              teamId: gameInfo.away_team_id,
              predicted: awayPrediction,
              actual: awayActual,
              error: awayError
            }
          });

        } catch (error) {
          errors.push({
            gameId: gameInfo.game_id,
            error: error.message
          });
        }
      }

      // Calculate aggregate metrics
      const allErrors = predictions.flatMap(p => [p.home.error, p.away.error]);
      const meanAbsoluteError = allErrors.reduce((sum, err) => sum + err.mae, 0) / allErrors.length;
      const rootMeanSquareError = Math.sqrt(allErrors.reduce((sum, err) => sum + err.mse, 0) / allErrors.length);
      const maxError = Math.max(...allErrors.map(err => err.maxAbsError));

      this.validationResults.predictionAccuracy = {
        status: 'completed',
        gamesAnalyzed: predictions.length,
        errors: errors.length,
        metrics: {
          meanAbsoluteError,
          rootMeanSquareError,
          maxError,
          averageAccuracy: 1 - meanAbsoluteError // Simple accuracy metric
        },
        predictions: predictions.slice(0, 5), // Keep sample for reporting
        summary: {
          acceptable: meanAbsoluteError < 0.1, // Threshold for acceptable accuracy
          excellent: meanAbsoluteError < 0.05
        }
      };

      logger.info('Prediction accuracy validation completed', {
        gamesAnalyzed: predictions.length,
        meanAbsoluteError: meanAbsoluteError.toFixed(4),
        rootMeanSquareError: rootMeanSquareError.toFixed(4),
        acceptable: this.validationResults.predictionAccuracy.summary.acceptable
      });

    } catch (error) {
      logger.error('Failed to validate prediction accuracy', {
        error: error.message
      });
      this.validationResults.predictionAccuracy = {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Validate team latent distributions for reasonable μ and decreasing σ over time
   * @param {number} teamSampleSize - Number of teams to analyze
   * @param {number} minGames - Minimum games required for analysis
   */
  async validateTeamDistributions(teamSampleSize, minGames) {
    logger.info('Validating team distributions', { teamSampleSize, minGames });

    try {
      // Get teams with statistical representations
      const teams = await dbConnection.all(`
        SELECT team_id, team_name, statistical_representation, updated_at
        FROM teams 
        WHERE statistical_representation IS NOT NULL 
        AND sport = 'mens-college-basketball'
        ORDER BY updated_at DESC 
        LIMIT ?
      `, [teamSampleSize]);

      if (teams.length === 0) {
        this.validationResults.teamDistributions = {
          status: 'insufficient_data',
          message: 'No teams with statistical representations found'
        };
        return;
      }

      const teamAnalyses = [];
      const distributionIssues = [];

      for (const team of teams) {
        try {
          const distribution = JSON.parse(team.statistical_representation);
          
          // Validate distribution structure
          if (!distribution.mu || !distribution.sigma || !Array.isArray(distribution.mu) || !Array.isArray(distribution.sigma)) {
            distributionIssues.push({
              teamId: team.team_id,
              issue: 'invalid_structure',
              message: 'Distribution missing mu or sigma arrays'
            });
            continue;
          }

          // Check dimensions
          if (distribution.mu.length !== 16 || distribution.sigma.length !== 16) {
            distributionIssues.push({
              teamId: team.team_id,
              issue: 'wrong_dimensions',
              message: `Expected 16 dimensions, got mu: ${distribution.mu.length}, sigma: ${distribution.sigma.length}`
            });
            continue;
          }

          // Analyze μ values (should be reasonable, not extreme)
          const muStats = this.calculateArrayStats(distribution.mu);
          const sigmaStats = this.calculateArrayStats(distribution.sigma);

          // Check for reasonable μ values (typically should be in [-3, 3] range for normalized latent space)
          const extremeMu = distribution.mu.some(val => Math.abs(val) > 5);
          
          // Check for positive σ values (uncertainty should be positive)
          const negativeSigma = distribution.sigma.some(val => val <= 0);
          
          // Check for reasonable σ values (should decrease over time, but not too small)
          const extremeSigma = distribution.sigma.some(val => val > 10 || val < 0.01);

          // Get game count for this team to check σ decay
          const gameCount = await this.getTeamGameCount(team.team_id);
          
          // Expected σ should decrease with more games
          const expectedSigmaRange = this.calculateExpectedSigmaRange(gameCount);
          const sigmaInRange = sigmaStats.mean >= expectedSigmaRange.min && sigmaStats.mean <= expectedSigmaRange.max;

          const analysis = {
            teamId: team.team_id,
            teamName: team.team_name,
            gameCount,
            distribution: {
              mu: muStats,
              sigma: sigmaStats
            },
            checks: {
              reasonableMu: !extremeMu,
              positiveSigma: !negativeSigma,
              reasonableSigma: !extremeSigma,
              sigmaInExpectedRange: sigmaInRange,
              sufficientGames: gameCount >= minGames
            },
            issues: []
          };

          // Record issues
          if (extremeMu) analysis.issues.push('Extreme μ values detected');
          if (negativeSigma) analysis.issues.push('Negative σ values detected');
          if (extremeSigma) analysis.issues.push('Extreme σ values detected');
          if (!sigmaInRange) analysis.issues.push('σ values outside expected range for game count');
          if (gameCount < minGames) analysis.issues.push('Insufficient games for reliable analysis');

          teamAnalyses.push(analysis);

        } catch (error) {
          distributionIssues.push({
            teamId: team.team_id,
            issue: 'parse_error',
            message: error.message
          });
        }
      }

      // Calculate aggregate statistics
      const validTeams = teamAnalyses.filter(t => t.checks.sufficientGames);
      const healthyTeams = validTeams.filter(t => t.issues.length === 0);
      
      const avgSigmaByGameCount = this.calculateSigmaDecayTrend(validTeams);

      this.validationResults.teamDistributions = {
        status: 'completed',
        teamsAnalyzed: teams.length,
        validTeams: validTeams.length,
        healthyTeams: healthyTeams.length,
        distributionIssues: distributionIssues.length,
        sigmaDecayTrend: avgSigmaByGameCount,
        summary: {
          healthyPercentage: validTeams.length > 0 ? (healthyTeams.length / validTeams.length) * 100 : 0,
          sigmaDecayingProperly: avgSigmaByGameCount.isDecaying,
          criticalIssues: distributionIssues.filter(i => i.issue === 'invalid_structure').length
        },
        sampleAnalyses: teamAnalyses.slice(0, 3), // Keep sample for reporting
        issues: distributionIssues
      };

      logger.info('Team distributions validation completed', {
        teamsAnalyzed: teams.length,
        healthyPercentage: this.validationResults.teamDistributions.summary.healthyPercentage.toFixed(1),
        sigmaDecaying: avgSigmaByGameCount.isDecaying,
        criticalIssues: this.validationResults.teamDistributions.summary.criticalIssues
      });

    } catch (error) {
      logger.error('Failed to validate team distributions', {
        error: error.message
      });
      this.validationResults.teamDistributions = {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Validate VAE feedback loop effectiveness
   */
  async validateFeedbackLoop() {
    logger.info('Validating VAE feedback loop');

    try {
      // Get feedback trainer statistics
      const trainerStats = this.feedbackTrainer.getTrainingStats();
      
      // Analyze feedback effectiveness
      const feedbackAnalysis = {
        totalIterations: trainerStats.totalIterations,
        feedbackTriggers: trainerStats.feedbackTriggers,
        feedbackRate: trainerStats.totalIterations > 0 ? trainerStats.feedbackTriggers / trainerStats.totalIterations : 0,
        convergenceAchieved: trainerStats.convergenceAchieved,
        currentAlpha: trainerStats.stability.currentAlpha,
        averageNNLoss: trainerStats.averageNNLoss,
        averageVAELoss: trainerStats.averageVAELoss
      };

      // Check if feedback is working properly
      const checks = {
        feedbackTriggering: feedbackAnalysis.feedbackRate > 0 && feedbackAnalysis.feedbackRate < 0.8, // Should trigger sometimes but not always
        alphaDecaying: feedbackAnalysis.currentAlpha < this.feedbackTrainer.initialAlpha, // Alpha should decay over time
        lossesReasonable: feedbackAnalysis.averageNNLoss < 2.0 && feedbackAnalysis.averageVAELoss < 10.0, // Losses should be reasonable
        systemStable: trainerStats.stability.stable
      };

      // Analyze loss trends if history is available
      const lossHistory = this.feedbackTrainer.lossHistory;
      let lossTrends = null;
      
      if (lossHistory && lossHistory.length >= 10) {
        const recentLosses = lossHistory.slice(-10);
        const earlyLosses = lossHistory.slice(0, Math.min(10, lossHistory.length));
        
        const recentNNLoss = recentLosses.reduce((sum, l) => sum + l.nnLoss, 0) / recentLosses.length;
        const earlyNNLoss = earlyLosses.reduce((sum, l) => sum + l.nnLoss, 0) / earlyLosses.length;
        
        lossTrends = {
          nnLossImproving: recentNNLoss < earlyNNLoss,
          improvementRate: (earlyNNLoss - recentNNLoss) / earlyNNLoss,
          historyLength: lossHistory.length
        };
      }

      this.validationResults.feedbackLoop = {
        status: 'completed',
        analysis: feedbackAnalysis,
        checks,
        lossTrends,
        summary: {
          effective: Object.values(checks).every(check => check),
          improving: lossTrends ? lossTrends.nnLossImproving : null,
          stable: checks.systemStable
        }
      };

      logger.info('Feedback loop validation completed', {
        effective: this.validationResults.feedbackLoop.summary.effective,
        feedbackRate: (feedbackAnalysis.feedbackRate * 100).toFixed(1) + '%',
        alphaDecayed: checks.alphaDecaying,
        stable: checks.systemStable
      });

    } catch (error) {
      logger.error('Failed to validate feedback loop', {
        error: error.message
      });
      this.validationResults.feedbackLoop = {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Validate system convergence and α decay
   */
  async validateSystemConvergence() {
    logger.info('Validating system convergence');

    try {
      const trainerStats = this.feedbackTrainer.getTrainingStats();
      const stability = this.feedbackTrainer.monitorStability();
      
      // Analyze convergence metrics
      const convergenceAnalysis = {
        convergenceAchieved: trainerStats.convergenceAchieved,
        currentAlpha: trainerStats.stability.currentAlpha,
        initialAlpha: this.feedbackTrainer.initialAlpha,
        alphaDecayRate: this.feedbackTrainer.alphaDecayRate,
        minAlpha: this.feedbackTrainer.minAlpha,
        totalIterations: trainerStats.totalIterations,
        stabilityMetrics: stability
      };

      // Calculate expected alpha after iterations
      const expectedAlpha = Math.max(
        this.feedbackTrainer.initialAlpha * Math.pow(this.feedbackTrainer.alphaDecayRate, trainerStats.totalIterations),
        this.feedbackTrainer.minAlpha
      );

      const checks = {
        alphaDecayingProperly: Math.abs(convergenceAnalysis.currentAlpha - expectedAlpha) < 0.01,
        systemStable: stability.stable,
        feedbackRateDecreasing: stability.feedbackRate < 0.5, // Should decrease over time
        convergenceDetected: trainerStats.convergenceAchieved || trainerStats.totalIterations < 50 // Allow for early stages
      };

      // Analyze convergence timeline
      let convergenceTimeline = null;
      if (this.feedbackTrainer.lossHistory.length >= 5) {
        const history = this.feedbackTrainer.lossHistory;
        const windows = [];
        
        for (let i = 0; i < history.length - 4; i += 5) {
          const window = history.slice(i, i + 5);
          const avgLoss = window.reduce((sum, l) => sum + l.nnLoss, 0) / window.length;
          windows.push({
            iteration: window[0].iteration,
            avgLoss,
            alpha: window[0].alpha
          });
        }
        
        convergenceTimeline = {
          windows,
          isConverging: windows.length >= 2 && windows[windows.length - 1].avgLoss < windows[0].avgLoss
        };
      }

      this.validationResults.systemConvergence = {
        status: 'completed',
        analysis: convergenceAnalysis,
        checks,
        convergenceTimeline,
        summary: {
          converging: Object.values(checks).filter(check => check).length >= 3, // At least 3/4 checks pass
          alphaDecayHealthy: checks.alphaDecayingProperly,
          systemStable: checks.systemStable
        }
      };

      logger.info('System convergence validation completed', {
        converging: this.validationResults.systemConvergence.summary.converging,
        currentAlpha: convergenceAnalysis.currentAlpha.toFixed(6),
        stable: checks.systemStable,
        iterations: trainerStats.totalIterations
      });

    } catch (error) {
      logger.error('Failed to validate system convergence', {
        error: error.message
      });
      this.validationResults.systemConvergence = {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Validate model calibration
   * @param {number} bins - Number of calibration bins
   */
  async validateCalibration(bins) {
    logger.info('Validating model calibration', { bins });

    try {
      // This is a simplified calibration check
      // In a full implementation, you would need historical predictions and outcomes
      
      const predictionAccuracy = this.validationResults.predictionAccuracy;
      
      if (!predictionAccuracy || predictionAccuracy.status !== 'completed') {
        this.validationResults.calibrationMetrics = {
          status: 'skipped',
          message: 'Prediction accuracy validation required first'
        };
        return;
      }

      // Calculate basic calibration metrics from prediction accuracy
      const mae = predictionAccuracy.metrics.meanAbsoluteError;
      const rmse = predictionAccuracy.metrics.rootMeanSquareError;
      
      // Simple calibration score (lower is better)
      const calibrationScore = mae + (rmse - mae) * 0.5; // Penalize high variance
      
      // Brier score approximation (for probability predictions)
      const brierScore = rmse * rmse; // RMSE squared approximates Brier score
      
      this.validationResults.calibrationMetrics = {
        status: 'completed',
        metrics: {
          meanAbsoluteError: mae,
          rootMeanSquareError: rmse,
          calibrationScore,
          brierScore,
          gamesAnalyzed: predictionAccuracy.gamesAnalyzed
        },
        summary: {
          wellCalibrated: calibrationScore < 0.1, // Threshold for good calibration
          acceptable: calibrationScore < 0.2,
          brierScoreGood: brierScore < 0.25 // Standard threshold
        }
      };

      logger.info('Model calibration validation completed', {
        calibrationScore: calibrationScore.toFixed(4),
        brierScore: brierScore.toFixed(4),
        wellCalibrated: this.validationResults.calibrationMetrics.summary.wellCalibrated
      });

    } catch (error) {
      logger.error('Failed to validate calibration', {
        error: error.message
      });
      this.validationResults.calibrationMetrics = {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Generate comprehensive validation report
   * @returns {Object} - Validation report
   */
  generateValidationReport() {
    const report = {
      timestamp: new Date().toISOString(),
      overallScore: 0,
      criticalIssues: [],
      recommendations: [],
      sections: {
        predictionAccuracy: this.validationResults.predictionAccuracy,
        teamDistributions: this.validationResults.teamDistributions,
        feedbackLoop: this.validationResults.feedbackLoop,
        systemConvergence: this.validationResults.systemConvergence,
        calibrationMetrics: this.validationResults.calibrationMetrics
      }
    };

    // Calculate overall score (0-100)
    let totalScore = 0;
    let scoredSections = 0;

    // Score prediction accuracy (25 points)
    if (this.validationResults.predictionAccuracy?.status === 'completed') {
      const accuracy = this.validationResults.predictionAccuracy;
      if (accuracy.summary.excellent) {
        totalScore += 25;
      } else if (accuracy.summary.acceptable) {
        totalScore += 15;
      } else {
        totalScore += 5;
        report.criticalIssues.push('Poor prediction accuracy detected');
      }
      scoredSections++;
    }

    // Score team distributions (25 points)
    if (this.validationResults.teamDistributions?.status === 'completed') {
      const distributions = this.validationResults.teamDistributions;
      if (distributions.summary.healthyPercentage > 80 && distributions.summary.sigmaDecayingProperly) {
        totalScore += 25;
      } else if (distributions.summary.healthyPercentage > 60) {
        totalScore += 15;
      } else {
        totalScore += 5;
        report.criticalIssues.push('Team distributions showing issues');
      }
      scoredSections++;
    }

    // Score feedback loop (25 points)
    if (this.validationResults.feedbackLoop?.status === 'completed') {
      const feedback = this.validationResults.feedbackLoop;
      if (feedback.summary.effective && feedback.summary.stable) {
        totalScore += 25;
      } else if (feedback.summary.effective || feedback.summary.stable) {
        totalScore += 15;
      } else {
        totalScore += 5;
        report.criticalIssues.push('VAE feedback loop not functioning properly');
      }
      scoredSections++;
    }

    // Score system convergence (25 points)
    if (this.validationResults.systemConvergence?.status === 'completed') {
      const convergence = this.validationResults.systemConvergence;
      if (convergence.summary.converging && convergence.summary.systemStable) {
        totalScore += 25;
      } else if (convergence.summary.converging || convergence.summary.systemStable) {
        totalScore += 15;
      } else {
        totalScore += 5;
        report.criticalIssues.push('System not converging properly');
      }
      scoredSections++;
    }

    report.overallScore = Math.round(totalScore);

    // Generate recommendations
    if (report.overallScore < 70) {
      report.recommendations.push('System requires attention - multiple components showing issues');
    }
    
    if (this.validationResults.predictionAccuracy?.summary?.acceptable === false) {
      report.recommendations.push('Improve prediction accuracy by adjusting model parameters or training data');
    }
    
    if (this.validationResults.teamDistributions?.summary?.sigmaDecayingProperly === false) {
      report.recommendations.push('Review Bayesian update mechanism - team uncertainties not decreasing properly');
    }
    
    if (this.validationResults.feedbackLoop?.summary?.effective === false) {
      report.recommendations.push('Adjust feedback threshold or alpha decay parameters');
    }
    
    if (this.validationResults.systemConvergence?.summary?.converging === false) {
      report.recommendations.push('System may need more training iterations or parameter tuning');
    }

    return report;
  }

  // Helper methods

  calculatePredictionError(predicted, actual) {
    const errors = predicted.map((pred, i) => Math.abs(pred - actual[i]));
    const squaredErrors = predicted.map((pred, i) => Math.pow(pred - actual[i], 2));
    
    return {
      mae: errors.reduce((sum, err) => sum + err, 0) / errors.length,
      mse: squaredErrors.reduce((sum, err) => sum + err, 0) / squaredErrors.length,
      maxAbsError: Math.max(...errors)
    };
  }

  calculateArrayStats(arr) {
    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      stdDev,
      min: Math.min(...arr),
      max: Math.max(...arr),
      range: Math.max(...arr) - Math.min(...arr)
    };
  }

  calculateExpectedSigmaRange(gameCount) {
    // Expected sigma should decrease with more games
    // Starting around 1.0 and decreasing to ~0.1 after many games
    const baseSigma = 1.0;
    const decayRate = 0.95;
    const minSigma = 0.1;
    
    const expectedMean = Math.max(baseSigma * Math.pow(decayRate, gameCount), minSigma);
    
    return {
      min: expectedMean * 0.5,
      max: expectedMean * 2.0,
      expected: expectedMean
    };
  }

  calculateSigmaDecayTrend(teams) {
    if (teams.length < 2) {
      return { isDecaying: null, correlation: null };
    }

    // Calculate correlation between game count and sigma
    const points = teams.map(t => ({
      gameCount: t.gameCount,
      avgSigma: t.distribution.sigma.mean
    }));

    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.gameCount, 0);
    const sumY = points.reduce((sum, p) => sum + p.avgSigma, 0);
    const sumXY = points.reduce((sum, p) => sum + p.gameCount * p.avgSigma, 0);
    const sumX2 = points.reduce((sum, p) => sum + p.gameCount * p.gameCount, 0);
    const sumY2 = points.reduce((sum, p) => sum + p.avgSigma * p.avgSigma, 0);

    const correlation = (n * sumXY - sumX * sumY) / 
      Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return {
      isDecaying: correlation < -0.3, // Negative correlation indicates decay
      correlation,
      dataPoints: points.length
    };
  }

  async getTeamGameCount(teamId) {
    try {
      const result = await dbConnection.get(`
        SELECT COUNT(*) as game_count 
        FROM game_ids 
        WHERE (home_team_id = ? OR away_team_id = ?) 
        AND processed = 1
      `, [teamId, teamId]);
      
      return result?.game_count || 0;
    } catch (error) {
      logger.error('Failed to get team game count', { teamId, error: error.message });
      return 0;
    }
  }

  buildGameContext(metadata) {
    return [
      metadata.neutralGame === 'Y' ? 1 : 0,
      metadata.postseason === 'Y' ? 1 : 0,
      0, 0, 0, 0, 0, 0, 0, 0 // Placeholder context features
    ];
  }

  convertTransitionProbsToArray(transitionProbs) {
    return [
      transitionProbs.twoPointMakeProb || 0,
      transitionProbs.twoPointMissProb || 0,
      transitionProbs.threePointMakeProb || 0,
      transitionProbs.threePointMissProb || 0,
      transitionProbs.freeThrowMakeProb || 0,
      transitionProbs.freeThrowMissProb || 0,
      transitionProbs.offensiveReboundProb || 0,
      transitionProbs.turnoverProb || 0
    ];
  }
}

// Main execution
async function main() {
  try {
    const validator = new VAESystemValidator();
    
    const options = {
      sampleSize: process.argv.includes('--sample-size') 
        ? parseInt(process.argv[process.argv.indexOf('--sample-size') + 1]) 
        : 20,
      teamSampleSize: process.argv.includes('--team-sample') 
        ? parseInt(process.argv[process.argv.indexOf('--team-sample') + 1]) 
        : 10,
      minGamesForTeamAnalysis: 5,
      calibrationBins: 10
    };

    console.log('\n=== VAE-NN System Validation ===');
    console.log(`Sample size: ${options.sampleSize} games`);
    console.log(`Team sample: ${options.teamSampleSize} teams`);
    console.log(`Minimum games for analysis: ${options.minGamesForTeamAnalysis}`);
    console.log('');

    const report = await validator.runValidation(options);

    // Display results
    console.log('=== VALIDATION RESULTS ===');
    console.log(`Overall Score: ${report.overallScore}/100`);
    console.log(`Critical Issues: ${report.criticalIssues.length}`);
    console.log('');

    if (report.criticalIssues.length > 0) {
      console.log('Critical Issues:');
      report.criticalIssues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
      });
      console.log('');
    }

    if (report.recommendations.length > 0) {
      console.log('Recommendations:');
      report.recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec}`);
      });
      console.log('');
    }

    // Section summaries
    console.log('Section Results:');
    
    if (report.sections.predictionAccuracy?.status === 'completed') {
      const pa = report.sections.predictionAccuracy;
      console.log(`  Prediction Accuracy: ${pa.summary.acceptable ? 'PASS' : 'FAIL'} (MAE: ${pa.metrics.meanAbsoluteError.toFixed(4)})`);
    }
    
    if (report.sections.teamDistributions?.status === 'completed') {
      const td = report.sections.teamDistributions;
      console.log(`  Team Distributions: ${td.summary.healthyPercentage > 60 ? 'PASS' : 'FAIL'} (${td.summary.healthyPercentage.toFixed(1)}% healthy)`);
    }
    
    if (report.sections.feedbackLoop?.status === 'completed') {
      const fl = report.sections.feedbackLoop;
      console.log(`  Feedback Loop: ${fl.summary.effective ? 'PASS' : 'FAIL'} (${fl.summary.stable ? 'Stable' : 'Unstable'})`);
    }
    
    if (report.sections.systemConvergence?.status === 'completed') {
      const sc = report.sections.systemConvergence;
      console.log(`  System Convergence: ${sc.summary.converging ? 'PASS' : 'FAIL'} (α: ${sc.analysis.currentAlpha.toFixed(6)})`);
    }

    // Save detailed report
    const fs = require('fs').promises;
    const reportPath = `data/vae-nn-validation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nDetailed report saved to: ${reportPath}`);

    // Exit with appropriate code
    process.exit(report.overallScore >= 70 ? 0 : 1);

  } catch (error) {
    console.error('Validation failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = VAESystemValidator;