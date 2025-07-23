import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import winston from 'winston';
import { VRF } from './utils/vrf';
import * as https from 'https';
import * as dns from 'dns';
import { leaderboard, GameRecord } from './leaderboard';
import { groupManager, GroupConfig } from './utils/group-manager';
import { gamePersistence } from './utils/game-persistence';
import { prizeManager } from './utils/prize-manager';
import { notificationManager } from './utils/notification-manager';
import { botWalletManager } from './utils/wallet-manager';
import { callbackManager } from './utils/callback-manager';
import {
  handleLeaderboardCommand,
  handleStatsCommand,
  handlePrizeStatsCommand,
  handleWinnerStatsCommand,
  handleStatusCommand
} from './handlers/command-handlers';

// Load environment variables
dotenv.config();

// Force IPv4 DNS resolution (fixes Node.js connection issues)
dns.setDefaultResultOrder('ipv4first');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' })
  ],
});

// Multiple game states (one per group) - loaded from persistence
const gameStates: Map<string, any> = gamePersistence.loadGamesSync(); // Use sync version for compatibility

// Create HTTPS agent with IPv4 forcing and better timeout settings
const httpsAgent = new https.Agent({
  family: 4, // Force IPv4 - this fixes the connection issue!
  keepAlive: true,
  timeout: 60000,
  maxSockets: 10,
  maxFreeSockets: 5,
  scheduling: 'fifo'
});

// Initialize bot with timeout configuration
const bot = new Telegraf(process.env.BOT_TOKEN!, {
  handlerTimeout: 90000,
  telegram: {
    apiRoot: 'https://api.telegram.org',
    agent: httpsAgent,
    attachmentAgent: httpsAgent,
    webhookReply: false
  }
});

// Helper function to get current game for a chat
function getCurrentGame(chatId: string): any {
  return gameStates.get(chatId) || null;
}

// Helper function to set current game for a chat
function setCurrentGame(chatId: string, game: any): void {
  gameStates.set(chatId, game);
  // Auto-save immediately when game state changes
  gamePersistence.saveGames(gameStates);
}

// Helper function to check if user is admin
function isAdminUser(userId: string): boolean {
  return groupManager.isAdmin(userId);
}

// Helper function to check if user is super admin
function isSuperAdminUser(userId: string): boolean {
  const superAdminId = process.env.SUPER_ADMIN_ID;
  return superAdminId && userId === superAdminId;
}

// Initialize group manager with defaults
const defaultAdminId = process.env.DEFAULT_ADMIN_ID;
const defaultChatId = process.env.DEFAULT_CHAT_ID;
if (defaultAdminId && defaultChatId) {
  groupManager.initialize(defaultAdminId, defaultChatId, 'Default Group');
}

// Test game creation removed - dynamic survivor scaling implemented

// Start auto-save for game persistence
const autoSaveInterval = gamePersistence.startAutoSave(gameStates, 10000); // Save every 10 seconds

// Save games on exit
process.on('SIGINT', () => {
  console.log('🔄 Saving games before exit...');
  gamePersistence.saveGames(gameStates);
  clearInterval(autoSaveInterval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🔄 Saving games before exit...');
  gamePersistence.saveGames(gameStates);
  clearInterval(autoSaveInterval);
  process.exit(0);
});

// Admin Commands

// Command: /addgroup (admin only)
bot.command('addgroup', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  const chatId = ctx.chat.id.toString();
  const chatTitle = 'title' in ctx.chat ? ctx.chat.title : `Group ${chatId}`;
  
  if (groupManager.addGroup(chatId, chatTitle || 'Unknown Group', userId)) {
    await ctx.reply(
      `✅ Group Added Successfully!\n\n` +
      `📋 Group: ${chatTitle}\n` +
      `🆔 ID: ${chatId}\n` +
      `👤 Added by: ${ctx.from!.first_name}\n\n` +
      `The bot will now operate in this group.`
    );
  } else {
    await ctx.reply(
      `⚠️ Group Already Configured\n\n` +
      `This group is already in the bot's configuration.`
    );
  }
});

// Command: /removegroup (admin only)
bot.command('removegroup', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  const chatId = ctx.chat.id.toString();
  
  if (groupManager.removeGroup(chatId)) {
    await ctx.reply(
      `✅ Group Removed Successfully!\n\n` +
      `This group has been removed from the bot's configuration.\n` +
      `The bot will no longer operate here.`
    );
  } else {
    await ctx.reply(
      `⚠️ Group Not Found\n\n` +
      `This group is not in the bot's configuration.`
    );
  }
});

// Command: /listgroups (admin only)
bot.command('listgroups', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  const groups = groupManager.getGroups();
  
  if (groups.length === 0) {
    return ctx.reply('📋 No groups configured yet.\n\nUse /addgroup in a group to add it.');
  }

  let message = '📋 CONFIGURED GROUPS\n\n';
  
  for (const group of groups) {
    const status = group.enabled ? '🟢 Active' : '🔴 Disabled';
    message += `${status} ${group.name}\n`;
    message += `   🆔 ID: ${group.id}\n`;
    message += `   👤 Added by: ${group.addedBy}\n`;
    message += `   📅 Added: ${new Date(group.addedAt).toLocaleDateString()}\n\n`;
  }

  await ctx.reply(message);
});

// Command: /addadmin (existing admin only) - reply to user's message
bot.command('addadmin', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  // Check if replying to a message
  if (!ctx.message || !('reply_to_message' in ctx.message) || !ctx.message.reply_to_message) {
    return ctx.reply(
      '❌ Please reply to a user\'s message with /addadmin to make them an admin.'
    );
  }

  // Check if target message has a from field
  if (!ctx.message.reply_to_message.from) {
    return ctx.reply('❌ Cannot add admin - unable to identify the user.');
  }

  const targetUserId = ctx.message.reply_to_message.from.id.toString();
  const targetUsername = ctx.message.reply_to_message.from.first_name || 
                        ctx.message.reply_to_message.from.username || 
                        'User';

  // Don't allow adding self
  if (targetUserId === userId) {
    return ctx.reply('❌ You are already an admin!');
  }

  if (groupManager.addAdmin(targetUserId)) {
    await ctx.reply(
      `✅ **Admin Added Successfully!**\n\n` +
      `👤 User: ${targetUsername}\n` +
      `🆔 ID: ${targetUserId}\n` +
      `🛡️ Status: Now has admin privileges\n\n` +
      `They can now:\n` +
      `• Manage groups (/addgroup, /removegroup)\n` +
      `• Force start/end games\n` +
      `• Access admin panel (/admin)\n` +
      `• Add/remove other admins`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(`⚠️ ${targetUsername} is already an admin.`);
  }
});

// Command: /deleteadmin (existing admin only) - reply to user's message
bot.command('deleteadmin', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  // Check if replying to a message
  if (!ctx.message || !('reply_to_message' in ctx.message) || !ctx.message.reply_to_message) {
    return ctx.reply(
      '❌ Please reply to a user\'s message with /deleteadmin to remove their admin privileges.'
    );
  }

  // Check if target message has a from field
  if (!ctx.message.reply_to_message.from) {
    return ctx.reply('❌ Cannot remove admin - unable to identify the user.');
  }

  const targetUserId = ctx.message.reply_to_message.from.id.toString();
  const targetUsername = ctx.message.reply_to_message.from.first_name || 
                        ctx.message.reply_to_message.from.username || 
                        'User';

  // Don't allow removing self
  if (targetUserId === userId) {
    return ctx.reply('❌ You cannot remove your own admin privileges!');
  }

  // Check if trying to remove super admin
  if (isSuperAdminUser(targetUserId)) {
    return ctx.reply('❌ Cannot remove super admin privileges!');
  }

  if (groupManager.removeAdmin(targetUserId)) {
    await ctx.reply(
      `✅ **Admin Removed Successfully!**\n\n` +
      `👤 User: ${targetUsername}\n` +
      `🆔 ID: ${targetUserId}\n` +
      `🔓 Status: Admin privileges revoked\n\n` +
      `They can no longer:\n` +
      `• Access admin commands\n` +
      `• Manage groups\n` +
      `• Force start/end games\n` +
      `• Add/remove admins`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(`⚠️ ${targetUsername} is not an admin.`);
  }
});

// Main admin menu
bot.command('admin', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use admin commands.');
  }

  const adminKeyboard = {
    inline_keyboard: [
      [
        { text: '🏠 Group Management', callback_data: 'admin_groups' },
        { text: '👥 User Management', callback_data: 'admin_users' }
      ],
      [
        { text: '🎮 Game Control', callback_data: 'admin_games' },
        { text: '📊 Statistics', callback_data: 'admin_stats' }
      ],
      [
        { text: '💰 Prize Stats', callback_data: 'admin_prize_stats' },
        { text: '🏆 Winners Stats', callback_data: 'admin_winners_stats' }
      ],
      [
        { text: '👛 Bot Wallet', callback_data: 'admin_wallet' }
      ],
      [
        { text: '🔧 Debug Info', callback_data: 'admin_debug' },
        { text: '📋 Help', callback_data: 'admin_help' }
      ]
    ]
  };

  await ctx.reply(
    '👑 **ADMIN CONTROL PANEL**\n\n' +
    'Select an option below to manage the bot:',
    { 
      parse_mode: 'Markdown',
      reply_markup: adminKeyboard 
    }
  );
});

// Command: /superadmin (SUPER ADMIN ONLY)
bot.command('superadmin', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isSuperAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use super admin commands.');
  }

  const superAdminKeyboard = {
    inline_keyboard: [
      [
        { text: '🔐 Secure Key Access', callback_data: 'superadmin_private_key' },
        { text: '👛 Wallet Details', callback_data: 'superadmin_wallet' }
      ],
      [
        { text: '👑 Admin Panel', callback_data: 'admin_main' },
        { text: '🔧 System Info', callback_data: 'superadmin_system' }
      ]
    ]
  };

  await ctx.reply(
    '🔱 **SUPER ADMIN CONTROL PANEL** 🔱\n\n' +
    '⚠️ **WARNING**: You have access to sensitive bot operations.\n' +
    'Use these functions responsibly.\n\n' +
    'Select an option below:',
    { 
      parse_mode: 'Markdown',
      reply_markup: superAdminKeyboard 
    }
  );
});

// Legacy /config command (redirects to new admin menu)
bot.command('config', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }
  
  // Redirect to admin menu
  const adminKeyboard = {
    inline_keyboard: [
      [{ text: '🏠 Go to Admin Panel', callback_data: 'admin_groups' }]
    ]
  };
  
  await ctx.reply(
    '⚙️ Bot configuration has moved!\n\nUse the button below or type `/admin` for the new admin panel.',
    { reply_markup: adminKeyboard }
  );
});

// Handle all callback queries through the callback manager
bot.on('callback_query', async (ctx): Promise<any> => {
  return callbackManager.handleCallback(ctx as any);
});

// Command: /start
bot.command('start', async (ctx) => {
  const userId = ctx.from!.id.toString();
  const isAdmin = isAdminUser(userId);
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  
  let message = `🎲 **Welcome to the Survival Lottery Bot!**\n\n` +
    `👋 Hello ${username}!\n\n` +
    `🎯 **How to Play:**\n` +
    `• Create or join a lottery game\n` +
    `• Each player gets a unique number\n` +
    `• Numbers are drawn randomly using VRF\n` +
    `• If your number is drawn, you're eliminated!\n` +
    `• Last survivor(s) win the prize pool!\n\n` +
    `💰 **Prizes:** Winners split 10,000-50,000 tokens!\n\n` +
    `Choose an option below to get started:`;

  // Create user menu keyboard
  const userMenuKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 Join Game', callback_data: 'user_join_game' },
        { text: '➕ Create Game', callback_data: 'user_create_game' }
      ],
      [
        { text: '📊 My Stats', callback_data: 'user_my_stats' },
        { text: '🏆 Leaderboard', callback_data: 'user_leaderboard' }
      ],
      [
        { text: '💰 Prize Stats', callback_data: 'user_prize_stats' },
        { text: '🎖️ Top Winners', callback_data: 'user_winner_stats' }
      ],
      [
        { text: '🎯 Current Game Status', callback_data: 'user_game_status' }
      ]
    ]
  };

  // Add admin button if user is admin
  if (isAdmin) {
    userMenuKeyboard.inline_keyboard.push([
      { text: '👑 Admin Panel', callback_data: 'admin_main' }
    ]);
  }

  await ctx.reply(message, { 
    reply_markup: userMenuKeyboard,
    parse_mode: 'Markdown'
  });
});

// Helper command to get chat ID
bot.command('getchatid', (ctx) => {
  ctx.reply(
    `📋 Chat Information:\n\n` +
    `Chat ID: <code>${ctx.chat.id}</code>\n` +
    `Chat Type: ${ctx.chat.type}\n\n` +
    `💡 To set this as your default channel:\n` +
    `Add this to your .env file:\n` +
    `<code>DEFAULT_CHAT_ID=${ctx.chat.id}</code>`,
    { parse_mode: 'HTML' }
  );
});

// Helper command to get your user ID
bot.command('myid', (ctx) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || 'No username';
  const firstName = ctx.from!.first_name || 'Unknown';
  
  ctx.reply(
    `👤 Your Information:\n\n` +
    `🆔 User ID: <code>${userId}</code>\n` +
    `👤 Name: ${firstName}\n` +
    `🔗 Username: @${username}\n\n` +
    `💡 Use this User ID in your .env file:\n` +
    `<code>DEFAULT_ADMIN_ID=${userId}</code>`,
    { parse_mode: 'HTML' }
  );
});

// Force start command (admin only)
bot.command('forcestart', async (ctx) => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Only admins can force-start games.');
  }
  
  if (!groupManager.isGroupEnabled(chatId)) {
    return ctx.reply('❌ This group is not configured.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply('❌ No active game to start.');
  }
  
  if (currentGame.state === 'WAITING') {
    if (currentGame.players.size < 2) {
      return ctx.reply('❌ Need at least 2 players to start.');
    }
    await ctx.reply('🚀 Force-starting game now!');
    startGame(chatId);
  } else if (currentGame.state === 'DRAWING') {
    await ctx.reply('🎯 Game is in drawing state - forcing draw to start!');
    startDrawing(chatId);
  } else {
    return ctx.reply(`❌ Game is already ${currentGame.state}.`);
  }
});

// Debug command (temporary)
bot.command('debug', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const currentGame = getCurrentGame(chatId);
  const isEnabled = groupManager.isGroupEnabled(chatId);
  const groups = groupManager.getGroups();
  
  let debugInfo = `🔍 DEBUG INFO\n\n`;
  debugInfo += `Chat ID: ${chatId}\n`;
  debugInfo += `Group Enabled: ${isEnabled}\n`;
  debugInfo += `Active Game: ${currentGame ? 'YES' : 'NO'}\n`;
  if (currentGame) {
    debugInfo += `Game ID: ${currentGame.gameId}\n`;
    debugInfo += `Game State: ${currentGame.state}\n`;
    debugInfo += `Players: ${currentGame.players.size}\n`;
  }
  debugInfo += `\nAll Groups: ${groups.length}\n`;
  for (const group of groups) {
    debugInfo += `- ${group.id}: ${group.name} (${group.enabled ? 'enabled' : 'disabled'})\n`;
  }
  
  await ctx.reply(debugInfo);
});

// End game command (admin only)
bot.command('endgame', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Only admins can end games.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply('❌ No active game to end.');
  }
  
  // Mark game as finished and clean up
  currentGame.state = 'FINISHED';
  currentGame.endedAt = new Date();
  setCurrentGame(chatId, currentGame);
  
  // Clean up notification buffers
  notificationManager.cleanup(chatId);
  
  await ctx.reply(
    '🔚 **Game Ended by Admin**\n\n' +
    `🎲 Game ID: ${currentGame.gameId}\n` +
    `👥 Players: ${currentGame.players.size}\n` +
    `⏱️ Status: TERMINATED\n\n` +
    'You can now create a new game with /create',
    { parse_mode: 'Markdown' }
  );
});

// Pause lottery command (admin only)
bot.command('pauselottery', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Only admins can pause lottery games.');
  }
  
  if (!groupManager.isGroupEnabled(chatId)) {
    return ctx.reply('❌ This group is not configured.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply('❌ No active lottery game to pause.');
  }
  
  // Check if game is in a pausable state
  if (currentGame.state === 'FINISHED') {
    return ctx.reply('❌ Cannot pause a finished game.');
  }
  
  if (currentGame.state === 'PAUSED') {
    return ctx.reply('⏸️ Lottery game is already paused.\n\nUse /resumelottery to resume the game.');
  }
  
  // Store the previous state and pause the game
  currentGame.previousState = currentGame.state;
  currentGame.state = 'PAUSED';
  currentGame.pausedAt = new Date();
  currentGame.pausedBy = userId;
  setCurrentGame(chatId, currentGame);
  
  await ctx.reply(
    '⏸️ **Lottery Game Paused**\n\n' +
    `🎲 Game ID: ${currentGame.gameId}\n` +
    `👥 Players: ${currentGame.players.size}\n` +
    `⏱️ Previous State: ${currentGame.previousState}\n` +
    `👤 Paused by: Admin\n\n` +
    '**Game is now paused. Players cannot join or leave.**\n' +
    'Use /resumelottery to resume the game.',
    { parse_mode: 'Markdown' }
  );
});

// Resume lottery command (admin only)
bot.command('resumelottery', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Only admins can resume lottery games.');
  }
  
  if (!groupManager.isGroupEnabled(chatId)) {
    return ctx.reply('❌ This group is not configured.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply('❌ No lottery game to resume.');
  }
  
  if (currentGame.state !== 'PAUSED') {
    return ctx.reply('▶️ Lottery game is not paused.\n\nCurrent state: ' + currentGame.state);
  }
  
  // Restore the previous state
  const previousState = currentGame.previousState || 'WAITING';
  currentGame.state = previousState;
  currentGame.resumedAt = new Date();
  currentGame.resumedBy = userId;
  delete currentGame.previousState;
  delete currentGame.pausedAt;
  delete currentGame.pausedBy;
  setCurrentGame(chatId, currentGame);
  
  await ctx.reply(
    '▶️ **Lottery Game Resumed**\n\n' +
    `🎲 Game ID: ${currentGame.gameId}\n` +
    `👥 Players: ${currentGame.players.size}\n` +
    `⏱️ Current State: ${currentGame.state}\n` +
    `👤 Resumed by: Admin\n\n` +
    '**Game is now active again!**\n' +
    (currentGame.state === 'WAITING' ? 
      'Players can now join with /join' : 
      'Game is continuing from where it was paused.'),
    { parse_mode: 'Markdown' }
  );
  
  // If the game was in DRAWING state, continue the drawing process
  if (currentGame.state === 'DRAWING') {
    setTimeout(() => {
      logger.info(`Resuming drawing process for game ${currentGame.gameId} in chat ${chatId}`);
      // Continue drawing process if it was interrupted
      startDrawing(chatId);
    }, 1000);
  }
});

// Help command
bot.command('help', (ctx) => {
  const userId = ctx.from!.id.toString();
  const isAdmin = isAdminUser(userId);
  
  let message = '🎲 **SURVIVAL LOTTERY BOT**\n\n';
  
  message += '🎯 **HOW TO PLAY:**\n';
  message += '• Join or create a lottery game\n';
  message += '• Each player gets a unique number\n';
  message += '• Numbers are drawn randomly\n';
  message += '• If your number is drawn, you\'re eliminated!\n';
  message += '• Last survivor(s) win prizes!\n\n';
  
  message += '💰 **PRIZES:**\n';
  message += 'Winners split 10,000-50,000 tokens!\n\n';
  
  message += '🎮 **QUICK START:**\n';
  message += 'Type `/start` to open the main menu\n\n';
  
  if (isAdmin) {
    message += '👑 **ADMIN COMMANDS:**\n';
    message += '• `/admin` - Admin panel\n';
    message += '• `/endgame` - End current game\n';
    message += '• `/pauselottery` - Pause active lottery\n';
    message += '• `/resumelottery` - Resume paused lottery\n';
    message += '• `/forcestart` - Force start waiting game\n';
    message += '• Group management and configuration\n\n';
  }
  
  message += '💡 **TIP:** Use `/start` for the interactive menu!';

  ctx.reply(message, { parse_mode: 'Markdown' });
});

// Command: /prizestats
bot.command('prizestats', async (ctx): Promise<any> => {
  try {
    const prizeStats = prizeManager.getPrizeStats();
    const recentPrizes = prizeManager.getRecentPrizes(5);
    
    if (prizeStats.totalGames === 0) {
      return ctx.reply(
        `💰 No prizes awarded yet!\n\n` +
        `Create your first lottery with /create to start the prize pool!`
      );
    }
    
    let statsMessage = `💰 **PRIZE POOL STATISTICS** 💰\n\n`;
    statsMessage += `💸 Total Prizes Paid: **${prizeStats.totalPaid.toLocaleString()}**\n`;
    statsMessage += `🎮 Total Games with Prizes: **${prizeStats.totalGames}**\n`;
    statsMessage += `📊 Average Prize: **${Math.round(prizeStats.averagePrize).toLocaleString()}**\n\n`;
    
    if (recentPrizes.length > 0) {
      statsMessage += `🕐 **Recent Prizes:**\n`;
      for (const prize of recentPrizes) {
        const date = new Date(prize.timestamp).toLocaleDateString();
        statsMessage += `• ${prize.prizeAmount.toLocaleString()} (${prize.totalSurvivors} survivors) - ${date}\n`;
      }
      statsMessage += `\n💡 Use /create to start a new lottery with automatic VRF prize generation!`;
    }

    await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in prizestats command:', error);
    await ctx.reply('❌ Error loading prize statistics. Please try again.');
  }
});

// Command: /winnerstats
bot.command('winnerstats', async (ctx): Promise<any> => {
  try {
    const userWinnings = prizeManager.getUserWinnings();
    const topWinners = userWinnings.slice(0, 15);
    
    if (topWinners.length === 0) {
      return ctx.reply(
        `🏆 No winners yet!\n\n` +
        `Be the first to win by joining lottery games with /join!`
      );
    }
    
    const totalWinners = userWinnings.length;
    const totalWinnings = userWinnings.reduce((sum, u) => sum + u.totalWinnings, 0);
    
    let winnersMessage = `🏆 **TOP WINNERS LEADERBOARD** 🏆\n\n`;
    winnersMessage += `👥 Total Winners: **${totalWinners}**\n`;
    winnersMessage += `💰 Total Prize Money: **${totalWinnings.toLocaleString()}**\n\n`;
    winnersMessage += `🏅 **Top ${Math.min(15, topWinners.length)} Winners:**\n`;
    
    for (let i = 0; i < topWinners.length; i++) {
      const winner = topWinners[i];
      const rank = i + 1;
      let medal = '';
      if (rank === 1) medal = '🥇';
      else if (rank === 2) medal = '🥈';
      else if (rank === 3) medal = '🥉';
      else medal = `${rank}.`;
      
      winnersMessage += `${medal} **${winner.username}**: ${winner.totalWinnings.toLocaleString()}\n`;
      winnersMessage += `   🎮 Games Won: ${winner.gamesWon} | 📅 Last Win: ${winner.lastWin.toLocaleDateString()}\n`;
    }
    
    winnersMessage += `\n💡 Use /stats to see your personal statistics!`;

    await ctx.reply(winnersMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in winnerstats command:', error);
    await ctx.reply('❌ Error loading winner statistics. Please try again.');
  }
});

// Helper function to parse game configuration from command
function parseGameConfig(text: string) {
  const config = {
    maxPlayers: parseInt(process.env.MAX_PLAYERS || '50'),
    startMinutes: 5,
    survivors: 1, // Will be auto-calculated based on maxPlayers
    selectionMultiplier: 2,
    survivorsOverride: false // Track if manually set
  };

  // Parse --max flag (handle both regular dashes and em-dashes)
  const maxMatch = text.match(/(?:--?|—)max\s+(\d+)/i);
  if (maxMatch) {
    config.maxPlayers = Math.min(Math.max(parseInt(maxMatch[1]), 2), 100);
  }

  // Parse --start flag (handle both regular dashes and em-dashes)
  const startMatch = text.match(/(?:--?|—)start\s+(\d+)/i);
  if (startMatch) {
    config.startMinutes = Math.min(Math.max(parseInt(startMatch[1]), 1), 30);
  }

  // Parse --survivors flag (manual override, handle both regular dashes and em-dashes)
  const survivorsMatch = text.match(/(?:--?|—)survivors\s+(\d+)/i);
  if (survivorsMatch) {
    config.survivors = Math.max(parseInt(survivorsMatch[1]), 1);
    config.survivorsOverride = true;
  }

  // Parse --selection flag (handle both regular dashes and em-dashes)
  const selectionMatch = text.match(/(?:--?|—)selection\s+(\d+(?:\.\d+)?)/i);
  if (selectionMatch) {
    config.selectionMultiplier = Math.min(Math.max(parseFloat(selectionMatch[1]), 1), 10);
  }

  // Auto-calculate survivors based on max players (if not manually overridden)
  if (!config.survivorsOverride) {
    if (config.maxPlayers >= 2 && config.maxPlayers <= 10) {
      config.survivors = 1;
    } else if (config.maxPlayers >= 11 && config.maxPlayers <= 20) {
      config.survivors = 2;
    } else if (config.maxPlayers >= 21 && config.maxPlayers <= 30) {
      config.survivors = 3;
    } else if (config.maxPlayers >= 31 && config.maxPlayers <= 40) {
      config.survivors = 4;
    } else if (config.maxPlayers >= 41 && config.maxPlayers <= 50) {
      config.survivors = 5;
    } else {
      // For maxPlayers > 50, scale proportionally
      config.survivors = Math.ceil(config.maxPlayers / 10);
    }
  }

  return config;
}

// Command: /create with configuration options
bot.command('create', async (ctx): Promise<any> => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat.id.toString();
  
  // Check if this group is configured and enabled
  if (!groupManager.isGroupEnabled(chatId)) {
    return ctx.reply(
      `❌ Bot not configured for this group!\n\n` +
      `An admin needs to run /addgroup here first.\n` +
      `Use /getchatid to get this group's ID for configuration.`
    );
  }
  
  // Check if game already exists in this chat
  const currentGame = getCurrentGame(chatId);
  if (currentGame && currentGame.state !== 'FINISHED') {
    return ctx.reply(
      `🎮 A game is already active in this group!\n\n` +
      `Current game has ${currentGame.players.size} players.\n` +
      `Use /join to participate or /status to see details.`
    );
  }

  // Parse configuration from command text
  const commandText = ctx.message?.text || '';
  const config = parseGameConfig(commandText);
  
  // Debug logging for config parsing
  logger.info(`CREATE DEBUG: Command text: "${commandText}"`);
  logger.info(`CREATE DEBUG: Parsed config:`, config);
  
  const newGame = {
    id: `${chatId}_${Date.now()}`,
    gameId: VRF.generate(`game_id_${Date.now()}_${userId}`).value.substring(0, 6).toUpperCase(),
    creator: userId,
    players: new Map([[userId.toString(), { id: userId.toString(), username, joinedAt: new Date() }]]),
    state: 'WAITING',
    numberSelections: new Map(),
    createdAt: new Date(),
    maxPlayers: config.maxPlayers,
    numberRange: { min: 1, max: 2 }, // Will be updated when game starts
    winnerCount: config.survivors,
    selectionMultiplier: config.selectionMultiplier,
    startMinutes: config.startMinutes,
    chatId: parseInt(chatId)
  };
  
  // Set the game for this specific chat
  setCurrentGame(chatId, newGame);
  logger.info(`CREATE DEBUG: Game created in chat ${chatId}, ID: ${newGame.gameId}`);
  
  // Record player entry for leaderboard
  leaderboard.recordPlayerEntry(userId.toString(), username);

  // Announce in current chat
  const survivorText = config.survivorsOverride 
    ? `${config.survivors} (manual override)` 
    : `${config.survivors} (auto-scaled)`;
    
  const announceMessage = 
    `🎰 Survival Lottery Created!\n\n` +
    `🎲 Game ID: <code>${newGame.gameId}</code>\n` +
    `👤 Created by: ${username}\n` +
    `👥 Players: 1/${newGame.maxPlayers}\n` +
    `⏰ Game starts in ${newGame.startMinutes} minutes or when full!\n\n` +
    `📊 Configuration:\n` +
    `• Max Players: ${config.maxPlayers}\n` +
    `• Start Timer: ${newGame.startMinutes} minutes\n` +
    `• Survivors: ${survivorText}\n` +
    `• Number Range: ${config.selectionMultiplier}x player count\n\n` +
    `💬 Use <b>/join</b> to participate!`;
  
  // Add join button to the announcement
  const joinKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 Join Game', callback_data: `join_${newGame.gameId}` },
        { text: '📊 Status', callback_data: `status_${newGame.gameId}` }
      ]
    ]
  };
  
  await ctx.reply(announceMessage, { 
    parse_mode: 'HTML',
    reply_markup: joinKeyboard
  });

  // Set up auto-start timer immediately after game creation
  const gameStartMinutes = newGame.startMinutes;
  
  // Debug logging for timer setup
  logger.info(`CREATE DEBUG: Setting up timer for ${gameStartMinutes} minutes (${gameStartMinutes * 60000}ms)`);
  
  // Schedule warnings based on startMinutes
  const totalMs = gameStartMinutes * 60000;
  const warnings = [4, 3, 2, 1]; // Minutes to warn at
  
  for (const warningMin of warnings) {
    const warningTime = totalMs - (warningMin * 60000);
    if (warningTime > 0 && warningTime < totalMs) {
      setTimeout(() => {
        const gameCheck = getCurrentGame(chatId);
        if (gameCheck && gameCheck.state === 'WAITING') {
          sendJoinWarning(chatId, warningMin);
        }
      }, warningTime);
    }
  }
  
  // 30-second warning
  const thirtySecWarning = totalMs - 30000;
  if (thirtySecWarning > 0) {
    setTimeout(() => {
      const gameCheck = getCurrentGame(chatId);
      if (gameCheck && gameCheck.state === 'WAITING') {
        sendJoinWarning(chatId, 0.5);
      }
    }, thirtySecWarning);
  }
  
  // Auto-start at configured time
  setTimeout(() => {
    const gameCheck = getCurrentGame(chatId);
    if (gameCheck && gameCheck.state === 'WAITING') {
      startGame(chatId);
    }
  }, gameStartMinutes * 60000); // Wait configured minutes

  // Schedule countdown notifications using notification manager
  notificationManager.scheduleCountdownNotifications(
    chatId,
    gameStartMinutes,
    async (message: string) => {
      const gameCheck = getCurrentGame(chatId);
      if (gameCheck && gameCheck.state === 'WAITING') {
        try {
          await bot.telegram.sendMessage(gameCheck.chatId, message);
        } catch (error) {
          logger.error('Failed to send countdown notification:', error);
        }
      }
    }
  );
});

// Command: /join  
bot.command('join', async (ctx): Promise<any> => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat.id.toString();
  
  // Debug logging
  logger.info(`JOIN DEBUG: User ${username} (${userId}) trying to join in chat ${chatId}`);
  logger.info(`JOIN DEBUG: Group enabled? ${groupManager.isGroupEnabled(chatId)}`);
  
  // Check if this group is configured and enabled
  if (!groupManager.isGroupEnabled(chatId)) {
    logger.info(`JOIN DEBUG: Group ${chatId} not enabled`);
    return ctx.reply(
      `❌ Bot not configured for this group!\n\n` +
      `An admin needs to run /addgroup here first.`
    );
  }
  
  const currentGame = getCurrentGame(chatId);
  logger.info(`JOIN DEBUG: Current game found? ${currentGame ? 'YES' : 'NO'}`);
  if (currentGame) {
    logger.info(`JOIN DEBUG: Game state: ${currentGame.state}, Players: ${currentGame.players.size}`);
  }
  
  if (!currentGame) {
    logger.info(`JOIN DEBUG: No game in chat ${chatId}`);
    return ctx.reply(
      `🎮 No active game found in this group!\n\n` +
      `Use /create to start a new Survival Lottery.`
    );
  }
  
  if (currentGame.state === 'PAUSED') {
    return ctx.reply(
      `⏸️ Game is currently paused!\n\n` +
      `🎲 Game ID: ${currentGame.gameId}\n` +
      `Players cannot join or leave while paused.\n` +
      `Wait for an admin to resume the game with /resumelottery`
    );
  }
  
  if (currentGame.state !== 'WAITING') {
    return ctx.reply(
      `🎮 Game already in progress!\n\n` +
      `Current state: ${currentGame.state}\n` +
      `Wait for this game to finish and create a new one.`
    );
  }
  
  if (currentGame.players.has(userId.toString())) {
    return ctx.reply(
      `✅ You're already in the game!\n\n` +
      `Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n` +
      `Waiting for more players or auto-start...`
    );
  }
  
  if (currentGame.players.size >= currentGame.maxPlayers) {
    return ctx.reply(
      `🎮 Game is full!\n\n` +
      `Maximum ${currentGame.maxPlayers} players allowed.\n` +
      `Wait for the next game.`
    );
  }
  
  currentGame.players.set(userId.toString(), {
    id: userId.toString(),
    username,
    joinedAt: new Date()
  });
  
  // Record player entry for leaderboard
  leaderboard.recordPlayerEntry(userId.toString(), username);
  
  await ctx.reply(
    `✅ You joined the Survival Lottery!\n\n` +
    `🎲 Game ID: ${currentGame.id}\n` +
    `👥 Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n` +
    `🔢 Number range will be: 1-${Math.floor(currentGame.players.size * currentGame.selectionMultiplier)}\n` +
    `⏰ Auto-start in ${currentGame.startMinutes} minutes or when full!\n\n` +
    `Waiting for more players...`
  );
  
  // Skip individual player notifications to avoid 403 errors
  // Players can see join notifications in the main chat instead
  
  // Use notification manager for rate-limited join announcements
  const gameRef = getCurrentGame(chatId);
  if (gameRef) {
    try {
      const announcement = await notificationManager.bufferPlayerJoin(
        chatId,
        username,
        gameRef.players.size,
        gameRef.maxPlayers
      );
      
      if (announcement) {
        await bot.telegram.sendMessage(gameRef.chatId, announcement);
      }
    } catch (error) {
      logger.error(`Failed to send buffered join notification:`, error);
      // Fallback to simple notification
      try {
        await bot.telegram.sendMessage(
          gameRef.chatId,
          `🎮 ${username} joined the lottery! ${gameRef.players.size}/${gameRef.maxPlayers} players`
        );
      } catch (fallbackError) {
        logger.error(`Failed to send fallback join notification:`, fallbackError);
      }
    }
  }
  
  // Check if game is full and start immediately
  const newGameRef = getCurrentGame(chatId);
  if (newGameRef && newGameRef.players.size >= newGameRef.maxPlayers) {
    setTimeout(() => {
      const gameCheck = getCurrentGame(chatId);
      if (gameCheck && gameCheck.state === 'WAITING') {
        startGame(chatId);
      }
    }, 5000); // Start in 5 seconds when full
  }
});

// Command: /status (replaces /games)
bot.command('status', async (ctx): Promise<any> => {
  const chatId = ctx.chat.id.toString();
  
  // Check if this group is configured and enabled
  if (!groupManager.isGroupEnabled(chatId)) {
    return ctx.reply(
      `❌ Bot not configured for this group!\n\n` +
      `An admin needs to run /addgroup here first.`
    );
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply(
      `🎮 No active game in this group\n\n` +
      `Use /create to start a new Survival Lottery!`
    );
  }
  
  let statusMessage = `🎲 Current Game Status\n\n`;
  statusMessage += `🆔 Game ID: ${currentGame.gameId}\n`;
  statusMessage += `📊 State: ${currentGame.state}\n`;
  statusMessage += `👥 Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n`;
  
  // Show pause information if game is paused
  if (currentGame.state === 'PAUSED') {
    statusMessage += `⏸️ Previous State: ${currentGame.previousState}\n`;
    if (currentGame.pausedAt) {
      statusMessage += `⏰ Paused: ${currentGame.pausedAt.toLocaleString()}\n`;
    }
    statusMessage += `\n⚠️ **Game is paused!**\n`;
    statusMessage += `Players cannot join or leave while paused.\n`;
    statusMessage += `Waiting for admin to resume with /resumelottery`;
  } else if (currentGame.state === 'WAITING') {
    statusMessage += `🔢 Number range will be: 1-${Math.floor(currentGame.players.size * currentGame.selectionMultiplier)}\n\n`;
    statusMessage += `💬 Use /join to participate!`;
  } else if (currentGame.state === 'NUMBER_SELECTION') {
    statusMessage += `🔢 Number range: 1-${currentGame.numberRange.max}\n`;
    statusMessage += `⏱️ Selection in progress...\n\n`;
    statusMessage += `📱 Check your DMs to select numbers!`;
  } else if (currentGame.state === 'DRAWING') {
    statusMessage += `🎯 Drawing in progress...\n`;
    statusMessage += `👀 Watch for elimination announcements!`;
  } else {
    statusMessage += `🏁 Game finished!`;
  }
  
  // Add action buttons based on game state
  let actionButtons = [];
  
  if (currentGame.state === 'WAITING') {
    actionButtons = [
      [
        { text: '🎮 Join Game', callback_data: `join_${currentGame.gameId}` },
        { text: '🔄 Refresh', callback_data: `status_${currentGame.gameId}` }
      ]
    ];
    
    // Add admin buttons if user is admin
    if (isAdminUser(ctx.from!.id.toString())) {
      actionButtons.push([
        { text: '🚀 Force Start', callback_data: `forcestart_${currentGame.gameId}` }
      ]);
    }
  } else {
    actionButtons = [
      [{ text: '🔄 Refresh Status', callback_data: `status_${currentGame.gameId}` }]
    ];
  }
  
  await ctx.reply(statusMessage, {
    reply_markup: { inline_keyboard: actionButtons }
  });
});

// Command: /leaderboard
bot.command('leaderboard', async (ctx): Promise<any> => {
  try {
    const topPlayers = leaderboard.getLeaderboard(15);
    const totalGames = leaderboard.getTotalGames();
    
    if (topPlayers.length === 0) {
      return ctx.reply('🏆 No games played yet!\n\nUse /create to start the first lottery!');
    }
    
    let leaderboardMessage = `🏆 SURVIVAL LOTTERY LEADERBOARD 🏆\n\n`;
    leaderboardMessage += `📊 Total Games Played: ${totalGames}\n\n`;
    
    for (let i = 0; i < topPlayers.length; i++) {
      const player = topPlayers[i];
      const rank = i + 1;
      const winRate = player.gamesEntered > 0 ? (player.gamesWon / player.gamesEntered * 100).toFixed(1) : '0.0';
      
      let medal = '';
      if (rank === 1) medal = '🥇';
      else if (rank === 2) medal = '🥈';
      else if (rank === 3) medal = '🥉';
      else medal = `${rank}.`;
      
      leaderboardMessage += `${medal} ${player.username}\n`;
      leaderboardMessage += `   🏅 Wins: ${player.gamesWon} | 🎮 Games: ${player.gamesEntered} | 📈 Rate: ${winRate}%\n`;
      
      if (player.winningNumbers.length > 0) {
        const lastWinning = player.winningNumbers[player.winningNumbers.length - 1];
        leaderboardMessage += `   🔢 Last Winning #: ${lastWinning}\n`;
      }
      
      leaderboardMessage += `\n`;
    }
    
    leaderboardMessage += `💡 Use /stats to see your personal statistics!`;
    
    await ctx.reply(leaderboardMessage);
  } catch (error) {
    logger.error('Error in leaderboard command:', error);
    await ctx.reply('❌ Error loading leaderboard. Please try again.');
  }
});

// Command: /stats
bot.command('stats', async (ctx): Promise<any> => {
  try {
    const userId = ctx.from!.id.toString();
    const playerStats = leaderboard.getPlayerStats(userId);
    
    if (!playerStats) {
      return ctx.reply(
        `📊 No statistics found!\n\n` +
        `You haven't played any games yet.\n` +
        `Use /create or /join to start playing!`
      );
    }
    
    const winRate = playerStats.gamesEntered > 0 ? (playerStats.gamesWon / playerStats.gamesEntered * 100).toFixed(1) : '0.0';
    const lastPlayed = playerStats.lastPlayed.toLocaleDateString();
    
    let statsMessage = `📊 PERSONAL STATISTICS 📊\n\n`;
    statsMessage += `👤 Player: ${playerStats.username}\n`;
    statsMessage += `🏅 Total Wins: ${playerStats.gamesWon}\n`;
    statsMessage += `🎮 Games Entered: ${playerStats.gamesEntered}\n`;
    statsMessage += `📈 Win Rate: ${winRate}%\n`;
    statsMessage += `📅 Last Played: ${lastPlayed}\n\n`;
    
    if (playerStats.winningNumbers.length > 0) {
      statsMessage += `🔢 Your Winning Numbers:\n`;
      const recentWinning = playerStats.winningNumbers.slice(-10).reverse();
      for (const num of recentWinning) {
        statsMessage += `   🎯 ${num}\n`;
      }
      
      if (playerStats.winningNumbers.length > 10) {
        statsMessage += `   ... and ${playerStats.winningNumbers.length - 10} more\n`;
      }
    } else {
      statsMessage += `🎯 No wins yet - keep trying!\n`;
    }
    
    // Show ranking
    const allPlayers = leaderboard.getLeaderboard(1000);
    const playerRank = allPlayers.findIndex(p => p.userId === userId) + 1;
    
    if (playerRank > 0) {
      statsMessage += `\n🏆 Your Rank: #${playerRank} of ${allPlayers.length}`;
    }
    
    await ctx.reply(statsMessage);
  } catch (error) {
    logger.error('Error in stats command:', error);
    await ctx.reply('❌ Error loading your statistics. Please try again.');
  }
});

// Start game function
async function startGame(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  // Generate prize amount using VRF (10k-50k)
  const prizeGeneration = prizeManager.generatePrize(currentGame.gameId);
  const totalPrize = prizeGeneration.amount;
  const survivorCount = currentGame.winnerCount;
  const prizePerSurvivor = Math.floor(totalPrize / survivorCount);
  
  // Store prize information in game state
  currentGame.prizeInfo = {
    totalPrize,
    prizePerSurvivor,
    vrfProof: prizeGeneration.vrfProof
  };
  
  // Log the prize
  prizeManager.logPrize({
    gameId: currentGame.gameId,
    prizeAmount: totalPrize,
    totalSurvivors: survivorCount,
    prizePerSurvivor,
    timestamp: new Date(),
    vrfProof: prizeGeneration.vrfProof,
    chatId
  });
  
  // Update number range based on player count and multiplier
  const playerCount = currentGame.players.size;
  currentGame.numberRange = { min: 1, max: Math.floor(playerCount * currentGame.selectionMultiplier) };
  
  currentGame.state = 'DRAWING';
  currentGame.startedAt = new Date();
  
  // Auto-select random numbers for all players using VRF
  const availableNumbers = Array.from({ length: currentGame.numberRange.max }, (_, i) => i + 1);
  
  // Use VRF to shuffle numbers securely
  const shuffledNumbers = [];
  const tempNumbers = [...availableNumbers];
  while (tempNumbers.length > 0) {
    const randomResult = VRF.generateRandomNumber(0, tempNumbers.length - 1, `shuffle_${currentGame.gameId}_${shuffledNumbers.length}`);
    shuffledNumbers.push(tempNumbers.splice(randomResult.number, 1)[0]);
  }
  
  // Assign numbers to players
  let numberIndex = 0;
  for (const [playerId, playerData] of currentGame.players) {
    const assignedNumber = shuffledNumbers[numberIndex % shuffledNumbers.length];
    currentGame.numberSelections.set(playerId, new Set([assignedNumber]));
    numberIndex++;
  }
  
  // Announce to main chat with auto-selected numbers
  try {
    let selectionMessage = `🎲 GAME STARTED! Numbers Auto-Selected! 🎲\n\n`;
    selectionMessage += `🆔 Game: ${currentGame.gameId}\n`;
    selectionMessage += `👥 Players: ${playerCount}\n`;
    selectionMessage += `🔢 Range: 1-${currentGame.numberRange.max}\n`;
    selectionMessage += `💰 **Prize Pool: ${totalPrize.toLocaleString()}** (split equally among final survivors)\n\n`;
    selectionMessage += `📋 **Player Numbers:**\n`;
    
    for (const [playerId, playerData] of currentGame.players) {
      const playerNumbers = Array.from(currentGame.numberSelections.get(playerId) || new Set());
      selectionMessage += `• ${playerData.username}: ${playerNumbers.join(', ')}\n`;
    }
    
    selectionMessage += `\n🎯 Drawing numbers now...`;
    
    await bot.telegram.sendMessage(currentGame.chatId, selectionMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error(`Failed to announce auto-selections:`, error);
  }
  
  // Start drawing immediately after a short delay
  setTimeout(() => {
    const gameCheck = getCurrentGame(chatId);
    if (gameCheck && gameCheck.state === 'DRAWING') {
      startDrawing(chatId);
    }
  }, 3000); // 3 second delay to show selections
}

// Duplicate callback handler removed and merged above

// Send join phase countdown warnings
async function sendJoinWarning(chatId: string, minutesLeft: number) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  let timeText = '';
  if (minutesLeft >= 1) {
    timeText = `${minutesLeft} MINUTE${minutesLeft > 1 ? 'S' : ''}`;
  } else {
    timeText = '30 SECONDS';
  }
  
  try {
    await bot.telegram.sendMessage(
      currentGame.chatId,
      `⚠️ GAME STARTING IN ${timeText}! ⚠️\n\n` +
      `🎲 Survival Lottery ${currentGame.gameId}\n` +
      `👥 Current players: ${currentGame.players.size}/${currentGame.maxPlayers}\n` +
      `🔢 Number range will be: 1-${Math.floor(currentGame.players.size * currentGame.selectionMultiplier)}\n\n` +
      `💬 Last chance to /join!`
    );
  } catch (error) {
    logger.error(`Failed to send ${timeText} warning:`, error);
  }
}

// Function removed - no longer needed with auto-selection

// Send periodic game status updates
async function sendPeriodicStatus(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  try {
    // Calculate time remaining more accurately
    const elapsedMs = Date.now() - currentGame.createdAt.getTime();
    const totalGameMs = currentGame.startMinutes * 60000;
    const remainingMs = Math.max(0, totalGameMs - elapsedMs);
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    
    const statusMessage = `🎰 **Survival Lottery Status**\n\n` +
      `🎲 Game ID: ${currentGame.gameId}\n` +
      `⏰ **Starts in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}**\n` +
      `👥 Players: **${currentGame.players.size}/${currentGame.maxPlayers}**\n` +
      `🎯 Survivors: ${currentGame.winnerCount}\n\n` +
      `💬 Join now to participate!`;
    
    await bot.telegram.sendMessage(
      currentGame.chatId,
      statusMessage,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎮 Join Game', callback_data: `join_${currentGame.gameId}` }
            ]
          ]
        }
      }
    );
  } catch (error) {
    logger.error(`Failed to send periodic status:`, error);
  }
}

// Announce all selections before drawing
async function announceSelections(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'NUMBER_SELECTION') return;
  
  // Auto-select for players who haven't selected
  const playersWithoutNumbers: string[] = [];
  for (const [playerId] of currentGame.players) {
    if (!currentGame.numberSelections.has(playerId) || currentGame.numberSelections.get(playerId)!.size === 0) {
      playersWithoutNumbers.push(playerId);
    }
  }
  
  // Auto-select random numbers
  const usedNumbers = new Set<number>();
  for (const nums of currentGame.numberSelections.values()) {
    for (const num of nums) {
      usedNumbers.add(num);
    }
  }
  
  const availableNumbers = [];
  for (let i = currentGame.numberRange.min; i <= currentGame.numberRange.max; i++) {
    if (!usedNumbers.has(i)) {
      availableNumbers.push(i);
    }
  }
  
  for (const playerId of playersWithoutNumbers) {
    if (availableNumbers.length > 0) {
      const randomResult = VRF.generateRandomNumber(0, availableNumbers.length - 1, `autoselect_${currentGame.gameId}_${playerId}`);
      const number = availableNumbers[randomResult.number];
      currentGame.numberSelections.set(playerId, new Set([number]));
      availableNumbers.splice(randomResult.number, 1);
      usedNumbers.add(number);
    }
  }
  
  // Create selection announcement
  let selectionMessage = `📊 NUMBER SELECTIONS REVEALED!\n\n`;
  selectionMessage += `🎲 Survival Lottery ${currentGame.gameId}\n`;
  selectionMessage += `🔢 Range: 1-${currentGame.numberRange.max}\n\n`;
  
  const selections: Array<{player: string, number: number}> = [];
  for (const [playerId, numbers] of currentGame.numberSelections) {
    const player = currentGame.players.get(playerId);
    if (player && numbers.size > 0) {
      const number = Array.from(numbers)[0] as number;
      selections.push({ player: player.username, number });
    }
  }
  
  // Sort by number for clear display
  selections.sort((a, b) => a.number - b.number);
  
  for (const selection of selections) {
    selectionMessage += `🔹 ${selection.player}: ${selection.number}\n`;
  }
  
  selectionMessage += `\n🎯 Strategy: Avoid having your number drawn!\n`;
  selectionMessage += `⚡ Drawing begins in 5 seconds...`;
  
  try {
    await bot.telegram.sendMessage(currentGame.chatId, selectionMessage, { parse_mode: 'HTML' });
  } catch (error) {
    logger.error(`Failed to announce selections:`, error);
  }
  
  // Start drawing after 5-second delay
  setTimeout(() => {
    startDrawing(chatId);
  }, 5000);
}

// Start drawing phase
async function startDrawing(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || (currentGame.state !== 'NUMBER_SELECTION' && currentGame.state !== 'DRAWING')) return;
  
  currentGame.state = 'DRAWING';
  
  // Add debug logging
  logger.info(`DRAWING DEBUG: Starting draw for game ${currentGame.gameId} in chat ${chatId}`);
  
  // Initialize drawing pool and tracking
  let availableNumbers = [];
  for (let i = currentGame.numberRange.min; i <= currentGame.numberRange.max; i++) {
    availableNumbers.push(i);
  }
  
  let activePlayers = new Set(currentGame.players.keys());
  let drawNumber = 1;
  
  // Announce drawing starts
  try {
    await bot.telegram.sendMessage(
      currentGame.chatId,
      `🎯 ELIMINATION DRAW BEGINS!\n\n` +
      `🎲 Survival Lottery ${currentGame.gameId}\n` +
      `🔢 Drawing Pool: ${availableNumbers.length} numbers (1-${currentGame.numberRange.max})\n` +
      `👥 Active Players: ${activePlayers.size}\n` +
      `🏆 Goal: Be the last survivor!\n\n` +
      `Drawing starts in 3 seconds...`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    logger.error(`Failed to announce drawing start:`, error);
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  logger.info(`DRAWING DEBUG: Starting drawing loop. Active players: ${activePlayers.size}, Available numbers: ${availableNumbers.length}`);
  
  while (activePlayers.size > 1 && availableNumbers.length > 0) {
    logger.info(`DRAWING DEBUG: Loop iteration - Active: ${activePlayers.size}, Numbers: ${availableNumbers.length}`);
    // Generate VRF number from remaining pool
    const poolIndex = VRF.generateRandomNumber(
      0,
      availableNumbers.length - 1,
      `${currentGame.gameId}_${drawNumber}_${Date.now()}`
    );
    
    const drawnNumber = availableNumbers[poolIndex.number];
    
    // Remove drawn number from pool
    availableNumbers.splice(poolIndex.number, 1);
    
    // Find eliminated players
    const eliminatedPlayers = [];
    for (const [playerId, selectedNumbers] of currentGame.numberSelections) {
      if (activePlayers.has(playerId) && selectedNumbers.has(drawnNumber)) {
        eliminatedPlayers.push(currentGame.players.get(playerId));
        activePlayers.delete(playerId);
      }
    }
    
    // Create dramatic announcement with survivor details
    let message = `🎲 DRAW #${drawNumber}\n\n`;
    message += `🎯 Number Drawn: ${drawnNumber}\n`;
    
    if (eliminatedPlayers.length > 0) {
      const eliminatedList = eliminatedPlayers.map(p => p!.username).join(', ');
      message += `💀 ELIMINATED: ${eliminatedList}\n`;
    } else {
      message += `✅ Safe! No players eliminated.\n`;
    }
    
    message += `\n👥 Survivors: ${activePlayers.size}\n`;
    message += `🔢 Pool Size: ${availableNumbers.length} numbers remaining\n`;
    
    // Show remaining contestants and their numbers
    if (activePlayers.size > 1 && activePlayers.size <= 10) {
      message += `\n🛡️ REMAINING CONTESTANTS:\n`;
      const remainingSurvivors: Array<{player: string, number: number}> = [];
      
      for (const [playerId, selectedNumbers] of currentGame.numberSelections) {
        if (activePlayers.has(playerId)) {
          const player = currentGame.players.get(playerId);
          const playerNumber = Array.from(selectedNumbers)[0] as number;
          if (player) {
            remainingSurvivors.push({ player: player.username, number: playerNumber });
          }
        }
      }
      
      // Sort by number for clear display
      remainingSurvivors.sort((a, b) => a.number - b.number);
      
      for (const survivor of remainingSurvivors) {
        message += `🔹 ${survivor.player}: ${survivor.number}\n`;
      }
    }
    
    // Add VRF proof for transparency
    message += `\n🔐 VRF Proof: ${poolIndex.vrf.proof.substring(0, 16)}...`;
    
    try {
      await bot.telegram.sendMessage(currentGame.chatId, message);
    } catch (error) {
      logger.error(`Failed to send draw result to main chat:`, error);
    }
    
    drawNumber++;
    
    // Check win condition - stop when we reach target survivor count
    if (activePlayers.size <= currentGame.winnerCount) {
      break;
    }
    
    // Wait between draws for suspense (10 seconds)
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Status update every 5 draws
    if (drawNumber % 5 === 0 && activePlayers.size > 1) {
      // Find which players still have safe numbers
      const remainingNumbers = new Set(availableNumbers);
      const stillSafePlayers: Array<{player: string, number: number}> = [];
      
      for (const [playerId, selectedNumbers] of currentGame.numberSelections) {
        if (activePlayers.has(playerId)) {
          const playerNumber = Array.from(selectedNumbers)[0] as number;
          if (remainingNumbers.has(playerNumber)) {
            const player = currentGame.players.get(playerId);
            if (player) {
              stillSafePlayers.push({ player: player.username, number: playerNumber });
            }
          }
        }
      }
      
      // Sort by number for clear display
      stillSafePlayers.sort((a, b) => a.number - b.number);
      
      let statusMessage = `📊 STATUS UPDATE (After ${drawNumber - 1} draws)\n\n`;
      statusMessage += `👥 Survivors: ${activePlayers.size}\n`;
      statusMessage += `🔢 Numbers remaining in pool: ${availableNumbers.length}\n\n`;
      statusMessage += `🛡️ Players with safe numbers:\n`;
      
      for (const safe of stillSafePlayers) {
        statusMessage += `🔹 ${safe.player}: ${safe.number}\n`;
      }
      
      statusMessage += `\n⚡ Drawing continues...`;
      
      try {
        await bot.telegram.sendMessage(currentGame.chatId, statusMessage);
      } catch (error) {
        logger.error(`Failed to send status update:`, error);
      }
      
      // Extra pause after status update
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Game finished - announce final survivor with delay
  currentGame.state = 'FINISHED';
  currentGame.endedAt = new Date();
  
  // Clean up notification buffers
  notificationManager.cleanup(chatId);
  
  // 5-second delay before winner announcement
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Record game completion and winners for leaderboard
  const gameRecord: GameRecord = {
    gameId: currentGame.gameId,
    timestamp: new Date(),
    playerCount: currentGame.players.size,
    winners: [],
    duration: Date.now() - currentGame.createdAt.getTime(),
    settings: {
      maxPlayers: currentGame.maxPlayers,
      startMinutes: currentGame.startMinutes,
      survivors: currentGame.winnerCount,
      selectionMultiplier: currentGame.selectionMultiplier
    }
  };

  let finalMessage;
  
  if (activePlayers.size >= 1 && activePlayers.size <= currentGame.winnerCount) {
    const survivors = Array.from(activePlayers).map(id => currentGame.players.get(id)!);
    
    // Calculate prize per winner based on ACTUAL survivors, not planned survivors
    const totalPrize = currentGame.prizeInfo ? currentGame.prizeInfo.totalPrize : 0;
    const actualSurvivors = survivors.length;
    const prizePerWinner = actualSurvivors > 0 ? Math.floor(totalPrize / actualSurvivors) : 0;
    
    // Record winners in leaderboard and prize logs
    const winnerLogs = [];
    for (const survivor of survivors) {
      const survivorNumber = Array.from(currentGame.numberSelections.get(survivor.id) || [])[0] as number;
      leaderboard.recordWin(survivor.id, survivor.username, survivorNumber);
      gameRecord.winners.push(survivor.id);
      
      // Add to winner logs
      winnerLogs.push({
        gameId: currentGame.gameId,
        userId: survivor.id,
        username: survivor.username,
        prizeAmount: prizePerWinner,
        timestamp: new Date(),
        chatId
      });
    }
    
    // Log all winners
    if (winnerLogs.length > 0) {
      prizeManager.logWinners(winnerLogs);
    }
    
    if (survivors.length === 1) {
      const survivor = survivors[0];
      const survivorNumber = Array.from(currentGame.numberSelections.get(survivor.id) || [])[0] as number;
      
      finalMessage = `🏆 FINAL SURVIVOR! 🏆\n\n`;
      finalMessage += `🎲 Survival Lottery ${currentGame.gameId} - COMPLETE\n\n`;
      finalMessage += `👑 WINNER: ${survivor.username}\n`;
      finalMessage += `🔢 Winning Number: ${survivorNumber}\n`;
      finalMessage += `💰 PRIZE WON: ${prizePerWinner.toLocaleString()}\n`;
      finalMessage += `💯 Elimination Rounds: ${drawNumber - 1}\n`;
      finalMessage += `📊 Started with ${currentGame.players.size} players\n\n`;
      finalMessage += `🎉 Congratulations on your survival strategy!\n`;
      finalMessage += `🏅 You outlasted ${currentGame.players.size - 1} other players!`;
    } else {
      const survivorList = survivors.map(s => s.username).join(', ');
      
      finalMessage = `🏆 MULTIPLE SURVIVORS! 🏆\n\n`;
      finalMessage += `🎲 Survival Lottery ${currentGame.gameId} - COMPLETE\n\n`;
      finalMessage += `👑 WINNERS: ${survivorList}\n`;
      finalMessage += `💰 PRIZE PER WINNER: ${prizePerWinner.toLocaleString()}\n`;
      finalMessage += `📊 ${survivors.length} players survived!\n`;
      finalMessage += `💯 Elimination Rounds: ${drawNumber - 1}\n`;
      finalMessage += `📊 Started with ${currentGame.players.size} players\n\n`;
      finalMessage += `🎉 Congratulations to all survivors!`;
    }
  } else if (activePlayers.size === 0) {
    finalMessage = `😱 UNPRECEDENTED OUTCOME! 😱\n\n`;
    finalMessage += `🎲 Survival Lottery ${currentGame.gameId} - COMPLETE\n\n`;
    finalMessage += `💀 All players eliminated!\n`;
    finalMessage += `🎯 No survivors remain!\n`;
    finalMessage += `📊 Total draws: ${drawNumber - 1}\n\n`;
    finalMessage += `🤯 This is extremely rare! Everyone chose an unlucky number!`;
  } else {
    // Fallback message
    finalMessage = `🎲 Survival Lottery ${currentGame.gameId} - COMPLETE\n\nGame ended unexpectedly.`;
  }
  
  // Record game in history
  leaderboard.recordGame(gameRecord);
  
  try {
    await bot.telegram.sendMessage(currentGame.chatId, finalMessage);
  } catch (error) {
    logger.error(`Failed to send final results to main chat:`, error);
  }
  
  // All results are shown in the main chat - no individual messages needed
  
  // Mark game as finished
  currentGame.state = 'FINISHED';
  currentGame.endedAt = new Date();
}

// Handle errors
bot.catch((err: any, ctx) => {
  logger.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('An error occurred. Please try again later.');
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Start bot with IPv4 connection fix
async function startBot() {
  try {
    logger.info('🔧 Testing bot connection with IPv4...');
    
    // Initialize bot wallet first
    await botWalletManager.initializeWallet();
    
    // Test the connection
    const me = await bot.telegram.getMe();
    logger.info('✅ Bot connection successful:', me.username);
    
    await bot.launch();
    
    logger.info('🎰 Lottery bot is running!');
    console.log('✅ Bot started successfully!');
    console.log('🎮 Bot username: @' + me.username);
    console.log('📱 Ready to create lottery games!');
    console.log('🔗 Connection issue resolved with IPv4 forcing');
    console.log('👛 Bot wallet initialized:', botWalletManager.getPublicKey());
    
  } catch (error: any) {
    logger.error('Failed to start bot:', error.message);
    console.error('❌ Bot startup failed - check bot token and network');
    process.exit(1);
  }
}

startBot();