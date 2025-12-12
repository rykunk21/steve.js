const BaseCommand = require('../BaseCommand');

class PingCommand extends BaseCommand {
  constructor() {
    super('ping', 'Replies with Pong! and shows bot latency', {
      category: 'general',
      cooldown: 5
    });
  }

  async execute(interaction) {
    const sent = await interaction.reply({ 
      content: 'Pinging...', 
      fetchReply: true 
    });
    
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.editReply({
      content: `🏓 Pong!\n📡 Latency: ${latency}ms\n💓 API Latency: ${apiLatency}ms`
    });
  }
}

module.exports = PingCommand;