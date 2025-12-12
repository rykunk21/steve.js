const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const config = require('../src/config');
const CommandLoader = require('../src/utils/commandLoader');

async function registerGuildCommands() {
  try {
    const guildId = '1421847145547563200'; // Your production guild
    
    console.log('🔄 Starting GUILD-SPECIFIC command registration...');
    console.log(`🎯 Target Guild: ${guildId}`);
    
    // Load all commands
    const commandLoader = new CommandLoader();
    const commandsPath = path.join(__dirname, '../src/commands');
    const commands = await commandLoader.loadCommands(commandsPath);
    
    const commandData = [];
    for (const command of commands.values()) {
      commandData.push(command.data.toJSON());
    }
    
    console.log(`📋 Found ${commandData.length} commands to register to guild`);
    
    // List all commands being registered
    console.log('\n📝 Commands to register:');
    commandData.forEach(cmd => {
      console.log(`  - /${cmd.name}: ${cmd.description}`);
    });
    
    // Create REST client
    const rest = new REST().setToken(config.discord.token);
    
    console.log(`\n🏠 Registering commands to GUILD ${guildId}`);
    console.log(`🤖 Using client ID: ${config.discord.clientId}`);
    
    // Clear existing global commands to avoid conflicts
    console.log('🧹 Clearing global commands to prevent conflicts...');
    try {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });
      console.log('✅ Global commands cleared');
    } catch (error) {
      console.log('⚠️ Could not clear global commands (this is okay)');
    }
    
    // Register commands to specific guild
    console.log('📤 Registering commands to guild...');
    const data = await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, guildId),
      { body: commandData }
    );
    
    console.log(`✅ Successfully registered ${data.length} commands to guild ${guildId}`);
    
    // List registered commands
    console.log('\n📝 Registered commands:');
    data.forEach(cmd => {
      console.log(`  - /${cmd.name}: ${cmd.description}`);
    });
    
    console.log('\n🎉 Guild command registration completed successfully!');
    console.log('⚡ Guild commands appear IMMEDIATELY in the target server.');
    console.log(`🏠 Commands are now available in guild ${guildId}`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error registering guild commands:', error);
    
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

registerGuildCommands();