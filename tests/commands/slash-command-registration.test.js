// Test slash command registration specifically
console.log('🔍 Testing slash command registration...\n');

async function testSlashCommandRegistration() {
  try {
    console.log('1. Loading environment and config...');
    require('dotenv').config();
    const config = require('../src/config');
    console.log('✅ Config loaded');

    console.log('2. Loading commands...');
    const CommandLoader = require('../src/utils/commandLoader');
    const path = require('path');
    
    const commandLoader = new CommandLoader();
    const commandsPath = path.join(__dirname, '../src/commands');
    const commands = await commandLoader.loadCommands(commandsPath);
    
    console.log(`✅ Loaded ${commands.size} commands`);

    console.log('3. Preparing command data...');
    const commandData = [];
    for (const command of commands.values()) {
      try {
        const jsonData = command.data.toJSON();
        commandData.push(jsonData);
        console.log(`  ✅ ${command.data.name}: ${command.data.description}`);
      } catch (cmdError) {
        console.error(`  ❌ Failed to serialize command: ${command.data?.name || 'unknown'}`);
        console.error(`     Error: ${cmdError.message}`);
        throw cmdError;
      }
    }

    console.log(`✅ Prepared ${commandData.length} commands for registration`);

    console.log('4. Validating configuration...');
    if (!config.discord.token || config.discord.token === 'your_discord_bot_token_here') {
      throw new Error('Invalid Discord bot token');
    }

    if (!config.discord.clientId || config.discord.clientId === 'your_discord_client_id_here') {
      throw new Error('Invalid Discord client ID');
    }

    console.log('✅ Configuration valid');

    console.log('5. Creating REST client...');
    const { REST, Routes } = require('discord.js');
    const rest = new REST().setToken(config.discord.token);
    console.log('✅ REST client created');

    console.log('6. Attempting command registration...');
    console.log(`   Client ID: ${config.discord.clientId}`);
    console.log(`   Guild ID: ${process.env.DEV_GUILD_ID}`);
    console.log(`   Commands to register: ${commandData.length}`);

    try {
      // Try guild-specific registration first (like the bot does)
      if (process.env.DEV_GUILD_ID && process.env.DEV_GUILD_ID !== 'your_test_server_guild_id_here') {
        console.log('   Registering guild-specific commands...');
        
        const data = await rest.put(
          Routes.applicationGuildCommands(config.discord.clientId, process.env.DEV_GUILD_ID),
          { body: commandData }
        );
        
        console.log(`✅ Successfully registered ${data.length} guild commands`);
      } else {
        console.log('   Registering global commands...');
        
        const data = await rest.put(
          Routes.applicationCommands(config.discord.clientId),
          { body: commandData }
        );
        
        console.log(`✅ Successfully registered ${data.length} global commands`);
      }

    } catch (registrationError) {
      console.error('❌ Command registration failed!');
      console.error('Error code:', registrationError.code);
      console.error('Error message:', registrationError.message);
      console.error('Status:', registrationError.status);
      
      if (registrationError.code === 50001) {
        console.error('\n💡 Missing Access - Bot lacks permissions');
        console.error('   Make sure the bot is added to the guild with applications.commands scope');
      } else if (registrationError.code === 10004) {
        console.error('\n💡 Unknown Guild - Guild ID is invalid');
        console.error('   Check your DEV_GUILD_ID in .env file');
      } else if (registrationError.status === 401) {
        console.error('\n💡 Unauthorized - Token is invalid');
        console.error('   Check your DISCORD_TOKEN in .env file');
      }
      
      throw registrationError;
    }

    console.log('\n🎉 Slash command registration test PASSED!');
    
  } catch (error) {
    console.error('\n💥 Slash command registration failed:', error.message);
    
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    
    console.error('\n🔍 This is likely why npm start exits with code 1');
    process.exit(1);
  }
}

testSlashCommandRegistration();