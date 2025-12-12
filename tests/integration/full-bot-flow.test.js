// Test the complete bot initialization flow including command registration
console.log('🔍 Testing complete bot initialization flow...\n');

async function testFullBotFlow() {
  try {
    console.log('1. Loading environment and config...');
    require('dotenv').config();
    const config = require('../src/config');
    const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
    
    console.log('✅ Environment loaded');
    
    console.log('2. Initializing database...');
    const dbConnection = require('../src/database/connection');
    await dbConnection.initialize();
    console.log('✅ Database initialized');
    
    console.log('3. Loading commands...');
    const CommandLoader = require('../src/utils/commandLoader');
    const path = require('path');
    
    const commandLoader = new CommandLoader();
    const commandsPath = path.join(__dirname, '../src/commands');
    const commands = await commandLoader.loadCommands(commandsPath);
    
    console.log(`✅ Loaded ${commands.size} commands`);
    
    console.log('4. Preparing command registration...');
    const commandData = [];
    for (const command of commands.values()) {
      commandData.push(command.data.toJSON());
    }
    
    if (commandData.length === 0) {
      throw new Error('No commands to register');
    }
    
    console.log(`✅ Prepared ${commandData.length} commands for registration`);
    
    console.log('5. Testing REST API setup...');
    const rest = new REST().setToken(config.discord.token);
    console.log('✅ REST client created');
    
    console.log('6. Creating Discord client...');
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions
      ]
    });
    
    let clientReady = false;
    
    client.once('ready', async () => {
      console.log('✅ Discord client ready');
      console.log(`Logged in as: ${client.user.tag}`);
      clientReady = true;
      
      try {
        console.log('7. Testing command registration...');
        
        // Test global command registration (like the bot does)
        console.log('Registering global commands...');
        
        const data = await rest.put(
          Routes.applicationCommands(config.discord.clientId),
          { body: commandData }
        );
        
        console.log(`✅ Successfully registered ${data.length} global commands`);
        
        // Also test guild-specific registration if DEV_GUILD_ID is set
        if (process.env.DEV_GUILD_ID && process.env.DEV_GUILD_ID !== 'your_test_server_guild_id_here') {
          console.log('Also testing guild-specific registration...');
          
          const guildData = await rest.put(
            Routes.applicationGuildCommands(config.discord.clientId, process.env.DEV_GUILD_ID),
            { body: commandData }
          );
          
          console.log(`✅ Successfully registered ${guildData.length} guild commands`);
        }
        
        console.log('\n🎉 Complete bot flow test passed!');
        console.log('All initialization steps work correctly.');
        
        // Clean up
        client.destroy();
        await dbConnection.close();
        
        process.exit(0);
        
      } catch (regError) {
        console.error('❌ Command registration failed:', regError);
        
        if (regError.code === 50001) {
          console.error('💡 Missing Access - Bot lacks permissions');
        } else if (regError.code === 50013) {
          console.error('💡 Missing Permissions - Check bot permissions');
        } else if (regError.status === 429) {
          console.error('💡 Rate Limited - Too many requests');
        }
        
        client.destroy();
        await dbConnection.close();
        process.exit(1);
      }
    });
    
    client.on('error', (error) => {
      console.error('❌ Discord client error:', error);
      process.exit(1);
    });
    
    // Set timeout for the entire process
    const processTimeout = setTimeout(() => {
      if (!clientReady) {
        console.error('❌ Process timeout - Bot initialization took too long');
        client.destroy();
        process.exit(1);
      }
    }, 30000);
    
    console.log('6. Logging in to Discord...');
    await client.login(config.discord.token);
    
    clearTimeout(processTimeout);
    
  } catch (error) {
    console.error('\n💥 Full bot flow test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

testFullBotFlow();