const VAEFeedbackTrainer = require('./VAEFeedbackTrainer');
const BayesianTeamUpdater = require('./BayesianTeamUpdater');
const TeamRepository = require('../../database/repositories/TeamRepository');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');

/**
 * Model Performance Monitor
 * 
 * Tracks system health and performance metrics:
 * 1. Monitor NN prediction accuracy over time
 * 2. Track team distribution convergence (decreasing σ values)
 * 3. Monitor VAE feedback frequency and α decay
 * 4. Alert when model performance degrades significantly
 * 5. Generate periodic performance reports
 */
class ModelPerformanceMonitor {
  constructor(options = {}) {
    this.teamRepository = new TeamRepository();
    
    // Monitoring parameters
    this.monitoringWindow = options.monitoringWindow || 100; // Number of recent predictions to track
    this.convergenceThreshold = options.convergenceThreshold || 0.1; // Threshold for team convergence
    this.degradationThreshold = options.degradationThreshold || 0.2; // Performance degradation alert threshold
    this.alertCooldown = options.alertCooldown || 3600000; // 1 hour cooldown between alerts
    
    // Performance tracking
    this.performanceHistory = [];
    this.teamConvergenceHistory = [];
    this.feedbackHistory = [];
    this.alertHistory = [];
    
    // Current metrics
    this.currentMetrics = {
      averageNNAccuracy: 0,
      averageVAELoss: 0,
      averageFeedbackFrequency: 0,
      currentAlpha: 0,
      convergedTeams: 0,
      totalTeams: 0,
      convergenceRate: 0,
      lastUpdated: null
    };

    // Alert state
    this.lastAlertTime = 0;
    this.alertCallbacks = [];

    logger.info('Initialized ModelPerformanceMonitor', {
      monitoringWindow: this.monitoringWindow,
      convergenceThreshold: this.convergenceThreshold,
      degradationThreshold: this.degradationThreshold
    });
  }

  /**
   * Record prediction performance from a training session
   * @param {Object} trainingResult - Result from VAE-NN training
   * @param {string} gameId - Game ID for tracking
   * @returns {void}
   */
  recordPredictionPerformance(trainingResult, gameId) {
    const timestamp = new Date().toISOString();
    
    const performanceRecord = {
      timestamp,
      gameId,
      nnLoss: trainingResult.nnLoss,
      vaeLoss: trainingResult.vaeLoss,
      feedbackTriggered: trainingResult.feedbackTriggered,
      currentAlpha: trainingResult.currentAlpha,
      accuracy: this.calculateAccuracyFromLoss(trainingResult.nnLoss),
      predictionQuality: this.assessPredictionQuality(trainingResult)
    };

    // Add to history
    this.performanceHistory.push(performanceRecord);
    
    // Keep only recent history for memory efficiency
    if (this.performanceHistory.length > this.monitoringWindow * 2) {
      this.performanceHistory = this.performanceHistory.slice(-this.monitoringWindow);
    }

    // Update current metrics
    this.updateCurrentMetrics();
    
    // Check for performance degradation
    this.checkPerformanceDegradation();

    logger.debug('Recorded prediction performance', {
      gameId,
      nnLoss: trainingResult.nnLoss.toFixed(6),
      accuracy: performanceRecord.accuracy.toFixed(3),
      feedbackTriggered: trainingResult.feedbackTriggered
    });
  }

  /**
   * Record team distribution convergence metrics
   * @param {string} teamId - Team ID
   * @param {Object} distribution - Team latent distribution
   * @param {Object} updateResult - Bayesian update result
   * @returns {void}
   */
  recordTeamConvergence(teamId, distribution, updateResult) {
    const timestamp = new Date().toISOString();
    
    // Calculate convergence metrics
    const averageSigma = this.calculateAverageSigma(distribution.sigma);
    const sigmaReduction = updateResult.sigmaReduction || 0;
    const isConverged = averageSigma < this.convergenceThreshold;
    
    const convergenceRecord = {
      timestamp,
      teamId,
      averageSigma,
      sigmaReduction,
      isConverged,
      gamesProcessed: distribution.gamesProcessed || 0,
      uncertaintyLevel: this.categorizeUncertaintyLevel(averageSigma)
    };

    // Add to history
    this.teamConvergenceHistory.push(convergenceRecord);
    
    // Keep only recent history
    if (this.teamConvergenceHistory.length > this.monitoringWindow * 10) {
      this.teamConvergenceHistory = this.teamConvergenceHistory.slice(-this.monitoringWindow * 5);
    }

    logger.debug('Recorded team convergence', {
      teamId,
      averageSigma: averageSigma.toFixed(4),
      isConverged,
      uncertaintyLevel: convergenceRecord.uncertaintyLevel
    });
  }

  /**
   * Record VAE feedback loop metrics
   * @param {Object} feedbackStats - Feedback statistics from VAEFeedbackTrainer
   * @returns {void}
   */
  recordFeedbackMetrics(feedbackStats) {
    const timestamp = new Date().toISOString();
    
    const feedbackRecord = {
      timestamp,
      currentAlpha: feedbackStats.stability.currentAlpha,
      feedbackRate: feedbackStats.stability.feedbackRate,
      alphaDecayRate: feedbackStats.stability.alphaDecayRate,
      convergenceAchieved: feedbackStats.convergenceAchieved,
      totalIterations: feedbackStats.totalIterations,
      averageNNLoss: feedbackStats.averageNNLoss,
      averageVAELoss: feedbackStats.averageVAELoss,
      systemStability: feedbackStats.stability.stable
    };

    // Add to history
    this.feedbackHistory.push(feedbackRecord);
    
    // Keep only recent history
    if (this.feedbackHistory.length > this.monitoringWindow) {
      this.feedbackHistory = this.feedbackHistory.slice(-Math.floor(this.monitoringWindow / 2));
    }

    // Update current metrics
    this.currentMetrics.currentAlpha = feedbackRecord.currentAlpha;
    this.currentMetrics.averageFeedbackFrequency = feedbackRecord.feedbackRate;

    logger.debug('Recorded feedback metrics', {
      currentAlpha: feedbackRecord.currentAlpha.toFixed(6),
      feedbackRate: (feedbackRecord.feedbackRate * 100).toFixed(1) + '%',
      systemStability: feedbackRecord.systemStability
    });
  }

  /**
   * Update current performance metrics based on recent history
   * @returns {void}
   */
  updateCurrentMetrics() {
    if (this.performanceHistory.length === 0) {
      return;
    }

    const recentPerformance = this.performanceHistory.slice(-this.monitoringWindow);
    
    // Calculate average NN accuracy
    const totalAccuracy = recentPerformance.reduce((sum, record) => sum + record.accuracy, 0);
    this.currentMetrics.averageNNAccuracy = totalAccuracy / recentPerformance.length;
    
    // Calculate average VAE loss
    const totalVAELoss = recentPerformance.reduce((sum, record) => sum + record.vaeLoss, 0);
    this.currentMetrics.averageVAELoss = totalVAELoss / recentPerformance.length;
    
    // Update timestamp
    this.currentMetrics.lastUpdated = new Date().toISOString();
  }

  /**
   * Update team convergence metrics
   * @returns {Promise<void>}
   */
  async updateTeamConvergenceMetrics() {
    try {
      // Get all teams from database
      const teams = await this.teamRepository.findAll();
      this.currentMetrics.totalTeams = teams.length;
      
      let convergedCount = 0;
      
      for (const team of teams) {
        try {
          const posterior = await this.teamRepository.getTeamEncodingFromDb(team.team_id);
          if (posterior && posterior.sigma) {
            const averageSigma = this.calculateAverageSigma(posterior.sigma);
            if (averageSigma < this.convergenceThreshold) {
              convergedCount++;
            }
          }
        } catch (error) {
          logger.warn('Failed to get team posterior distribution', {
            teamId: team.team_id,
            error: error.message
          });
        }
      }
      
      this.currentMetrics.convergedTeams = convergedCount;
      this.currentMetrics.convergenceRate = teams.length > 0 
        ? (convergedCount / teams.length) * 100 
        : 0;

      logger.debug('Updated team convergence metrics', {
        totalTeams: this.currentMetrics.totalTeams,
        convergedTeams: this.currentMetrics.convergedTeams,
        convergenceRate: this.currentMetrics.convergenceRate.toFixed(1) + '%'
      });

    } catch (error) {
      logger.error('Failed to update team convergence metrics', {
        error: error.message
      });
    }
  }

  /**
   * Check for significant performance degradation and trigger alerts
   * @returns {void}
   */
  checkPerformanceDegradation() {
    if (this.performanceHistory.length < 20) {
      return; // Need sufficient history
    }

    const recentPerformance = this.performanceHistory.slice(-10);
    const olderPerformance = this.performanceHistory.slice(-20, -10);
    
    const recentAvgAccuracy = recentPerformance.reduce((sum, r) => sum + r.accuracy, 0) / recentPerformance.length;
    const olderAvgAccuracy = olderPerformance.reduce((sum, r) => sum + r.accuracy, 0) / olderPerformance.length;
    
    const accuracyDrop = olderAvgAccuracy - recentAvgAccuracy;
    
    // Check if performance has degraded significantly
    if (accuracyDrop > this.degradationThreshold) {
      this.triggerPerformanceAlert('accuracy_degradation', {
        recentAccuracy: recentAvgAccuracy,
        previousAccuracy: olderAvgAccuracy,
        degradation: accuracyDrop,
        threshold: this.degradationThreshold
      });
    }

    // Check for excessive feedback triggering (system instability)
    const recentFeedbackRate = recentPerformance.filter(r => r.feedbackTriggered).length / recentPerformance.length;
    if (recentFeedbackRate > 0.8) { // More than 80% feedback triggers
      this.triggerPerformanceAlert('excessive_feedback', {
        feedbackRate: recentFeedbackRate,
        threshold: 0.8
      });
    }
  }

  /**
   * Trigger a performance alert
   * @param {string} alertType - Type of alert
   * @param {Object} alertData - Alert data
   * @returns {void}
   */
  triggerPerformanceAlert(alertType, alertData) {
    const now = Date.now();
    
    // Check cooldown
    if (now - this.lastAlertTime < this.alertCooldown) {
      return;
    }

    const alert = {
      timestamp: new Date().toISOString(),
      type: alertType,
      data: alertData,
      severity: this.determineAlertSeverity(alertType, alertData)
    };

    // Add to alert history
    this.alertHistory.push(alert);
    this.lastAlertTime = now;

    // Log alert
    logger.warn('Performance alert triggered', {
      type: alertType,
      severity: alert.severity,
      data: alertData
    });

    // Notify registered callbacks
    this.notifyAlertCallbacks(alert);
  }

  /**
   * Determine alert severity based on type and data
   * @param {string} alertType - Alert type
   * @param {Object} alertData - Alert data
   * @returns {string} - Severity level
   */
  determineAlertSeverity(alertType, alertData) {
    switch (alertType) {
      case 'accuracy_degradation':
        if (alertData.degradation > 0.4) return 'critical';
        if (alertData.degradation > 0.3) return 'high';
        return 'medium';
      
      case 'excessive_feedback':
        if (alertData.feedbackRate > 0.9) return 'high';
        return 'medium';
      
      default:
        return 'low';
    }
  }

  /**
   * Register callback for performance alerts
   * @param {Function} callback - Alert callback function
   * @returns {void}
   */
  onAlert(callback) {
    this.alertCallbacks.push(callback);
  }

  /**
   * Notify all registered alert callbacks
   * @param {Object} alert - Alert object
   * @returns {void}
   */
  notifyAlertCallbacks(alert) {
    for (const callback of this.alertCallbacks) {
      try {
        callback(alert);
      } catch (error) {
        logger.error('Alert callback failed', {
          error: error.message
        });
      }
    }
  }

  /**
   * Generate comprehensive performance report
   * @param {Object} options - Report options
   * @returns {Promise<Object>} - Performance report
   */
  async generatePerformanceReport(options = {}) {
    const {
      includeTrendAnalysis = true,
      includeTeamDetails = false,
      timeRange = 'recent' // 'recent', 'all', or specific date range
    } = options;

    await this.updateTeamConvergenceMetrics();

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        ...this.currentMetrics,
        monitoringWindow: this.monitoringWindow,
        totalRecords: this.performanceHistory.length
      },
      performance: {
        recentAccuracy: this.currentMetrics.averageNNAccuracy,
        recentVAELoss: this.currentMetrics.averageVAELoss,
        systemStability: this.assessSystemStability(),
        convergenceProgress: this.assessConvergenceProgress()
      },
      alerts: {
        recentAlerts: this.alertHistory.slice(-10),
        alertFrequency: this.calculateAlertFrequency()
      }
    };

    if (includeTrendAnalysis) {
      report.trends = await this.analyzeTrends();
    }

    if (includeTeamDetails) {
      report.teamDetails = await this.getTeamConvergenceDetails();
    }

    logger.info('Generated performance report', {
      averageAccuracy: report.performance.recentAccuracy.toFixed(3),
      convergenceRate: this.currentMetrics.convergenceRate.toFixed(1) + '%',
      systemStability: report.performance.systemStability,
      recentAlerts: report.alerts.recentAlerts.length
    });

    return report;
  }

  /**
   * Assess overall system stability
   * @returns {string} - Stability assessment
   */
  assessSystemStability() {
    if (this.feedbackHistory.length === 0) {
      return 'unknown';
    }

    const recentFeedback = this.feedbackHistory.slice(-10);
    const avgFeedbackRate = recentFeedback.reduce((sum, f) => sum + f.feedbackRate, 0) / recentFeedback.length;
    const avgAlphaDecay = recentFeedback.reduce((sum, f) => sum + f.alphaDecayRate, 0) / recentFeedback.length;
    
    if (avgFeedbackRate < 0.3 && avgAlphaDecay > 0) {
      return 'stable';
    } else if (avgFeedbackRate < 0.6) {
      return 'moderate';
    } else {
      return 'unstable';
    }
  }

  /**
   * Assess convergence progress
   * @returns {string} - Convergence assessment
   */
  assessConvergenceProgress() {
    const convergenceRate = this.currentMetrics.convergenceRate;
    
    if (convergenceRate > 80) {
      return 'excellent';
    } else if (convergenceRate > 60) {
      return 'good';
    } else if (convergenceRate > 40) {
      return 'moderate';
    } else if (convergenceRate > 20) {
      return 'slow';
    } else {
      return 'poor';
    }
  }

  /**
   * Analyze performance trends over time
   * @returns {Promise<Object>} - Trend analysis
   */
  async analyzeTrends() {
    if (this.performanceHistory.length < 20) {
      return {
        accuracyTrend: 'insufficient_data',
        vaeLossTrend: 'insufficient_data',
        feedbackTrend: 'insufficient_data'
      };
    }

    const recent = this.performanceHistory.slice(-10);
    const older = this.performanceHistory.slice(-20, -10);

    // Accuracy trend
    const recentAccuracy = recent.reduce((sum, r) => sum + r.accuracy, 0) / recent.length;
    const olderAccuracy = older.reduce((sum, r) => sum + r.accuracy, 0) / older.length;
    const accuracyChange = recentAccuracy - olderAccuracy;

    // VAE loss trend
    const recentVAELoss = recent.reduce((sum, r) => sum + r.vaeLoss, 0) / recent.length;
    const olderVAELoss = older.reduce((sum, r) => sum + r.vaeLoss, 0) / older.length;
    const vaeLossChange = recentVAELoss - olderVAELoss;

    // Feedback trend
    const recentFeedbackRate = recent.filter(r => r.feedbackTriggered).length / recent.length;
    const olderFeedbackRate = older.filter(r => r.feedbackTriggered).length / older.length;
    const feedbackChange = recentFeedbackRate - olderFeedbackRate;

    return {
      accuracyTrend: this.categorizeTrend(accuracyChange, 0.05),
      vaeLossTrend: this.categorizeTrend(-vaeLossChange, 0.1), // Negative because lower loss is better
      feedbackTrend: this.categorizeTrend(-feedbackChange, 0.1), // Negative because less feedback is better
      changes: {
        accuracy: accuracyChange,
        vaeLoss: vaeLossChange,
        feedback: feedbackChange
      }
    };
  }

  /**
   * Get detailed team convergence information
   * @returns {Promise<Array>} - Team convergence details
   */
  async getTeamConvergenceDetails() {
    try {
      const teams = await this.teamRepository.findAll();
      const teamDetails = [];

      for (const team of teams) {
        try {
          const posterior = await this.teamRepository.getTeamEncodingFromDb(team.team_id);
          if (posterior) {
            const averageSigma = this.calculateAverageSigma(posterior.sigma || []);
            
            teamDetails.push({
              teamId: team.team_id,
              teamName: team.team_name,
              averageSigma,
              isConverged: averageSigma < this.convergenceThreshold,
              gamesProcessed: posterior.games_processed || 0,
              uncertaintyLevel: this.categorizeUncertaintyLevel(averageSigma),
              lastSeason: posterior.last_season,
              modelVersion: posterior.model_version
            });
          } else {
            teamDetails.push({
              teamId: team.team_id,
              teamName: team.team_name,
              error: 'No posterior distribution available'
            });
          }
        } catch (error) {
          teamDetails.push({
            teamId: team.team_id,
            teamName: team.team_name,
            error: 'Failed to load posterior distribution'
          });
        }
      }

      // Sort by convergence status and uncertainty level
      teamDetails.sort((a, b) => {
        if (a.isConverged !== b.isConverged) {
          return b.isConverged - a.isConverged; // Converged teams first
        }
        return a.averageSigma - b.averageSigma; // Lower uncertainty first
      });

      return teamDetails;

    } catch (error) {
      logger.error('Failed to get team convergence details', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Calculate average sigma from sigma array
   * @param {Array} sigmaArray - Array of sigma values
   * @returns {number} - Average sigma
   */
  calculateAverageSigma(sigmaArray) {
    if (!Array.isArray(sigmaArray) || sigmaArray.length === 0) {
      return 1.0; // Default high uncertainty
    }
    
    return sigmaArray.reduce((sum, sigma) => sum + sigma, 0) / sigmaArray.length;
  }

  /**
   * Categorize uncertainty level based on average sigma
   * @param {number} averageSigma - Average sigma value
   * @returns {string} - Uncertainty category
   */
  categorizeUncertaintyLevel(averageSigma) {
    if (averageSigma < 0.1) return 'very_low';
    if (averageSigma < 0.2) return 'low';
    if (averageSigma < 0.4) return 'moderate';
    if (averageSigma < 0.7) return 'high';
    return 'very_high';
  }

  /**
   * Calculate accuracy from NN loss (approximate)
   * @param {number} nnLoss - Neural network loss
   * @returns {number} - Approximate accuracy (0-1)
   */
  calculateAccuracyFromLoss(nnLoss) {
    // Approximate conversion from cross-entropy loss to accuracy
    // This is a rough approximation for monitoring purposes
    return Math.max(0, Math.min(1, 1 - (nnLoss / 2)));
  }

  /**
   * Assess prediction quality based on training result
   * @param {Object} trainingResult - Training result
   * @returns {string} - Quality assessment
   */
  assessPredictionQuality(trainingResult) {
    const accuracy = this.calculateAccuracyFromLoss(trainingResult.nnLoss);
    
    if (accuracy > 0.9) return 'excellent';
    if (accuracy > 0.8) return 'good';
    if (accuracy > 0.7) return 'fair';
    if (accuracy > 0.6) return 'poor';
    return 'very_poor';
  }

  /**
   * Categorize trend based on change value
   * @param {number} change - Change value
   * @param {number} threshold - Significance threshold
   * @returns {string} - Trend category
   */
  categorizeTrend(change, threshold) {
    if (Math.abs(change) < threshold) return 'stable';
    if (change > threshold * 2) return 'strongly_improving';
    if (change > threshold) return 'improving';
    if (change < -threshold * 2) return 'strongly_declining';
    if (change < -threshold) return 'declining';
    return 'stable';
  }

  /**
   * Calculate alert frequency (alerts per day)
   * @returns {number} - Alert frequency
   */
  calculateAlertFrequency() {
    if (this.alertHistory.length === 0) return 0;
    
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const recentAlerts = this.alertHistory.filter(alert => 
      new Date(alert.timestamp) > oneDayAgo
    );
    
    return recentAlerts.length;
  }

  /**
   * Get current performance metrics
   * @returns {Object} - Current metrics
   */
  getCurrentMetrics() {
    return { ...this.currentMetrics };
  }

  /**
   * Reset monitoring history (for testing or fresh start)
   * @returns {void}
   */
  resetHistory() {
    this.performanceHistory = [];
    this.teamConvergenceHistory = [];
    this.feedbackHistory = [];
    this.alertHistory = [];
    this.lastAlertTime = 0;
    
    this.currentMetrics = {
      averageNNAccuracy: 0,
      averageVAELoss: 0,
      averageFeedbackFrequency: 0,
      currentAlpha: 0,
      convergedTeams: 0,
      totalTeams: 0,
      convergenceRate: 0,
      lastUpdated: null
    };

    logger.info('ModelPerformanceMonitor history reset');
  }
}

module.exports = ModelPerformanceMonitor;