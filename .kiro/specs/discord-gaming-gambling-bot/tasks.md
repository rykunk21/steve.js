# Implementation Plan - InfoNCE VAE-NN Refactoring

## Goal
Refactor the existing VAE-NN system to use InfoNCE pretraining with frozen encoder and Bayesian posterior updates, eliminating mode collapse while maintaining adaptive learning capabilities.

## System Architecture Overview

**New Three-Phase Architecture:**
1. **InfoNCE Pretraining (One-Time)**: Train VAE with InfoNCE objective, then freeze encoder permanently
2. **Game-by-Game Processing**: Use frozen encoder + Bayesian posterior updates + NN training
3. **Prediction Pipeline**: Use posterior latents for stable, adaptive predictions

**Key Changes from Current System:**
- **Eliminate Feedback Loop**: No more backpropagation from NN to VAE encoder
- **InfoNCE Pretraining**: VAE learns label-predictive representations without reconstruction pressure
- **Frozen Encoder**: Encoder weights never change after pretraining
- **Bayesian Updates**: Team representations evolve via posterior inference, not gradient descent

## Phase 0: Cleanup and Database Reset

- [-] 0. Clean up codebase and reset database for new architecture








- [x] 0.1 Clean up scripts folder




  - Audit all scripts in /scripts directory
  - Keep only essential scripts: database reset, team seeding, basic validation
  - Delete experimental/debugging scripts that are no longer needed
  - Organize remaining scripts with clear naming and documentation
  - _Requirements: Code organization, maintainability_

- [x] 0.2 Reset and clean database






  - Backup existing database if needed
  - Drop and recreate all tables with clean schema
  - Clear any corrupted or inconsistent data
  - Reset all processed flags and training state
  - _Requirements: Clean database state_

- [x] 0.3 Update game_ids table schema for InfoNCE








  - Add transition_probabilities_home BLOB field to store home team's 8-dim transition vector
  - Add transition_probabilities_away BLOB field to store away team's 8-dim transition vector
  - Add indexes on these fields for efficient negative sampling
  - These vectors will serve as labels for InfoNCE contrastive learning
  - _Requirements: InfoNCE negative sampling, label storage_


- [x] 0.4 Create transition probability extraction pipeline













  - Implement transition probabilities extraction from StatBroadcast XML in source code
  - Parse play-by-play data to compute 8-dimensional vectors: [2pt_make, 2pt_miss, 3pt_make, 3pt_miss, ft_make, ft_miss, oreb, turnover]
  - Normalize transition probabilities to sum to 1.0
  - Store computed vectors in game_ids table for InfoNCE training
  - _Requirements: Label extraction, InfoNCE training data_

## Phase 1: InfoNCE VAE Pretraining Implementation

- [x] 1. Implement InfoNCE pretraining system





- [x] 1.1 Create InfoNCE loss function


  - Implement InfoNCE (Noise Contrastive Estimation) loss: -log(exp(sim(z, g(y))) / Σ exp(sim(z, g(y'))))
  - Create positive sampling: use current team's transition probabilities from game_ids table
  - Create negative sampling: randomly sample transition probabilities from other games in game_ids table
  - Implement similarity function between latent z and label embedding g(y)
  - Add temperature parameter for contrastive learning
  - _Requirements: 11.2_

- [x] 1.2 Modify VAE architecture for InfoNCE training


  - Update VAE loss to: reconstruction + β*KL + λ*InfoNCE
  - Create label embedding function g(y) for transition probability labels from game_ids table
  - Implement database-driven contrastive sampling: positive from current game, negatives from random games
  - Add hyperparameter tuning for λ (InfoNCE weight) and temperature
  - _Requirements: 11.2, 11.3_

- [x] 1.3 Implement VAE pretraining pipeline


  - Create PretrainVAE class to orchestrate InfoNCE training
  - Load games from game_ids table with precomputed transition probability labels
  - Implement efficient batch sampling for positive/negative pairs from database
  - Train VAE with combined loss until convergence
  - Validate that latent representations are predictive of labels
  - Save trained encoder weights to vae_model_weights table
  - _Requirements: 11.2, 11.3_

- [x] 1.4 Implement encoder freezing mechanism


  - Create FrozenVAEEncoder class that loads pretrained weights
  - Disable gradient computation for all encoder parameters
  - Implement validation to ensure encoder weights never change
  - Add logging to track encoder immutability
  - _Requirements: 11.3, 11.10_

- [ ]* 1.5 Write property test for InfoNCE pretraining
  - **Property 17: InfoNCE pretraining round trip**
  - **Validates: Requirements 11.2, 11.3**

- [ ]* 1.6 Write property test for encoder immutability
  - **Property 18: Encoder weight immutability**
  - **Validates: Requirements 11.3, 11.10**

## Phase 2: Bayesian Posterior Update System


- [x] 2. Implement Bayesian posterior management




- [x] 2.1 Create posterior latent storage system


  - Update teams.statistical_representation to store posterior distributions
  - Implement get_team_encoding_from_db() and save_team_encoding_to_db()
  - Add versioning and timestamps for posterior updates
  - Create database migration for new posterior format
  - _Requirements: 11.6, 11.15_

- [x] 2.2 Implement Bayesian posterior update algorithm


  - Create BayesianPosteriorUpdater class
  - Implement p(z|games) ∝ p(y|z,opponent,context) p(z) update rule
  - Use NN model to compute likelihood p(y|z,opponent,context)
  - Update posterior mean and variance without touching encoder weights
  - _Requirements: 11.11, 11.12_

- [x] 2.3 Refactor team representation retrieval


  - Modify existing code to load posterior distributions instead of encoding on-the-fly
  - Update game processing pipeline to use stored posteriors as priors
  - Implement fallback to frozen encoder for new teams
  - Add validation that posteriors remain in InfoNCE space
  - _Requirements: 11.6, 11.7_

- [ ]* 2.4 Write property test for Bayesian convergence
  - **Property 2: Bayesian posterior convergence**
  - **Validates: Requirements 11.11, 11.12**

- [ ]* 2.5 Write property test for InfoNCE structure preservation
  - **Property 9: InfoNCE structure preservation**
  - **Validates: Requirements 11.3, 11.11**

## Phase 3: Refactor Game Processing Pipeline

- [x] 3. Update game-by-game processing system




- [x] 3.1 Refactor AdaptiveVAENNTrainer for new architecture


  - Remove VAE-NN feedback loop completely
  - Update to use frozen encoder for logging only (no gradients)
  - Modify to load/save posterior distributions instead of encoding
  - Separate NN training from VAE operations completely
  - _Requirements: 11.10, 11.11_

- [x] 3.2 Update NN training to use posterior latents


  - Modify NN input to use posterior means and variances
  - Update build_input() to concatenate posterior distributions
  - Ensure NN training only updates NN weights, never encoder weights
  - Add validation that encoder remains frozen during NN training
  - _Requirements: 11.7, 11.8, 11.10_

- [x] 3.3 Integrate Bayesian updates into game processing


  - Add posterior update step after each game completion
  - Update OnlineLearningOrchestrator to handle new pipeline
  - Implement error handling for posterior update failures
  - Add logging for posterior evolution tracking
  - _Requirements: 11.11, 11.12_

- [x] 3.4 Update inter-year uncertainty for posterior system


  - Modify season transition detection to work with posteriors
  - Update inter-year variance increase to operate on stored posteriors
  - Ensure uncertainty increases are applied to posterior σ², not encoder
  - _Requirements: 11.13, 11.14_

## Phase 4: Database Schema and Migration

- [x] 4. Update database schema for new architecture





- [x] 4.1 Create VAE model weights table


  - Implement vae_model_weights table creation
  - Add fields for frozen encoder weights, model version, training status
  - Create indexes for efficient model loading
  - _Requirements: Database schema updates_

- [x] 4.2 Migrate existing team representations


  - Create migration script to convert existing latent distributions to posterior format
  - Add metadata fields (last_updated, model_version) to existing teams
  - Validate that all teams have valid posterior distributions after migration
  - Backup existing data before migration
  - _Requirements: Data migration, backward compatibility_

- [x] 4.3 Update database access patterns


  - Modify TeamRepository to handle posterior storage/retrieval
  - Update all code that accesses statistical_representation field
  - Add validation for posterior distribution format
  - Implement caching for frequently accessed posteriors
  - _Requirements: Database access, performance_

## Phase 5: Testing and Validation

- [x] 5. Validate refactored system





- [x] 5.1 Test InfoNCE pretraining effectiveness


  - Validate that pretrained encoder produces label-predictive representations
  - Compare InfoNCE latents vs original VAE latents for prediction quality
  - Verify that frozen encoder maintains representation quality over time
  - Test that pretraining eliminates mode collapse issues
  - _Requirements: 11.2, 11.3_



- [x] 5.2 Test Bayesian posterior evolution







  - Validate that posterior distributions converge appropriately
  - Test that uncertainty decreases with more game observations
  - Verify that posterior updates improve prediction accuracy
  - Check that posteriors remain in valid InfoNCE space



  - _Requirements: 11.11, 11.12_

- [x] 5.3 Test end-to-end system stability






  - Run extended training sessions to verify no mode collapse
  - Test system performance on historical data
  - Validate that predictions remain stable and accurate
  - Compare new system vs old system on validation metrics
  - _Requirements: System stability, performance validation_

- [ ]* 5.4 Write comprehensive integration tests
  - Test complete pipeline from pretraining to prediction
  - Validate all components work together correctly
  - Test error handling and recovery scenarios
  - _Requirements: Integration testing_

## Phase 6: Deployment and Monitoring

- [ ] 6. Deploy and monitor refactored system
- [ ] 6.1 Create deployment scripts
  - Create script to run InfoNCE pretraining on historical data
  - Implement gradual rollout strategy for new system
  - Add monitoring for system performance and stability
  - Create rollback plan in case of issues
  - _Requirements: Deployment, monitoring_

- [ ] 6.2 Update prediction pipeline
  - Modify existing prediction scripts to use new architecture
  - Update MCMC integration to work with posterior distributions
  - Test betting recommendation generation with new system
  - Validate that recommendations are reasonable and stable
  - _Requirements: Prediction pipeline, betting recommendations_

- [ ] 6.3 Performance monitoring and optimization
  - Monitor system performance vs baseline
  - Track prediction accuracy and calibration
  - Optimize database queries for posterior access
  - Add alerting for system degradation
  - _Requirements: Performance monitoring, optimization_

## Critical Success Criteria

**Phase 0 Success**: Codebase cleaned up, database reset, transition probabilities extracted for InfoNCE training
**Phase 1 Success**: InfoNCE pretraining produces stable, label-predictive representations
**Phase 2 Success**: Bayesian posterior updates work correctly without encoder changes
**Phase 3 Success**: Game processing pipeline eliminates mode collapse while maintaining accuracy
**Phase 4 Success**: Database migration completes successfully with no data loss
**Phase 5 Success**: Refactored system shows improved stability and comparable/better accuracy
**Phase 6 Success**: New system deployed successfully with monitoring in place

## Key Benefits of New Architecture

- **Eliminates Mode Collapse**: No competing objectives between VAE and NN
- **Preserves InfoNCE Structure**: Frozen encoder maintains discriminative representations
- **Maintains Adaptability**: Bayesian updates allow team representations to evolve
- **Clean Separation**: VAE learns intrinsic properties, NN learns interactions
- **Mathematical Soundness**: Proper handling of opponent dependence in transition probabilities

## Development Guidelines

**Test-Driven Development (TDD)**: All new development will be built using TDD methodology:
- Write failing tests first (Red)
- Implement minimal code to pass tests (Green) 
- Refactor for quality while keeping tests passing (Refactor)
- All new code goes directly in `src/` directory with corresponding tests
- Focus on unit tests for individual components and integration tests for workflows

## Migration Strategy

1. **Parallel Development**: Build new system alongside existing system
2. **Gradual Testing**: Validate each component before integration
3. **Data Preservation**: Maintain existing data during transition
4. **Rollback Plan**: Keep old system available in case of issues
5. **Performance Comparison**: Validate new system meets or exceeds old performance