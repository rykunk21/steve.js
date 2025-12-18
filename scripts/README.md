# Scripts Directory

This directory contains essential utility scripts for the Discord Gaming Gambling Bot project with InfoNCE VAE-NN architecture.

## 🚀 **Essential Scripts**

### **Database Management**
- `reset-database.js` - Reset entire database to clean state for new architecture
- `seed-teams.js` - Seed teams table with StatBroadcast GIDs
- `seed-teams-multi-sport.js` - Multi-sport team seeding
- `reseed-teams.js` - Re-seed teams table (clears existing data)
- `reset-processed-flags.js` - Reset processed flags for reprocessing games

### **Data Collection & Processing**
- `discover-game-ids.js` - Discover game IDs from StatBroadcast archives
- `reconcile-games.js` - Reconcile ESPN games with StatBroadcast data
- `fetch-schedule-fixture.js` - Fetch schedule data for testing
- `fetch-team-games.js` - Fetch games for specific teams
- `scrape-statbroadcast-gids.js` - Scrape StatBroadcast team GIDs
- `match-espn-team-ids.js` - Match ESPN team IDs to StatBroadcast
- `backfill-missing-teams.js` - Backfill missing team data
- `check-available-games.js` - Check available games for processing

### **System Validation**
- `validate-vae-nn-system.js` - Validate model performance and generate reports
- `quick-validate-system.js` - Quick system validation checks
- `predict-and-simulate-game.js` - Test game prediction and simulation

### **Discord Bot Management**
- `register-commands.js` - Register Discord slash commands
- `register-guild-commands.js` - Register guild-specific commands

## 🏃‍♂️ **Quick Start for InfoNCE Architecture**

To set up the new InfoNCE VAE-NN system:

```bash
# 1. Reset database for new architecture
node scripts/reset-database.js

# 2. Seed teams table
node scripts/seed-teams.js

# 3. Discover and populate game IDs
node scripts/discover-game-ids.js

# 4. Validate system setup
node scripts/quick-validate-system.js
```

## 📊 **Daily Operations**

```bash
# Check for new games
node scripts/check-available-games.js

# Reconcile ESPN games with StatBroadcast
node scripts/reconcile-games.js

# Validate system performance
node scripts/validate-vae-nn-system.js
```

## ⚠️ **Important Notes**

- **New Architecture**: Scripts have been cleaned up for InfoNCE VAE-NN architecture
- **Rate Limiting**: StatBroadcast scripts respect 1-second delays between requests
- **Database**: Always ensure database is initialized before running scripts
- **Logging**: All scripts use structured logging for monitoring and debugging
- **Experimental Scripts**: All experimental/debugging scripts have been removed