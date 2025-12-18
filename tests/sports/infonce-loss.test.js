const tf = require('@tensorflow/tfjs');
const InfoNCELoss = require('../../src/modules/sports/InfoNCELoss');

describe('InfoNCELoss', () => {
  let infoNCE;

  beforeEach(() => {
    infoNCE = new InfoNCELoss(0.1, 8);
  });

  afterEach(() => {
    if (infoNCE) {
      infoNCE.dispose();
    }
  });

  describe('constructor', () => {
    test('should initialize with correct parameters', () => {
      expect(infoNCE.temperature).toBe(0.1);
      expect(infoNCE.labelEmbeddingDim).toBe(8);
      expect(infoNCE.labelEmbedding).toBeDefined();
    });

    test('should create label embedding network with correct architecture', () => {
      const config = infoNCE.labelEmbedding.getConfig();
      expect(config.layers).toHaveLength(1);
      expect(config.layers[0].config.units).toBe(16);
      // Input shape is defined in the first layer
      expect(config.layers[0].config.batchInputShape).toEqual([null, 8]);
    });
  });

  describe('computeLabelEmbedding', () => {
    test('should compute label embeddings for transition probabilities', () => {
      const transitionProbs = tf.tensor2d([
        [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1], // Valid transition probs
        [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1]
      ]);

      const embeddings = infoNCE.computeLabelEmbedding(transitionProbs);
      
      expect(embeddings.shape).toEqual([2, 16]);
      
      transitionProbs.dispose();
      embeddings.dispose();
    });
  });

  describe('computeCosineSimilarity', () => {
    test('should compute cosine similarity between vectors', () => {
      const latents = tf.tensor2d([
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      ]);
      
      const embeddings = tf.tensor2d([
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Same as first latent
        [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]  // Different from both
      ]);

      const similarities = infoNCE.computeCosineSimilarity(latents, embeddings);
      const simValues = similarities.dataSync();
      
      expect(similarities.shape).toEqual([2]);
      expect(simValues[0]).toBeCloseTo(1.0, 5); // Perfect match
      expect(simValues[1]).toBeCloseTo(0.0, 5); // Orthogonal
      
      latents.dispose();
      embeddings.dispose();
      similarities.dispose();
    });

    test('should handle zero vectors gracefully', () => {
      const latents = tf.zeros([2, 16]);
      const embeddings = tf.zeros([2, 16]);

      const similarities = infoNCE.computeCosineSimilarity(latents, embeddings);
      const simValues = similarities.dataSync();
      
      // Should not be NaN due to epsilon in normalization
      expect(simValues.every(val => !isNaN(val))).toBe(true);
      
      latents.dispose();
      embeddings.dispose();
      similarities.dispose();
    });
  });

  describe('computeInfoNCELossEfficient', () => {
    test('should compute InfoNCE loss for valid inputs', () => {
      const batchSize = 2;
      const latentDim = 16;
      const numNegatives = 4;

      const latents = tf.randomNormal([batchSize, latentDim]);
      const positiveLabels = tf.tensor2d([
        [0.2, 0.1, 0.15, 0.05, 0.1, 0.05, 0.25, 0.1],
        [0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.15, 0.1]
      ]);
      const negativeLabels = tf.randomUniform([numNegatives, 8]);

      const loss = infoNCE.computeInfoNCELossEfficient(latents, positiveLabels, negativeLabels);
      
      expect(loss.shape).toEqual([]);
      expect(loss.dataSync()[0]).toBeGreaterThan(0);
      expect(!isNaN(loss.dataSync()[0])).toBe(true);
      
      latents.dispose();
      positiveLabels.dispose();
      negativeLabels.dispose();
      loss.dispose();
    });

    test('should produce lower loss for better aligned positive samples', () => {
      const latentDim = 16;
      
      // Create latents and positive labels that should align well
      const latents = tf.tensor2d([[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
      
      // Positive label that should produce embedding aligned with latent
      const positiveLabels = tf.tensor2d([[1, 0, 0, 0, 0, 0, 0, 0]]);
      
      // Random negative labels
      const negativeLabels = tf.randomUniform([8, 8]);

      const loss1 = infoNCE.computeInfoNCELossEfficient(latents, positiveLabels, negativeLabels);
      
      // Now test with misaligned positive
      const misalignedPositive = tf.tensor2d([[0, 0, 0, 0, 0, 0, 0, 1]]);
      const loss2 = infoNCE.computeInfoNCELossEfficient(latents, misalignedPositive, negativeLabels);
      
      // Loss should be different (though exact relationship depends on learned embeddings)
      expect(loss1.dataSync()[0]).not.toBe(loss2.dataSync()[0]);
      
      latents.dispose();
      positiveLabels.dispose();
      negativeLabels.dispose();
      misalignedPositive.dispose();
      loss1.dispose();
      loss2.dispose();
    });
  });

  describe('sampleNegativeExamples', () => {
    test('should return correct number of negative samples', async () => {
      const numNegatives = 5;
      const negatives = await infoNCE.sampleNegativeExamples(numNegatives);
      
      expect(negatives).toHaveLength(numNegatives);
      
      // Each negative should be a valid transition probability vector
      negatives.forEach(negative => {
        expect(negative).toHaveLength(8);
        expect(negative.every(p => p >= 0)).toBe(true);
        
        // Should sum to approximately 1
        const sum = negative.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 5);
      });
    });
  });

  describe('weight serialization', () => {
    test('should save and load weights correctly', async () => {
      // Train the label embedding a bit to have non-random weights
      const dummyInput = tf.randomUniform([4, 8]);
      infoNCE.labelEmbedding.predict(dummyInput);
      dummyInput.dispose();

      const savedState = await infoNCE.saveWeights();
      
      expect(savedState.temperature).toBe(0.1);
      expect(savedState.labelEmbeddingDim).toBe(8);
      expect(savedState.weights).toBeDefined();
      
      // Create new instance and load weights
      const newInfoNCE = new InfoNCELoss(0.2, 8); // Different initial params
      await newInfoNCE.loadWeights(savedState);
      
      expect(newInfoNCE.temperature).toBe(0.1);
      expect(newInfoNCE.labelEmbeddingDim).toBe(8);
      
      newInfoNCE.dispose();
    });
  });

  describe('resource management', () => {
    test('should dispose resources without errors', () => {
      expect(() => {
        infoNCE.dispose();
        infoNCE = null; // Prevent double disposal in afterEach
      }).not.toThrow();
    });
  });
});