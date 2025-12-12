// Jest setup file for global test configuration

// Mock Discord.js for testing
jest.mock('discord.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    login: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    on: jest.fn(),
    once: jest.fn(),
    user: { tag: 'TestBot#1234' }
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    GuildVoiceStates: 4,
    MessageContent: 8
  },
  ChannelType: {
    GuildText: 0,
    DM: 1,
    GuildVoice: 2,
    GroupDM: 3,
    GuildCategory: 4,
    GuildAnnouncement: 5,
    AnnouncementThread: 10,
    PublicThread: 11,
    PrivateThread: 12,
    GuildStageVoice: 13,
    GuildDirectory: 14,
    GuildForum: 15
  },
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
    setAuthor: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({
      title: 'Test Embed',
      description: 'Test Description',
      fields: []
    })
  })),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
    setComponents: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({
      type: 1,
      components: []
    })
  })),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({
      type: 2,
      style: 1,
      label: 'Test Button',
      custom_id: 'test_button'
    })
  })),
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5
  },
  Collection: Map,
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setDefaultMemberPermissions: jest.fn().mockReturnThis(),
    setDMPermission: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({
      name: 'test',
      description: 'Test command',
      options: []
    })
  })),
  PermissionFlagsBits: {
    Administrator: 8n
  },
  REST: jest.fn().mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    put: jest.fn().mockResolvedValue([])
  })),
  Routes: {
    applicationCommands: jest.fn().mockReturnValue('/applications/123/commands')
  }
}));

// Mock environment variables for testing
process.env.DISCORD_TOKEN = 'test_token';
process.env.DISCORD_CLIENT_ID = 'test_client_id';
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Suppress console output during tests unless debugging
if (!process.env.DEBUG_TESTS) {
  console.log = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
}