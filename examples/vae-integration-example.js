/**
 * Example demonstrating VAE integration with feature extraction
 * This shows how the VariationalAutoencoder works with VAEFeatureExtractor
 */

const VariationalAutoencoder = require('../src/modules/sports/VariationalAutoencoder');

async function demonstrateVAEIntegration() {
  console.log('=== VAE Integration Example ===\n');

  // Initialize VAE with 80-dimensional input (game features) and 16-dimensional latent space
  const vae = new VariationalAutoencoder(80, 16);
  console.log('✓ Initialized VAE with 80→16 architecture');
  console.log(`  Total parameters: ${vae.countParameters()}`);

  // Simulate normalized game features (would come from VAEFeatureExtractor)
  const gameFeatures = new Array(80).fill(0).map(() => Math.random());
  console.log('\n✓ Generated sample normalized game features (80-dim)');

  // 1. Encode game features to team latent distribution
  const { mu, sigma } = vae.encodeGameToTeamDistribution(gameFeatures);
  console.log('\n✓ Encoded game to team latent distribution:');
  console.log(`  μ (mean): [${mu.slice(0, 3).map(x => x.toFixed(3)).join(', ')}...]`);
  console.log(`  σ (std): [${sigma.slice(0, 3).map(x => x.toFixed(3)).join(', ')}...]`);

  // 2. Sample from team distribution (for NN input)
  const teamSample1 = vae.sampleFromTeamDistribution(mu, sigma);
  const teamSample2 = vae.sampleFromTeamDistribution(mu, sigma);
  console.log('\n✓ Sampled from team distribution:');
  console.log(`  Sample 1: [${teamSample1.slice(0, 3).map(x => x.toFixed(3)).join(', ')}...]`);
  console.log(`  Sample 2: [${teamSample2.slice(0, 3).map(x => x.toFixed(3)).join(', ')}...]`);

  // 3. Demonstrate VAE training (forward + backward pass)
  console.log('\n✓ Training demonstration:');
  
  // Forward pass
  const { reconstruction, mu: forwardMu, logVar, z } = vae.forward(gameFeatures);
  console.log(`  Forward pass completed - reconstruction error: ${
    gameFeatures.reduce((sum, val, i) => sum + Math.abs(val - reconstruction[i]), 0).toFixed(3)
  }`);

  // Compute loss
  const lossInfo = vae.computeLoss(gameFeatures, reconstruction, forwardMu, logVar);
  console.log(`  VAE Loss components:`);
  console.log(`    Reconstruction: ${lossInfo.reconstructionLoss.toFixed(3)}`);
  console.log(`    KL Divergence: ${lossInfo.klLoss.toFixed(3)}`);
  console.log(`    Total VAE: ${lossInfo.vaeLoss.toFixed(3)}`);

  // Simulate NN feedback loss
  const nnFeedbackLoss = 0.5;
  const lossWithFeedback = vae.computeLoss(gameFeatures, reconstruction, forwardMu, logVar, nnFeedbackLoss);
  console.log(`    With NN feedback (α=${vae.alphaFeedback.toFixed(3)}): ${lossWithFeedback.totalLoss.toFixed(3)}`);

  // Backward pass
  const backwardLoss = vae.backward(gameFeatures, nnFeedbackLoss);
  console.log(`  Backward pass completed - loss: ${backwardLoss.totalLoss.toFixed(3)}`);

  // 4. Demonstrate feedback coefficient decay
  console.log('\n✓ Feedback coefficient decay:');
  console.log(`  Initial α: ${vae.alphaFeedback.toFixed(4)}`);
  vae.decayFeedbackCoefficient();
  console.log(`  After decay: ${vae.alphaFeedback.toFixed(4)}`);

  // 5. Demonstrate model serialization
  console.log('\n✓ Model serialization:');
  const modelState = vae.toJSON();
  console.log(`  Serialized model size: ${JSON.stringify(modelState).length} characters`);
  
  const newVae = new VariationalAutoencoder();
  newVae.fromJSON(modelState);
  console.log(`  Loaded model parameters: ${newVae.countParameters()}`);

  // 6. Show how this integrates with the broader system
  console.log('\n=== Integration with VAE-NN System ===');
  console.log('1. VAEFeatureExtractor processes StatBroadcast XML → normalized features (80-dim)');
  console.log('2. VariationalAutoencoder encodes features → team distributions N(μ, σ²) (16-dim)');
  console.log('3. TransitionProbabilityNN uses team distributions → transition probabilities (8-dim)');
  console.log('4. MCMC simulation uses probabilities → game outcomes');
  console.log('5. Feedback loop: NN loss → VAE updates (α coefficient)');
  console.log('6. Bayesian updates: game results → team distribution updates');

  console.log('\n✓ VAE Integration Example Complete!');
}

// Run the example
if (require.main === module) {
  demonstrateVAEIntegration().catch(console.error);
}

module.exports = { demonstrateVAEIntegration };