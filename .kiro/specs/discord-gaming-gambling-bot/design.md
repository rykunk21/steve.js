# Design Document

## Overview

Discord bot providing gaming lobby management and sports betting discussion features. The betting system uses ESPN API for game data, ActionNetwork for odds, and advanced MCMC simulation for predictions.

## Architecture

### Core Systems

1. **Gaming Module** - Private voice channels and lobby management
2. **Sports Module** - Game tracking, odds scraping, betting threads
3. **MCMC Prediction Engine** - Statistical simulation for betting recommendations
4. **Database Layer** - Game history, team stats, betting snapshots

### Data Flow

```
ESPN API → Game Data → Admin Selection → Betting Thread
                                              ↓
ActionNetwork → Odds Data → Team Matching → Thread Display
                                              ↓
StatBroadcast → Play-by-Play → Real-time Updates → Bayesian Priors
                                              ↓
Historical DB → Team Stats → MCMC Sim → EV Calc → Recommendation
```

## Key Components

### ESPN API Client
- Fetches game schedules for NFL, NBA, NHL, NCAA Basketball, NCAA Football
- Extracts team info, logos, colors, game times
- Caches data to minimize API calls

### StatBroadcast API Client
- Connects to https://www.statbroadcast.com for NCAA basketball data
- Fetches complete game data from XML archives at http://archive.statbroadcast.com/{gameId}.xml
- Crawls site structure to discover schools and games
- Streams real-time play-by-play data during live games
- Parses possession-level events (shots, rebounds, turnovers)
- Provides normalized data for transition matrix building
- Does NOT store data locally - processes in real-time

### XMLGameParser
- Parses StatBroadcast XML into structured format
- Extracts game metadata (teams, date, venue, neutral site)
- Extracts team aggregate statistics (FG%, 3PT%, FT%, rebounds, turnovers, assists)
- Extracts advanced metrics (points in paint, fast break, second chance, possession count)
- Extracts complete play-by-play sequences with shot types and results
- Extracts player-level statistics
- Calculates derived metrics (efficiency, rates, shot distribution)

### HistoricalGameFetcher
- Fetches game IDs from StatBroadcast schedule endpoint
- Queries https://www.statbroadcast.com/events/schedule.php?gid={statbroadcast_gid}
- Parses schedule response to extract game IDs
- Fetches XML from http://archive.statbroadcast.com/{gameId}.xml
- Processes games on-the-fly without storing raw data
- Implements rate limiting to respect StatBroadcast servers
- Returns parsed game data for immediate processing

### ActionNetwork Scraper
- Uses Puppeteer for dynamic content
- Scrapes moneyline, spread, totals
- Stores snapshots for line movement tracking

### Team Name Matcher
- Matches ESPN games to ActionNetwork odds
- Uses Levenshtein distance algorithm
- Handles abbreviation variations

### Betting Thread Manager
- Creates Discord forum threads per game
- Displays spread visualization with team colors
- Shows current odds and recommendations
- Updates threads with line movements

### VAE-Neural Network Prediction Engine

**Three-Component Architecture:**

1. **Team Encoding VAE (Variational Autoencoder)**
   - **Input**: Normalized game features (80 dimensions): shooting stats, rebounding, assists, turnovers, advanced metrics, player-level data, lineup combinations
   - **Encoder**: Maps game features → latent team distribution N(μ, σ²) with 16 dimensions
   - **Decoder**: Reconstructs game features from latent vector for training
   - **Loss**: Reconstruction loss + KL divergence + α * NN_feedback_loss
   - **Output**: 16-dimensional latent team representations with uncertainty estimates

2. **Transition Probability Neural Network**
   - **Input**: [team_A_μ[16], team_A_σ[16], team_B_μ[16], team_B_σ[16], game_context[~10]]
   - **Architecture**: MLP with hidden layers (128, 64, 32)
   - **Output**: 8 transition probabilities (2pt make/miss, 3pt make/miss, FT make/miss, oreb, turnover)
   - **Training**: Cross-entropy loss vs actual observed transition frequencies

3. **MCMC Game Simulation**
   - Runs 10,000+ Monte Carlo iterations using NN-predicted transition probabilities
   - Simulates possession-by-possession gameplay
   - Generates win probabilities and score distributions for betting analysis

**Key Innovation - VAE-NN Feedback Loop:**
- When NN cross-entropy loss > threshold: backpropagate NN loss through VAE encoder
- VAE learns to encode teams in ways that improve transition probability predictions
- Feedback coefficient α decays over time as system stabilizes
- Creates self-improving team representations

**Supporting Components:**

4. **HistoricalGameFetcher**
   - Fetches game IDs from StatBroadcast schedule endpoint using team GIDs
   - Retrieves XML data from archive for each game ID
   - Processes games chronologically for proper Bayesian updates
   - Implements rate limiting and error handling

5. **GameFeatureExtractor**
   - Extracts and normalizes 80-dimensional feature vectors from XML game data
   - Includes: shooting percentages, rebounding rates, assist rates, turnover rates, pace, efficiency metrics
   - Player-level features: minutes, plus/minus, usage rates for key players
   - Lineup combinations: most-used lineups and their performance metrics
   - Situational features: performance in different game states

6. **TransitionProbabilityComputer**
   - Parses play-by-play data from XML
   - Counts possession outcomes (2pt make/miss, 3pt make/miss, FT, turnover, rebound)
   - Calculates empirical transition probabilities as ground truth
   - Validates probabilities sum to 1.0

7. **BayesianTeamUpdater**
   - Updates team latent distributions N(μ, σ²) using Bayesian inference
   - Incorporates observed game performance to refine team representations
   - Handles opponent strength in update calculations
   - Maintains uncertainty estimates that decrease with more observations

8. **EV Calculator**
   - Converts American odds to implied probabilities
   - Compares MCMC-simulated probabilities vs implied probabilities
   - Identifies +EV opportunities (5%+ edge)
   - Accounts for betting market efficiency

**Training Pipeline:**

```
1. Load all teams from teams table (random initialization of latent distributions)
2. Query game_ids table for unprocessed games, ordered chronologically
3. For each game:
   a. Fetch XML from StatBroadcast archive
   b. Extract normalized game features (80-dim)
   c. Encode teams using VAE → latent distributions N(μ, σ²)
   d. Compute actual transition probabilities from play-by-play
   e. Train NN: predict transitions from team latents + context
   f. If NN loss > threshold: backprop through VAE (α * NN_loss)
   g. Bayesian update of team latent distributions
   h. Mark game as processed
4. Store trained VAE weights, NN weights, and team distributions
```

**Online Learning Pipeline:**

```
1. Fetch today's games from ESPN API
2. Load team latent distributions N(μ, σ²) from teams table
3. For each game:
   a. Sample from team distributions or use mean vectors
   b. Build game representation (team_A + team_B + context)
   c. Generate transition probabilities with NN
   d. Run MCMC simulation (10k iterations)
   e. Calculate EV for all betting markets
   f. Generate recommendation with confidence
4. After game completion:
   a. Fetch actual game XML
   b. Update NN weights based on prediction error
   c. Update VAE if NN performance poor (decaying α)
   d. Bayesian update of team distributions
   e. Store updated models and team representations
```

## Database Schema

### Teams Table
```sql
CREATE TABLE teams (
    team_id TEXT PRIMARY KEY,              -- ESPN team ID (e.g., "150" for Duke)
    statbroadcast_gid TEXT UNIQUE NOT NULL, -- StatBroadcast GID (e.g., "duke", "ilsu")
    team_name TEXT NOT NULL,                -- Human-readable name
    sport TEXT NOT NULL DEFAULT 'mens-college-basketball',
    conference TEXT,                        -- Conference affiliation
    
    -- VAE latent team representation (JSON blob)
    -- Contains: {"mu": [16-dim array], "sigma": [16-dim array], "games_processed": int}
    -- Represents team as N(μ, σ²) distribution in 16-dimensional latent space
    statistical_representation TEXT,
    
    -- Player roster for injury analysis (JSON array) - future use
    player_roster TEXT,
    
    -- Sync tracking
    last_synced TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Game IDs Table
```sql
CREATE TABLE game_ids (
    game_id TEXT PRIMARY KEY,              -- StatBroadcast game ID
    sport TEXT NOT NULL DEFAULT 'mens-college-basketball',
    home_team_id TEXT,                     -- FK to teams.team_id
    away_team_id TEXT,                     -- FK to teams.team_id
    game_date DATE NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT 0,  -- Whether game has been used for training
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
    FOREIGN KEY (away_team_id) REFERENCES teams(team_id)
);
```

**Key Points:**
- `team_id` is used to fetch today's games from ESPN API
- `statbroadcast_gid` is used to fetch historical game IDs from schedule endpoint
- `statistical_representation` stores VAE latent distribution N(μ, σ²) as JSON
- `game_ids.processed` tracks which games have been used for online learning
- No historical_games table needed - games are processed on-the-fly from StatBroadcast

### Model Predictions (for validation only)
```sql
CREATE TABLE model_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    prediction_time TIMESTAMP NOT NULL,
    
    -- Predictions
    home_win_prob REAL,
    away_win_prob REAL,
    predicted_spread REAL,
    predicted_total REAL,
    
    -- Actual outcomes (filled after game)
    actual_home_score INTEGER,
    actual_away_score INTEGER,
    
    -- Validation metrics
    brier_score REAL,
    log_loss REAL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Correctness Properties

### Property 1: Historical data persistence
*For any* completed game, storing the result should allow retrieval of the same game data including scores and betting outcomes.
**Validates: Requirements 10.1, 10.2, 10.3**

### Property 2: Bayesian update convergence
*For any* team with multiple game results, the posterior distribution standard deviation should decrease as more games are observed.
**Validates: Requirements 11.2, 11.4**

### Property 3: Opponent adjustment consistency
*For any* set of teams, running the opponent-adjustment algorithm should converge to stable ratings within 100 iterations.
**Validates: Requirements 12.1, 12.3, 12.6**

### Property 4: MCMC simulation stability
*For any* transition matrix, running the simulation twice with different random seeds should produce win probabilities within 2% of each other.
**Validates: Requirements 2E.4**

### Property 5: EV calculation correctness
*For any* betting odds, the implied probability calculated should sum to greater than 1.0 (accounting for vig).
**Validates: Requirements 2E.6**

### Property 6: Model calibration
*For any* set of predictions, the predicted probabilities should match actual outcomes within calibration tolerance (Brier score < 0.25).
**Validates: Requirements 15.2, 15.5**

### Property 7: Ensemble improvement
*For any* validation dataset, the ensemble model should have lower error than the worst individual model.
**Validates: Requirements 16.6**

### Property 8: Play-by-play data integrity
*For any* game with play-by-play data, the sum of all scoring events should equal the final score for both teams.
**Validates: Requirements 13.4, 17.5**

### Property 9: Real-time Bayesian updates
*For any* team with play-by-play data, the posterior distribution after processing all possessions should have lower variance than the prior.
**Validates: Requirements 13.9, 11.4**

### Property 10: XML parsing completeness
*For any* valid StatBroadcast XML game file, parsing should extract all required fields (metadata, team stats, play-by-play) without errors.
**Validates: Requirements 18.2, 18.3, 18.4, 18.5**

### Property 11: Game ID mapping consistency
*For any* ESPN game ID that is successfully mapped to a StatBroadcast ID, retrieving the mapping again should return the same StatBroadcast ID.
**Validates: Requirements 19.1, 19.2, 19.6**

### Property 12: Team name normalization
*For any* pair of team name variations (e.g., "UNC" and "North Carolina"), the normalization function should produce the same normalized form.
**Validates: Requirements 19.4**

### Property 13: Reconciliation completeness
*For any* date range, running reconciliation should identify all ESPN games that are not in the processed games database.
**Validates: Requirements 20.2, 20.3, 20.4**

### Property 14: Backfill idempotence
*For any* game that has already been backfilled, attempting to backfill it again should skip it without creating duplicate records.
**Validates: Requirements 20.12**

### Property 15: Possession count accuracy
*For any* game with StatBroadcast XML data containing possession count, the extracted possession count should be used instead of estimation formulas.
**Validates: Requirements 18.9**

## Testing Strategy

### Unit Tests
- Test each component in isolation
- Mock external dependencies (ESPN API, database)
- Verify mathematical correctness (Bayesian updates, EV calculations)

### Integration Tests
- Test full prediction pipeline
- Use historical game data
- Verify end-to-end flow

### Property-Based Tests
- Generate random game scenarios
- Verify correctness properties hold
- Test edge cases (blowouts, close games, pick'ems)

### Validation Tests
- Backtest on historical data
- Measure calibration and accuracy
- Compare against market odds

## Error Handling

- ESPN API failures → Use cached data, fallback to basic stats
- Missing team stats → Use league averages with high uncertainty
- Bayesian update failures → Log error, use prior distribution
- MCMC simulation errors → Fall back to simpler model
- Database errors → Log and continue with in-memory data

## Performance Considerations

- Cache team stats for 24 hours
- Pre-compute opponent-adjusted ratings daily
- Run MCMC simulations asynchronously
- Index database on team_id, date, season
- Limit historical queries to recent seasons

