const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');
const logger = require('./logger');

class CommandLoader {
  constructor() {
    this.commands = new Collection();
  }

  /**
   * Load all commands from the commands directory
   * @param {string} commandsPath - Path to the commands directory
   * @returns {Collection} - Collection of loaded commands
   */
  async loadCommands(commandsPath) {
    if (!fs.existsSync(commandsPath)) {
      logger.warn('Commands directory does not exist:', commandsPath);
      return this.commands;
    }

    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
      const folderPath = path.join(commandsPath, folder);
      
      // Skip files, only process directories
      if (!fs.statSync(folderPath).isDirectory()) continue;

      await this.loadCommandsFromFolder(folderPath, folder);
    }

    logger.info(`Loaded ${this.commands.size} commands total`);
    return this.commands;
  }

  /**
   * Load commands from a specific folder
   * @param {string} folderPath - Path to the command folder
   * @param {string} category - Category name for the commands
   */
  async loadCommandsFromFolder(folderPath, category) {
    const commandFiles = fs.readdirSync(folderPath).filter(file => 
      file.endsWith('.js') && !file.startsWith('.') && file !== 'index.js'
    );

    let loadedCount = 0;

    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      
      try {
        // Clear require cache for hot reloading in development
        if (process.env.NODE_ENV === 'development') {
          delete require.cache[require.resolve(filePath)];
        }

        const CommandClass = require(filePath);
        
        // Handle both class exports and direct command objects
        let command;
        if (typeof CommandClass === 'function') {
          command = new CommandClass();
        } else if (CommandClass && typeof CommandClass === 'object') {
          command = CommandClass;
        } else {
          logger.warn(`Invalid command export in ${filePath}`);
          continue;
        }

        // Validate command structure
        if (!this.validateCommand(command, filePath)) {
          continue;
        }

        // Set category if not already set
        if (command.options && !command.options.category) {
          command.options.category = category;
        }

        this.commands.set(command.data.name, command);
        loadedCount++;
        
        logger.debug(`Loaded command: ${command.data.name} from ${category}/${file}`);
      } catch (error) {
        logger.error(`Error loading command ${file}:`, error);
      }
    }

    if (loadedCount > 0) {
      logger.info(`Loaded ${loadedCount} commands from ${category} category`);
    }
  }

  /**
   * Validate command structure
   * @param {Object} command - Command object to validate
   * @param {string} filePath - File path for error reporting
   * @returns {boolean} - Whether the command is valid
   */
  validateCommand(command, filePath) {
    if (!command) {
      logger.warn(`Command at ${filePath} exports null or undefined`);
      return false;
    }

    if (!command.data) {
      logger.warn(`Command at ${filePath} is missing required "data" property`);
      return false;
    }

    if (!command.execute || typeof command.execute !== 'function') {
      logger.warn(`Command at ${filePath} is missing required "execute" method`);
      return false;
    }

    if (!command.data.name) {
      logger.warn(`Command at ${filePath} is missing command name`);
      return false;
    }

    if (!command.data.description) {
      logger.warn(`Command at ${filePath} is missing command description`);
      return false;
    }

    return true;
  }

  /**
   * Get all commands
   * @returns {Collection} - Collection of all loaded commands
   */
  getCommands() {
    return this.commands;
  }

  /**
   * Get commands by category
   * @param {string} category - Category to filter by
   * @returns {Array} - Array of commands in the category
   */
  getCommandsByCategory(category) {
    return Array.from(this.commands.values()).filter(command => 
      command.options && command.options.category === category
    );
  }

  /**
   * Get command by name
   * @param {string} name - Command name
   * @returns {Object|null} - Command object or null if not found
   */
  getCommand(name) {
    return this.commands.get(name) || null;
  }

  /**
   * Reload a specific command
   * @param {string} name - Command name to reload
   * @param {string} commandsPath - Path to the commands directory
   * @returns {boolean} - Whether the reload was successful
   */
  async reloadCommand(name, commandsPath) {
    const command = this.commands.get(name);
    if (!command) {
      logger.warn(`Command ${name} not found for reload`);
      return false;
    }

    try {
      // Find the command file
      const category = command.options?.category || 'general';
      const folderPath = path.join(commandsPath, category);
      
      if (!fs.existsSync(folderPath)) {
        logger.error(`Category folder ${category} not found`);
        return false;
      }

      // Remove from collection
      this.commands.delete(name);

      // Reload the folder
      await this.loadCommandsFromFolder(folderPath, category);

      logger.info(`Reloaded command: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Error reloading command ${name}:`, error);
      return false;
    }
  }
}

module.exports = CommandLoader;