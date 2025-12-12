# Discord Gaming & Gambling Bot

A Discord bot that provides custom slash commands for gaming lobbies and sports betting discussions.

## Features

### Gaming Module
- Create private gaming lobbies with dedicated voice channels
- Party leader management with invite/kick capabilities
- Automatic lobby cleanup and expiration

### Sports Module
- Automated game thread creation for NFL, NCAA, NHL, NBA
- Real-time game updates and status tracking
- Channel-specific sports content organization

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`:
   - `DISCORD_TOKEN`: Your Discord bot token
   - `DISCORD_CLIENT_ID`: Your Discord application client ID
   - `SPORTS_API_KEY`: API key for sports data (optional)

5. Run database migrations:
   ```bash
   npm run migrate
   ```

6. Start the bot:
   ```bash
   npm start
   ```

## Development

- `npm run dev`: Start with nodemon for development
- `npm test`: Run test suite
- `npm run test:watch`: Run tests in watch mode
- `npm run test:coverage`: Generate test coverage report

## Project Structure

```
src/
├── bot.js              # Main bot entry point
├── config/             # Configuration management
├── commands/           # Slash command handlers
│   ├── gaming/         # Gaming-related commands
│   └── admin/          # Administrative commands
├── modules/            # Core business logic
│   ├── gaming/         # Gaming lobby management
│   └── sports/         # Sports data and threads
├── database/           # Database models and utilities
└── utils/              # Shared utilities and helpers
```

## Requirements

- Node.js 18.0.0 or higher
- Discord bot with appropriate permissions
- SQLite database (included)

## License

MIT