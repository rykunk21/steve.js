# MLP Training and Testing Guide

This guide explains how to train and test the generative transition matrix MLP model.

## Prerequisites

1. **Historical Game Data**: You need games with play-by-play data in the `historical_games` table
2. **Team Data**: Teams should be in the `teams` table with StatBroadcast GIDs
3. **Node.js**: Version 18+ installed

## Training Workflow

### Step 1: Ensure You Have Training Data

Check your database for games with play-by-play data:

```bash
sqlite3 data/bot.db "SELECT COUNT(*) FROM historical_games WHERE has_play_by_play = 1;"
```

You need at least 50-100 games for meaningful training.

### Step 2: Initial Model Training

Train the model on a full season of historical data:

```bash
node scripts/train-mlp-model.js mens-college-basketball 2024
```

**Training Parameters:**
- `sport`: Sport identifier (default: mens-college-basketball)
- `season`: Season year (default: current year)

**What happens:**
1. Loads all games with play-by-play data for the season
2. Extracts team features from game histories
3. Computes actual transition probabilities from play-by-play
4. Trains MLP using mini-batch gradient descent
5. Validates on held-out data with early stopping
6. Saves trained model to `data/models/transition_mlp_[sport]_[season].json`

**Expected Output:**
```
Training completed successfully
Epochs: 45
Final Train Loss: 0.1234
Final Validation Loss: 0.1456
Test Loss: 0.1389
```

### Step 3: Test Predictions

Test the model on a matchup:

```bash
node scripts/test-mlp-predictions.js TEAM_ID_1 TEAM_ID_2
```

**Example:**
```bash
node scripts/test-mlp-predictions.js 127 150  # Michigan State vs Duke
```

**What happens:**
1. Loads team game histories
2. Extracts features for both teams
3. Builds game representation
4. Uses MLP to generate transition probabilities
5. Runs MCMC simulation (10,000 iterations)
6. Displays win probabilities and expected scores

**Expected Output:**
```
=== Simulation Results ===
Data Source: mlp_generated
Used Generative Model: Yes
Iterations: 10,000

Win Probabilities:
  Home: 62.3%
  Away: 37.7%

Expected Scores:
  Home: 75.2
  Away: 68.4

Expected Margin: Home by 6.8
Implied Spread: Home -6.8
```

### Step 4: Online Learning Updates

After each completed game, update the model:

```bash
node scripts/update-model-from-game.js GAME_ID
```

**What happens:**
1. Loads game data and XML
2. Computes actual transition probabilities
3. Generates predicted probabilities using current model
4. Calculates prediction error
5. Performs single gradient descent step (learning rate: 0.0001)
6. Updates team feature vectors using Bayesian update
7. Saves updated model and features

**Expected Output:**
```
=== Update Results ===
Success: true
Steps Completed: 4

compute_probabilities:
  Success: true

update_mlp:
  Success: true
  Loss: 0.0823
  Prediction Error: 0.0891

update_features:
  Success: true
  Home Feature Change: 0.0234
  Away Feature Change: 0.0189
```

## Integration with Bot

### Automatic Updates During Reconciliation

The `GameReconciliationService` automatically triggers model updates when backfilling games:

```javascript
const orchestrator = new ModelUpdateOrchestrator(
  historicalGameRepo,
  teamRepo,
  xmlGameParser
);

const reconciliationService = new GameReconciliationService(
  historicalGameRepo,
  reconciliationLogRepo,
  teamRepo,
  gameIdDiscoveryService,
  statBroadcastClient,
  xmlGameParser,
  espnAPIClient,
  orchestrator  // Pass orchestrator
);

// Configure batch updates
reconciliationService.configureModelUpdates({
  enabled: true,
  batchSize: 10,  // Update after every 10 games
  accumulateGradients: true
});

// Reconcile will automatically update model
await reconciliationService.reconcileRecentGames(7);
```

### Using MLP in Predictions

The `MCMCSimulator` automatically uses the MLP if available:

```javascript
const onlineLearner = new OnlineLearner(historicalGameRepo);
const simulator = new MCMCSimulator(10000, onlineLearner, teamRepo);

// Build traditional matrix as fallback
const matrix = matrixBuilder.buildMatrix(homeStats, awayStats, sport);

// Simulate (will use MLP if available)
const results = await simulator.simulate(matrix, {
  homeTeamId: 'team1',
  awayTeamId: 'team2',
  gameDate: new Date(),
  isNeutralSite: false,
  sport: 'mens-college-basketball',
  season: 2024
});

console.log('Used MLP:', results.usedGenerativeModel);
console.log('Data Source:', results.dataSource);
```

## Model Files

Models are saved as JSON files in `data/models/`:

```
data/models/
  transition_mlp_mens-college-basketball_2024.json
  transition_mlp_mens-college-basketball_2025.json
```

Each file contains:
- Network architecture (layers, dimensions)
- Weights and biases for all layers
- Learning rate and training configuration

## Monitoring Model Performance

### Check Prediction Accuracy

Compare predicted vs actual outcomes:

```javascript
const predicted = await onlineLearner.predict(homeId, awayId, context, sport, season);
const actual = transitionComputer.computeFromGameData(gameData);

const error = mlp.computeLoss(
  transitionComputer.matrixToArray(predicted),
  transitionComputer.matrixToArray(actual)
);

console.log('Prediction Error:', error.toFixed(4));
```

### Track Metrics

The `ModelUpdateOrchestrator` tracks metrics:

```javascript
const metrics = orchestrator.getMetrics();
console.log('Success Rate:', metrics.successRate);
console.log('Avg Update Time:', metrics.avgUpdateTime);
```

## Troubleshooting

### "No training data available"

**Problem:** Not enough games with play-by-play data

**Solution:** 
1. Run reconciliation to backfill historical games
2. Ensure StatBroadcast XML data is being fetched
3. Check `has_play_by_play` flag in database

### "Insufficient history for online learning"

**Problem:** Teams don't have enough game history

**Solution:**
- Need at least 5 games per team for updates
- Backfill more historical data
- Wait for more games to be played

### "Failed to load model"

**Problem:** Model file doesn't exist

**Solution:**
1. Train initial model using training script
2. Check `data/models/` directory exists
3. Verify file permissions

### Model predictions seem random

**Problem:** Model not trained or undertrained

**Solution:**
1. Train on more data (100+ games minimum)
2. Increase training epochs
3. Check training loss is decreasing
4. Verify feature extraction is working correctly

## Best Practices

1. **Initial Training**: Train on at least one full season (200+ games)
2. **Regular Updates**: Update model after every completed game
3. **Batch Processing**: Use batch updates during reconciliation (10-20 games)
4. **Monitoring**: Track prediction errors and update metrics
5. **Fallback**: Always have traditional matrix builder as fallback
6. **Validation**: Periodically retrain and validate on held-out data

## Performance Expectations

- **Training Time**: ~5-10 minutes for 200 games (depends on hardware)
- **Prediction Time**: ~50-100ms per game
- **Update Time**: ~200-500ms per game
- **Memory Usage**: ~50-100MB for model in memory

## Next Steps

1. Collect more historical game data
2. Train initial model on full season
3. Integrate with betting recommendation engine
4. Monitor prediction accuracy over time
5. Retrain periodically with accumulated data
