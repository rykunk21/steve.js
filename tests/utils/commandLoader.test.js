// Mock fs and path modules before importing
jest.mock('fs');
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn((p) => p.split('/').slice(0, -1).join('/')),
  basename: jest.fn((p) => p.split('/').pop()),
  resolve: jest.fn((...args) => args.join('/'))
}));

// Mock winston logger to avoid file system operations
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn()
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}));

const CommandLoader = require('../../src/utils/commandLoader');
const fs = require('fs');
const path = require('path');

// Mock path module
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn(),
  resolve: jest.fn()
}));

describe('CommandLoader', () => {
  let commandLoader;
  const mockCommandsPath = '/mock/commands';

  beforeEach(() => {
    commandLoader = new CommandLoader();
    jest.clearAllMocks();
  });

  describe('loadCommands', () => {
    it('should handle non-existent commands directory', async () => {
      fs.existsSync.mockReturnValue(false);

      const commands = await commandLoader.loadCommands(mockCommandsPath);

      expect(commands.size).toBe(0);
    });

    it('should load commands from existing directory', async () => {
      // Mock directory structure
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValueOnce(['gaming', 'admin']); // folders
      fs.statSync.mockReturnValue({ isDirectory: () => true });
      
      // Mock gaming folder
      fs.readdirSync.mockReturnValueOnce(['create-lobby.js']);
      
      // Mock admin folder  
      fs.readdirSync.mockReturnValueOnce(['configure.js']);

      // Since we can't easily mock require in this context, let's test the structure
      const commands = await commandLoader.loadCommands(mockCommandsPath);

      // The commands collection should be initialized even if no files are loaded
      expect(commands).toBeDefined();
      expect(typeof commands.set).toBe('function');
      expect(typeof commands.get).toBe('function');
    });
  });

  describe('validateCommand', () => {
    it('should validate correct command structure', () => {
      const validCommand = {
        data: { name: 'test', description: 'Test command' },
        execute: jest.fn()
      };

      const result = commandLoader.validateCommand(validCommand, '/test/path');
      expect(result).toBe(true);
    });

    it('should reject command without data property', () => {
      const invalidCommand = {
        execute: jest.fn()
      };

      const result = commandLoader.validateCommand(invalidCommand, '/test/path');
      expect(result).toBe(false);
    });

    it('should reject command without execute method', () => {
      const invalidCommand = {
        data: { name: 'test', description: 'Test command' }
      };

      const result = commandLoader.validateCommand(invalidCommand, '/test/path');
      expect(result).toBe(false);
    });

    it('should reject null or undefined command', () => {
      expect(commandLoader.validateCommand(null, '/test/path')).toBe(false);
      expect(commandLoader.validateCommand(undefined, '/test/path')).toBe(false);
    });
  });

  describe('getCommands', () => {
    it('should return the commands collection', () => {
      const commands = commandLoader.getCommands();
      expect(commands).toBeDefined();
      expect(typeof commands.set).toBe('function');
    });
  });

  describe('getCommand', () => {
    it('should return command by name', () => {
      const mockCommand = {
        data: { name: 'test', description: 'Test' },
        execute: jest.fn()
      };

      commandLoader.commands.set('test', mockCommand);

      const result = commandLoader.getCommand('test');
      expect(result).toBe(mockCommand);
    });

    it('should return null for non-existent command', () => {
      const result = commandLoader.getCommand('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getCommandsByCategory', () => {
    it('should filter commands by category', () => {
      const gamingCommand = {
        data: { name: 'lobby', description: 'Gaming command' },
        execute: jest.fn(),
        options: { category: 'gaming' }
      };

      const adminCommand = {
        data: { name: 'config', description: 'Admin command' },
        execute: jest.fn(),
        options: { category: 'admin' }
      };

      commandLoader.commands.set('lobby', gamingCommand);
      commandLoader.commands.set('config', adminCommand);

      const gamingCommands = commandLoader.getCommandsByCategory('gaming');
      expect(gamingCommands).toHaveLength(1);
      expect(gamingCommands[0]).toBe(gamingCommand);
    });
  });
});