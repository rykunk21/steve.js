const tf = require('@tensorflow/tfjs');
const logger = require('../../utils/logger');

/**
 * InfoNCE (Information Noise Contrastive Estimation) Loss Function
 * 
 * Implements contrastive learning objective:
 * L_InfoNCE = -log(exp(sim(z, g(y))) / Σ exp(sim(z, g(y'))))
 * 
 * Where:
 * - z: latent representation from VAE encoder
 * - g(y): label embedding of transition probabilities
 * - y: positive sample (current team's transition probabilities)
 * - y': negative samples (other teams' transition probabilities)
 * - sim(): similarity function (cosine similarity)
 * 
 * This encourages the VAE to learn representations that are predictive
 * of transition probabilities without forcing reconstruction.
 */
class InfoNCELoss {
  constructor(temperature = 0.1, labelEmbeddingDim = 8) {
    this.temperature = temperature; // Temperature parameter for contrastive learning
    this.labelEmbeddingDim = labelEmbeddingDim; // Dimension of transition probability labels
    
    // Label embedding network g(y): transition_probs[8] -> embedding[8]
    // Simple linear transformation for now
    this.labelEmbedding = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.labelEmbeddingDim],
          units: 16, // Match VAE latent dimension
          activation: 'linear',
          kernelInitializer: 'glorotNormal',
          name: 'label_embedding'
        })
      ]
    });
    
    logger.info('Initialized InfoNCE loss function', {
      temperature: this.temperature,
      labelEmbeddingDim: this.labelEmbeddingDim,
      embeddingParams: this.labelEmbedding.countParams()
    });
  }

  /**
   * Compute label embedding g(y) for transition probabilities
   * @param {tf.Tensor} transitionProbs - Transition probabilities [batch, 8]
   * @returns {tf.Tensor} - Label embeddings [batch, 16]
   */
  computeLabelEmbedding(transitionProbs) {
    return this.labelEmbedding.predict(transitionProbs);
  }

  /**
   * Compute cosine similarity between latent representations and label embeddings
   * @param {tf.Tensor} latents - Latent representations [batch, latentDim]
   * @param {tf.Tensor} labelEmbeddings - Label embeddings [batch, latentDim]
   * @returns {tf.Tensor} - Cosine similarities [batch]
   */
  computeCosineSimilarity(latents, labelEmbeddings) {
    return tf.tidy(() => {
      // Normalize vectors
      const latentsNorm = tf.norm(latents, 2, 1, true);
      const embeddingsNorm = tf.norm(labelEmbeddings, 2, 1, true);
      
      const latentsNormalized = tf.div(latents, tf.add(latentsNorm, 1e-8));
      const embeddingsNormalized = tf.div(labelEmbeddings, tf.add(embeddingsNorm, 1e-8));
      
      // Compute dot product (cosine similarity for normalized vectors)
      return tf.sum(tf.mul(latentsNormalized, embeddingsNormalized), 1);
    });
  }

  /**
   * Compute InfoNCE loss for a batch of positive and negative samples
   * @param {tf.Tensor} latents - Latent representations [batch, latentDim]
   * @param {tf.Tensor} positiveLabels - Positive transition probabilities [batch, 8]
   * @param {tf.Tensor} negativeLabels - Negative transition probabilities [negatives, 8]
   * @returns {tf.Tensor} - InfoNCE loss scalar
   */
  computeInfoNCELoss(latents, positiveLabels, negativeLabels) {
    return tf.tidy(() => {
      const batchSize = latents.shape[0];
      const numNegatives = negativeLabels.shape[0];
      
      // Compute positive label embeddings
      const positiveEmbeddings = this.computeLabelEmbedding(positiveLabels);
      
      // Compute negative label embeddings
      const negativeEmbeddings = this.computeLabelEmbedding(negativeLabels);
      
      // Compute positive similarities
      const positiveSims = this.computeCosineSimilarity(latents, positiveEmbeddings);
      
      // Compute negative similarities for each latent against all negatives
      let totalLoss = tf.scalar(0);
      
      for (let i = 0; i < batchSize; i++) {
        // Get current latent [1, latentDim]
        const currentLatent = latents.slice([i, 0], [1, -1]);
        
        // Expand to match negative embeddings [numNegatives, latentDim]
        const expandedLatent = tf.tile(currentLatent, [numNegatives, 1]);
        
        // Compute similarities with all negatives
        const negativeSims = this.computeCosineSimilarity(expandedLatent, negativeEmbeddings);
        
        // Get positive similarity for this sample
        const positiveSim = positiveSims.slice([i], [1]);
        
        // Compute InfoNCE loss for this sample
        // L = -log(exp(pos/τ) / (exp(pos/τ) + Σ exp(neg/τ)))
        const positiveExp = tf.exp(tf.div(positiveSim, this.temperature));
        const negativeExps = tf.exp(tf.div(negativeSims, this.temperature));
        const negativeSum = tf.sum(negativeExps);
        
        const denominator = tf.add(positiveExp, negativeSum);
        const sampleLoss = tf.neg(tf.log(tf.div(positiveExp, denominator)));
        
        totalLoss = tf.add(totalLoss, sampleLoss);
        
        // Clean up intermediate tensors
        currentLatent.dispose();
        expandedLatent.dispose();
        negativeSims.dispose();
        positiveSim.dispose();
        positiveExp.dispose();
        negativeExps.dispose();
        negativeSum.dispose();
        denominator.dispose();
        sampleLoss.dispose();
      }
      
      // Average loss over batch
      const avgLoss = tf.div(totalLoss, batchSize);
      totalLoss.dispose();
      
      // Clean up
      positiveEmbeddings.dispose();
      negativeEmbeddings.dispose();
      positiveSims.dispose();
      
      return avgLoss;
    });
  }

  /**
   * Compute InfoNCE loss with efficient batch processing
   * Alternative implementation using matrix operations for better performance
   * @param {tf.Tensor} latents - Latent representations [batch, latentDim]
   * @param {tf.Tensor} positiveLabels - Positive transition probabilities [batch, 8]
   * @param {tf.Tensor} negativeLabels - Negative transition probabilities [negatives, 8]
   * @returns {tf.Tensor} - InfoNCE loss scalar
   */
  computeInfoNCELossEfficient(latents, positiveLabels, negativeLabels) {
    return tf.tidy(() => {
      // Compute embeddings
      const positiveEmbeddings = this.computeLabelEmbedding(positiveLabels);
      const negativeEmbeddings = this.computeLabelEmbedding(negativeLabels);
      
      // Normalize latents and embeddings
      const latentsNorm = tf.norm(latents, 2, 1, true);
      const positiveNorm = tf.norm(positiveEmbeddings, 2, 1, true);
      const negativeNorm = tf.norm(negativeEmbeddings, 2, 1, true);
      
      const latentsNormalized = tf.div(latents, tf.add(latentsNorm, 1e-8));
      const positiveNormalized = tf.div(positiveEmbeddings, tf.add(positiveNorm, 1e-8));
      const negativeNormalized = tf.div(negativeEmbeddings, tf.add(negativeNorm, 1e-8));
      
      // Compute positive similarities (element-wise dot product)
      const positiveSims = tf.sum(tf.mul(latentsNormalized, positiveNormalized), 1);
      
      // Compute negative similarities (matrix multiplication)
      // latents: [batch, latentDim], negatives: [negatives, latentDim]
      // result: [batch, negatives]
      const negativeSims = tf.matMul(latentsNormalized, negativeNormalized, false, true);
      
      // Apply temperature scaling
      const positiveScaled = tf.div(positiveSims, this.temperature);
      const negativeScaled = tf.div(negativeSims, this.temperature);
      
      // Compute InfoNCE loss using log-sum-exp trick for numerical stability
      // For each sample: -log(exp(pos) / (exp(pos) + sum(exp(negs))))
      // = -pos + log(exp(pos) + sum(exp(negs)))
      // = -pos + log_sum_exp([pos, neg1, neg2, ...])
      
      // Concatenate positive and negative similarities for log-sum-exp
      const positiveExpanded = tf.expandDims(positiveScaled, 1); // [batch, 1]
      const allSims = tf.concat([positiveExpanded, negativeScaled], 1); // [batch, 1 + negatives]
      
      // Compute log-sum-exp for numerical stability
      const maxSims = tf.max(allSims, 1, true); // [batch, 1]
      const shiftedSims = tf.sub(allSims, maxSims); // Subtract max for stability
      const expSims = tf.exp(shiftedSims);
      const sumExp = tf.sum(expSims, 1); // [batch]
      const logSumExp = tf.add(tf.log(sumExp), tf.squeeze(maxSims, [1]));
      
      // InfoNCE loss: -positive + log_sum_exp
      const loss = tf.sub(logSumExp, positiveScaled);
      
      // Average over batch
      const avgLoss = tf.mean(loss);
      
      return avgLoss;
    });
  }

  /**
   * Sample negative examples from database
   * This is a placeholder - actual implementation will query game_ids table
   * @param {number} numNegatives - Number of negative samples to draw
   * @param {string} excludeGameId - Game ID to exclude (positive sample)
   * @returns {Promise<Array>} - Array of negative transition probability vectors
   */
  async sampleNegativeExamples(numNegatives, excludeGameId = null) {
    // This will be implemented to query the database
    // For now, return random transition probabilities for testing
    const negatives = [];
    
    for (let i = 0; i < numNegatives; i++) {
      // Generate random transition probabilities that sum to 1
      const probs = new Array(8).fill(0).map(() => Math.random());
      const sum = probs.reduce((a, b) => a + b, 0);
      const normalized = probs.map(p => p / sum);
      negatives.push(normalized);
    }
    
    return negatives;
  }

  /**
   * Get trainable variables for the label embedding network
   * @returns {Array} - Array of trainable variables
   */
  getTrainableVariables() {
    return this.labelEmbedding.trainableWeights;
  }

  /**
   * Save label embedding weights
   * @returns {Promise<Object>} - Serialized weights
   */
  async saveWeights() {
    const weights = await this.labelEmbedding.getWeights();
    const weightData = weights.map(tensor => ({
      shape: tensor.shape,
      data: Array.from(tensor.dataSync())
    }));
    
    return {
      temperature: this.temperature,
      labelEmbeddingDim: this.labelEmbeddingDim,
      weights: weightData
    };
  }

  /**
   * Load label embedding weights
   * @param {Object} state - Serialized weights
   */
  async loadWeights(state) {
    this.temperature = state.temperature;
    this.labelEmbeddingDim = state.labelEmbeddingDim;
    
    if (state.weights) {
      const tensors = state.weights.map(w => tf.tensor(w.data, w.shape));
      this.labelEmbedding.setWeights(tensors);
      tensors.forEach(tensor => tensor.dispose());
    }
  }

  /**
   * Dispose of TensorFlow.js resources
   */
  dispose() {
    if (this.labelEmbedding) {
      this.labelEmbedding.dispose();
      this.labelEmbedding = null;
    }
    logger.debug('Disposed InfoNCE loss resources');
  }
}

module.exports = InfoNCELoss;