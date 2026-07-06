import { Bot } from 'grammy';
import { handleNewMember } from './newMember.js';
import { handleMessage } from './message.js';
import { handleCallback } from './callback.js';
import { handleServiceMessage } from './serviceMessage.js';

export function setupHandlers(bot: Bot) {
  // 新成員加入
  bot.on('chat_member', handleNewMember);

  // 驗證按鈕回調
  bot.on('callback_query:data', handleCallback);

  // 入群服務訊息（需在一般訊息檢查之前註冊）
  bot.on('message:new_chat_members', handleServiceMessage);

  // 訊息檢查（連結過濾、洪水偵測）
  bot.on('message', handleMessage);
}
