# VAE-NN Feedback Loop Training Guide

## Overview

The `VAEFeedbackTrainer` implements a sophisticated feedback loop mechanism that coordinates training between a Variational Autoencoder (VAE) and a Transition Probability Neural Network (NN). This system enables self-improving team representations through adaptive feedback.

## Key Features

### 1. Feedback Loop Mechanism
- **Trigger Condition**: When NN cross-entropy loss exceeds a threshold, feedback is triggered
- **Feedback Process**: NN loss is backpropagated through the VAE encoder
- **Loss Combination**: `VAE_loss = reconstruction + KL + α * NN_loss`
- **Self-Improvement**: VAE learns to encode teams in ways that improve NN predictions

### 2. Decaying Feedback Coefficient
- **Initial α**: Starts with a configurable feedback coefficient (default: 0.1)
- **Decay Rate**: α decays over time as the system stabilizes (default: 0.99 per iteration)
- **Minimum α**: Prevents α from decaying below a minimum threshold (default: 0.001)
- **Adaptive Learning**: System becomes less dependent on feedback as models improve

### 3. Monitoring and Convergence
- **Loss History**: Tracks NN and VAE losses over time
- **Feedback History**: Records when feedback is triggered
- **Convergence Detection**: Monitors loss variance to detect convergence
- **Stability Analysis**: Evaluates system stability based on feedback frequency

## Usage

### Basic Setup

```javascript
const VariationalAutoencoder = require('./src/modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('./src/modules/sports/TransitionProbabilityNN');
const VAEFeedbackTrainer = require('./src/modules/sports/VAEFeedbackTrainer');

// Initialize VAE and NN
const vae = new VariationalAutoencoder(80, 16);
const transitionNN = new TransitionProbabilityNN(10);

// Initialize trainer with custom parameters
const trainer = new VAEFeedbackTrainer(vae, transitionNN, {
  feedbackThreshold: 0.3,    // Trigger feedback when NN loss > 0.3
  initialAlpha: 0.1,         // Initial feedback coefficient
  alphaDecayRate: 0.95,      // Decay rate per iteration
  minAlpha: 0.001,           // Minimum feedback coefficient
  stabilityWindow: 10        // Window for stability monitoring
});
```

### Training on Single Games

```javascript
// Train on a single game
const gameFeatures = new Array(80).fill(0).map(() => Math.random());
const actualTransitionProbs = [0.2, 0.3, 0.1, 0.1, 0.1, 0.05, 0.1, 0.05];

const result = await trainer.trainOnGame(gameFeatures, actualTransitionProbs);

console.log(`NN Loss: ${result.nnLoss.toFixed(6)}`);
console.log(`VAE Loss: ${result.vaeLoss.toFixed(6)}`);
console.log(`Feedback Triggered: ${result.feedbackTriggered}`);
console.log(`Current α: ${result.currentAlpha.toFixed(6)}`);
```

### Batch Training

```javascript
// Prepare batch of games
const gamesBatch = [
  {
    gameFeatures: [...],
    actualTransitionProbs: [...],
    teamA_mu: [...],      // Optional: pre-computed team representations
    teamA_sigma: [...],
    teamB_mu: [...],
    teamB_sigma: [...],
    gameContext: [...]
  },
  // ... more games
];

// Train on batch
const batchResult = await trainer.trainOnBatch(gamesBatch);

console.log(`Batch size: ${batchResult.batchSize}`);
console.log(`Average NN loss: ${batchResult.averageNNLoss.toFixed(6)}`);
console.log(`Feedback trigger rate: ${(batchResult.feedbackTriggerRate * 100).toFixed(1)}%`);
```

### Monitoring Training Progress

```javascript
// Get comprehensive training statistics
const stats = trainer.getTrainingStats();

console.log(`Total iterations: ${stats.totalIterations}`);
console.log(`Feedback triggers: ${stats.feedbackTriggers}`);
console.log(`Convergence achieved: ${stats.convergenceAchieved}`);
console.log(`System stable: ${stats.stability.stable}`);

// Check convergence manually
const converged = trainer.checkConvergence();
console.log(`Training converged: ${converged}`);

// Monitor stability
const stability = trainer.monitorStability();
console.log(`Feedback rate: ${(stability.feedbackRate * 100).toFixed(1)}%`);
console.log(`Alpha decay rate: ${(stability.alphaDecayRate * 100).toFixed(1)}%`);
```

### Configuration Management

```javascript
// Update feedback threshold
trainer.setFeedbackThreshold(0.5);

// Update alpha decay parameters
trainer.setAlphaDecayParameters(0.98, 0.005);

// Reset training state for new session
trainer.reset();
```

### State Persistence

```javascript
// Save trainer state
await trainer.saveToFile('models/vae_feedback_trainer_state.json');

// Load trainer state
await trainer.loadFromFile('models/vae_feedback_trainer_state.json');

// Or use JSON serialization
const state = trainer.toJSON();
const newTrainer = new VAEFeedbackTrainer(vae, transitionNN);
newTrainer.fromJSON(state);
```

## Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `feedbackThreshold` | 0.5 | NN loss threshold for triggering VAE feedback |
| `initialAlpha` | 0.1 | Initial feedback coefficient |
| `alphaDecayRate` | 0.99 | Decay rate for feedback coefficient per iteration |
| `minAlpha` | 0.001 | Minimum feedback coefficient |
| `maxIterations` | 1000 | Maximum training iterations |
| `convergenceThreshold` | 1e-6 | Variance threshold for convergence detection |
| `stabilityWindow` | 10 | Window size for stability monitoring |

## Training Flow

1. **VAE Forward Pass**: Encode game features to team latent distributions N(μ, σ²)
2. **NN Forward Pass**: Predict transition probabilities from team representations
3. **NN Training**: Train NN on predicted vs actual transition probabilities
4. **Feedback Decision**: Check if NN loss exceeds threshold
5. **VAE Feedback** (if triggered): Backpropagate NN loss through VAE encoder
6. **VAE Training**: Train VAE with or without feedback loss
7. **Alpha Decay**: Reduce feedback coefficient for next iteration
8. **Monitoring**: Record metrics and check for convergence

## Best Practices

### 1. Threshold Tuning
- Start with moderate threshold (0.3-0.5)
- Lower threshold = more feedback = faster adaptation but potential instability
- Higher threshold = less feedback = more stable but slower adaptation

### 2. Alpha Management
- Initial α should be small (0.05-0.15) to prevent overwhelming VAE training
- Decay rate should be gradual (0.95-0.99) to allow system stabilization
- Monitor feedback frequency - aim for decreasing rate over time

### 3. Convergence Monitoring
- Check both NN and VAE loss variance for convergence
- System is stable when feedback rate < 50% and decreasing
- Allow sufficient training iterations for α to decay properly

### 4. Batch vs Single Training
- Single game training: Better for online learning and real-time adaptation
- Batch training: More efficient for large datasets and stable training

### 5. Error Handling
- Validate input dimensions before training
- Monitor for NaN or infinite losses
- Implement graceful degradation when feedback fails

## Integration with Basketball Prediction System

The VAEFeedbackTrainer is designed to work with the basketball prediction pipeline:

1. **Game Processing**: StatBroadcast XML → normalized features (80-dim)
2. **Team Encoding**: VAE encodes features → team distributions N(μ, σ²) (16-dim)
3. **Prediction**: NN uses team distributions → transition probabilities (8-dim)
4. **MCMC Simulation**: Uses probabilities → game outcomes and betting recommendations
5. **Online Learning**: Actual game results → feedback training → improved models

This creates a self-improving system where poor predictions trigger VAE updates, leading to better team representations and more accurate future predictions.