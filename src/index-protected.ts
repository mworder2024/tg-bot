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
import { TelegramApiWrapper } from './utils/telegram-api-wrapper';
import { rateLimitManager } from './utils/rate-limit-manager';
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
const gameStates: Map<string, any> = gamePersistence.loadGamesSync();

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

// Create Telegram API wrapper
const telegramApi = new TelegramApiWrapper(bot);

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

// Start game function
async function startGame(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  // Check minimum players
  if (currentGame.players.size < 2) {
    await telegramApi.sendMessage(chatId, 
      `❌ Not enough players! Need at least 2.\nGame cancelled.`,
      { parse_mode: 'Markdown' }
    );
    currentGame.state = 'FINISHED';
    return;
  }
  
  // Generate prize
  const playerCount = currentGame.players.size;
  const { amount: prizeAmount, vrfProof } = prizeManager.generatePrize(currentGame.gameId, playerCount);
  currentGame.totalPrize = prizeAmount;
  
  await telegramApi.sendMessage(chatId,
    `🎯 *GAME STARTING!*\n\n` +
    `👥 *${currentGame.players.size} players*\n` +
    `💰 *Total Prize: ${prizeAmount.toLocaleString()} MWOR*\n` +
    `🎲 Numbers: 1-${currentGame.maxNumber}\n\n` +
    `⏰ You have 60 seconds to select your numbers!`,
    { parse_mode: 'Markdown' }
  );
  
  currentGame.state = 'NUMBER_SELECTION';
  currentGame.selectionDeadline = Date.now() + 60000; // 60 seconds
  
  // Set timeout for number selection
  setTimeout(() => {
    const game = getCurrentGame(chatId);
    if (game && game.state === 'NUMBER_SELECTION') {
      startDrawing(chatId);
    }
  }, 60000);
}

// Start drawing function
async function startDrawing(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'NUMBER_SELECTION') return;
  
  currentGame.state = 'DRAWING';
  
  // Auto-select for players who haven't selected
  currentGame.players.forEach((player: any) => {
    if (!player.selectedNumber) {
      player.selectedNumber = Math.floor(Math.random() * currentGame.maxNumber) + 1;
      player.autoSelected = true;
    }
  });
  
  await telegramApi.sendMessage(chatId,
    `🎲 *NUMBER SELECTION CLOSED!*\n\n` +
    `Starting elimination rounds...`,
    { parse_mode: 'Markdown' }
  );
  
  // Start rounds after a short delay
  setTimeout(() => processRound(chatId), 3000);
}

// Process elimination round
async function processRound(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'DRAWING') return;
  
  const activePlayers = Array.from(currentGame.players.values())
    .filter((p: any) => p.isActive);
  
  if (activePlayers.length <= currentGame.survivors) {
    // Game over - we have winners
    currentGame.state = 'FINISHED';
    const prizePerWinner = Math.floor(currentGame.totalPrize / activePlayers.length);
    
    let winnerMessage = `🏆 *GAME OVER!*\n\n`;
    winnerMessage += `*WINNERS:*\n`;
    
    activePlayers.forEach((winner: any) => {
      winnerMessage += `👑 @${winner.username} - ${prizePerWinner.toLocaleString()} MWOR\n`;
      leaderboard.recordWin(winner.userId, winner.username, prizePerWinner);
    });
    
    await telegramApi.sendMessage(chatId, winnerMessage, { parse_mode: 'Markdown' });
    
    // Clear game state
    gameStates.delete(chatId);
    return;
  }
  
  // Draw number
  currentGame.currentRound++;
  const drawnNumber = VRF.generateRandomNumber(1, currentGame.maxNumber, 
    `${currentGame.gameId}_round_${currentGame.currentRound}`
  ).number;
  
  currentGame.drawnNumbers.push(drawnNumber);
  
  // Eliminate players
  let eliminatedCount = 0;
  const eliminated: any[] = [];
  
  currentGame.players.forEach((player: any) => {
    if (player.isActive && player.selectedNumber === drawnNumber) {
      player.isActive = false;
      player.eliminatedRound = currentGame.currentRound;
      eliminatedCount++;
      eliminated.push(player);
    }
  });
  
  // Create round message
  let roundMessage = `🎲 *ROUND ${currentGame.currentRound}*\n\n`;
  roundMessage += `🔢 Drawn Number: *${drawnNumber}*\n\n`;
  
  if (eliminatedCount > 0) {
    roundMessage += `💀 *ELIMINATED:*\n`;
    eliminated.forEach(player => {
      roundMessage += `❌ @${player.username} (${player.selectedNumber})\n`;
    });
  } else {
    roundMessage += `✅ No one eliminated!\n`;
  }
  
  const remainingPlayers = Array.from(currentGame.players.values())
    .filter((p: any) => p.isActive).length;
  
  roundMessage += `\n👥 Remaining: ${remainingPlayers} players`;
  
  await telegramApi.sendMessage(chatId, roundMessage, { parse_mode: 'Markdown' });
  
  // Continue to next round after delay
  setTimeout(() => processRound(chatId), 5000);
}

// Initialize group manager with defaults
const defaultAdminId = process.env.DEFAULT_ADMIN_ID;
const defaultChatId = process.env.DEFAULT_CHAT_ID;
if (defaultAdminId && defaultChatId) {
  groupManager.initialize(defaultAdminId, defaultChatId, 'Default Group');
}

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

// Command: /ratelimit (admin only) - Check rate limit status
bot.command('ratelimit', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }
  
  const status = rateLimitManager.getStatus();
  
  const statusMessage = `📊 **Rate Limit Status**\n\n` +
    `📬 Queue Size: ${status.queueSize} messages\n` +
    `🚦 Circuit Breaker: ${status.circuitBreakerOpen ? '🔴 OPEN' : '🟢 CLOSED'}\n` +
    `⏱️ Rate Limited Chats: ${status.rateLimitedChats}\n` +
    `📈 Messages/Minute: ${status.messagesInLastMinute}\n\n` +
    `Use /clearratelimit to reset all limits (use with caution!)`;
  
  await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
});

// Command: /clearratelimit (admin only) - Clear rate limits
bot.command('clearratelimit', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }
  
  const chatId = ctx.chat.id.toString();
  rateLimitManager.clearRateLimit(chatId);
  
  await ctx.reply('✅ Rate limits cleared for this chat.');
});

// Update the join command to use the new API wrapper
bot.command('join', async (ctx): Promise<any> => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
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
      `🎮 No active game found in this group!\n\n` +
      `Use /create to start a new Survival Lottery.`
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
  
  // Use notification manager for rate-limited join announcements
  const gameRef = getCurrentGame(chatId);
  if (gameRef) {
    const announcement = await notificationManager.bufferPlayerJoin(
      chatId,
      username,
      gameRef.players.size,
      gameRef.maxPlayers
    );
    
    if (announcement) {
      // Use the rate-limited API wrapper
      await telegramApi.sendLowPriorityMessage(gameRef.chatId, announcement);
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

// Update other commands to use the API wrapper...
// For brevity, I'll show the pattern for key functions

// Send join phase countdown warnings with rate limiting
async function sendJoinWarning(chatId: string, minutesLeft: number) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  let timeText = '';
  if (minutesLeft >= 1) {
    timeText = `${minutesLeft} MINUTE${minutesLeft > 1 ? 'S' : ''}`;
  } else {
    timeText = '30 SECONDS';
  }
  
  const message = `⚠️ GAME STARTING IN ${timeText}! ⚠️\n\n` +
    `🎲 Survival Lottery ${currentGame.gameId}\n` +
    `👥 Current players: ${currentGame.players.size}/${currentGame.maxPlayers}\n` +
    `🔢 Number range will be: 1-${Math.floor(currentGame.players.size * currentGame.selectionMultiplier)}\n\n` +
    `💬 Last chance to /join!`;
  
  // Use rate-limited API wrapper with high priority
  await telegramApi.sendHighPriorityMessage(currentGame.chatId, message);
}

// Update drawing announcements with rate limiting
async function announceDrawResult(chatId: string, message: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) return;
  
  // Draw results are high priority
  await telegramApi.sendHighPriorityMessage(currentGame.chatId, message);
}

// Monitor rate limit status periodically
setInterval(() => {
  const status = rateLimitManager.getStatus();
  
  if (status.circuitBreakerOpen) {
    logger.error('Circuit breaker is OPEN - all sending paused');
  }
  
  if (status.queueSize > 50) {
    logger.warn(`Large message queue detected: ${status.queueSize} messages pending`);
  }
  
  if (status.rateLimitedChats > 0) {
    logger.info(`Currently rate limited in ${status.rateLimitedChats} chats`);
  }
}, 30000); // Check every 30 seconds

// Handle errors with better recovery
bot.catch((err: any, ctx) => {
  const error = err?.response?.description || err?.message || 'Unknown error';
  logger.error(`Error for ${ctx.updateType}:`, error);
  
  // Don't try to reply if we're rate limited
  const chatId = ctx.chat?.id?.toString();
  if (chatId && !rateLimitManager.isRateLimited(chatId)) {
    ctx.reply('An error occurred. Please try again later.').catch(() => {
      // Ignore reply errors
    });
  }
});

// Export key functions
export { bot, telegramApi, getCurrentGame, setCurrentGame };

// The rest of the bot code remains the same...
// Copy remaining functions from the original index.ts