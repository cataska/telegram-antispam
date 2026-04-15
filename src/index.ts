import { Bot } from 'grammy';
import { setupHandlers } from './handlers/index.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN environment variable is required');
}

const bot = new Bot(token);

setupHandlers(bot);

bot.start();
console.log('Anti-spam bot is running...');
