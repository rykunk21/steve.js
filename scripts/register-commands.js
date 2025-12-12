const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const config = require('../src/config');
const CommandLoader = require('../src/utils/commandLoader');

async function registerCommands() {
  try {
    console.log('🔄 Starting GLOBAL command registration...');
    
    // Load all commands
    const commandLoader = new CommandLoader();
    const commandsPath = path.join(__dirname, '../src/commands');
    const commands = await commandLoader.loadCommands(commandsPath);
    
    const commandData = [];
    for (const command of commands.values()) {
      commandData.push(command.data.toJSON());
    }
    
    console.log(`📋 Found ${commandData.length} commands to register globally`);
    
    // Create REST client
    const rest = new REST().setToken(config.discord.token);
    
    console.log(`🌍 Registering commands GLOBALLY for all servers`);
    console.log(`🤖 Using client ID: ${config.discord.clientId}`);
    
    // Clear existing guild commands from dev guild to avoid conflicts
    const devGuildId = process.env.DEV_GUILD_ID;
    if (devGuildId) {
      console.log(`🧹 Clearing existing guild commands from dev guild ${devGuildId}...`);
      try {
        await rest.put(
          Routes.applicationGuildCommands(config.discord.clientId, devGuildId),
          { body: [] }
        );
        console.log('✅ Dev guild commands cleared');
      } catch (error) {
        console.log('⚠️ Could not clear dev guild commands (this is okay)');
      }
    }
    
    // Register commands globally
    console.log('📤 Registering commands globally...');
    const data = await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commandData }
    );
    
    console.log(`✅ Successfully registered ${data.length} commands GLOBALLY`);
    
    // List registered commands
    console.log('\n📝 Registered commands:');
    data.forEach(cmd => {
      console.log(`  - /${cmd.name}: ${cmd.description}`);
    });
    
    console.log('\n🎉 Global command registration completed successfully!');
    console.log('⏰ Global commands may take up to 1 hour to appear in all Discord servers.');
    console.log('🌍 Commands will be available on ALL servers where this bot is a member.');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error registering commands:', error);
    
    if (error.status === 401) {
      console.error('🔑 Authentication failed. Check your bot token.');
    } else if (error.status === 403) {
      console.error('🚫 Permission denied. Make sure your bot has the applications.commands scope.');
    } else if (error.status === 404) {
      console.error('🔍 Guild not found. Make sure the guild ID is correct and the bot is in that server.');
    }
    
    process.exit(1);
  }
}

registerCommands();