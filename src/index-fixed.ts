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
import { botWalletManager } from './utils/wallet-manager';
import { callbackManager } from './utils/callback-manager';
import { initializeSafeAPI, getSafeAPI } from './utils/safe-telegram-api';
import { safeNotificationManager } from './utils/safe-notification-manager';
import {
  handleLeaderboardCommand,
  handleStatsCommand,
  handlePrizeStatsCommand,
  handleWinnerStatsCommand,
  handleStatusCommand
} from './handlers/command-handlers';

// Load environment variables
dotenv.config();

// Force IPv4 DNS resolution
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

// Game states
const gameStates: Map<string, any> = gamePersistence.loadGamesSync();
const gameTimers: Map<string, NodeJS.Timeout[]> = new Map(); // Track active timers

// Create HTTPS agent
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 60000,
  maxSockets: 10,
  maxFreeSockets: 5,
  scheduling: 'fifo'
});

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN!, {
  handlerTimeout: 90000,
  telegram: {
    apiRoot: 'https://api.telegram.org',
    agent: httpsAgent,
    attachmentAgent: httpsAgent,
    webhookReply: false
  }
});

// Initialize safe API
const safeAPI = initializeSafeAPI(bot);

// Helper functions
function getCurrentGame(chatId: string): any {
  return gameStates.get(chatId) || null;
}

function setCurrentGame(chatId: string, game: any): void {
  gameStates.set(chatId, game);
  gamePersistence.saveGames(gameStates);
}

function isAdminUser(userId: string): boolean {
  return groupManager.isAdmin(userId);
}

function isSuperAdminUser(userId: string): boolean {
  const superAdminId = process.env.SUPER_ADMIN_ID;
  return superAdminId && userId === superAdminId;
}

// Clean up game timers
function cleanupGameTimers(chatId: string): void {
  const timers = gameTimers.get(chatId);
  if (timers) {
    timers.forEach(timer => clearTimeout(timer));
    gameTimers.delete(chatId);
  }
}

// Initialize group manager
const defaultAdminId = process.env.DEFAULT_ADMIN_ID;
const defaultChatId = process.env.DEFAULT_CHAT_ID;
if (defaultAdminId && defaultChatId) {
  groupManager.initialize(defaultAdminId, defaultChatId, 'Default Group');
}

// Auto-save interval
const autoSaveInterval = gamePersistence.startAutoSave(gameStates, 10000);

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('🔄 Saving games before exit...');
  gamePersistence.saveGames(gameStates);
  clearInterval(autoSaveInterval);
  // Clean up all timers
  for (const timers of gameTimers.values()) {
    timers.forEach(timer => clearTimeout(timer));
  }
  process.exit(0);
});

// Command: /ratelimit (admin only)
bot.command('ratelimit', async (ctx) => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return safeAPI.replyTo(ctx, '❌ You are not authorized to use this command.');
  }
  
  const status = safeAPI.getStatus();
  const notifStatus = safeNotificationManager.getStatus();
  
  const message = `📊 **System Status**\n\n` +
    `🚦 Rate Limited: ${status.globallyRateLimited ? '🔴 YES' : '🟢 NO'}\n` +
    `📬 Pending Messages: ${status.pendingMessages}\n` +
    `⏱️ Rate Limited Chats: ${status.rateLimitedChats}\n` +
    `🎮 Active Games: ${status.activeGames}\n` +
    `📢 Pending Notifications: ${notifStatus.pendingNotifications}\n\n` +
    `Use /clearratelimit to force clear (emergency only!)`;
  
  await safeAPI.replyTo(ctx, message, { parse_mode: 'Markdown' });
});

// Command: /clearratelimit (admin only)
bot.command('clearratelimit', async (ctx) => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return safeAPI.replyTo(ctx, '❌ You are not authorized to use this command.');
  }
  
  safeAPI.clearAllRateLimits();
  await safeAPI.replyTo(ctx, '✅ All rate limits cleared. Use with caution!');
});

// Command: /create
bot.command('create', async (ctx) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat.id.toString();
  
  if (!groupManager.isGroupEnabled(chatId)) {
    return safeAPI.replyTo(ctx, 
      `❌ Bot not configured for this group!\n\n` +
      `An admin needs to run /addgroup here first.`
    );
  }
  
  const currentGame = getCurrentGame(chatId);
  if (currentGame && currentGame.state !== 'FINISHED') {
    return safeAPI.replyTo(ctx,
      `🎮 A game is already active in this group!\n\n` +
      `Current game has ${currentGame.players.size} players.\n` +
      `Use /join to participate or /status to see details.`
    );
  }
  
  // Clean up any old timers
  cleanupGameTimers(chatId);
  
  // Parse configuration
  const commandText = ctx.message?.text || '';
  const config = parseGameConfig(commandText);
  
  const newGame = {
    id: `${chatId}_${Date.now()}`,
    gameId: Math.random().toString(36).substring(2, 8).toUpperCase(),
    creator: userId,
    players: new Map([[userId.toString(), { id: userId.toString(), username, joinedAt: new Date() }]]),
    state: 'WAITING',
    numberSelections: new Map(),
    createdAt: new Date(),
    maxPlayers: config.maxPlayers,
    numberRange: { min: 1, max: 2 },
    winnerCount: config.survivors,
    selectionMultiplier: config.selectionMultiplier,
    startMinutes: config.startMinutes,
    chatId: parseInt(chatId)
  };
  
  setCurrentGame(chatId, newGame);
  leaderboard.recordPlayerEntry(userId.toString(), username);
  
  // Initialize notifications
  safeNotificationManager.initializeGame(newGame.gameId, chatId);
  
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
  
  const joinKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 Join Game', callback_data: `join_${newGame.gameId}` },
        { text: '📊 Status', callback_data: `status_${newGame.gameId}` }
      ]
    ]
  };
  
  await safeAPI.replyTo(ctx, announceMessage, { 
    parse_mode: 'HTML',
    reply_markup: joinKeyboard
  });
  
  // Schedule game start with proper timer tracking
  const timers: NodeJS.Timeout[] = [];
  const gameStartMs = newGame.startMinutes * 60000;
  
  // Schedule countdown notifications
  const countdownTimes = [
    { minutes: Math.floor(gameStartMs / 60000 / 2), sent: false },
    { minutes: 2, sent: false },
    { minutes: 1, sent: false }
  ];
  
  countdownTimes.forEach(countdown => {
    const timeUntilCountdown = gameStartMs - (countdown.minutes * 60000);
    if (timeUntilCountdown > 0) {
      const timer = setTimeout(async () => {
        const game = getCurrentGame(chatId);
        if (game && game.state === 'WAITING' && !countdown.sent) {
          countdown.sent = true;
          await safeNotificationManager.sendCountdown(
            game.gameId,
            countdown.minutes,
            game.players.size,
            game.maxPlayers
          );
        }
      }, timeUntilCountdown);
      timers.push(timer);
    }
  });
  
  // Auto-start timer
  const startTimer = setTimeout(() => {
    const game = getCurrentGame(chatId);
    if (game && game.state === 'WAITING') {
      startGame(chatId);
    }
  }, gameStartMs);
  timers.push(startTimer);
  
  gameTimers.set(chatId, timers);
});

// Command: /join
bot.command('join', async (ctx) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat.id.toString();
  
  if (!groupManager.isGroupEnabled(chatId)) {
    return safeAPI.replyTo(ctx,
      `❌ Bot not configured for this group!\n\n` +
      `An admin needs to run /addgroup here first.`
    );
  }
  
  const currentGame = getCurrentGame(chatId);
  
  if (!currentGame) {
    return safeAPI.replyTo(ctx,
      `🎮 No active game found in this group!\n\n` +
      `Use /create to start a new Survival Lottery.`
    );
  }
  
  if (currentGame.state !== 'WAITING') {
    return safeAPI.replyTo(ctx,
      `🎮 Game already in progress!\n\n` +
      `Current state: ${currentGame.state}\n` +
      `Wait for this game to finish and create a new one.`
    );
  }
  
  if (currentGame.players.has(userId.toString())) {
    return safeAPI.replyTo(ctx,
      `✅ You're already in the game!\n\n` +
      `Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n` +
      `Waiting for more players or auto-start...`
    );
  }
  
  if (currentGame.players.size >= currentGame.maxPlayers) {
    return safeAPI.replyTo(ctx,
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
  
  leaderboard.recordPlayerEntry(userId.toString(), username);
  
  await safeAPI.replyTo(ctx,
    `✅ You joined the Survival Lottery!\n\n` +
    `🎲 Game ID: ${currentGame.gameId}\n` +
    `👥 Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n` +
    `🔢 Number range will be: 1-${Math.floor(currentGame.players.size * currentGame.selectionMultiplier)}\n` +
    `⏰ Auto-start in ${currentGame.startMinutes} minutes or when full!\n\n` +
    `Waiting for more players...`
  );
  
  // Announce join
  await safeNotificationManager.announcePlayerJoin(
    currentGame.gameId,
    username,
    currentGame.players.size,
    currentGame.maxPlayers
  );
  
  // Check if game is full
  if (currentGame.players.size >= currentGame.maxPlayers) {
    // Clear existing timers
    cleanupGameTimers(chatId);
    
    // Start in 5 seconds
    const quickStartTimer = setTimeout(() => {
      const game = getCurrentGame(chatId);
      if (game && game.state === 'WAITING') {
        startGame(chatId);
      }
    }, 5000);
    
    gameTimers.set(chatId, [quickStartTimer]);
  }
});

// Start game function
async function startGame(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  // Clean up timers
  cleanupGameTimers(chatId);
  
  // Check if we're rate limited before starting
  const apiStatus = safeAPI.getStatus();
  if (apiStatus.globallyRateLimited) {
    logger.warn('Cannot start game - globally rate limited');
    // Schedule retry
    const retryTimer = setTimeout(() => startGame(chatId), 30000);
    gameTimers.set(chatId, [retryTimer]);
    return;
  }
  
  // Generate prize
  const prizeGeneration = prizeManager.generatePrize(currentGame.gameId);
  const totalPrize = prizeGeneration.amount;
  const survivorCount = currentGame.winnerCount;
  const prizePerSurvivor = Math.floor(totalPrize / survivorCount);
  
  currentGame.prizeInfo = {
    totalPrize,
    prizePerSurvivor,
    vrfProof: prizeGeneration.vrfProof
  };
  
  prizeManager.logPrize({
    gameId: currentGame.gameId,
    prizeAmount: totalPrize,
    totalSurvivors: survivorCount,
    prizePerSurvivor,
    timestamp: new Date(),
    vrfProof: prizeGeneration.vrfProof,
    chatId
  });
  
  // Update game state
  const playerCount = currentGame.players.size;
  currentGame.numberRange = { min: 1, max: Math.floor(playerCount * currentGame.selectionMultiplier) };
  currentGame.state = 'DRAWING';
  currentGame.startedAt = new Date();
  
  // Auto-select numbers
  const availableNumbers = Array.from({ length: currentGame.numberRange.max }, (_, i) => i + 1);
  const shuffledNumbers = availableNumbers.sort(() => Math.random() - 0.5);
  
  let numberIndex = 0;
  for (const [playerId, playerData] of currentGame.players) {
    const assignedNumber = shuffledNumbers[numberIndex % shuffledNumbers.length];
    currentGame.numberSelections.set(playerId, new Set([assignedNumber]));
    numberIndex++;
  }
  
  // Announce game start
  await safeNotificationManager.announceGameStarting(
    currentGame.gameId,
    playerCount,
    totalPrize
  );
  
  // Show player numbers
  let selectionMessage = `📋 **Player Numbers:**\n`;
  for (const [playerId, playerData] of currentGame.players) {
    const playerNumbers = Array.from(currentGame.numberSelections.get(playerId) || new Set());
    selectionMessage += `• ${playerData.username}: ${playerNumbers.join(', ')}\n`;
  }
  selectionMessage += `\n🎯 Drawing begins in 5 seconds...`;
  
  await safeAPI.sendMessage(currentGame.chatId, selectionMessage, { parse_mode: 'Markdown' }, 'high');
  
  // Start drawing after delay
  const drawTimer = setTimeout(() => {
    const game = getCurrentGame(chatId);
    if (game && game.state === 'DRAWING') {
      startDrawing(chatId);
    }
  }, 5000);
  
  gameTimers.set(chatId, [drawTimer]);
}

// Drawing function with rate limit awareness
async function startDrawing(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'DRAWING') return;
  
  let availableNumbers = [];
  for (let i = currentGame.numberRange.min; i <= currentGame.numberRange.max; i++) {
    availableNumbers.push(i);
  }
  
  let activePlayers = new Set(currentGame.players.keys());
  let drawNumber = 1;
  let drawDelay = 10000; // Start with 10 second delays
  
  // Drawing loop with rate limit checks
  async function performDraw() {
    // Check if we should continue
    if (activePlayers.size <= currentGame.winnerCount || availableNumbers.length === 0) {
      await finishGame(chatId, activePlayers as Set<string>);
      return;
    }
    
    // Check rate limit status
    const apiStatus = safeAPI.getStatus();
    if (apiStatus.globallyRateLimited) {
      logger.warn('Pausing draws due to rate limit');
      drawDelay = Math.min(drawDelay * 2, 60000); // Increase delay, max 1 minute
      const timer = setTimeout(performDraw, drawDelay);
      const timers = gameTimers.get(chatId) || [];
      timers.push(timer);
      gameTimers.set(chatId, timers);
      return;
    }
    
    // Generate draw
    const poolIndex = VRF.generateRandomNumber(
      0,
      availableNumbers.length - 1,
      `${currentGame.gameId}_${drawNumber}_${Date.now()}`
    );
    
    const drawnNumber = availableNumbers[poolIndex.number];
    availableNumbers.splice(poolIndex.number, 1);
    
    // Find eliminated players
    const eliminatedPlayers = [];
    for (const [playerId, selectedNumbers] of currentGame.numberSelections) {
      if (activePlayers.has(playerId) && selectedNumbers.has(drawnNumber)) {
        eliminatedPlayers.push(currentGame.players.get(playerId)!.username);
        activePlayers.delete(playerId);
      }
    }
    
    // Announce result
    await safeNotificationManager.announceDrawResult(
      currentGame.gameId,
      drawNumber,
      drawnNumber,
      eliminatedPlayers,
      activePlayers.size
    );
    
    drawNumber++;
    
    // Schedule next draw
    const timer = setTimeout(performDraw, drawDelay);
    const timers = gameTimers.get(chatId) || [];
    timers.push(timer);
    gameTimers.set(chatId, timers);
  }
  
  // Start first draw
  performDraw();
}

// Finish game
async function finishGame(chatId: string, activePlayers: Set<string>) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) return;
  
  // Clean up timers
  cleanupGameTimers(chatId);
  
  currentGame.state = 'FINISHED';
  currentGame.endedAt = new Date();
  
  // Calculate winners and prizes
  const totalPrize = currentGame.prizeInfo?.totalPrize || 0;
  const actualSurvivors = activePlayers.size;
  const prizePerWinner = actualSurvivors > 0 ? Math.floor(totalPrize / actualSurvivors) : 0;
  
  const winners = [];
  const winnerLogs = [];
  
  for (const playerId of activePlayers) {
    const player = currentGame.players.get(playerId);
    if (player) {
      const survivorNumber = Array.from(currentGame.numberSelections.get(playerId) || [])[0] as number;
      
      winners.push({
        username: player.username,
        prize: prizePerWinner
      });
      
      // Record in leaderboard
      leaderboard.recordWin(playerId, player.username, survivorNumber);
      
      // Log winner
      winnerLogs.push({
        gameId: currentGame.gameId,
        userId: playerId,
        username: player.username,
        prizeAmount: prizePerWinner,
        timestamp: new Date(),
        chatId
      });
    }
  }
  
  if (winnerLogs.length > 0) {
    prizeManager.logWinners(winnerLogs);
  }
  
  // Record game
  const gameRecord: GameRecord = {
    gameId: currentGame.gameId,
    timestamp: new Date(),
    playerCount: currentGame.players.size,
    winners: Array.from(activePlayers),
    duration: Date.now() - currentGame.createdAt.getTime(),
    settings: {
      maxPlayers: currentGame.maxPlayers,
      startMinutes: currentGame.startMinutes,
      survivors: currentGame.winnerCount,
      selectionMultiplier: currentGame.selectionMultiplier
    }
  };
  
  leaderboard.recordGame(gameRecord);
  
  // Announce winners
  await safeNotificationManager.announceWinners(currentGame.gameId, winners);
  
  // Clean up
  safeNotificationManager.cleanupGame(currentGame.gameId);
}

// Parse game configuration
function parseGameConfig(text: string) {
  const config = {
    maxPlayers: parseInt(process.env.MAX_PLAYERS || '50'),
    startMinutes: 5,
    survivors: 1,
    selectionMultiplier: 2,
    survivorsOverride: false
  };

  const maxMatch = text.match(/(?:--?|—)max\s+(\d+)/i);
  if (maxMatch) {
    config.maxPlayers = Math.min(Math.max(parseInt(maxMatch[1]), 2), 100);
  }

  const startMatch = text.match(/(?:--?|—)start\s+(\d+)/i);
  if (startMatch) {
    config.startMinutes = Math.min(Math.max(parseInt(startMatch[1]), 1), 30);
  }

  const survivorsMatch = text.match(/(?:--?|—)survivors\s+(\d+)/i);
  if (survivorsMatch) {
    config.survivors = Math.max(parseInt(survivorsMatch[1]), 1);
    config.survivorsOverride = true;
  }

  const selectionMatch = text.match(/(?:--?|—)selection\s+(\d+(?:\.\d+)?)/i);
  if (selectionMatch) {
    config.selectionMultiplier = Math.min(Math.max(parseFloat(selectionMatch[1]), 1), 10);
  }

  // Auto-calculate survivors
  if (!config.survivorsOverride) {
    if (config.maxPlayers <= 10) config.survivors = 1;
    else if (config.maxPlayers <= 20) config.survivors = 2;
    else if (config.maxPlayers <= 30) config.survivors = 3;
    else if (config.maxPlayers <= 40) config.survivors = 4;
    else if (config.maxPlayers <= 50) config.survivors = 5;
    else config.survivors = Math.ceil(config.maxPlayers / 10);
  }

  return config;
}

// Other commands remain similar but use safeAPI.replyTo() instead of ctx.reply()
// ... (implement remaining commands)

// Error handler
bot.catch((err: any, ctx) => {
  logger.error(`Error for ${ctx.updateType}:`, err);
  // Don't try to reply - might cause more rate limits
});

// Start bot
async function startBot() {
  try {
    await botWalletManager.initializeWallet();
    
    const me = await bot.telegram.getMe();
    logger.info('✅ Bot connection successful:', me.username);
    
    await bot.launch();
    
    console.log('🎰 Lottery bot is running with rate limit protection!');
    console.log('🛡️ Anti-spam measures active');
    console.log('📊 Monitor with /ratelimit command');
    
  } catch (error: any) {
    logger.error('Failed to start bot:', error.message);
    process.exit(1);
  }
}

startBot();