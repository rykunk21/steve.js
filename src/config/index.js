require('dotenv').config();

const config = {
  // Discord Configuration
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID
  },

  // Database Configuration
  database: {
    path: process.env.DATABASE_PATH || './data/bot.db'
  },

  // Sports API Configuration
  sportsApi: {
    key: process.env.SPORTS_API_KEY,
    baseUrl: process.env.SPORTS_API_BASE_URL || 'https://api.the-odds-api.com/v4'
  },

  // Bot Settings
  bot: {
    logLevel: process.env.LOG_LEVEL || 'info',
    environment: process.env.NODE_ENV || 'development'
  },

  // Lobby Settings
  lobby: {
    defaultDuration: parseInt(process.env.DEFAULT_LOBBY_DURATION) || 60, // minutes
    maxSize: parseInt(process.env.MAX_LOBBY_SIZE) || 10,
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 300000 // 5 minutes in ms
  },

  // DM Settings
  dm: {
    volatileDeleteMinutes: (() => {
      const envValue = process.env.VOLATILE_DM_DELETE_MINUTES;
      const parsed = parseInt(envValue);
      const result = parsed || 5;
      console.log('DM Config Debug:', {
        envValue,
        envValueType: typeof envValue,
        parsed,
        parsedType: typeof parsed,
        isNaN: isNaN(parsed),
        result,
        resultType: typeof result
      });
      return result;
    })()
  },

  // Emoji Reaction Settings
  emoji: {
    reactionTimeoutMinutes: parseInt(process.env.EMOJI_REACTION_TIMEOUT_MINUTES) || 10
  },

  // Validation
  validate() {
    const required = [
      'DISCORD_TOKEN',
      'DISCORD_CLIENT_ID'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return true;
  }
};

module.exports = config;