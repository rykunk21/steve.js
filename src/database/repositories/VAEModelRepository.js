const BaseRepository = require('./BaseRepository');
const logger = require('../../utils/logger');

/**
 * Repository for VAE model weights management
 * Handles storage and retrieval of frozen encoder weights and model metadata
 */
class VAEModelRepository extends BaseRepository {
  constructor() {
    super('vae_model_weights');
  }

  /**
   * Save VAE model weights
   * @param {Object} modelData - Model data
   * @param {string} modelData.model_version - Version identifier
   * @param {Buffer} modelData.encoder_weights - Frozen encoder weights
   * @param {Buffer} modelData.decoder_weights - Decoder weights (optional)
   * @param {number} modelData.latent_dim - Latent space dimensionality
   * @param {number} modelData.input_dim - Input feature dimensionality
   * @param {boolean} modelData.training_completed - Whether InfoNCE pretraining is complete
   * @param {boolean} modelData.frozen - Whether encoder is frozen
   * @returns {Promise<Object>} - Database result
   */
  async saveModel(modelData) {
    try {
      const data = {
        model_version: modelData.model_version,
        encoder_weights: modelData.encoder_weights,
        decoder_weights: modelData.decoder_weights || null,
        latent_dim: modelData.latent_dim || 16,
        input_dim: modelData.input_dim || 80,
        training_completed: modelData.training_completed || false,
        frozen: modelData.frozen || false,
        updated_at: new Date().toISOString()
      };

      // Check if model version already exists
      const existing = await this.getModelByVersion(modelData.model_version);
      
      if (existing) {
        // Update existing model
        return await this.update(existing.id, data);
      } else {
        // Create new model
        return await this.create(data);
      }
    } catch (error) {
      logger.error('Failed to save VAE model', {
        model_version: modelData.model_version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get VAE model by version
   * @param {string} version - Model version
   * @returns {Promise<Object|null>} - Model object or null
   */
  async getModelByVersion(version) {
    try {
      const row = await this.findOneBy({ model_version: version });
      
      if (!row) return null;

      return this.mapRowToObject(row);
    } catch (error) {
      logger.error('Failed to get VAE model by version', {
        version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get latest frozen VAE model
   * @returns {Promise<Object|null>} - Latest frozen model or null
   */
  async getLatestFrozenModel() {
    try {
      const rows = await this.findBy(
        { frozen: true, training_completed: true },
        'created_at DESC',
        1
      );
      
      if (rows.length === 0) return null;

      return this.mapRowToObject(rows[0]);
    } catch (error) {
      logger.error('Failed to get latest frozen VAE model', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Mark model as frozen after pretraining
   * @param {string} version - Model version
   * @returns {Promise<Object>} - Database result
   */
  async freezeModel(version) {
    try {
      return await this.updateBy(
        { model_version: version },
        { 
          frozen: true,
          training_completed: true,
          updated_at: new Date().toISOString()
        }
      );
    } catch (error) {
      logger.error('Failed to freeze VAE model', {
        version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all available model versions
   * @returns {Promise<Array>} - Array of model versions with metadata
   */
  async getAllModelVersions() {
    try {
      const rows = await this.findAll('created_at DESC');
      
      return rows.map(row => ({
        id: row.id,
        version: row.model_version,
        latent_dim: row.latent_dim,
        input_dim: row.input_dim,
        training_completed: row.training_completed,
        frozen: row.frozen,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get all model versions', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Load frozen encoder weights for inference
   * @param {string} version - Model version (optional, uses latest if not specified)
   * @returns {Promise<Buffer|null>} - Encoder weights buffer or null
   */
  async loadFrozenEncoderWeights(version = null) {
    try {
      let model;
      
      if (version) {
        model = await this.getModelByVersion(version);
      } else {
        model = await this.getLatestFrozenModel();
      }
      
      if (!model || !model.frozen) {
        logger.warn('No frozen encoder weights available', { version });
        return null;
      }

      return model.encoder_weights;
    } catch (error) {
      logger.error('Failed to load frozen encoder weights', {
        version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate model weights integrity
   * @param {string} version - Model version
   * @returns {Promise<boolean>} - True if model is valid
   */
  async validateModelIntegrity(version) {
    try {
      const model = await this.getModelByVersion(version);
      
      if (!model) {
        return false;
      }

      // Check required fields
      const hasEncoderWeights = model.encoder_weights && model.encoder_weights.length > 0;
      const hasValidDimensions = model.latent_dim > 0 && model.input_dim > 0;
      const isProperlyFrozen = model.frozen && model.training_completed;

      return hasEncoderWeights && hasValidDimensions && isProperlyFrozen;
    } catch (error) {
      logger.error('Failed to validate model integrity', {
        version,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Delete model by version
   * @param {string} version - Model version
   * @returns {Promise<Object>} - Database result
   */
  async deleteModel(version) {
    try {
      const model = await this.getModelByVersion(version);
      
      if (!model) {
        throw new Error(`Model version ${version} not found`);
      }

      return await this.delete(model.id);
    } catch (error) {
      logger.error('Failed to delete VAE model', {
        version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Map database row to object with camelCase properties
   * @param {Object} row - Database row
   * @returns {Object} - Mapped object
   */
  mapRowToObject(row) {
    return {
      id: row.id,
      model_version: row.model_version,
      encoder_weights: row.encoder_weights,
      decoder_weights: row.decoder_weights,
      latent_dim: row.latent_dim,
      input_dim: row.input_dim,
      training_completed: row.training_completed,
      frozen: row.frozen,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

module.exports = VAEModelRepository;