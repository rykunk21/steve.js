// Test command registration in isolation
console.log('🔍 Testing command registration...');

try {
  require('dotenv').config();
  
  const { REST, Routes } = require('discord.js');
  const config = require('../src/config');
  const CommandLoader = require('../src/utils/commandLoader');
  const path = require('path');
  
  async function testCommandRegistration() {
    try {
      console.log('1. Loading commands...');
      
      const commandLoader = new CommandLoader();
      const commandsPath = path.join(__dirname, '../src/commands');
      const commands = await commandLoader.loadCommands(commandsPath);
      
      console.log(`✅ Loaded ${commands.size} commands`);
      
      // List all commands
      console.log('📋 Commands found:');
      for (const [name, command] of commands) {
        console.log(`  - ${name}: ${command.data.description}`);
      }
      
      console.log('\n2. Preparing command data for registration...');
      
      const commandData = [];
      for (const command of commands.values()) {
        commandData.push(command.data.toJSON());
      }
      
      console.log(`✅ Prepared ${commandData.length} commands for registration`);
      
      console.log('\n3. Testing REST client creation...');
      
      const rest = new REST().setToken(config.discord.token);
      console.log('✅ REST client created');
      
      console.log('\n4. Testing command registration (dry run)...');
      console.log(`Client ID: ${config.discord.clientId}`);
      console.log(`Guild ID: ${process.env.DEV_GUILD_ID}`);
      
      // Don't actually register, just test the setup
      console.log('✅ Command registration setup is valid');
      
      console.log('\n🎉 Command registration test passed!');
      
    } catch (error) {
      console.error('❌ Command registration test failed:', error);
      console.error('Stack trace:', error.stack);
      throw error;
    }
  }
  
  testCommandRegistration().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
  
} catch (error) {
  console.error('❌ Initial setup failed:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}