┌─────────────────────────────────────────────────────────────┐
│              Generative Transition Matrix System             │
└─────────────────────────────────────────────────────────────┘

TRAINING PHASE (from historical games):
1. Parse StatBroadcast XML → Extract play-by-play
2. Compute actual transition probabilities (ground truth)
3. Extract team features from aggregate stats
4. Train MLP: [team1_features, team2_features, context] → [transition_probs]

PREDICTION PHASE (for upcoming games):
1. Load team feature vectors from database
2. Construct game representation with context
3. MLP generates predicted transition probabilities
4. MCMC simulator uses these probabilities
5. Calculate EV and make betting recommendations

UPDATE PHASE (after game completes):
1. Parse new game's play-by-play
2. Compute actual transition probabilities
3. Calculate prediction error (loss)
4. Bayesian update: Adjust team feature vectors based on performance delta
5. Online learning: Update MLP weights incrementally
6. Store updated team features in database

RECONCILIATION PHASE (backfill):
1. Process all missed games in batch
2. Extract features and targets for each
3. Batch update MLP parameters
4. Update all affected team feature vectors
