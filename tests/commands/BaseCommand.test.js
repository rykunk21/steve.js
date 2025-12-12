// Mock Discord.js before importing BaseCommand
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => {
    const builder = {
      name: undefined,
      description: undefined,
      setName: jest.fn().mockImplementation((name) => {
        builder.name = name;
        return builder;
      }),
      setDescription: jest.fn().mockImplementation((description) => {
        builder.description = description;
        return builder;
      }),
      setDefaultMemberPermissions: jest.fn().mockReturnThis(),
      setDMPermission: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({
        name: builder.name,
        description: builder.description
      })
    };
    return builder;
  }),
  PermissionFlagsBits: {
    Administrator: 8n
  }
}));

const BaseCommand = require('../../src/commands/BaseCommand');

// Mock Discord.js components
const mockInteraction = {
  reply: jest.fn().mockResolvedValue(true),
  user: { id: 'test-user-id', tag: 'TestUser#1234' },
  member: {
    permissions: {
      has: jest.fn().mockReturnValue(true)
    }
  },
  guild: { name: 'Test Guild', id: 'test-guild-id' },
  channel: { name: 'test-channel', id: 'test-channel-id' }
};

describe('BaseCommand', () => {
  let command;

  beforeEach(() => {
    command = new BaseCommand('test', 'Test command description');
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a command with basic properties', () => {
      expect(command.name).toBe('test');
      expect(command.description).toBe('Test command description');
      expect(command.data.name).toBe('test');
      expect(command.data.description).toBe('Test command description');
    });

    it('should set default options', () => {
      expect(command.options.category).toBe('general');
      expect(command.options.cooldown).toBe(3);
      expect(command.options.guildOnly).toBe(true);
      expect(command.options.adminOnly).toBe(false);
    });

    it('should accept custom options', () => {
      const customCommand = new BaseCommand('custom', 'Custom command', {
        category: 'admin',
        cooldown: 10,
        adminOnly: true,
        guildOnly: false
      });

      expect(customCommand.options.category).toBe('admin');
      expect(customCommand.options.cooldown).toBe(10);
      expect(customCommand.options.adminOnly).toBe(true);
      expect(customCommand.options.guildOnly).toBe(false);
    });
  });

  describe('execute', () => {
    it('should throw error when not implemented', async () => {
      await expect(command.execute(mockInteraction))
        .rejects.toThrow('Execute method must be implemented by BaseCommand');
    });
  });

  describe('checkPermissions', () => {
    it('should allow regular users for non-admin commands', async () => {
      const result = await command.checkPermissions(mockInteraction);
      expect(result).toBe(true);
    });

    it('should block non-admin users from admin commands', async () => {
      command.options.adminOnly = true;
      mockInteraction.member.permissions.has.mockReturnValue(false);

      const result = await command.checkPermissions(mockInteraction);
      
      expect(result).toBe(false);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'This command requires administrator permissions.',
        ephemeral: true
      });
    });

    it('should allow admin users for admin commands', async () => {
      command.options.adminOnly = true;
      mockInteraction.member.permissions.has.mockReturnValue(true);

      const result = await command.checkPermissions(mockInteraction);
      expect(result).toBe(true);
    });

    it('should block DM usage for guild-only commands', async () => {
      const dmInteraction = { ...mockInteraction, guild: null };
      
      const result = await command.checkPermissions(dmInteraction);
      
      expect(result).toBe(false);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'This command can only be used in a server.',
        ephemeral: true
      });
    });
  });

  describe('checkCooldown', () => {
    it('should allow first usage', async () => {
      const result = await command.checkCooldown(mockInteraction);
      expect(result).toBe(true);
    });

    it('should block rapid successive usage', async () => {
      // First usage should succeed
      await command.checkCooldown(mockInteraction);
      
      // Second immediate usage should fail
      const result = await command.checkCooldown(mockInteraction);
      
      expect(result).toBe(false);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please wait'),
          ephemeral: true
        })
      );
    });

    it('should allow usage after cooldown expires', async () => {
      command.options.cooldown = 0.001; // Very short cooldown for testing
      
      // First usage
      await command.checkCooldown(mockInteraction);
      
      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should allow usage again
      const result = await command.checkCooldown(mockInteraction);
      expect(result).toBe(true);
    });
  });

  describe('validate', () => {
    it('should validate all prerequisites', async () => {
      const result = await command.validate(mockInteraction);
      expect(result).toBe(true);
    });

    it('should fail if permissions check fails', async () => {
      command.options.adminOnly = true;
      mockInteraction.member.permissions.has.mockReturnValue(false);

      const result = await command.validate(mockInteraction);
      expect(result).toBe(false);
    });
  });

  describe('logUsage', () => {
    it('should log command usage without errors', () => {
      // This test mainly ensures the method doesn't throw
      expect(() => {
        command.logUsage(mockInteraction, 'test', { extra: 'data' });
      }).not.toThrow();
    });
  });
});