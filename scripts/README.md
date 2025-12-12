# Scripts Directory

This directory contains utility scripts for the Discord Gaming Gambling Bot project. Scripts are organized by functionality.

## 🚀 **Core Production Scripts**

### **Model Training & Validation**
- `initialize-team-latent-distributions.js` - Initialize team VAE latent distributions N(μ, σ²)
- `train-vae-nn-system.js` - Train the complete VAE-NN system with feedback loops
- `validate-vae-nn-system.js` - Validate model performance and generate reports
- `run-incremental-discovery.js` - Continuous game discovery and model updates

### **Data Management**
- `discover-game-ids.js` - Discover game IDs from StatBroadcast archives
- `extract-vae-features.js` - Extract 88-dimensional features for VAE training
- `reconcile-games.js` - Reconcile ESPN games with StatBroadcast data

### **Team & Database Setup**
- `seed-teams.js` - Seed teams table with StatBroadcast GIDs
- `seed-teams-multi-sport.js` - Multi-sport team seeding
- `reseed-teams.js` - Re-seed teams table (clears existing data)
- `reset-database.js` - Reset entire database to clean state

## 🧪 **Testing & Validation Scripts**

### **VAE-NN System Testing**
- `test-vae-nn-with-real-teams.js` - Test VAE-NN with real database teams
- `test-vae-nn-with-db.js` - Test VAE-NN with database initialization
- `test-vae-nn-recommendations.js` - Test betting recommendation generation

### **Debugging & Diagnostics**
- `debug-vae-validation.js` - Debug VAE validation issues
- `diagnose-vae-loss.js` - Diagnose VAE loss function problems
- `debug-ajax-endpoint.js` - Debug AJAX endpoint issues

## 🔧 **Utility Scripts**

### **Discord Bot Management**
- `register-commands.js` - Register Discord slash commands
- `register-guild-commands.js` - Register guild-specific commands

### **Data Collection & Processing**
- `fetch-schedule-fixture.js` - Fetch schedule data for testing
- `fetch-team-games.js` - Fetch games for specific teams
- `scrape-statbroadcast-gids.js` - Scrape StatBroadcast team GIDs
- `match-espn-team-ids.js` - Match ESPN team IDs to StatBroadcast
- `backfill-missing-teams.js` - Backfill missing team data

### **Betting & Recommendations**
- `generate-vae-nn-betting-recommendations.js` - Generate betting recommendations using VAE-NN

## 📦 **Legacy Scripts**
- `legacy-populate-game-ids.js` - Legacy game ID population (superseded by incremental discovery)

## 🏃‍♂️ **Quick Start for New Machine**

To set up the VAE-NN system on a new machine with populated `game_ids` table:

```bash
# 1. Initialize team latent distributions
node scripts/initialize-team-latent-distributions.js

# 2. Train the VAE-NN system
node scripts/train-vae-nn-system.js

# 3. Validate the system
node scripts/validate-vae-nn-system.js

# 4. Test betting recommendations
node scripts/test-vae-nn-with-real-teams.js
```

## 📊 **Monitoring & Maintenance**

```bash
# Run incremental discovery (daily)
node scripts/run-incremental-discovery.js

# Generate performance reports
node scripts/run-incremental-discovery.js --report-only

# Debug model issues
node scripts/debug-vae-validation.js
```

## ⚠️ **Important Notes**

- **Rate Limiting**: StatBroadcast scripts respect 1-second delays between requests
- **Database**: Always ensure database is initialized before running scripts
- **Incremental**: Most scripts support incremental processing and can be safely interrupted
- **Logging**: All scripts use structured logging for monitoring and debugging