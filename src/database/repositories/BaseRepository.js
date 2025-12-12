const dbConnection = require('../connection');
const logger = require('../../utils/logger');

/**
 * Base Repository class with common database operations
 */
class BaseRepository {
  constructor(tableName) {
    this.tableName = tableName;
    this.db = dbConnection;
  }

  /**
   * Find a record by primary key
   */
  async findById(id, primaryKey = 'id') {
    try {
      const sql = `SELECT * FROM ${this.tableName} WHERE ${primaryKey} = ?`;
      const row = await this.db.get(sql, [id]);
      return row || null;
    } catch (error) {
      logger.error(`Error finding ${this.tableName} by ${primaryKey}:`, error);
      throw error;
    }
  }

  /**
   * Find records by criteria
   */
  async findBy(criteria = {}, orderBy = null, limit = null) {
    try {
      const conditions = [];
      const params = [];

      for (const [key, value] of Object.entries(criteria)) {
        if (value !== undefined && value !== null) {
          conditions.push(`${key} = ?`);
          params.push(value);
        }
      }

      let sql = `SELECT * FROM ${this.tableName}`;
      
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      if (orderBy) {
        sql += ` ORDER BY ${orderBy}`;
      }

      if (limit) {
        sql += ` LIMIT ${limit}`;
      }

      const rows = await this.db.all(sql, params);
      return rows;
    } catch (error) {
      logger.error(`Error finding ${this.tableName} records:`, error);
      throw error;
    }
  }

  /**
   * Find one record by criteria
   */
  async findOneBy(criteria = {}) {
    const results = await this.findBy(criteria, null, 1);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get all records
   */
  async findAll(orderBy = null, limit = null) {
    return this.findBy({}, orderBy, limit);
  }

  /**
   * Create a new record
   */
  async create(data) {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map(() => '?').join(', ');

      const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
      const result = await this.db.run(sql, values);

      logger.debug(`Created ${this.tableName} record:`, { id: result.lastID, changes: result.changes });
      return result;
    } catch (error) {
      logger.error(`Error creating ${this.tableName} record:`, error);
      throw error;
    }
  }

  /**
   * Update a record by primary key
   */
  async update(id, data, primaryKey = 'id') {
    try {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const setClause = keys.map(key => `${key} = ?`).join(', ');

      const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE ${primaryKey} = ?`;
      const result = await this.db.run(sql, [...values, id]);

      logger.debug(`Updated ${this.tableName} record:`, { id, changes: result.changes });
      return result;
    } catch (error) {
      logger.error(`Error updating ${this.tableName} record:`, error);
      throw error;
    }
  }

  /**
   * Update records by criteria
   */
  async updateBy(criteria, data) {
    try {
      const conditions = [];
      const conditionParams = [];

      for (const [key, value] of Object.entries(criteria)) {
        if (value !== undefined && value !== null) {
          conditions.push(`${key} = ?`);
          conditionParams.push(value);
        }
      }

      if (conditions.length === 0) {
        throw new Error('No criteria provided for update operation');
      }

      const keys = Object.keys(data);
      const values = Object.values(data);
      const setClause = keys.map(key => `${key} = ?`).join(', ');

      const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE ${conditions.join(' AND ')}`;
      const result = await this.db.run(sql, [...values, ...conditionParams]);

      logger.debug(`Updated ${this.tableName} records by criteria:`, { criteria, changes: result.changes });
      return result;
    } catch (error) {
      logger.error(`Error updating ${this.tableName} records by criteria:`, error);
      throw error;
    }
  }

  /**
   * Delete a record by primary key
   */
  async delete(id, primaryKey = 'id') {
    try {
      const sql = `DELETE FROM ${this.tableName} WHERE ${primaryKey} = ?`;
      const result = await this.db.run(sql, [id]);

      logger.debug(`Deleted ${this.tableName} record:`, { id, changes: result.changes });
      return result;
    } catch (error) {
      logger.error(`Error deleting ${this.tableName} record:`, error);
      throw error;
    }
  }

  /**
   * Delete records by criteria
   */
  async deleteBy(criteria) {
    try {
      const conditions = [];
      const params = [];

      for (const [key, value] of Object.entries(criteria)) {
        if (value !== undefined && value !== null) {
          conditions.push(`${key} = ?`);
          params.push(value);
        }
      }

      if (conditions.length === 0) {
        throw new Error('No criteria provided for delete operation');
      }

      const sql = `DELETE FROM ${this.tableName} WHERE ${conditions.join(' AND ')}`;
      const result = await this.db.run(sql, params);

      logger.debug(`Deleted ${this.tableName} records by criteria:`, { criteria, changes: result.changes });
      return result;
    } catch (error) {
      logger.error(`Error deleting ${this.tableName} records by criteria:`, error);
      throw error;
    }
  }

  /**
   * Count records by criteria
   */
  async count(criteria = {}) {
    try {
      const conditions = [];
      const params = [];

      for (const [key, value] of Object.entries(criteria)) {
        if (value !== undefined && value !== null) {
          conditions.push(`${key} = ?`);
          params.push(value);
        }
      }

      let sql = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      const result = await this.db.get(sql, params);
      return result.count;
    } catch (error) {
      logger.error(`Error counting ${this.tableName} records:`, error);
      throw error;
    }
  }

  /**
   * Check if record exists
   */
  async exists(criteria) {
    const count = await this.count(criteria);
    return count > 0;
  }

  /**
   * Create or update record (upsert)
   */
  async upsert(data, primaryKey = 'id') {
    try {
      const id = data[primaryKey];
      
      if (id && await this.exists({ [primaryKey]: id })) {
        // Update existing record
        const updateData = { ...data };
        delete updateData[primaryKey];
        return await this.update(id, updateData, primaryKey);
      } else {
        // Create new record
        return await this.create(data);
      }
    } catch (error) {
      logger.error(`Error upserting ${this.tableName} record:`, error);
      throw error;
    }
  }

  /**
   * Execute raw SQL query
   */
  async query(sql, params = []) {
    try {
      return await this.db.all(sql, params);
    } catch (error) {
      logger.error(`Error executing query on ${this.tableName}:`, error);
      throw error;
    }
  }

  /**
   * Execute transaction
   */
  async transaction(operations) {
    try {
      return await this.db.transaction(operations);
    } catch (error) {
      logger.error(`Error executing transaction on ${this.tableName}:`, error);
      throw error;
    }
  }
}

module.exports = BaseRepository;