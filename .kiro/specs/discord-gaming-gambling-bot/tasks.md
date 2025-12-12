# Implementation Plan - MLP Training Strategy

## Goal
Train the neural network (MLP) to predict transition matrices for basketball games, enabling data-driven MCMC simulations that provide betting recommendations with positive expected value.

## System Architecture Overview

**Data Flow:**
1. **Teams Table (SQL)**: Stores `team_id` (ESPN), `statbroadcast_gid`, `statistical_representation` (feature vectors)
2. **StatBroadcast XML API**: Stream games on-the-fly from `schedule.php` → `archive/{gameId}.xml`
3. **Training Dataset (Temporary Cache)**: `data/training-dataset.json` - processed games for training
4. **MLP Pipeline**: Team features → Game representations → Transition probabilities → MCMC simulation

**Key Principle**: NO historical games stored in SQL. Stream from XML API and cache temporarily for training.

## Phase 1: Verify Schedule Scraping (Critical First Step)

- [-] 1. Audit StatBroadcast schedule parsing
- [x] 1.1 Review current schedule scraper implementation
  - Examine `scripts/fetch-team-games.js` schedule parsing logic
  - Verify game ID extraction from `https://www.statbroadcast.com/events/schedule.php?gid={gid}`
  - Check if scraper handles dynamic content loading (DataTables)
  - Identify potential parsing issues or missed games
  - _Requirements: 19.1, 19.2, 19.3_

- [x] 1.2 Test schedule scraping on sample teams
  - Run schedule scraper on 3-5 known teams (duke, unc, msu, etc.)
  - Compare scraped game counts with expected season totals (~25-30 games)
  - Verify game IDs are valid by testing XML fetch for sample games
  - Check for consistent parsing across different team schedule formats
  - _Requirements: 19.1, 19.2, 19.4_

- [x] 1.3 Fix schedule parsing if needed
  - Update scraper to handle JavaScript-rendered tables if necessary
  - Improve game ID extraction regex patterns
  - Add better error handling for malformed schedule pages
  - Implement retry logic for failed schedule fetches
  - _Requirements: 19.3, 19.5, 19.6_

- [x] 1.4 Validate game ID coverage
  - Write a test using jest to validate game ID coverage
  - Develop the following aspects of the test using a red green refactor strategy
    - Run full schedule scraping for all teams in database
    - Log statistics: teams processed, games found per team, failed teams
    - Verify total game count is reasonable (teams × ~25 games)
  - Identify teams with unusually low game counts for manual review
  - _Requirements: 19.1, 19.2, 20.2_

## Phase 2: Database Schema Corrections and Team/Game ID Management

**Goal**: Restructure the database to properly track teams and game IDs using StatBroadcast as the source of truth. This enables incremental feature vector updates as new games are played.

**Strategy**:
1. Seed teams from `data/statbroadcast-gids.json` (teams we have GIDs for)
2. Fetch all game IDs for each team from StatBroadcast archive
3. Store game IDs in a simplified `game_ids` table
4. Build feature vectors by fetching and analyzing game XML data
5. Enable incremental updates by tracking which games have been processed

- [ ] 2. Restructure database schema and seed teams
- [x] 2.1 Create database migration for schema changes
  - Rename `statbroadcast_game_ids` table to `game_ids`
  - Simplify `game_ids` schema to: `game_id` (PK), `sport`, `home_team_id` (FK to teams), `away_team_id` (FK to teams), `game_date`, `processed` (boolean)
  - Preserve `team_id` format for thread creation compatibility
  - Create indexes on `game_ids.home_team_id`, `game_ids.away_team_id`, and `game_ids.processed`
  - _Requirements: Database integrity, schema flexibility_

- [x] 2.2 Clear and reseed teams table
  - Clear existing teams table data
  - Load teams from `data/statbroadcast-gids.json`
  - Create team records with proper `team_id` (preserve format), `statbroadcast_gid`, and `team_name`
  - Initialize `statistical_representation` as NULL for all teams
  - Log seeding statistics (teams created, any failures)
  - _Requirements: Data consistency_

- [x] 2.3 Implement game ID discovery script
  - Create script to fetch game IDs from StatBroadcast archive for each team
  - Visit `https://www.statbroadcast.com/events/archive.php?gid=<statbroadcast_gid>` for each team
  - Parse HTML to extract all basketball game IDs
  - Handle pagination if archive has multiple pages
  - Implement rate limiting (1 second between requests)
  - _Requirements: Game ID collection_

- [x] 2.4 Populate game_ids table
  - Run game ID discovery for all teams in database
  - Handle duplicate game IDs (same game appears in both team archives)
  - Log statistics (total games found, games per team, date range)
  - _Requirements: Game tracking_

- [x] 2.5 Implement VAE-based feature extraction from game XML






  - Create script to fetch game XML from `http://archive.statbroadcast.com/<game_id>.xml`
  - Parse XML to extract comprehensive game features (80-dim): shooting stats, rebounding, assists, turnovers, advanced metrics, player-level data, lineup combinations
  - Normalize all features to [0,1] range for VAE input
  - Compute actual transition probabilities from play-by-play as ground truth
  - Initialize team latent distributions N(μ, σ²) with random values for new teams
  - Mark games as `processed=true` after successful extraction
  - _Requirements: VAE feature extraction, Bayesian team representations_

- [x] 2.6 Implement VAE architecture for team encoding





  - Create VariationalAutoencoder class with encoder/decoder networks
  - Encoder: game_features[80] → μ[16], σ[16] (latent team distribution)
  - Decoder: z[16] → reconstructed_features[80] (for training)
  - Implement VAE loss: reconstruction_loss + KL_divergence + α * NN_feedback_loss
  - Add methods for encoding games and sampling from team distributions
  - _Requirements: VAE team encoding, latent representations_

- [x] 2.7 Implement transition probability neural network





  - Create TransitionProbabilityNN class for predicting game outcomes
  - Input: [team_A_μ[16], team_A_σ[16], team_B_μ[16], team_B_σ[16], game_context[~10]]
  - Architecture: MLP with hidden layers (128, 64, 32) → 8 transition probabilities
  - Output: [2pt_make, 2pt_miss, 3pt_make, 3pt_miss, ft_make, ft_miss, oreb, turnover]
  - Implement cross-entropy loss calculation vs actual transition frequencies
  - _Requirements: Neural network transition prediction_

- [x] 2.8 Implement VAE-NN feedback loop mechanism





  - Create VAEFeedbackTrainer class to coordinate VAE and NN training
  - Implement feedback logic: when NN cross-entropy loss > threshold, backprop through VAE
  - Add decaying feedback coefficient α that reduces over time as system stabilizes
  - Implement loss combination: VAE_loss = reconstruction + KL + α * NN_loss
  - Add monitoring for feedback loop stability and convergence
  - _Requirements: VAE-NN feedback loop, self-improving representations_

- [x] 2.9 Implement Bayesian team distribution updates





  - Create BayesianTeamUpdater class for updating team latent distributions
  - Implement Bayesian inference: posterior = bayesian_update(prior, likelihood)
  - Update team N(μ, σ²) distributions based on observed game performance
  - Handle opponent strength considerations in update calculations
  - Maintain uncertainty estimates that decrease with more game observations
  - Implement inter-year uncertainty increase: add configurable variance to σ² at season start
  - Track season transitions to detect when to apply uncertainty adjustments
  - _Requirements: Bayesian team updates, uncertainty quantification, inter-year variance_

- [x] 2.10 Implement online learning orchestrator





  - Create OnlineLearningOrchestrator to coordinate the complete training process
  - Process games chronologically from game_ids table (processed=false)
  - For each game: extract features → VAE encode → NN predict → compute loss → update models → Bayesian update teams
  - Implement error handling and rollback for failed updates
  - Add comprehensive logging and progress tracking
  - _Requirements: Online learning coordination, chronological processing_

## Phase 3: VAE-NN System Training

**Prerequisites**: VAE architecture, NN architecture, and feedback mechanisms implemented.

- [ ] 3. Train VAE-NN system on historical games



- [x] 3.1 Initialize team latent distributions





  - Query all teams from teams table
  - Initialize statistical_representation with random N(μ=0, σ=1) distributions for 16 dimensions
  - Store initial distributions as JSON: {"mu": [16-array], "sigma": [16-array], "games_processed": 0, "last_season": "2024-25"}
  - Account for inter-year uncertainty: teams without recent games get higher initial σ values
  - Verify all teams have valid initial latent distributions
  - Log initialization statistics (teams initialized, distribution parameters, season tracking)
  - _Requirements: Team initialization, latent space setup, inter-year uncertainty_

- [x] 3.2 Train VAE-NN system on historical games















  - Query unprocessed games from game_ids table ordered by game_date ASC
  - For each game chronologically:
    - Fetch and parse XML to extract 88-dim normalized features
    - VAE encode game features to get team latent distributions
    - NN predict transition probabilities from team latents + context
    - Compute actual transition probabilities from play-by-play
    - Calculate NN cross-entropy loss vs actual probabilities
    - If loss > threshold: backprop NN loss through VAE (α coefficient)
    - Bayesian update team latent distributions based on performance
    - Mark game as processed
  - _Requirements: VAE-NN training, online learning, Bayesian updates_

- [x] 3.3 Validate VAE-NN system performance





  - Sample recent games and compare predicted vs actual transition probabilities
  - Verify team latent distributions have reasonable μ and decreasing σ over time
  - Check that VAE feedback loop is improving NN predictions
  - Monitor α decay and system convergence
  - Log validation metrics (prediction accuracy, calibration, team uncertainty)
  - _Requirements: Model validation, system performance_

## Phase 4: MCMC Integration with VAE-NN System

- [-] 4. Integrate VAE-NN system with MCMC simulation pipeline





- [x] 4.1 Update MCMCSimulator for VAE-NN integration


  - Modify `MCMCSimulator` to load team latent distributions from database
  - Integrate VAE-NN system for transition probability generation
  - Sample from team distributions N(μ, σ²) or use mean vectors for predictions
  - Build game context features (home/away, neutral site, rest days, etc.)
  - Implement fallback to aggregate statistics when VAE-NN unavailable
  - Track data source (VAE-NN vs fallback) in simulation results
  - _Requirements: MCMC integration, uncertainty handling_

- [x] 4.2 Test end-to-end MCMC with VAE-NN system


  - Run MCMC simulations using VAE-NN generated probabilities
  - Compare VAE-NN results vs traditional aggregate-based results
  - Verify simulation results are reasonable (win probabilities, score distributions)
  - Test uncertainty propagation from team distributions to game predictions
  - Validate that team uncertainty affects prediction confidence appropriately
  - _Requirements: End-to-end validation, uncertainty propagation_



- [x] 4.3 Generate betting recommendations with VAE-NN








  - Fetch today's NCAA basketball games from ESPN API
  - Load team latent distributions from teams.statistical_representation
  - Run MCMC simulations for each game using VAE-NN system
  - Calculate expected value for betting opportunities
  - Display recommendations in Discord betting threads
  - Include simulation details (iterations, confidence, data source, team uncertainty)
  - _Requirements: Betting recommendations, confidence intervals_

## Phase 4.5: Inter-Year Uncertainty Management



- [x] 4.5 Implement inter-year uncertainty adjustments




- [x] 4.5.1 Create season transition detection


  - Implement logic to detect when a new basketball season begins (typically November)
  - Check game dates to identify season boundaries
  - Track current season in team statistical representations
  - Log season transitions for all teams
  - _Requirements: Season boundary detection, temporal tracking_


- [x] 4.5.2 Implement inter-year variance increase

  - Add configurable inter-year variance parameter (default 0.25)
  - When new season detected, increase σ² for all teams by adding inter-year variance
  - Preserve μ values (team skill persists) but increase uncertainty (σ²)
  - Update last_season field in statistical representation
  - Log uncertainty adjustments (teams updated, variance added)
  - _Requirements: Inter-year uncertainty modeling, roster change adaptation_

- [x] 4.5.3 Create season-aware Bayesian updates


  - Modify BayesianTeamUpdater to check for season transitions before each update
  - Apply inter-year variance increase automatically when season boundary crossed
  - Weight recent games more heavily than games from previous seasons
  - Implement exponential decay for cross-season game influence
  - _Requirements: Season-aware learning, temporal weighting_

## Phase 5: Continuous Online Learning

- [x] 5. Implement continuous online learning for live game updates




- [x] 5.1 Implement post-game update pipeline


  - Create PostGameUpdater class to handle completed games
  - Fetch actual game XML after completion
  - Extract actual transition probabilities from play-by-play
  - Calculate NN prediction error vs actual outcomes
  - Update NN weights using small learning rate (avoid catastrophic forgetting)
  - Update VAE encoder if NN performance was poor (decaying α)
  - Bayesian update team latent distributions based on observed performance
  - _Requirements: Online learning, continuous improvement_


- [x] 5.2 Implement model performance monitoring






  - Create ModelPerformanceMonitor class to track system health
  - Monitor NN prediction accuracy over time
  - Track team distribution convergence (decreasing σ values)
  - Monitor VAE feedback frequency and α decay
  - Alert when model performance degrades significantly
  - Generate periodic performance reports
  - _Requirements: Model monitoring, performance tracking_


- [x] 5.3 Implement incremental game discovery






  - Create script to check for new games not in game_ids table
  - Fetch new game IDs from StatBroadcast archive for all teams
  - Add new games to game_ids table with processed=false
  - Enable daily/scheduled execution for continuous updates
  - Process new games through VAE-NN system as they become available
  - Log update statistics (new games found, teams updated, model improvements)
  - _Requirements: Continuous data ingestion, incremental learning_

## Critical Success Criteria

**Phase 1 Success**: Schedule scraper consistently extracts 20+ games per team
**Phase 2 Success**: Database schema updated, teams seeded, game IDs populated, VAE-NN architecture implemented
**Phase 3 Success**: VAE-NN system trains successfully with feedback loop, all teams have valid latent distributions N(μ, σ²)
**Phase 4 Success**: MCMC generates reasonable betting recommendations using VAE-NN predictions with uncertainty quantification
**Phase 5 Success**: Online learning system continuously improves predictions as new games are processed

## Notes

- **VAE-NN Architecture**: Three-component system with feedback loop for self-improving team representations
- **Data Architecture**: Stream from StatBroadcast XML API, process chronologically, store only latent team distributions
- **No SQL historical_games table**: Games are processed on-the-fly from XML API for online learning
- **Bayesian Updates**: Team representations N(μ, σ²) updated with each game, uncertainty decreases over time
- **Feedback Loop**: Poor NN predictions trigger VAE encoder updates with decaying coefficient α
- **Rate Limiting**: Critical when accessing StatBroadcast servers (1 second between requests)
- **Fallback Strategy**: Always maintain aggregate statistics fallback when VAE-NN unavailable
- **Validation**: Verify each phase before proceeding to ensure data quality and model convergence
