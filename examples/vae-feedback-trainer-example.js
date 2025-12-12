/**
 * Example demonstrating VAE-NN Feedback Loop Training
 * This shows how the VAEFeedbackTrainer coordinates VAE and NN training
 * with feedback mechanism for self-improving team representations
 */

const VariationalAutoencoder = require('../src/modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('../src/modules/sports/TransitionProbabilityNN');
const VAEFeedbackTrainer = require('../src/modules/sports/VAEFeedbackTrainer');

async function demonstrateVAEFeedbackTraining() {
  console.log('=== VAE-NN Feedback Loop Training Demo ===\n');

  // Step 1: Initialize VAE and NN
  console.log('1. Initializing VAE and TransitionProbabilityNN...');
  const vae = new VariationalAutoencoder(80, 16);
  const transitionNN = new TransitionProbabilityNN(10);
  
  console.log(`   VAE: ${vae.inputDim}→${vae.latentDim} dimensions, ${vae.countParameters()} parameters`);
  console.log(`   NN: ${transitionNN.inputDim}→${transitionNN.outputDim} dimensions, ${transitionNN.countParameters()} parameters`);

  // Step 2: Initialize VAEFeedbackTrainer
  console.log('\n2. Initializing VAEFeedbackTrainer...');
  const trainer = new VAEFeedbackTrainer(vae, transitionNN, {
    feedbackThreshold: 0.3,    // Trigger feedback when NN loss > 0.3
    initialAlpha: 0.1,         // Initial feedback coefficient
    alphaDecayRate: 0.95,      // Decay rate per iteration
    minAlpha: 0.001,           // Minimum feedback coefficient
    stabilityWindow: 5         // Window for stability monitoring
  });
  
  console.log(`   Feedback threshold: ${trainer.feedbackThreshold}`);
  console.log(`   Initial α: ${trainer.initialAlpha}`);
  console.log(`   Decay rate: ${trainer.alphaDecayRate}`);

  // Step 3: Generate synthetic training data
  console.log('\n3. Generating synthetic training data...');
  const trainingGames = [];
  
  for (let i = 0; i < 10; i++) {
    // Generate random game features (normalized to [0,1])
    const gameFeatures = new Array(80).fill(0).map(() => Math.random());
    
    // Generate realistic transition probabilities that sum to 1
    const rawProbs = [
      Math.random() * 0.3 + 0.2,  // 2pt_make: 0.2-0.5
      Math.random() * 0.3 + 0.2,  // 2pt_miss: 0.2-0.5
      Math.random() * 0.15 + 0.05, // 3pt_make: 0.05-0.2
      Math.random() * 0.15 + 0.05, // 3pt_miss: 0.05-0.2
      Math.random() * 0.1 + 0.05,  // ft_make: 0.05-0.15
      Math.random() * 0.05 + 0.02, // ft_miss: 0.02-0.07
      Math.random() * 0.1 + 0.05,  // oreb: 0.05-0.15
      Math.random() * 0.1 + 0.05   // turnover: 0.05-0.15
    ];
    
    // Normalize to sum to 1
    const sum = rawProbs.reduce((a, b) => a + b, 0);
    const actualTransitionProbs = rawProbs.map(p => p / sum);
    
    trainingGames.push({
      gameFeatures,
      actualTransitionProbs,
      gameId: `game_${i + 1}`
    });
  }
  
  console.log(`   Generated ${trainingGames.length} synthetic games`);

  // Step 4: Train with feedback loop
  console.log('\n4. Training with VAE-NN feedback loop...');
  console.log('   Iteration | NN Loss  | VAE Loss | Feedback | α      | Status');
  console.log('   ---------|----------|----------|----------|--------|--------');
  
  for (let epoch = 0; epoch < 3; epoch++) {
    console.log(`\n   === Epoch ${epoch + 1} ===`);
    
    for (const game of trainingGames) {
      const result = await trainer.trainOnGame(
        game.gameFeatures,
        game.actualTransitionProbs
      );
      
      const feedbackStatus = result.feedbackTriggered ? 'YES' : 'NO';
      const status = result.feedbackTriggered ? '🔄 Feedback' : '✓ Normal';
      
      console.log(`   ${String(result.iteration).padStart(9)} | ${result.nnLoss.toFixed(6)} | ${result.vaeLoss.toFixed(6)} | ${feedbackStatus.padStart(8)} | ${result.currentAlpha.toFixed(4)} | ${status}`);
    }
  }

  // Step 5: Analyze training results
  console.log('\n5. Training Analysis:');
  const stats = trainer.getTrainingStats();
  
  console.log(`   Total iterations: ${stats.totalIterations}`);
  console.log(`   Feedback triggers: ${stats.feedbackTriggers} (${(stats.feedbackTriggers / stats.totalIterations * 100).toFixed(1)}%)`);
  console.log(`   Final α: ${stats.finalAlpha.toFixed(6)}`);
  console.log(`   Average NN loss: ${stats.averageNNLoss.toFixed(6)}`);
  console.log(`   Average VAE loss: ${stats.averageVAELoss.toFixed(6)}`);
  console.log(`   Convergence achieved: ${stats.convergenceAchieved ? 'YES' : 'NO'}`);
  
  const stability = stats.stability;
  console.log(`   System stable: ${stability.stable ? 'YES' : 'NO'}`);
  console.log(`   Recent feedback rate: ${(stability.feedbackRate * 100).toFixed(1)}%`);

  // Step 6: Demonstrate batch training
  console.log('\n6. Demonstrating batch training...');
  const batchGames = trainingGames.slice(0, 3);
  const batchResult = await trainer.trainOnBatch(batchGames);
  
  console.log(`   Batch size: ${batchResult.batchSize}`);
  console.log(`   Average NN loss: ${batchResult.averageNNLoss.toFixed(6)}`);
  console.log(`   Average VAE loss: ${batchResult.averageVAELoss.toFixed(6)}`);
  console.log(`   Feedback trigger rate: ${(batchResult.feedbackTriggerRate * 100).toFixed(1)}%`);

  // Step 7: Test prediction with trained models
  console.log('\n7. Testing prediction with trained models...');
  const testGame = trainingGames[0];
  
  // Encode game features to team representations
  const { mu, sigma } = vae.encodeGameToTeamDistribution(testGame.gameFeatures);
  console.log(`   Team representation μ: [${mu.slice(0, 3).map(x => x.toFixed(3)).join(', ')}...]`);
  console.log(`   Team representation σ: [${sigma.slice(0, 3).map(x => x.toFixed(3)).join(', ')}...]`);
  
  // Generate game context
  const gameContext = new Array(10).fill(0.5); // Neutral context
  
  // Predict transition probabilities
  const prediction = transitionNN.predict(mu, sigma, mu, sigma, gameContext);
  console.log('\n   Predicted transition probabilities:');
  Object.entries(prediction).forEach(([label, prob]) => {
    console.log(`     ${label}: ${prob.toFixed(4)}`);
  });
  
  console.log('\n   Actual transition probabilities:');
  transitionNN.transitionLabels.forEach((label, i) => {
    console.log(`     ${label}: ${testGame.actualTransitionProbs[i].toFixed(4)}`);
  });

  // Step 8: Demonstrate serialization
  console.log('\n8. Demonstrating state serialization...');
  const trainerState = trainer.toJSON();
  console.log(`   Serialized state size: ${JSON.stringify(trainerState).length} characters`);
  
  // Create new trainer and load state
  const newTrainer = new VAEFeedbackTrainer(vae, transitionNN);
  newTrainer.fromJSON(trainerState);
  console.log(`   Loaded state - iteration: ${newTrainer.iteration}, α: ${newTrainer.currentAlpha.toFixed(6)}`);

  // Step 9: Monitor convergence and stability
  console.log('\n9. Convergence and Stability Analysis:');
  
  if (trainer.lossHistory.length >= trainer.stabilityWindow) {
    const recentLosses = trainer.lossHistory.slice(-trainer.stabilityWindow);
    const nnLosses = recentLosses.map(l => l.nnLoss);
    const nnMean = nnLosses.reduce((a, b) => a + b, 0) / nnLosses.length;
    const nnVariance = nnLosses.reduce((sum, l) => sum + Math.pow(l - nnMean, 2), 0) / nnLosses.length;
    
    console.log(`   Recent NN loss variance: ${nnVariance.toFixed(8)}`);
    console.log(`   Convergence threshold: ${trainer.convergenceThreshold}`);
    console.log(`   Converged: ${nnVariance < trainer.convergenceThreshold ? 'YES' : 'NO'}`);
  }

  // Step 10: Demonstrate feedback mechanism details
  console.log('\n10. Feedback Mechanism Analysis:');
  console.log(`    Initial feedback coefficient: ${trainer.initialAlpha}`);
  console.log(`    Current feedback coefficient: ${trainer.currentAlpha.toFixed(6)}`);
  console.log(`    Decay rate per iteration: ${trainer.alphaDecayRate}`);
  console.log(`    Minimum coefficient: ${trainer.minAlpha}`);
  
  const totalDecay = (trainer.initialAlpha - trainer.currentAlpha) / trainer.initialAlpha;
  console.log(`    Total decay: ${(totalDecay * 100).toFixed(1)}%`);
  
  console.log('\n    Feedback Logic:');
  console.log(`    - When NN cross-entropy loss > ${trainer.feedbackThreshold}:`);
  console.log(`      → Backpropagate NN loss through VAE encoder`);
  console.log(`      → VAE loss = reconstruction + KL + α * NN_loss`);
  console.log(`      → This improves team representations for better NN predictions`);
  console.log(`    - α decays over time as system stabilizes`);
  console.log(`    - Feedback becomes less frequent as models improve`);

  console.log('\n=== VAE-NN Feedback Training Complete ===');
  
  // Clean up TensorFlow.js resources
  if (transitionNN.model) {
    transitionNN.model.dispose();
  }
}

// Run the demonstration
if (require.main === module) {
  demonstrateVAEFeedbackTraining().catch(console.error);
}

module.exports = { demonstrateVAEFeedbackTraining };