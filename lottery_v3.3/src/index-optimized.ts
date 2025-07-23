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
import { messageThrottle } from './utils/message-throttle';
import { gameTimerManager } from './utils/game-timer-manager';
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
const gameStates: Map<string, any> = gamePersistence.loadGames();

// Join buffers for combining messages
const joinBuffers: Map<string, { players: string[], timer: NodeJS.Timeout | null }> = new Map();

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
  gameTimerManager.destroy();
  process.exit(0);
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
    if (messageThrottle.shouldSend(chatId, 'game_exists')) {
      return safeAPI.replyTo(ctx,
        `🎮 A game is already active!\n\n` +
        `Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n` +
        `Use /join to participate.`
      );
    }
    return; // Throttled
  }
  
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
  
  // Schedule game with absolute time
  const startTime = gameTimerManager.scheduleGame(
    newGame.gameId,
    chatId,
    config.startMinutes,
    () => startGame(chatId)
  );
  
  newGame.scheduledStartTime = startTime;
  
  setCurrentGame(chatId, newGame);
  leaderboard.recordPlayerEntry(userId.toString(), username);
  
  const survivorText = config.survivorsOverride 
    ? `${config.survivors} (manual)` 
    : `${config.survivors}`;
  
  // Format start time
  const startTimeStr = startTime.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
    
  const announceMessage = 
    `🎰 **Survival Lottery Created!**\n\n` +
    `🎲 Game ID: \`${newGame.gameId}\`\n` +
    `👤 Created by: ${username}\n` +
    `👥 Players: 1/${newGame.maxPlayers}\n` +
    `⏰ **Starts at ${startTimeStr}** (in ${config.startMinutes} minutes)\n\n` +
    `📊 Settings:\n` +
    `• Max Players: ${config.maxPlayers}\n` +
    `• Survivors: ${survivorText}\n` +
    `• Number Range: ${config.selectionMultiplier}x players\n\n` +
    `💬 Use /join to participate!`;
  
  const joinKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 Join Game', callback_data: `join_${newGame.gameId}` },
        { text: '📊 Status', callback_data: `status_${newGame.gameId}` }
      ]
    ]
  };
  
  await safeAPI.replyTo(ctx, announceMessage, { 
    parse_mode: 'Markdown',
    reply_markup: joinKeyboard
  });
  
  // Schedule minimal countdown notifications
  const countdownTimes = [
    Math.floor(config.startMinutes / 2),
    2,
    1
  ].filter(min => min > 0 && min < config.startMinutes);
  
  countdownTimes.forEach(minutes => {
    const delay = (config.startMinutes - minutes) * 60000;
    setTimeout(() => {
      const game = getCurrentGame(chatId);
      if (game && game.state === 'WAITING') {
        sendCountdownNotification(chatId, minutes);
      }
    }, delay);
  });
});

// Command: /join
bot.command('join', async (ctx) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat.id.toString();
  
  if (!groupManager.isGroupEnabled(chatId)) {
    if (messageThrottle.shouldSend(chatId, 'not_configured')) {
      return safeAPI.replyTo(ctx,
        `❌ Bot not configured for this group!`
      );
    }
    return;
  }
  
  const currentGame = getCurrentGame(chatId);
  
  if (!currentGame) {
    if (messageThrottle.shouldSend(chatId, 'no_game')) {
      return safeAPI.replyTo(ctx,
        `🎮 No active game. Use /create to start one.`
      );
    }
    return;
  }
  
  if (currentGame.state !== 'WAITING') {
    if (messageThrottle.shouldSend(chatId, 'game_started')) {
      return safeAPI.replyTo(ctx,
        `🎮 Game already started. Wait for next one.`
      );
    }
    return;
  }
  
  if (currentGame.players.has(userId.toString())) {
    if (messageThrottle.shouldSend(chatId, 'already_joined')) {
      return safeAPI.replyTo(ctx,
        `✅ Already in game! (${currentGame.players.size}/${currentGame.maxPlayers})`
      );
    }
    return;
  }
  
  if (currentGame.players.size >= currentGame.maxPlayers) {
    if (messageThrottle.shouldSend(chatId, 'game_full')) {
      return safeAPI.replyTo(ctx,
        `🎮 Game full! Wait for next one.`
      );
    }
    return;
  }
  
  // Add player
  currentGame.players.set(userId.toString(), {
    id: userId.toString(),
    username,
    joinedAt: new Date()
  });
  
  leaderboard.recordPlayerEntry(userId.toString(), username);
  
  // Personal confirmation (always send)
  await safeAPI.replyTo(ctx,
    `✅ You joined!\n` +
    `Players: ${currentGame.players.size}/${currentGame.maxPlayers}`
  );
  
  // Buffer join announcement
  bufferJoinAnnouncement(chatId, username, currentGame);
  
  // Check if game is full
  if (currentGame.players.size >= currentGame.maxPlayers) {
    // Cancel scheduled start
    gameTimerManager.cancelGame(currentGame.gameId);
    
    // Announce and start in 5 seconds
    await safeAPI.sendMessage(
      currentGame.chatId,
      `🎮 **Game Full! Starting in 5 seconds...**`,
      { parse_mode: 'Markdown' },
      'high'
    );
    
    setTimeout(() => {
      const game = getCurrentGame(chatId);
      if (game && game.state === 'WAITING') {
        startGame(chatId);
      }
    }, 5000);
  }
});

// Buffer join announcements
function bufferJoinAnnouncement(chatId: string, username: string, game: any) {
  let buffer = joinBuffers.get(chatId);
  
  if (!buffer) {
    buffer = { players: [], timer: null };
    joinBuffers.set(chatId, buffer);
  }
  
  buffer.players.push(username);
  
  // Clear existing timer
  if (buffer.timer) {
    clearTimeout(buffer.timer);
  }
  
  // Set new timer for 5 seconds
  buffer.timer = setTimeout(() => {
    flushJoinBuffer(chatId, game);
  }, 5000);
}

// Flush join buffer
async function flushJoinBuffer(chatId: string, game: any) {
  const buffer = joinBuffers.get(chatId);
  if (!buffer || buffer.players.length === 0) return;
  
  const players = buffer.players;
  buffer.players = [];
  buffer.timer = null;
  
  let message: string;
  if (players.length === 1) {
    message = `👤 ${players[0]} joined! (${game.players.size}/${game.maxPlayers})`;
  } else if (players.length === 2) {
    message = `👥 ${players[0]} and ${players[1]} joined! (${game.players.size}/${game.maxPlayers})`;
  } else {
    const last = players.pop();
    message = `👥 ${players.join(', ')} and ${last} joined! (${game.players.size}/${game.maxPlayers})`;
  }
  
  await safeAPI.sendMessage(game.chatId, message, undefined, 'low');
}

// Send countdown notification
async function sendCountdownNotification(chatId: string, minutes: number) {
  const game = getCurrentGame(chatId);
  if (!game || game.state !== 'WAITING') return;
  
  const timeStr = gameTimerManager.getStartTime(game.gameId)?.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  const message = `⏰ Game starts ${minutes === 1 ? 'in 1 minute' : `in ${minutes} minutes`} (at ${timeStr})!\n` +
    `👥 ${game.players.size}/${game.maxPlayers} players`;
  
  await safeAPI.sendMessage(game.chatId, message, undefined, 'normal');
}

// Start game function
async function startGame(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  // Check minimum players
  if (currentGame.players.size < 2) {
    await safeAPI.sendMessage(
      currentGame.chatId,
      `❌ Not enough players! Need at least 2.\nGame cancelled.`,
      undefined,
      'high'
    );
    currentGame.state = 'FINISHED';
    gameTimerManager.cancelGame(currentGame.gameId);
    return;
  }
  
  // Flush any pending join announcements
  const buffer = joinBuffers.get(chatId);
  if (buffer && buffer.timer) {
    clearTimeout(buffer.timer);
    buffer.timer = null;
  }
  joinBuffers.delete(chatId);
  
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
  const playerList = [];
  
  for (const [playerId, playerData] of currentGame.players) {
    const assignedNumber = shuffledNumbers[numberIndex % shuffledNumbers.length];
    currentGame.numberSelections.set(playerId, new Set([assignedNumber]));
    playerList.push({
      name: playerData.username,
      number: assignedNumber
    });
    numberIndex++;
  }
  
  // Sort by number for display
  playerList.sort((a, b) => a.number - b.number);
  
  // Single comprehensive start message
  let startMessage = `🎲 **GAME STARTED!** 🎲\n\n`;
  startMessage += `🆔 Game: ${currentGame.gameId}\n`;
  startMessage += `👥 Players: ${playerCount}\n`;
  startMessage += `💰 Prize Pool: **${totalPrize.toLocaleString()}** tokens\n`;
  startMessage += `🏆 Survivors: ${survivorCount}\n`;
  startMessage += `🔢 Number Range: 1-${currentGame.numberRange.max}\n\n`;
  startMessage += `**Player Numbers:**\n`;
  
  for (const player of playerList) {
    startMessage += `• ${player.name}: **${player.number}**\n`;
  }
  
  startMessage += `\n🎯 Drawing begins in 10 seconds...`;
  
  await safeAPI.sendMessage(currentGame.chatId, startMessage, { parse_mode: 'Markdown' }, 'critical');
  
  // Clean up timer
  gameTimerManager.cancelGame(currentGame.gameId);
  
  // Start drawing after delay
  setTimeout(() => {
    const game = getCurrentGame(chatId);
    if (game && game.state === 'DRAWING') {
      startDrawing(chatId);
    }
  }, 10000);
}

// Drawing function
async function startDrawing(chatId: string) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'DRAWING') return;
  
  let availableNumbers = [];
  for (let i = currentGame.numberRange.min; i <= currentGame.numberRange.max; i++) {
    availableNumbers.push(i);
  }
  
  let activePlayers = new Set(currentGame.players.keys());
  let drawNumber = 1;
  let consecutiveNoEliminations = 0;
  
  // Drawing loop
  async function performDraw() {
    // Check if game should end
    if (activePlayers.size <= currentGame.winnerCount || availableNumbers.length === 0) {
      await finishGame(chatId, activePlayers);
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
    
    // Build draw message
    let message = `🎲 **DRAW #${drawNumber}**\n\n`;
    message += `🎯 Number: **${drawnNumber}**\n`;
    
    if (eliminatedPlayers.length > 0) {
      message += `💀 Eliminated: ${eliminatedPlayers.join(', ')}\n`;
      consecutiveNoEliminations = 0;
    } else {
      message += `✅ No eliminations\n`;
      consecutiveNoEliminations++;
    }
    
    message += `👥 Survivors: ${activePlayers.size}`;
    
    // Add remaining players if 5 or fewer
    if (activePlayers.size <= 5 && activePlayers.size > currentGame.winnerCount) {
      message += '\n\n**Still in:**\n';
      for (const playerId of activePlayers) {
        const player = currentGame.players.get(playerId);
        const number = Array.from(currentGame.numberSelections.get(playerId) || [])[0];
        if (player) {
          message += `• ${player.username} (#${number})\n`;
        }
      }
    }
    
    await safeAPI.sendMessage(currentGame.chatId, message, { parse_mode: 'Markdown' }, 'high');
    
    drawNumber++;
    
    // Dynamic delay based on game state
    let delay = 10000; // Default 10 seconds
    
    if (activePlayers.size <= 5) {
      delay = 15000; // 15 seconds for final players
    } else if (consecutiveNoEliminations >= 3) {
      delay = 5000; // Speed up if no eliminations
    }
    
    // Schedule next draw
    setTimeout(performDraw, delay);
  }
  
  // Start first draw
  performDraw();
}

// Finish game
async function finishGame(chatId: string, activePlayers: Set<string>) {
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) return;
  
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
        number: survivorNumber,
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
  
  // Winner announcement
  let winnerMessage = `🏆 **GAME COMPLETE!** 🏆\n\n`;
  winnerMessage += `🎲 Game: ${currentGame.gameId}\n\n`;
  
  if (winners.length === 0) {
    winnerMessage += `💀 **No survivors!** All eliminated!\n`;
    winnerMessage += `💰 Prize pool returns to treasury`;
  } else if (winners.length === 1) {
    winnerMessage += `👑 **WINNER:** ${winners[0].username}\n`;
    winnerMessage += `🔢 Winning Number: ${winners[0].number}\n`;
    winnerMessage += `💰 **Prize:** ${winners[0].prize.toLocaleString()} tokens`;
  } else {
    winnerMessage += `👑 **WINNERS:**\n`;
    for (const winner of winners) {
      winnerMessage += `• ${winner.username} (#${winner.number}) - ${winner.prize.toLocaleString()}\n`;
    }
  }
  
  winnerMessage += `\n\n🎮 GG! Use /create for a new game.`;
  
  await safeAPI.sendMessage(currentGame.chatId, winnerMessage, { parse_mode: 'Markdown' }, 'critical');
}

// Command: /status
bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const currentGame = getCurrentGame(chatId);
  
  if (!currentGame) {
    return safeAPI.replyTo(ctx, `🎮 No active game. Use /create to start.`);
  }
  
  const timeUntil = gameTimerManager.getFormattedTimeUntil(currentGame.gameId);
  const startTime = gameTimerManager.getStartTime(currentGame.gameId);
  
  let message = `📊 **Game Status**\n\n`;
  message += `🎲 ID: ${currentGame.gameId}\n`;
  message += `📊 State: ${currentGame.state}\n`;
  message += `👥 Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n`;
  
  if (currentGame.state === 'WAITING' && startTime) {
    message += `⏰ Starts: ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (in ${timeUntil})`;
  }
  
  await safeAPI.replyTo(ctx, message, { parse_mode: 'Markdown' });
});

// Command: /forcestart (admin)
bot.command('forcestart', async (ctx) => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return safeAPI.replyTo(ctx, '❌ Admin only command.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return safeAPI.replyTo(ctx, '❌ No game to start.');
  }
  
  if (currentGame.state !== 'WAITING') {
    return safeAPI.replyTo(ctx, `❌ Game already ${currentGame.state}.`);
  }
  
  if (currentGame.players.size < 2) {
    return safeAPI.replyTo(ctx, '❌ Need at least 2 players.');
  }
  
  // Cancel timer and start immediately
  gameTimerManager.cancelGame(currentGame.gameId);
  await safeAPI.replyTo(ctx, '🚀 Force starting game...');
  startGame(chatId);
});

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

// Check for overdue games periodically
setInterval(() => {
  for (const [chatId, game] of gameStates) {
    if (game.state === 'WAITING' && gameTimerManager.isOverdue(game.gameId)) {
      logger.info(`Starting overdue game ${game.gameId}`);
      startGame(chatId);
    }
  }
}, 10000); // Check every 10 seconds

// Error handler
bot.catch((err: any, ctx) => {
  logger.error(`Error for ${ctx.updateType}:`, err);
});

// Start bot
async function startBot() {
  try {
    await botWalletManager.initializeWallet();
    
    const me = await bot.telegram.getMe();
    logger.info('✅ Bot started:', me.username);
    
    await bot.launch();
    
    console.log('🎰 Optimized Lottery Bot Running!');
    console.log('📉 Reduced message volume');
    console.log('⏰ Absolute time-based starts');
    console.log('🛡️ Throttled responses');
    
  } catch (error: any) {
    logger.error('Failed to start bot:', error.message);
    process.exit(1);
  }
}

startBot();