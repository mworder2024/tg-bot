import { Telegraf, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import * as winston from 'winston';
import { VRF } from './utils/vrf';
import * as https from 'https';
import * as dns from 'dns';
import { leaderboard, GameRecord } from './leaderboard';
import { groupManager } from './utils/group-manager';
import { gamePersistence } from './utils/game-persistence';
import { prizeManager } from './utils/prize-manager';
import { botWalletManager } from './utils/wallet-manager';
import { callbackManager } from './utils/callback-manager';
import { gameTimerManager } from './utils/game-timer-manager';
import { MessageQueueManager } from './utils/message-queue-manager';
import { gameSpeedManager } from './utils/game-speed-manager';
import { gameScheduler, GameScheduler } from './utils/game-scheduler';
import { adminMenu } from './utils/admin-menu';
import { gameConfigManager } from './utils/game-config-manager';
import {
  getRandomBubbleMessage,
  getRandomFinalDrawMessage,
  getRandomCountdownSequence,
  generatePrizeUpdate,
  generateSuspensefulPlayerList
} from './utils/suspense-messages';
import {
  getGamePhaseMessage,
  generateEliminationMessage,
  getEnhancedCountdownSequence,
  generateProgressMessage,
  getPreEliminationTaunt
} from './utils/enhanced-suspense-messages';
import { escapeUsername } from './utils/markdown-escape';
import { initializeRedis } from './utils/redis-client';
import {
  handleLeaderboardCommand,
  handleStatsCommand,
  handlePrizeStatsCommand,
  handleWinnerStatsCommand
} from './handlers/command-handlers';

// Load environment variables
dotenv.config();

// Force IPv4 DNS resolution
dns.setDefaultResultOrder('ipv4first');

// Configure logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' })
  ],
});

// Game states
// Load games into the new multi-game structure
const loadedGames = gamePersistence.loadGamesSync();
const gameStates = loadedGames; // Keep for compatibility

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

// Initialize message queue manager
const messageQueue = new MessageQueueManager(bot);

// Initialize game scheduler
gameScheduler.setGameCreateCallback((chatId: string, config: any) => {
  createScheduledGame(chatId, config);
});

// Initialize callback manager
callbackManager.setGetCurrentGame(() => null); // Not used but required for compatibility

// Helper functions
// Modified to support multiple games per chat

function getGamesForChat(chatId: string): Map<string, any> {
  if (!gameStates.has(chatId)) {
    gameStates.set(chatId, new Map());
  }
  const chatGames = gameStates.get(chatId);
  // Ensure it's a Map (for compatibility with old format)
  if (!(chatGames instanceof Map)) {
    // Convert old single-game format to new multi-game format
    const newMap = new Map();
    if (chatGames && chatGames.gameId) {
      newMap.set(chatGames.gameId, chatGames);
    }
    gameStates.set(chatId, newMap);
    return newMap;
  }
  return chatGames;
}

function getActiveGames(chatId: string): any[] {
  const games = getGamesForChat(chatId);
  return Array.from(games.values()).filter(game => 
    game.state === 'WAITING' || game.state === 'DRAWING' || game.state === 'PAUSED'
  );
}

function getGameById(chatId: string, gameId: string): any {
  const games = getGamesForChat(chatId);
  return games.get(gameId) || null;
}

function addGame(chatId: string, game: any): void {
  const games = getGamesForChat(chatId);
  games.set(game.gameId, game);
  // Still save to persistence (will need to update persistence logic later)
  gamePersistence.saveGames(gameStates);
}

function removeGame(chatId: string, gameId: string): void {
  const games = getGamesForChat(chatId);
  games.delete(gameId);
  
  // Clean up empty chat entries
  if (games.size === 0) {
    gameStates.delete(chatId);
  }
  
  gamePersistence.saveGames(gameStates);
}

// Legacy compatibility functions (will be phased out)
function getCurrentGame(chatId: string): any {
  // Return the first active game for backward compatibility
  const activeGames = getActiveGames(chatId);
  return activeGames.length > 0 ? activeGames[0] : null;
}

function setCurrentGame(chatId: string, game: any): void {
  if (game) {
    addGame(chatId, game);
  }
  // Don't update gameStates directly - it's now multi-game structure
  gamePersistence.saveGames(gameStates);
}

async function isAdminUser(userId: string): Promise<boolean> {
  return await groupManager.isAdmin(userId);
}

// Initialize group manager
const defaultAdminId = process.env.DEFAULT_ADMIN_ID;
const defaultChatId = process.env.DEFAULT_CHAT_ID;
if (defaultAdminId && defaultChatId) {
  groupManager.initialize(defaultAdminId, defaultChatId, 'Default Group');
}

// Auto-save interval
// Auto-save disabled to prevent save loops
// const autoSaveInterval = gamePersistence.startAutoSave(gameStates, 10000);

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('🔄 Saving games before exit...');
  gamePersistence.saveGames(gameStates);
  // clearInterval(autoSaveInterval);
  gameTimerManager.destroy();
  messageQueue.destroy();
  gameScheduler.destroy();
  process.exit(0);
});

// Command: /create
bot.command('create', async (ctx) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat.id.toString();
  
  if (!(await groupManager.isGroupEnabled(chatId))) {
    return ctx.reply(
      `❌ Bot not configured for this group!\n\n` +
      `An admin needs to run /addgroup here first.`
    );
  }
  
  // Check if user is admin
  if (!(await isAdminUser(userId.toString()))) {
    return ctx.reply('❌ Only admins can create games.');
  }
  
  // Parse configuration
  const commandText = ctx.message?.text || '';
  const config = parseGameConfig(commandText);
  
  // Check for active games
  const activeGames = getActiveGames(chatId);
  
  // Allow multiple games but set a reasonable limit
  if (activeGames.length >= 5) {
    return ctx.reply('❌ Maximum number of concurrent games reached (5)!');
  }
  
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
    chatId: parseInt(chatId),
    scheduledStartTime: null as Date | null,
    requiresApproval: config.requiresApproval,
    isApproved: false,
    raidEnabled: config.raidEnabled,
    raidPaused: false,
    raidStartTime: null as Date | null,
    raidMessageCount: 0,
    isSpecialEvent: config.isSpecialEvent,
    eventPrize: config.eventPrize,
    eventName: config.eventName
  };
  
  // Schedule game with absolute time
  const startTime = gameTimerManager.scheduleGame(
    newGame.gameId,
    chatId,
    config.startMinutes,
    () => startGame(chatId, newGame.gameId)
  );
  
  newGame.scheduledStartTime = startTime;
  
  setCurrentGame(chatId, newGame);
  leaderboard.recordPlayerEntrySync(userId.toString(), username);
  
  const survivorText = config.survivorsOverride 
    ? `${config.survivors} (manual)` 
    : `${config.survivors}`;
  
  // Format start time
  const startTimeStr = startTime.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
    
  let announceMessage;
  
  if (config.isSpecialEvent) {
    announceMessage = 
      `🎉 **SPECIAL EVENT CREATED!**\n\n` +
      `🏆 Event: "${config.eventName}"\n` +
      `💰 Prize Pool: ${config.eventPrize.toLocaleString()} tokens\n` +
      `🎲 Game ID: \`${newGame.gameId}\`\n` +
      `👤 Created by: ${username}\n` +
      `👥 Players: 1/${newGame.maxPlayers}\n`;
  } else {
    announceMessage = 
      `🎰 **Survival Lottery Created!**\n\n` +
      `🎲 Game ID: \`${newGame.gameId}\`\n` +
      `👤 Created by: ${username}\n` +
      `👥 Players: 1/${newGame.maxPlayers}\n`;
  }
  
  if (config.requiresApproval) {
    announceMessage += `⏸️ **AWAITING ADMIN APPROVAL**\n`;
    announceMessage += `⏰ Will start ${config.startMinutes} minutes after approval\n\n`;
  } else {
    announceMessage += `⏰ **Starts at ${startTimeStr}** (in ${config.startMinutes} minutes)\n\n`;
  }
  
  announceMessage += `📊 Settings:\n` +
    `• Max Players: ${config.maxPlayers}\n` +
    `• Survivors: ${survivorText}\n` +
    `• Number Range: ${config.selectionMultiplier}x players\n`;
  
  if (config.raidEnabled) {
    announceMessage += `• 🚨 **RAID MODE ENABLED**\n`;
  }
  
  announceMessage += `\n`;
  
  if (config.requiresApproval) {
    announceMessage += `⚠️ **Admin must use /approve to start the game**`;
  } else {
    announceMessage += `💬 Use /join to participate!`;
  }
  
  const joinKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 Join Game', callback_data: `join_${newGame.gameId}` },
        { text: '📊 Status', callback_data: `status_${newGame.gameId}` }
      ]
    ]
  };
  
  await ctx.reply(announceMessage, { 
    parse_mode: 'Markdown',
    reply_markup: joinKeyboard
  });
  
  // Schedule announcement intervals
  scheduleGameAnnouncements(chatId, newGame, config.startMinutes);
});

// Command: /join
bot.command('join', async (ctx) => {
  const userId = ctx.from!.id.toString();
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat.id.toString();
  
  if (!(await groupManager.isGroupEnabled(chatId))) {
    return;
  }
  
  const activeGames = getActiveGames(chatId);
  const waitingGames = activeGames.filter(g => g.state === 'WAITING');
  
  if (waitingGames.length === 0) {
    await ctx.reply('❌ No active lotteries to join!');
    return;
  }
  
  if (waitingGames.length === 1) {
    // Only one game, join directly
    await joinGame(ctx, chatId, waitingGames[0].gameId, userId, username);
    return;
  }
  
  // Multiple games - show selection menu
  const keyboard = {
    inline_keyboard: waitingGames.map(game => {
      const gameLabel = game.isSpecialEvent 
        ? `🎉 ${game.eventName} (${game.players.size}/${game.maxPlayers})`
        : `🎰 Regular Lottery (${game.players.size}/${game.maxPlayers})`;
      
      return [{
        text: gameLabel,
        callback_data: `join_game:${game.gameId}`
      }];
    })
  };
  
  keyboard.inline_keyboard.push([{
    text: '❌ Cancel',
    callback_data: 'cancel_join'
  }]);
  
  await ctx.reply('🎮 **Select a lottery to join:**', {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

// Helper function to join a specific game
async function joinGame(ctx: Context, chatId: string, gameId: string, userId: string, username: string) {
  const game = getGameById(chatId, gameId);
  
  if (!game || game.state !== 'WAITING') {
    await ctx.reply('❌ This game is no longer available.');
    return;
  }
  
  if (game.players.has(userId)) {
    await ctx.reply('✅ You are already in this game!');
    return;
  }
  
  if (game.players.size >= game.maxPlayers) {
    await ctx.reply('❌ This game is full!');
    return;
  }
  
  // Add player
  game.players.set(userId, {
    id: userId,
    username,
    joinedAt: new Date()
  });
  
  leaderboard.recordPlayerEntrySync(userId, username);
  
  // Announce to group that player joined
  const gameLabel = game.isSpecialEvent ? `[${game.eventName}]` : '';
  messageQueue.enqueue({
    type: 'game',
    chatId,
    content: `👤 **${escapeUsername(username)}** joined${gameLabel ? ' ' + gameLabel : ''}! ${game.players.size}/${game.maxPlayers}`,
    options: { parse_mode: 'Markdown' },
    priority: 'normal'
  });
  
  // Update game state
  messageQueue.clearGameMessages(chatId, game.state);
  
  // Check if game is full
  if (game.players.size >= game.maxPlayers) {
    // Cancel scheduled start
    gameTimerManager.cancelGame(game.gameId);
    
    // Flush join messages immediately
    messageQueue.flushAllJoinBundles();
    
    // Announce and start in 5 seconds
    messageQueue.enqueue({
      type: 'announcement',
      chatId: game.chatId,
      content: `🎮 **Game Full! Starting in 5 seconds...**`,
      options: { parse_mode: 'Markdown' },
      priority: 'high'
    });
    
    setTimeout(() => {
      const checkGame = getGameById(chatId, game.gameId);
      if (checkGame && checkGame.state === 'WAITING') {
        startGame(chatId, game.gameId);
      }
    }, 5000);
  }
}


// Start game function
async function startGame(chatId: string, gameId?: string) {
  let currentGame;
  
  if (gameId) {
    currentGame = getGameById(chatId, gameId);
  } else {
    // Legacy support - find first waiting game
    currentGame = getCurrentGame(chatId);
  }
  
  if (!currentGame || currentGame.state !== 'WAITING') return;
  
  // Check if approval is required and not yet approved
  if (currentGame.requiresApproval && !currentGame.isApproved) {
    messageQueue.enqueue({
      type: 'announcement',
      chatId: currentGame.chatId,
      content: `⏸️ Game requires admin approval!\n\nAn admin must use /approve to start the game.`,
      priority: 'high'
    });
    return;
  }
  
  // Check minimum players
  if (currentGame.players.size < 2) {
    messageQueue.enqueue({
      type: 'announcement',
      chatId: currentGame.chatId,
      content: `❌ Not enough players! Need at least 2.\nGame cancelled.`,
      priority: 'high'
    });
    currentGame.state = 'FINISHED';
    gameTimerManager.cancelGame(currentGame.gameId);
    return;
  }
  
  // Flush any pending join announcements
  messageQueue.flushAllJoinBundles();
  
  // Clear join messages from queue
  messageQueue.clearGameMessages(chatId, 'STARTING');
  
  // Generate prize based on player count or use event prize
  let totalPrize, vrfProof;
  
  if (currentGame.isSpecialEvent && currentGame.eventPrize > 0) {
    // Use custom event prize
    totalPrize = currentGame.eventPrize;
    vrfProof = 'event-custom'; // No VRF needed for custom prizes
  } else {
    // Generate random prize using VRF
    const prizeGeneration = prizeManager.generatePrize(currentGame.gameId, currentGame.players.size);
    totalPrize = prizeGeneration.amount;
    vrfProof = prizeGeneration.vrfProof;
  }
  
  const survivorCount = currentGame.winnerCount;
  const prizePerSurvivor = Math.floor(totalPrize / survivorCount);
  
  currentGame.prizeInfo = {
    totalPrize,
    prizePerSurvivor,
    vrfProof: vrfProof
  };
  
  prizeManager.logPrize({
    gameId: currentGame.gameId,
    prizeAmount: totalPrize,
    totalSurvivors: survivorCount,
    prizePerSurvivor,
    timestamp: new Date(),
    vrfProof: vrfProof,
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
      name: playerData.username || playerData.first_name || `Player${playerId.substring(0, 6)}`,
      number: assignedNumber
    });
    numberIndex++;
  }
  
  // Sort by number for display
  playerList.sort((a: any, b: any) => a.number - b.number);
  
  // Single comprehensive start message
  let startMessage;
  
  if (currentGame.isSpecialEvent) {
    startMessage = `🎉 **${currentGame.eventName.toUpperCase()} STARTED!** 🎉\n\n`;
    startMessage += `🆔 Game: ${currentGame.gameId}\n`;
    startMessage += `🏆 Event Prize: **${totalPrize.toLocaleString()}** tokens\n`;
  } else {
    startMessage = `🎲 **GAME STARTED!** 🎲\n\n`;
    startMessage += `🆔 Game: ${currentGame.gameId}\n`;
    startMessage += `💰 Prize Pool: **${totalPrize.toLocaleString()}** tokens\n`;
  }
  
  startMessage += `👥 Players: ${playerCount}\n`;
  startMessage += `🏆 Survivors: ${survivorCount}\n`;
  startMessage += `🔢 Number Range: 1-${currentGame.numberRange.max}\n\n`;
  startMessage += `**All Player Numbers:**\n`;
  
  // Add all players - Telegram supports up to 4096 chars per message
  let playerListText = '';
  for (const player of playerList) {
    playerListText += `• ${escapeUsername(player.name)}: **${player.number}**\n`;
  }
  
  // Check if message would be too long (leave room for the footer)
  const headerLength = startMessage.length;
  const footerLength = '\n🎯 Drawing begins in 10 seconds...'.length;
  const maxPlayerListLength = 4000 - headerLength - footerLength;
  
  if (playerListText.length > maxPlayerListLength) {
    // Split into multiple messages if needed
    startMessage += playerListText.substring(0, maxPlayerListLength) + '...\n';
    
    messageQueue.enqueue({
      type: 'game',
      chatId: currentGame.chatId,
      content: startMessage + '\n📋 *Continued in next message...*',
      options: { parse_mode: 'Markdown' },
      priority: 'critical'
    });
    
    // Send remaining players in continuation message
    let continuationMessage = `📋 **Player List Continued:**\n\n`;
    continuationMessage += playerListText.substring(maxPlayerListLength);
    continuationMessage += `\n🎯 Drawing begins in 10 seconds...`;
    
    messageQueue.enqueue({
      type: 'game',
      chatId: currentGame.chatId,
      content: continuationMessage,
      options: { parse_mode: 'Markdown' },
      priority: 'critical'
    });
  } else {
    // Message fits in one part
    startMessage += playerListText;
    startMessage += `\n🎯 Drawing begins in 10 seconds...`;
    
    messageQueue.enqueue({
      type: 'game',
      chatId: currentGame.chatId,
      content: startMessage,
      options: { parse_mode: 'Markdown' },
      priority: 'critical'
    });
  }
  
  // Clean up timer
  gameTimerManager.cancelGame(currentGame.gameId);
  
  // Start drawing after delay
  setTimeout(() => {
    const game = getCurrentGame(chatId);
    if (game && game.state === 'DRAWING') {
      startDrawing(chatId);
    }
  }, 10000);
  
  // Send a summary after 5 seconds with full player count
  setTimeout(() => {
    const game = getCurrentGame(chatId);
    if (game && game.state === 'DRAWING') {
      let summaryMessage = `📢 **Game ${currentGame.gameId} is NOW IN PROGRESS!**\n\n`;
      summaryMessage += `🎮 **${playerCount} players** are competing!\n`;
      summaryMessage += `🏆 Only **${survivorCount}** will survive!\n`;
      summaryMessage += `💀 **${playerCount - survivorCount}** must be eliminated!\n\n`;
      summaryMessage += `⚡ First elimination coming soon...\n\n`;
      summaryMessage += `Good luck to all players! 🍀`;
      
      messageQueue.enqueue({
        type: 'game',
        chatId: currentGame.chatId,
        content: summaryMessage,
        options: { parse_mode: 'Markdown' },
        priority: 'normal'
      });
    }
  }, 5000);
}

// Drawing function with dynamic speed
async function startDrawing(chatId: string) {
  logger.info(`startDrawing called for chat ${chatId}`);
  const currentGame = getCurrentGame(chatId);
  if (!currentGame || currentGame.state !== 'DRAWING') {
    logger.warn(`Cannot start drawing: game state is ${currentGame?.state || 'null'}`);
    return;
  }
  
  let availableNumbers: number[] = [];
  for (let i = currentGame.numberRange.min; i <= currentGame.numberRange.max; i++) {
    availableNumbers.push(i);
  }
  
  let activePlayers = new Set(currentGame.players.keys());
  let drawNumber = 1;
  let consecutiveNoEliminations = 0;
  let previousRemaining = activePlayers.size;
  let totalEliminated = 0;
  let lastPlayerListAnnouncement = 0;
  
  // Drawing loop
  async function performDraw() {
    // Check if game should end
    if (activePlayers.size <= currentGame.winnerCount || availableNumbers.length === 0) {
      await finishGame(chatId, activePlayers as Set<string>);
      return;
    }
    
    // Check for raid pause
    if (currentGame.raidEnabled && !currentGame.raidPaused) {
      const totalPlayers = currentGame.players.size;
      const eliminated = totalPlayers - activePlayers.size;
      const halfwayPoint = Math.floor(totalPlayers / 2);
      
      if (eliminated >= halfwayPoint && activePlayers.size > currentGame.winnerCount + 2) {
        // Pause for raid
        await pauseForRaid(chatId, currentGame);
        return;
      }
    }
    
    // Get speed configuration from config manager
    const speedConfig = gameConfigManager.getSpeedConfig(
      activePlayers.size,
      currentGame.winnerCount
    );
    
    // Check for suspense messages
    if (speedConfig.suspenseMessages) {
      const toEliminate = activePlayers.size - currentGame.winnerCount;
      
      if (toEliminate === 1) {
        // Final draw sequence
        messageQueue.enqueue({
          type: 'suspense',
          chatId: currentGame.chatId,
          content: getRandomFinalDrawMessage(),
          options: { parse_mode: 'Markdown' },
          priority: 'high'
        });
        
        // Countdown sequence
        const countdown = getEnhancedCountdownSequence();
        for (let i = 0; i < countdown.length; i++) {
          setTimeout(() => {
            messageQueue.enqueue({
              type: 'suspense',
              chatId: currentGame.chatId,
              content: countdown[i],
              priority: 'high'
            });
          }, (i + 1) * 2000);
        }
        
        // Delay final draw for suspense
        setTimeout(() => performActualDraw(), countdown.length * 2000 + 2000);
        return;
      } else if (toEliminate <= 3) {
        // Bubble messages
        messageQueue.enqueue({
          type: 'suspense',
          chatId: currentGame.chatId,
          content: getRandomBubbleMessage(),
          priority: 'normal'
        });
      }
    }
    
    performActualDraw();
    
    async function performActualDraw() {
      // Add pre-elimination taunt for early/mid game
      if (activePlayers.size > 10 && drawNumber % 3 === 1) {
        messageQueue.enqueue({
          type: 'suspense',
          chatId: currentGame.chatId,
          content: getPreEliminationTaunt(activePlayers.size),
          priority: 'normal'
        });
        
        // Small delay for taunt to be read
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Draw numbers based on speed config
      const numbersToDraw = Math.min(speedConfig.numbersPerDraw, availableNumbers.length);
      const drawnNumbers = [];
      const eliminatedByNumber = new Map<number, string[]>();
      
      for (let i = 0; i < numbersToDraw; i++) {
        const poolIndex = VRF.generateRandomNumber(
          0,
          availableNumbers.length - 1,
          `${currentGame.gameId}_${drawNumber}_${i}_${Date.now()}`
        );
        
        const drawnNumber = availableNumbers[poolIndex.number];
        availableNumbers.splice(poolIndex.number, 1);
        drawnNumbers.push(drawnNumber);
        
        // Find eliminated players
        const eliminated = [];
        for (const [playerId, selectedNumbers] of currentGame.numberSelections) {
          if (activePlayers.has(playerId) && selectedNumbers.has(drawnNumber)) {
            eliminated.push(currentGame.players.get(playerId)!.username);
            activePlayers.delete(playerId);
          }
        }
        
        if (eliminated.length > 0) {
          eliminatedByNumber.set(drawnNumber, eliminated);
        }
      }
      
      // Build draw message
      const message = gameSpeedManager.formatMultiNumberDraw(
        drawnNumbers,
        drawNumber,
        eliminatedByNumber
      );
      
      const roundEliminated = Array.from(eliminatedByNumber.values())
        .reduce((sum, players) => sum + players.length, 0);
      
      if (roundEliminated > 0) {
        consecutiveNoEliminations = 0;
        totalEliminated += roundEliminated;
      } else {
        consecutiveNoEliminations++;
      }
      
      // Add remaining count
      const finalMessage = message + `\n👥 Survivors: ${activePlayers.size}`;
      
      messageQueue.enqueue({
        type: 'draw',
        chatId: currentGame.chatId,
        content: finalMessage,
        options: { parse_mode: 'Markdown' },
        priority: 'high'
      });
      
      // Add enhanced elimination messages
      if (roundEliminated > 0) {
        const allEliminated = Array.from(eliminatedByNumber.values()).flat();
        const eliminationRoast = await generateEliminationMessage(allEliminated, chatId);
        if (eliminationRoast) {
          messageQueue.enqueue({
            type: 'suspense',
            chatId: currentGame.chatId,
            content: eliminationRoast,
            options: { parse_mode: 'Markdown' },
            priority: 'normal'
          });
        }
      }
      
      // Add game phase message periodically
      if (drawNumber % 5 === 0 || (activePlayers.size < 20 && drawNumber % 3 === 0)) {
        const phaseMessage = getGamePhaseMessage(activePlayers.size, currentGame.players.size);
        messageQueue.enqueue({
          type: 'suspense',
          chatId: currentGame.chatId,
          content: phaseMessage,
          priority: 'low'
        });
      }
      
      // Show player list if configured OR every 5 eliminations
      const shouldShowPlayerList = speedConfig.showPlayerList || 
        (totalEliminated - lastPlayerListAnnouncement >= 5 && activePlayers.size > currentGame.winnerCount);
      
      if (shouldShowPlayerList) {
        const remainingPlayers = [];
        for (const playerId of activePlayers) {
          const player = currentGame.players.get(playerId as string);
          const number = Array.from(currentGame.numberSelections.get(playerId as string) || [])[0];
          if (player) {
            remainingPlayers.push({ username: player.username, number });
          }
        }
        
        // Create a comprehensive player list message
        let playerListMessage = `📊 **Game Update**\n\n`;
        playerListMessage += `👥 **${activePlayers.size} Players Remaining**\n`;
        playerListMessage += `💀 Total Eliminated: ${totalEliminated}\n`;
        playerListMessage += `🏆 Playing for: ${currentGame.winnerCount} survivor${currentGame.winnerCount > 1 ? 's' : ''}\n\n`;
        
        // Sort players by number
        remainingPlayers.sort((a: any, b: any) => a.number - b.number);
        
        // For final phase, use suspenseful message format
        if (activePlayers.size - currentGame.winnerCount <= 3) {
          // Use the suspenseful message but replace its header with our game update
          const suspenseMessage = generateSuspensefulPlayerList(remainingPlayers, currentGame.winnerCount);
          const suspenseLines = suspenseMessage.split('\n');
          // Skip the first 3 lines (header and warning) and use the "Still Standing" part
          const stillStandingIndex = suspenseLines.findIndex(line => line.includes('Still Standing'));
          if (stillStandingIndex !== -1) {
            playerListMessage += suspenseLines.slice(stillStandingIndex).join('\n');
          } else {
            // Fallback if format changes
            playerListMessage += `**Still Standing:**\n`;
            for (const player of remainingPlayers) {
              playerListMessage += `• ${escapeUsername(player.username)} (#${player.number})\n`;
            }
          }
        } else {
          // Normal player list for non-final phases
          if (activePlayers.size <= 10) {
            playerListMessage += `**👥 Remaining Players:**\n`;
          } else {
            playerListMessage += `**🎯 Current Players:**\n`;
          }
          
          for (const player of remainingPlayers) {
            playerListMessage += `• ${escapeUsername(player.username)} (#${player.number})\n`;
          }
        }
        
        messageQueue.enqueue({
          type: 'game',
          chatId: currentGame.chatId,
          content: playerListMessage,
          options: { parse_mode: 'Markdown' },
          priority: 'normal'
        });
        
        // Update last announcement counter
        if (totalEliminated - lastPlayerListAnnouncement >= 5) {
          lastPlayerListAnnouncement = totalEliminated;
        }
      }
      
      // Show progress with humor every 10 eliminations in large games
      if (totalEliminated > 0 && totalEliminated % 10 === 0 && activePlayers.size > 20) {
        const progressMsg = generateProgressMessage(
          totalEliminated,
          activePlayers.size,
          drawNumber
        );
        messageQueue.enqueue({
          type: 'suspense',
          chatId: currentGame.chatId,
          content: progressMsg,
          priority: 'low'
        });
      }
      
      // Show prize update near the end
      if (gameSpeedManager.needsProgressAnnouncement(
        activePlayers.size,
        previousRemaining,
        currentGame.winnerCount
      )) {
        const prizeMessage = generatePrizeUpdate(
          activePlayers.size,
          currentGame.winnerCount,
          currentGame.prizeInfo.totalPrize,
          currentGame.prizeInfo.prizePerSurvivor
        );
        
        messageQueue.enqueue({
          type: 'game',
          chatId: currentGame.chatId,
          content: prizeMessage,
          options: { parse_mode: 'Markdown' },
          priority: 'normal'
        });
        
        previousRemaining = activePlayers.size;
      }
      
      drawNumber++;
      
      // Get dynamic delay
      const delay = gameSpeedManager.getDynamicDelay(
        speedConfig.drawDelay,
        consecutiveNoEliminations,
        activePlayers.size
      );
      
      // Schedule next draw
      setTimeout(performDraw, delay);
    }
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
  
  // Clear any game-related messages from queue
  messageQueue.clearGameMessages(chatId, 'FINISHED');
  
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
      leaderboard.recordWinSync(playerId, player.username, survivorNumber);
      
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
  let winnerMessage;
  
  if (currentGame.isSpecialEvent) {
    winnerMessage = `🎉 **${currentGame.eventName.toUpperCase()} COMPLETE!** 🎉\n\n`;
    winnerMessage += `🎲 Game: ${currentGame.gameId}\n`;
    winnerMessage += `🏆 Event Prize Pool: ${totalPrize.toLocaleString()} tokens\n\n`;
  } else {
    winnerMessage = `🏆 **GAME COMPLETE!** 🏆\n\n`;
    winnerMessage += `🎲 Game: ${currentGame.gameId}\n\n`;
  }
  
  if (winners.length === 0) {
    winnerMessage += `💀 **No survivors!** All eliminated!\n`;
    winnerMessage += `💰 Prize pool returns to treasury`;
  } else if (winners.length === 1) {
    winnerMessage += `👑 **WINNER:** ${escapeUsername(winners[0].username)}\n`;
    winnerMessage += `🔢 Winning Number: ${winners[0].number}\n`;
    winnerMessage += `💰 **Prize:** ${winners[0].prize.toLocaleString()} tokens`;
  } else {
    winnerMessage += `👑 **WINNERS:**\n`;
    for (const winner of winners) {
      winnerMessage += `• ${escapeUsername(winner.username)} (#${winner.number}) - ${winner.prize.toLocaleString()}\n`;
    }
  }
  
  winnerMessage += `\n\n🎮 GG! Use /create for a new game.`;
  
  messageQueue.enqueue({
    type: 'game',
    chatId: currentGame.chatId,
    content: winnerMessage,
    options: { parse_mode: 'Markdown' },
    priority: 'critical'
  });
}

// Command: /status
bot.command('status', async (ctx): Promise<any> => {
  const chatId = ctx.chat.id.toString();
  const activeGames = getActiveGames(chatId);
  
  if (activeGames.length === 0) {
    return ctx.reply(`🎮 No active games. Use /create to start.`);
  }
  
  const queueStats = messageQueue.getStats();
  
  let message = `📊 **Active Games**\n\n`;
  
  for (const game of activeGames) {
    const timeUntil = gameTimerManager.getFormattedTimeUntil(game.gameId);
    const startTime = gameTimerManager.getStartTime(game.gameId);
    
    if (game.isSpecialEvent) {
      message += `🎉 **${game.eventName}**\n`;
      message += `💰 Prize: ${game.eventPrize.toLocaleString()} tokens\n`;
    } else {
      message += `🎰 **Regular Lottery**\n`;
    }
    
    message += `🎲 ID: ${game.gameId}\n`;
    message += `📊 State: ${game.state}\n`;
    message += `👥 Players: ${game.players.size}/${game.maxPlayers}\n`;
    
    if (game.state === 'WAITING' && startTime) {
      message += `⏰ Starts: ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (in ${timeUntil})`;
    }
    
    message += `\n\n`;
  }
  
  if (queueStats.queueSize > 0) {
    message += `📬 Message Queue: ${queueStats.queueSize}`;
  }
  
  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// Command: /forcestart (admin)
bot.command('forcestart', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Admin only command.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply('❌ No game to start.');
  }
  
  if (currentGame.state !== 'WAITING') {
    return ctx.reply(`❌ Game already ${currentGame.state}.`);
  }
  
  if (currentGame.players.size < 2) {
    return ctx.reply('❌ Need at least 2 players.');
  }
  
  // Cancel timer and start immediately
  gameTimerManager.cancelGame(currentGame.gameId);
  await ctx.reply('🚀 Force starting game...');
  startGame(chatId);
});

// Command: /approve (admin)
bot.command('approve', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Admin only command.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply('❌ No game to approve.');
  }
  
  if (!currentGame.requiresApproval) {
    return ctx.reply('❌ This game does not require approval.');
  }
  
  if (currentGame.isApproved) {
    return ctx.reply('✅ Game is already approved.');
  }
  
  if (currentGame.state !== 'WAITING') {
    return ctx.reply(`❌ Cannot approve - game is ${currentGame.state}.`);
  }
  
  // Approve the game
  currentGame.isApproved = true;
  
  // Cancel the old timer
  gameTimerManager.cancelGame(currentGame.gameId);
  
  // Schedule new start time from now
  const newStartTime = gameTimerManager.scheduleGame(
    currentGame.gameId,
    chatId,
    currentGame.startMinutes,
    () => startGame(chatId)
  );
  
  currentGame.scheduledStartTime = newStartTime;
  
  const startTimeStr = newStartTime.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const username = ctx.from!.username || ctx.from!.first_name || 'Admin';
  
  await ctx.reply(
    `✅ **GAME APPROVED!**\n\n` +
    `🎲 Game ID: \`${currentGame.gameId}\`\n` +
    `👤 Approved by: ${username}\n` +
    `⏰ **Starts at ${startTimeStr}** (in ${currentGame.startMinutes} minutes)\n` +
    `👥 Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n\n` +
    `The countdown has begun! Use /join to participate.`,
    { parse_mode: 'Markdown' }
  );
  
  // Schedule announcement intervals
  scheduleGameAnnouncements(chatId, currentGame, currentGame.startMinutes);
});

// Handle inline button callbacks
// Handle all callbacks through the callback manager
// COMMENTED OUT: This was intercepting our custom callbacks
// bot.on('callback_query', async (ctx) => {
//   await callbackManager.handleCallback(ctx as any);
// });

// Legacy action handlers (kept for compatibility)
bot.action(/join_(.+)/, async (ctx) => {
  const gameId = ctx.match[1];
  const userId = ctx.from!.id.toString();
  const username = ctx.from!.username || ctx.from!.first_name || 'Player';
  const chatId = ctx.chat!.id.toString();
  
  try {
    await ctx.answerCbQuery();
  } catch (error) {
    // Ignore callback query errors
  }
  
  const currentGame = getCurrentGame(chatId);
  
  if (!currentGame || currentGame.gameId !== gameId || currentGame.state !== 'WAITING') {
    return ctx.answerCbQuery('This game is no longer accepting players.', { show_alert: true }).catch(() => {});
  }
  
  if (currentGame.players.has(userId)) {
    return ctx.answerCbQuery('You are already in this game!', { show_alert: true }).catch(() => {});
  }
  
  if (currentGame.players.size >= currentGame.maxPlayers) {
    return ctx.answerCbQuery('Game is full!', { show_alert: true }).catch(() => {});
  }
  
  // Add player
  currentGame.players.set(userId, {
    id: userId,
    username,
    joinedAt: new Date()
  });
  
  leaderboard.recordPlayerEntrySync(userId, username);
  
  // Personal confirmation removed - only group announcement needed
  
  // Announce to group that player joined
  messageQueue.enqueue({
    type: 'game',
    chatId,
    content: `👤 **${escapeUsername(username)}** joined! ${currentGame.players.size}/${currentGame.maxPlayers}`,
    options: { parse_mode: 'Markdown' },
    priority: 'normal'
  });
});

bot.action(/status_(.+)/, async (ctx) => {
  const gameId = ctx.match[1];
  const chatId = ctx.chat!.id.toString();
  
  try {
    await ctx.answerCbQuery();
  } catch (error) {
    // Ignore callback query errors
  }
  
  const currentGame = getCurrentGame(chatId);
  
  if (!currentGame || currentGame.gameId !== gameId) {
    return ctx.answerCbQuery('Game not found.', { show_alert: false }).catch(() => {});
  }
  
  const timeUntil = gameTimerManager.getFormattedTimeUntil(currentGame.gameId);
  const message = `Players: ${currentGame.players.size}/${currentGame.maxPlayers}\nStarts in: ${timeUntil}`;
  
  return ctx.answerCbQuery(message, { show_alert: true }).catch(() => {});
});

// Command: /endgame (admin only)
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
  
  // Cancel the lottery game using the helper function
  await cancelLotteryGame(chatId, currentGame, 'ADMIN_MANUAL');
  
  // Clear message queue for this chat
  // Note: clearQueue method doesn't exist, we'll just let the queue process normally
  
  await ctx.reply(
    '🔚 **Game Ended by Admin**\n\n' +
    `🎲 Game ID: ${currentGame.gameId}\n` +
    `👥 Players: ${currentGame.players.size}\n` +
    `⏱️ Status: TERMINATED\n\n` +
    'You can now create a new game with /create',
    { parse_mode: 'Markdown' }
  );
});

// Command: /resumedraw (admin only) - resume a stuck drawing
bot.command('resumedraw', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Only admins can resume drawings.');
  }
  
  const currentGame = getCurrentGame(chatId);
  if (!currentGame) {
    return ctx.reply('❌ No active game to resume.');
  }
  
  if (currentGame.state !== 'DRAWING') {
    return ctx.reply(`❌ Game is in ${currentGame.state} state. Can only resume DRAWING games.`);
  }
  
  await ctx.reply(
    '⚡ **Resuming Drawing Process**\n\n' +
    `🎲 Game ID: ${currentGame.gameId}\n` +
    `👥 Active Players: ${currentGame.players.size}\n` +
    `🏆 Target Survivors: ${currentGame.winnerCount}\n\n` +
    '🔄 Drawing will continue in 3 seconds...',
    { parse_mode: 'Markdown' }
  );
  
  // Force immediate draw announcement
  await ctx.reply('💀 **Drawing resumed!** Next elimination in 5 seconds...');
  
  // Resume drawing after 3 seconds
  setTimeout(async () => {
    logger.info(`Resuming drawing for game ${currentGame.gameId} in chat ${chatId}`);
    
    // Get fresh game state
    const game = getCurrentGame(chatId);
    if (!game || game.state !== 'DRAWING') {
      await ctx.reply('❌ Game state changed. Cannot resume.');
      return;
    }
    
    // Force the drawing to start
    startDrawing(chatId);
  }, 3000);
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

  if (await groupManager.addAdmin(targetUserId)) {
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
  const superAdminId = process.env.SUPER_ADMIN_ID;
  if (superAdminId && targetUserId === superAdminId) {
    return ctx.reply('❌ Cannot remove super admin privileges!');
  }

  if (await groupManager.removeAdmin(targetUserId)) {
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

// Command: /admin (admin menu)
bot.command('admin', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Admin only command.');
  }
  
  await ctx.reply(
    '🔧 **Admin Panel**\n\nSelect an option:',
    {
      parse_mode: 'Markdown',
      reply_markup: adminMenu.getMainMenu()
    }
  );
});

// Command: /schedule (admin)
bot.command('schedule', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Admin only command.');
  }
  
  const commandText = ctx.message?.text || '';
  const args = commandText.split(' ').slice(1);
  
  // Show current schedule if no args
  if (args.length === 0) {
    const schedule = gameScheduler.getSchedule(chatId);
    if (!schedule) {
      return ctx.reply(
        `📅 **No Schedule Set**\n\n` +
        `Use: /schedule <interval> <survivors> [options]\n\n` +
        `Examples:\n` +
        `• /schedule 4h 3 - Every 4 hours, 3 survivors\n` +
        `• /schedule 30m 1 --max 20 - Every 30 min, 1 survivor, max 20 players\n` +
        `• /schedule 2h 5 --start 10 - Every 2 hours, 5 survivors, 10 min start delay\n` +
        `• /schedule cancel - Cancel schedule`,
        { parse_mode: 'Markdown' }
      );
    }
    
    return ctx.reply(
      gameScheduler.formatScheduleInfo(schedule),
      { parse_mode: 'Markdown' }
    );
  }
  
  // Handle cancel
  if (args[0].toLowerCase() === 'cancel' || args[0].toLowerCase() === 'stop') {
    if (gameScheduler.cancelSchedule(chatId)) {
      return ctx.reply('📅 Schedule cancelled.');
    } else {
      return ctx.reply('❌ No schedule to cancel.');
    }
  }
  
  // Handle pause/resume
  if (args[0].toLowerCase() === 'pause' || args[0].toLowerCase() === 'resume') {
    if (gameScheduler.toggleSchedule(chatId)) {
      const schedule = gameScheduler.getSchedule(chatId);
      return ctx.reply(`📅 Schedule ${schedule?.enabled ? 'resumed' : 'paused'}.`);
    } else {
      return ctx.reply('❌ No schedule to toggle.');
    }
  }
  
  // Parse new schedule
  const interval = GameScheduler.parseInterval(args[0]);
  if (!interval) {
    return ctx.reply('❌ Invalid interval. Use format like: 15m, 2h, 4hours');
  }
  
  const survivors = parseInt(args[1]);
  if (isNaN(survivors) || survivors < 1) {
    return ctx.reply('❌ Invalid survivor count.');
  }
  
  // Parse options
  let maxPlayers = 50;
  let startMinutes = 5;
  
  const maxMatch = commandText.match(/--max\s+(\d+)/i);
  if (maxMatch) {
    maxPlayers = parseInt(maxMatch[1]);
  }
  
  const startMatch = commandText.match(/--start\s+(\d+)/i);
  if (startMatch) {
    startMinutes = parseInt(startMatch[1]);
  }
  
  // Validate
  const validation = GameScheduler.validateSchedule(interval, survivors, maxPlayers, startMinutes);
  if (!validation.valid) {
    return ctx.reply(`❌ ${validation.error}`);
  }
  
  // Create schedule
  const schedule = gameScheduler.createSchedule(
    chatId,
    interval,
    survivors,
    maxPlayers,
    startMinutes,
    userId
  );
  
  await ctx.reply(
    `📅 **Schedule Created!**\n\n` +
    gameScheduler.formatScheduleInfo(schedule),
    { parse_mode: 'Markdown' }
  );
});

// /activatenext command - manually trigger next scheduled game
bot.command('activatenext', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Admin only command.');
  }
  
  const currentGame = getCurrentGame(chatId);
  const hasActiveGame = currentGame && 
    (currentGame.state === 'WAITING' || 
     currentGame.state === 'NUMBER_SELECTION' || 
     currentGame.state === 'DRAWING');
  
  if (hasActiveGame) {
    return ctx.reply(`❌ There's already an active game (${currentGame.gameId}) in this chat.`);
  }
  
  const schedule = gameScheduler.getSchedule(chatId);
  if (!schedule) {
    return ctx.reply('❌ No scheduled games configured for this chat.');
  }
  
  if (!schedule.enabled) {
    return ctx.reply('❌ Scheduled games are currently paused for this chat.');
  }
  
  // Check timing for informational display
  const now = Date.now();
  const timeUntilNext = schedule.nextRun.getTime() - now;
  const minutesUntilNext = Math.ceil(timeUntilNext / 60000);
  const originalScheduleTime = schedule.nextRun.toLocaleTimeString();
  
  // Manually trigger the scheduled game (keeping original scheduled start time)
  logger.info(`Admin ${userId} manually activated next scheduled game for chat ${chatId}`);
  
  // Calculate minutes until the original scheduled start time
  const minutesUntilStart = Math.ceil((schedule.nextRun.getTime() - now) / 60000);
  const actualStartMinutes = Math.max(1, minutesUntilStart); // At least 1 minute
  
  // Create game config with original scheduled start time
  const gameConfig = {
    maxPlayers: schedule.maxPlayers,
    startMinutes: actualStartMinutes, // Time until original scheduled start
    survivors: schedule.survivors,
    survivorsOverride: true,
    scheduled: true,
    scheduleId: schedule.id,
    adminActivated: true
  };
  
  // Update schedule for next occurrence from current time
  schedule.lastRun = new Date();
  schedule.runCount++;
  // Next game should be interval minutes from NOW, not from the original scheduled time
  schedule.nextRun = new Date(now + schedule.interval * 60000);
  
  // Create the game - opens for joining now, starts at original time
  createScheduledGame(chatId, gameConfig);
  
  return ctx.reply(
    `✅ **Next scheduled game activated!**\n\n` +
    `🎮 A new lottery game should appear shortly.\n` +
    `⏰ Was scheduled for: ${originalScheduleTime} (in ${Math.floor(minutesUntilNext / 60)}h ${minutesUntilNext % 60}m)\n` +
    `🚀 Activated immediately by admin override.`
  );
});

// /scheduled command - view upcoming scheduled games
bot.command('scheduled', async (ctx): Promise<any> => {
  const chatId = ctx.chat.id.toString();
  
  // Get schedule for this chat
  const schedule = gameScheduler.getSchedule(chatId);
  
  if (!schedule) {
    return ctx.reply(
      `📅 **No Scheduled Games**\n\n` +
      `There are no scheduled games configured for this chat.\n\n` +
      `Admins can use /schedule to set up automatic recurring games.`,
      { parse_mode: 'Markdown' }
    );
  }
  
  // Check if schedule is paused
  if (!schedule.enabled) {
    return ctx.reply(
      `📅 **Scheduled Games Paused**\n\n` +
      `Automatic scheduled games are currently paused for this chat.\n\n` +
      `Admins can use /schedule resume to re-enable.`,
      { parse_mode: 'Markdown' }
    );
  }
  
  // Get current game info
  const currentGame = getCurrentGame(chatId);
  const hasActiveGame = currentGame && 
    (currentGame.state === 'WAITING' || 
     currentGame.state === 'NUMBER_SELECTION' || 
     currentGame.state === 'DRAWING');
  
  // Calculate next game info
  const now = Date.now();
  const timeUntilNext = schedule.nextRun.getTime() - now;
  const minutesUntilNext = Math.ceil(timeUntilNext / 60000);
  const hoursUntilNext = Math.floor(minutesUntilNext / 60);
  const minsRemaining = minutesUntilNext % 60;
  
  // Format times
  const nextGameTime = schedule.nextRun.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  const intervalHours = Math.floor(schedule.interval / 60);
  const intervalMins = schedule.interval % 60;
  const intervalStr = intervalHours > 0 
    ? `${intervalHours}h ${intervalMins > 0 ? intervalMins + 'm' : ''}`
    : `${intervalMins}m`;
  
  // Build response message
  let message = `📅 **Upcoming Scheduled Games**\n\n`;
  
  if (hasActiveGame) {
    message += `🎮 **Active Game:** ${currentGame.gameId}\n`;
    message += `👥 Players: ${currentGame.players.size}/${currentGame.maxPlayers}\n\n`;
  }
  
  message += `⏰ **Next Game:** ${nextGameTime}\n`;
  message += `⏳ Time Until: `;
  
  if (hoursUntilNext > 0) {
    message += `${hoursUntilNext}h ${minsRemaining}m\n`;
  } else {
    message += `${minutesUntilNext} minutes\n`;
  }
  
  message += `\n📊 **Schedule Details:**\n`;
  message += `• Interval: Every ${intervalStr}\n`;
  message += `• Max Players: ${schedule.maxPlayers}\n`;
  message += `• Survivors: ${schedule.survivors}\n`;
  message += `• Start Delay: ${schedule.startMinutes} minutes\n`;
  message += `• Games Run: ${schedule.runCount}\n`;
  
  if (schedule.lastRun) {
    const lastRunTime = schedule.lastRun.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    message += `• Last Game: ${lastRunTime}\n`;
  }
  
  message += `\n💰 **Prize Pool Tiers:**\n`;
  message += `• <10 players: 10K-20K\n`;
  message += `• <20 players: 10K-35K\n`;
  message += `• <30 players: 10K-50K\n`;
  message += `• <40 players: 10K-70K\n`;
  message += `• 50 players: 10K-100K\n`;
  
  // Add auto-activation info if within 30 minutes
  if (!hasActiveGame && minutesUntilNext <= 30) {
    message += `\n⚡ **Auto-Activation:** Game will open automatically when no active game is running!\n`;
  }
  
  // Add admin info
  const userId = ctx.from?.id?.toString();
  if (userId && isAdminUser(userId)) {
    message += `\n🔧 **Admin Commands:**\n`;
    message += `• /activatenext - Open next game early\n`;
    message += `• /schedule - Modify schedule\n`;
    message += `• /schedule pause - Pause schedule\n`;
  }
  
  return ctx.reply(message, { parse_mode: 'Markdown' });
});

// Send game announcement with optional player list
function sendGameAnnouncement(chatId: string, game: any, minutesLeft: number, includePlayerList: boolean) {
  const playerCount = game.players.size;
  const spotsLeft = game.maxPlayers - playerCount;
  
  // Format time announcement
  let timeText;
  if (minutesLeft >= 60) {
    const hours = Math.floor(minutesLeft / 60);
    const mins = minutesLeft % 60;
    timeText = mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (minutesLeft === 1) {
    timeText = '1 minute';
  } else {
    timeText = `${minutesLeft} minutes`;
  }
  
  let message;
  
  if (game.isSpecialEvent) {
    message = `🎉 **${game.eventName} - EVENT REMINDER!** 🎉\n\n`;
    message += `🏆 Event Prize: **${game.eventPrize.toLocaleString()} tokens**\n`;
    message += `🎲 Game ID: \`${game.gameId}\`\n`;
    message += `⏰ **Starting in ${timeText}**\n`;
    message += `👥 Players: **${playerCount}/${game.maxPlayers}**\n`;
  } else {
    message = `🎰 **Scheduled Game Reminder!**\n\n`;
    message += `🎲 Game ID: \`${game.gameId}\`\n`;
    message += `⏰ **Starting in ${timeText}**\n`;
    message += `👥 Players: **${playerCount}/${game.maxPlayers}**\n`;
  }
  
  if (playerCount > 0) {
    // Show progress bar
    const progress = Math.floor((playerCount / game.maxPlayers) * 10);
    const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);
    message += `📊 Progress: [${progressBar}]\n`;
  }
  
  if (spotsLeft > 0) {
    message += `\n✨ **${spotsLeft} spots remaining!**\n`;
  } else {
    message += `\n🔥 **Game is FULL!**\n`;
  }
  
  // Add urgency for final minutes
  if (minutesLeft <= 2) {
    message += `\n⚡ **FINAL CALL!** Game starts very soon!\n`;
  } else if (minutesLeft <= 5) {
    message += `\n⏳ Hurry! Limited time to join!\n`;
  }
  
  // Show current players if requested
  if (includePlayerList && playerCount > 0) {
    message += `\n**Current players:**\n`;
    const playerList = Array.from(game.players.values());
    if (playerCount <= 10) {
      playerList.forEach((player: any) => {
        message += `• ${escapeUsername(player.username)}\n`;
      });
    } else {
      // Show first 8 players and count
      playerList.slice(0, 8).forEach((player: any) => {
        message += `• ${escapeUsername(player.username)}\n`;
      });
      message += `• ... and ${playerCount - 8} more\n`;
    }
  }
  
  message += `\n💬 Type /join to participate NOW!`;
  
  const joinKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 Join Game', callback_data: `join_${game.gameId}` },
        { text: `📊 ${playerCount}/${game.maxPlayers}`, callback_data: `status_${game.gameId}` }
      ]
    ]
  };
  
  messageQueue.enqueue({
    type: 'announcement',
    chatId,
    content: message,
    options: { 
      parse_mode: 'Markdown',
      reply_markup: joinKeyboard
    },
    priority: minutesLeft <= 2 ? 'high' : 'normal'
  });
}

// Schedule all game announcements
function scheduleGameAnnouncements(chatId: string, game: any, totalMinutes: number) {
  // const startTimeMs = game.scheduledStartTime.getTime(); // Removed - unused variable
  const announcements: { time: number, includeList: boolean }[] = [];
  
  // Every minute for games longer than 5 minutes (with player list)
  if (totalMinutes > 5) {
    for (let min = totalMinutes - 1; min > 0; min--) {
      announcements.push({ time: min, includeList: true });
    }
  } else {
    // For shorter games, just do key times
    if (totalMinutes >= 3) announcements.push({ time: 3, includeList: true });
    if (totalMinutes >= 2) announcements.push({ time: 2, includeList: true });
    if (totalMinutes >= 1) announcements.push({ time: 1, includeList: true });
  }
  
  // Add final countdown announcements (no player list)
  announcements.push({ time: 0.5, includeList: false }); // 30 seconds
  announcements.push({ time: 0.25, includeList: false }); // 15 seconds
  announcements.push({ time: 0.083, includeList: false }); // 5 seconds
  
  // Schedule each announcement
  announcements.forEach(({ time, includeList }) => {
    const delayMs = (totalMinutes - time) * 60000;
    if (delayMs > 0) {
      setTimeout(() => {
        const currentGame = getCurrentGame(chatId);
        if (currentGame && currentGame.state === 'WAITING') {
          if (time >= 1) {
            // Minutes announcement
            sendGameAnnouncement(chatId, currentGame, Math.round(time), includeList);
          } else if (time === 0.5) {
            // 30 seconds
            sendFinalCountdown(chatId, currentGame, 30);
          } else if (time === 0.25) {
            // 15 seconds
            sendFinalCountdown(chatId, currentGame, 15);
          } else if (time === 0.083) {
            // 5 seconds - entries closed
            sendEntriesClosedAnnouncement(chatId, currentGame);
            // Schedule game start announcement
            setTimeout(() => {
              const game = getCurrentGame(chatId);
              if (game && game.state === 'IN_PROGRESS') {
                sendGameStartAnnouncement(chatId, game);
              }
            }, 5000);
          }
        }
      }, delayMs);
    }
  });
  
  logger.info(`Scheduled ${announcements.length} announcements for game ${game.gameId}`);
}

// Send final countdown announcement (30 or 15 seconds)
function sendFinalCountdown(chatId: string, game: any, seconds: number) {
  const playerCount = game.players.size;
  
  let message;
  
  if (game.isSpecialEvent) {
    message = `⏱️ **${seconds} SECONDS TO ${game.eventName.toUpperCase()}!** ⏱️\n\n`;
    message += `🎉 Event starts in ${seconds} seconds!\n`;
    message += `💰 Prize Pool: **${game.eventPrize.toLocaleString()} tokens**\n`;
    message += `👥 ${playerCount} players competing\n`;
    message += `\n🚀 LAST CHANCE TO JOIN THE EVENT!`;
  } else {
    message = `⏱️ **${seconds} SECONDS!**\n\n`;
    message += `🎮 Game starting in ${seconds} seconds!\n`;
    message += `👥 ${playerCount} players ready\n`;
    message += `\n💨 Last chance to join!`;
  }
  
  messageQueue.enqueue({
    type: 'announcement',
    chatId,
    content: message,
    options: { parse_mode: 'Markdown' },
    priority: 'high'
  });
}

// Send entries closed announcement
function sendEntriesClosedAnnouncement(chatId: string, game: any) {
  const playerCount = game.players.size;
  
  let message;
  
  if (game.isSpecialEvent) {
    message = `🚫 **${game.eventName.toUpperCase()} ENTRIES CLOSED!** 🚫\n\n`;
    message += `🎉 Event starting in 5 seconds...\n`;
    message += `💰 ${playerCount} players competing for **${game.eventPrize.toLocaleString()} tokens**!\n`;
    message += `\n🏆 May the best player win!`;
  } else {
    message = `🚫 **ENTRIES CLOSED!**\n\n`;
    message += `🎰 Lottery starting in 5 seconds...\n`;
    message += `👥 Final player count: **${playerCount}**\n`;
    message += `\n🎲 Get ready for the draw!`;
  }
  
  messageQueue.enqueue({
    type: 'announcement',
    chatId,
    content: message,
    options: { parse_mode: 'Markdown' },
    priority: 'critical'
  });
}

// Send game start announcement with full player list
function sendGameStartAnnouncement(chatId: string, game: any) {
  const playerList = Array.from(game.players.values());
  const playerCount = playerList.length;
  
  let message = `🎮 **GAME HAS BEGUN!**\n\n`;
  message += `🎲 Game ID: \`${game.gameId}\`\n`;
  message += `👥 Total Players: **${playerCount}**\n`;
  message += `🏆 Survivors: **${game.survivors}**\n`;
  message += `🔢 Number Range: **1-${playerCount * game.selectionMultiplier}**\n\n`;
  
  message += `**All Participants:**\n`;
  playerList.forEach((player: any, index: number) => {
    if (index < 20) {
      message += `${index + 1}. ${escapeUsername(player.username)}\n`;
    }
  });
  
  if (playerCount > 20) {
    message += `... and ${playerCount - 20} more\n`;
  }
  
  message += `\n🍀 Good luck everyone!`;
  
  messageQueue.enqueue({
    type: 'game',
    chatId,
    content: message,
    options: { parse_mode: 'Markdown' },
    priority: 'critical'
  });
}

// Helper: Create scheduled game
async function createScheduledGame(chatId: string, config: any) {
  const currentGame = getCurrentGame(chatId);
  
  // Don't create if game already active
  if (currentGame && currentGame.state !== 'FINISHED') {
    logger.info(`Skipping scheduled game for chat ${chatId} - game already active`);
    return;
  }
  
  const newGame = {
    id: `${chatId}_${Date.now()}`,
    gameId: Math.random().toString(36).substring(2, 8).toUpperCase(),
    creator: 'SCHEDULER',
    players: new Map(),
    state: 'WAITING',
    numberSelections: new Map(),
    createdAt: new Date(),
    maxPlayers: config.maxPlayers,
    numberRange: { min: 1, max: 2 },
    winnerCount: config.survivors,
    selectionMultiplier: 2,
    startMinutes: config.startMinutes,
    chatId: parseInt(chatId),
    scheduled: true,
    scheduledStartTime: new Date(Date.now() + config.startMinutes * 60000)
  };
  
  // Schedule game with absolute time
  const startTime = gameTimerManager.scheduleGame(
    newGame.gameId,
    chatId,
    config.startMinutes,
    () => startGame(chatId, newGame.gameId)
  );
  
  newGame.scheduledStartTime = startTime;
  
  setCurrentGame(chatId, newGame);
  
  // Format start time
  const startTimeStr = startTime.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
    
  const announceMessage = 
    `🎰 **SCHEDULED LOTTERY ANNOUNCED!** 🎰\n\n` +
    `🎲 Game ID: \`${newGame.gameId}\`\n` +
    `🤖 Auto-created by scheduler\n` +
    `⏰ **Starts at ${startTimeStr}** (in ${config.startMinutes} minutes)\n\n` +
    `📊 **Game Settings:**\n` +
    `• 👥 Max Players: **${config.maxPlayers}**\n` +
    `• 🏆 Survivors: **${config.survivors}**\n` +
    `• 🔢 Number Range: **1-${config.maxPlayers * 2}**\n` +
    `• 💰 Prize Pool: **10K-20K** (<10 players)\n` +
    `     35K max (<20), 50K (<30), 70K (<40), 100K (50)\n\n` +
    `✨ **GAME IS OPEN FOR JOINING NOW!**\n` +
    `🎯 Join early to secure your spot!\n\n` +
    `💬 Type /join or click the button below:`;
  
  const joinKeyboard = {
    inline_keyboard: [
      [
        { text: '🎮 Join Game', callback_data: `join_${newGame.gameId}` },
        { text: '📊 Status', callback_data: `status_${newGame.gameId}` }
      ]
    ]
  };
  
  messageQueue.enqueue({
    type: 'announcement',
    chatId,
    content: announceMessage,
    options: { 
      parse_mode: 'Markdown',
      reply_markup: joinKeyboard
    },
    priority: 'high'
  });
  
  // Schedule regular 5-minute announcements plus countdown notifications
  const announcementTimes = [];
  
  // Add 5-minute interval announcements
  for (let min = 5; min < config.startMinutes; min += 5) {
    announcementTimes.push(min);
  }
  
  // Add final countdown times (2 min, 1 min)
  if (config.startMinutes > 2) announcementTimes.push(2);
  if (config.startMinutes > 1) announcementTimes.push(1);
  
  // Sort in descending order (earliest announcement first)
  announcementTimes.sort((a, b) => b - a);
  
  announcementTimes.forEach(minutesLeft => {
    const delay = (config.startMinutes - minutesLeft) * 60000;
    setTimeout(() => {
      const game = getCurrentGame(chatId);
      if (game && game.state === 'WAITING') {
        sendGameAnnouncement(chatId, game, minutesLeft, true);
      }
    }, delay);
  });
}

// Parse game configuration
function parseGameConfig(text: string) {
  const gameDefaults = gameConfigManager.getConfig();
  const config = {
    maxPlayers: gameDefaults.defaultMaxPlayers,
    startMinutes: gameDefaults.defaultStartMinutes,
    survivors: 1,
    selectionMultiplier: gameDefaults.defaultNumberMultiplier,
    survivorsOverride: false,
    requiresApproval: false,
    raidEnabled: false,
    isSpecialEvent: false,
    eventPrize: 0,
    eventName: ''
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

  // Check for approval flag
  if (text.match(/(?:--?|—)approval/i)) {
    config.requiresApproval = true;
  }

  // Check for raid flags
  if (text.match(/(?:--?|—)raid/i)) {
    config.raidEnabled = true;
  }
  if (text.match(/(?:--?|—)no-?raid/i)) {
    config.raidEnabled = false;
  }

  // Check for special event flag
  const eventMatch = text.match(/(?:--?|—)event\s+(\d+)\s+"([^"]+)"/i);
  if (eventMatch) {
    config.isSpecialEvent = true;
    config.eventPrize = Math.min(Math.max(parseInt(eventMatch[1]), 1000), 1000000); // Between 1k and 1M
    config.eventName = eventMatch[2].substring(0, 50); // Limit event name to 50 chars
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

// Raid-related functions
async function pauseForRaid(chatId: string, game: any) {
  game.raidPaused = true;
  game.raidStartTime = new Date();
  game.raidMessageCount = 0;
  
  // Initial raid announcement
  await messageQueue.enqueue({
    type: 'announcement',
    chatId: chatId,
    content: `🚨 **RAID TIME!** 🚨\n\n` +
      `The lottery is PAUSED until everyone completes the raid!\n\n` +
      `💪 GET IN THERE AND ENGAGE!\n` +
      `❌ NO RAID = NO PRIZES!\n\n` +
      `Waiting for @memeworldraidbot to confirm completion...`,
    priority: 'critical'
  });
  
  // Start monitoring for raid bot messages
  startRaidMonitoring(chatId, game);
  
  // Start engagement reminder timer
  startEngagementReminders(chatId, game);
}

function startRaidMonitoring(chatId: string, game: any) {
  // Set up monitoring for raid bot messages
  // This will be handled by message event listener
  game.raidMonitorActive = true;
}

function startEngagementReminders(chatId: string, game: any) {
  const reminders = [
    `⚡ RAID STILL ACTIVE! Get in there or we cancel the whole thing!`,
    `😤 Not seeing enough engagement! PUMP THOSE NUMBERS!`,
    `🔥 Come on! We need EVERYONE in this raid or no prizes!`,
    `👀 Still waiting... Some of you better not be slacking!`,
    `💀 Engagement looking WEAK! Step it up or game over!`,
    `🚨 FINAL WARNING: Engage NOW or lottery gets cancelled!`
  ];
  
  const reminderInterval = setInterval(() => {
    if (!game.raidPaused) {
      clearInterval(reminderInterval);
      return;
    }
    
    const message = reminders[game.raidMessageCount % reminders.length];
    game.raidMessageCount++;
    
    messageQueue.enqueue({
      type: 'announcement',
      chatId: chatId,
      content: message,
      priority: 'high'
    });
    
    // After 10 messages, get more aggressive
    if (game.raidMessageCount > 10) {
      messageQueue.enqueue({
        type: 'announcement',
        chatId: chatId,
        content: `❌❌❌ ${game.raidMessageCount * 5} SECONDS WASTED! GET IN THE RAID! ❌❌❌`,
        priority: 'critical'
      });
    }
  }, 30000); // Every 30 seconds
  
  // Store interval ID for cleanup
  game.raidReminderInterval = reminderInterval;
}

async function handleRaidSuccess(chatId: string, game: any) {
  game.raidPaused = false;
  game.raidMonitorActive = false;
  
  // Clear reminder interval
  if (game.raidReminderInterval) {
    clearInterval(game.raidReminderInterval);
  }
  
  await messageQueue.enqueue({
    type: 'announcement',
    chatId: chatId,
    content: `✅ **RAID SUCCESSFUL!** ✅\n\n` +
      `Great job everyone! 🔥\n\n` +
      `The lottery will resume in 10 seconds...\n` +
      `Get ready for more eliminations! 💀`,
    priority: 'critical'
  });
  
  // Resume drawing after 10 seconds
  setTimeout(() => {
    const currentGame = getCurrentGame(chatId);
    if (currentGame && currentGame.state === 'DRAWING') {
      startDrawing(chatId);
    }
  }, 10000);
}

// Helper function to cancel a lottery game
async function cancelLotteryGame(chatId: string, game: any, reason: string = 'MANUAL') {
  // Mark game as finished and clean up
  game.state = 'FINISHED';
  game.endedAt = new Date();
  game.cancelReason = reason;
  setCurrentGame(chatId, game);
  
  // Cancel any active timers
  gameTimerManager.cancelGame(game.gameId);
  
  logger.info(`Game ${game.gameId} cancelled due to: ${reason}`);
}

async function handleRaidFailure(chatId: string, game: any, isFirstFailure: boolean = true) {
  // Don't unpause on failure - cancel the lottery
  game.raidMessageCount = 0;
  
  if (isFirstFailure) {
    await messageQueue.enqueue({
      type: 'announcement', 
      chatId: chatId,
      content: `❌ **RAID FAILED!** ❌\n\n` +
        `PATHETIC! Not enough engagement! 😤\n\n` +
        `🔚 **LOTTERY CANCELLED!** 🔚\n` +
        `💀 NO SUCCESSFUL RAID = NO PRIZES! 💀\n\n` +
        `Game over! Create a new lottery if you dare to try again!`,
      priority: 'critical'
    });
  } else {
    await messageQueue.enqueue({
      type: 'announcement',
      chatId: chatId,
      content: `🤬 **FAILED AGAIN?!** 🤬\n\n` +
        `This is embarrassing! Still can't complete a simple raid?!\n\n` +
        `🔚 **LOTTERY CANCELLED!** 🔚\n` +
        `You don't deserve prizes! Game is OVER!\n\n` +
        `Try creating a new game when you're ready to actually participate! 💪`,
      priority: 'critical'
    });
  }
  
  // Cancel the lottery game when raid fails
  await cancelLotteryGame(chatId, game, 'RAID_FAILURE');
  
  // Track failure count
  game.raidFailureCount = (game.raidFailureCount || 0) + 1;
}

// Check for overdue games and schedules periodically
setInterval(() => {
  // Check overdue games
  for (const [chatId, game] of gameStates) {
    if (game.state === 'WAITING' && gameTimerManager.isOverdue(game.gameId)) {
      logger.info(`Starting overdue game ${game.gameId}`);
      startGame(chatId);
    }
  }
  
  // Check overdue schedules
  gameScheduler.checkOverdueSchedules();
  
  // Check for scheduled games that can be auto-activated
  gameScheduler.checkAndActivateScheduledGames(getCurrentGame);
}, 10000); // Check every 10 seconds

// Callback query handler
bot.on('callback_query', async (ctx): Promise<any> => {
  const data = (ctx.callbackQuery as any).data;
  if (!data) return;

  // Handle quick actions (minimal UI)
  if (data.startsWith('quick:')) {
    const { quickJoin } = await import('./utils/quick-join.js');
    const action = data.split(':')[1];
    
    switch (action) {
      case 'join':
        await quickJoin.handleQuickJoin(ctx);
        break;
      case 'status':
        await quickJoin.showQuickStatus(ctx);
        break;
    }
    return;
  }
  
  // Handle user menu callbacks
  if (data.startsWith('user:')) {
    const { userMenu } = await import('./utils/user-menu.js');
    await userMenu.handleCallback(ctx, data);
    return;
  }
  
  // Handle admin menu callbacks
  if (data.startsWith('admin:')) {
    const userId = ctx.from!.id.toString();
    
    if (!isAdminUser(userId)) {
      return ctx.answerCbQuery('❌ Admin only');
    }
    
    try {
      await adminMenu.handleCallback(ctx, data);
    } catch (error) {
      logger.error('Admin menu error:', error);
      await ctx.answerCbQuery('❌ Error occurred');
    }
    return;
  }

  // Handle game join selection
  if (data.startsWith('join_game:')) {
    const gameId = data.split(':')[1];
    const userId = ctx.from!.id.toString();
    const username = ctx.from!.username || ctx.from!.first_name || 'Player';
    const chatId = ctx.chat!.id.toString();
    
    await joinGame(ctx, chatId, gameId, userId, username);
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    return;
  }
  
  if (data === 'cancel_join') {
    await ctx.answerCbQuery('Cancelled');
    await ctx.deleteMessage();
    return;
  }
  
  // Handle other callbacks (status, etc.)
  const [action, gameId] = data.split('_');
  
  switch (action) {
    // 'join' case removed - handled by bot.action(/join_(.+)/) above
    
    case 'status':
      const game = getCurrentGame(ctx.chat!.id.toString());
      if (game) {
        await ctx.answerCbQuery(`Players: ${game.players.size}/${game.maxPlayers}`);
      } else {
        await ctx.answerCbQuery('No active game');
      }
      break;
      
    default:
      await ctx.answerCbQuery();
  }
});

// Add missing commands from index.ts

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
  await handleStatsCommand(ctx);
});

// Command: /prizestats
bot.command('prizestats', async (ctx): Promise<any> => {
  await handlePrizeStatsCommand(ctx);
});

// Command: /winnerstats
bot.command('winnerstats', async (ctx): Promise<any> => {
  await handleWinnerStatsCommand(ctx);
});

// Command: /pauselottery (admin only)
bot.command('pauselottery', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Only admins can pause lottery games.');
  }
  
  if (!(await groupManager.isGroupEnabled(chatId))) {
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

// Command: /resumelottery (admin only)
bot.command('resumelottery', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  const chatId = ctx.chat.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ Only admins can resume lottery games.');
  }
  
  if (!(await groupManager.isGroupEnabled(chatId))) {
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
    }, 1000);
  }
});

// Command: /restart (admin)
bot.command('restart', async (ctx) => {
  const { handleRestartCommand } = await import('./commands/admin-commands.js');
  await handleRestartCommand(ctx);
});

// Command: /logs (admin)
bot.command('logs', async (ctx) => {
  const { handleLogsCommand } = await import('./commands/admin-commands.js');
  await handleLogsCommand(ctx);
});

// Command: /activegames (admin)
bot.command('activegames', async (ctx) => {
  const { handleActiveGamesCommand } = await import('./commands/admin-commands.js');
  await handleActiveGamesCommand(ctx);
});

// Command: /scheduleevent (admin)
bot.command('scheduleevent', async (ctx) => {
  const { handleScheduleEventCommand } = await import('./commands/admin-commands.js');
  await handleScheduleEventCommand(ctx);
});

// Command: /cancelevent (admin)
bot.command('cancelevent', async (ctx) => {
  const { handleCancelEventCommand } = await import('./commands/admin-commands.js');
  await handleCancelEventCommand(ctx);
});

// Group management commands
bot.command('addgroup', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  const chatId = ctx.chat.id.toString();
  const chatTitle = 'title' in ctx.chat ? ctx.chat.title : `Group ${chatId}`;
  
  if (await groupManager.addGroup(chatId, chatTitle || 'Unknown Group', userId)) {
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

bot.command('removegroup', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  const chatId = ctx.chat.id.toString();
  
  if (await groupManager.removeGroup(chatId)) {
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

bot.command('listgroups', async (ctx): Promise<any> => {
  const userId = ctx.from!.id.toString();
  
  if (!isAdminUser(userId)) {
    return ctx.reply('❌ You are not authorized to use this command.');
  }

  const groups = await groupManager.getGroups();
  
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

// Help command with nested command structure
bot.command('help', (ctx) => {
  const userId = ctx.from!.id.toString();
  const isAdmin = isAdminUser(userId);
  const args = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ') : [];
  const topic = args[1]; // /help [topic]
  
  // Handle specific help topics
  if (topic) {
    return handleHelpTopic(ctx, topic, isAdmin);
  }
  
  let message = '🎲 **SURVIVAL LOTTERY BOT HELP**\n\n';
  
  message += '📋 **QUICK START:**\n';
  message += '• `/create` - Create a new lottery game\n';
  message += '• `/join` - Join an active game\n';
  message += '• `/status` - Check game status\n';
  message += '• `/help commands` - See all commands\n\n';
  
  message += '🎯 **HOW TO PLAY:**\n';
  message += '• Join or create a lottery game\n';
  message += '• Each player gets a unique number\n';
  message += '• Numbers are drawn randomly\n';
  message += '• If your number is drawn, you\'re eliminated!\n';
  message += '• Last survivor(s) win prizes!\n\n';
  
  message += '📖 **HELP TOPICS:**\n';
  message += '• `/help commands` - All available commands\n';
  message += '• `/help game` - Game mechanics\n';
  message += '• `/help prizes` - Prize information\n';
  message += '• `/help stats` - Statistics commands\n';
  if (isAdmin) {
    message += '• `/help admin` - Admin commands\n';
  }
  
  message += '💰 **PRIZES:**\n';
  message += 'Winners split 10,000-50,000 tokens!\n\n';
  
  message += '🎮 **QUICK START:**\n';
  message += 'Type `/start` to open the main menu\n\n';
  
  if (isAdmin) {
    message += '👑 **ADMIN COMMANDS:**\n';
    message += '• `/admin` - Admin panel\n';
    message += '• `/create --event <prize> "<name>"` - Create special event\n';
    message += '• `/endgame` - End current game\n';
    message += '• `/pauselottery` - Pause active lottery\n';
    message += '• `/resumelottery` - Resume paused lottery\n';
    message += '• `/forcestart` - Force start waiting game\n';
    message += '• Group management and configuration\n\n';
    
    message += '🎉 **SPECIAL EVENTS:**\n';
    message += 'Create events with custom prizes:\n';
    message += '`/create --event 20000 "MWOR Madness"`\n\n';
  }
  
  message += '💡 **TIP:** Use `/start` for the interactive menu!';

  ctx.reply(message, { parse_mode: 'Markdown' });
});

// Handle help topics function
async function handleHelpTopic(ctx: Context, topic: string, isAdmin: boolean) {
  let message = '';
  
  switch (topic.toLowerCase()) {
    case 'commands':
      message = '📋 **ALL COMMANDS**\n\n';
      message += '🎮 **GAME COMMANDS:**\n';
      message += '• `/create` - Create a new lottery game\n';
      message += '• `/join` - Join an active lottery\n';
      message += '• `/status` - Check current game status\n';
      message += '• `/scheduled` - View scheduled games\n\n';
      
      message += '📊 **STATISTICS:**\n';
      message += '• `/stats` - Your personal statistics\n';
      message += '• `/leaderboard` - Top players\n';
      message += '• `/prizestats` - Prize distribution\n';
      message += '• `/winnerstats` - Biggest winners\n\n';
      
      message += '🔧 **UTILITY:**\n';
      message += '• `/start` - Show main menu\n';
      message += '• `/help [topic]` - This help system\n\n';
      
      if (isAdmin) {
        message += '👑 **ADMIN COMMANDS:**\n';
        message += '• `/admin` - Admin control panel\n';
        message += '• `/addadmin` - Add new admin (reply to user)\n';
        message += '• `/deleteadmin` - Remove admin (reply to user)\n';
        message += '• `/addgroup` - Enable bot in current group\n';
        message += '• `/removegroup` - Disable bot in current group\n';
        message += '• `/listgroups` - List all configured groups\n\n';
        
        message += '🎮 **GAME CONTROL:**\n';
        message += '• `/forcestart` - Force start waiting game\n';
        message += '• `/approve` - Approve pending game\n';
        message += '• `/endgame` - End current game\n';
        message += '• `/pauselottery` - Pause active game\n';
        message += '• `/resumelottery` - Resume paused game\n';
        message += '• `/resumedraw` - Resume drawing phase\n\n';
        
        message += '📅 **SCHEDULING:**\n';
        message += '• `/schedule` - Create game schedule\n';
        message += '• `/scheduleevent` - Schedule special event\n';
        message += '• `/cancelevent` - Cancel scheduled event\n';
        message += '• `/activatenext` - Activate next scheduled game\n';
        message += '• `/activegames` - List all active games\n\n';
        
        message += '🔧 **SYSTEM:**\n';
        message += '• `/restart` - Restart the bot\n';
        message += '• `/logs` - View recent logs\n';
      }
      break;
      
    case 'game':
      message = '🎯 **GAME MECHANICS**\n\n';
      message += '**How Lottery Works:**\n';
      message += '1️⃣ Players join a lottery game\n';
      message += '2️⃣ Each player gets a unique random number\n';
      message += '3️⃣ Game starts automatically or when full\n';
      message += '4️⃣ Numbers are drawn randomly one by one\n';
      message += '5️⃣ If your number is drawn, you\'re eliminated\n';
      message += '6️⃣ Last survivor(s) win the prize pool\n\n';
      
      message += '**Game Types:**\n';
      message += '• **Standard** - Random prize pool\n';
      message += '• **Custom** - Set player limits and delays\n';
      message += '• **Event** - Special themed games with custom prizes\n\n';
      
      message += '**Game States:**\n';
      message += '• **WAITING** - Players can join\n';
      message += '• **ACTIVE** - Drawing numbers\n';
      message += '• **PAUSED** - Temporarily stopped\n';
      message += '• **FINISHED** - Game completed\n';
      break;
      
    case 'prizes':
      message = '💰 **PRIZE INFORMATION**\n\n';
      message += '**Prize Pools:**\n';
      message += '• Standard games: 10,000-50,000 tokens\n';
      message += '• Event games: Custom amounts (up to 1M)\n';
      message += '• Multiple survivors split the prize\n\n';
      
      message += '**Prize Distribution:**\n';
      message += '• Equal split among all survivors\n';
      message += '• Minimum 1 survivor guaranteed\n';
      message += '• Maximum survivors: 3 (configurable)\n\n';
      
      message += '**How to Win:**\n';
      message += '• Survive until the end\n';
      message += '• Don\'t get your number drawn\n';
      message += '• Pure luck - no skill involved!\n';
      break;
      
    case 'stats':
      message = '📊 **STATISTICS COMMANDS**\n\n';
      message += '**Personal Stats:**\n';
      message += '• `/stats` - Your game history and performance\n';
      message += '• Shows games played, won, survival rate\n\n';
      
      message += '**Global Stats:**\n';
      message += '• `/leaderboard` - Top players by wins\n';
      message += '• `/prizestats` - Prize distribution analysis\n';
      message += '• `/winnerstats` - Biggest prize winners\n\n';
      
      message += '**Stat Categories:**\n';
      message += '• Games played and won\n';
      message += '• Total tokens earned\n';
      message += '• Average survival rounds\n';
      message += '• Win/loss ratio\n';
      break;
      
    case 'admin':
      if (!isAdmin) {
        message = '❌ Admin help is only available to administrators.';
        break;
      }
      message = '👑 **ADMIN HELP**\n\n';
      message += '**Admin Panel:**\n';
      message += '• Use `/admin` to access the full admin panel\n';
      message += '• All admin functions available through menus\n';
      message += '• Real-time game monitoring and control\n\n';
      
      message += '**Key Admin Functions:**\n';
      message += '• **Game Control** - Start, stop, pause games\n';
      message += '• **User Management** - Add/remove admins\n';
      message += '• **Group Management** - Enable/disable groups\n';
      message += '• **Scheduling** - Set up automated games\n';
      message += '• **System** - Restart bot, view logs\n\n';
      
      message += '**Emergency Commands:**\n';
      message += '• `/forcestart` - Force start stuck games\n';
      message += '• `/endgame` - Emergency game termination\n';
      message += '• `/restart confirm` - Bot restart with confirmation\n';
      break;
      
    default:
      message = `❌ **Unknown Help Topic: "${topic}"**\n\n`;
      message += 'Available topics:\n';
      message += '• `commands` - All available commands\n';
      message += '• `game` - Game mechanics\n';
      message += '• `prizes` - Prize information\n';
      message += '• `stats` - Statistics commands\n';
      if (isAdmin) {
        message += '• `admin` - Admin commands\n';
      }
      break;
  }
  
  await ctx.reply(message, { parse_mode: 'Markdown' });
}

// Command: /start
bot.command('start', (ctx) => {
  const userId = ctx.from!.id.toString();
  const isAdmin = isAdminUser(userId);
  
  const keyboard = [];
  
  if (isAdmin) {
    keyboard.push([
      { text: '👑 Admin Panel', callback_data: 'admin_panel' },
      { text: '🎮 Create Game', callback_data: 'create_game' }
    ]);
  } else {
    keyboard.push([
      { text: '🎮 Create Game', callback_data: 'create_game' },
      { text: '🎯 Join Game', callback_data: 'join_game' }
    ]);
  }
  
  keyboard.push([
    { text: '📊 Game Status', callback_data: 'game_status' },
    { text: '🏆 Leaderboard', callback_data: 'leaderboard' }
  ]);
  
  keyboard.push([
    { text: '📈 My Stats', callback_data: 'my_stats' },
    { text: '💰 Prize Stats', callback_data: 'user_prize_stats' }
  ]);
  
  keyboard.push([
    { text: '🏆 Top Winners', callback_data: 'user_winner_stats' }
  ]);
  
  keyboard.push([
    { text: '❓ Help', callback_data: 'help' },
    { text: '🔒 Private Menu', callback_data: 'user:private' }
  ]);
  
  ctx.reply(
    '🎰 **Welcome to Survival Lottery!**\n\n' +
    'Choose an option below to get started:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
});

// Monitor all messages for raid bot completion
bot.on('message', async (ctx) => {
  try {
    const message = ctx.message;
    
    // Check if this is from the raid bot
    if (message && 'text' in message && message.from?.id === 7747869380) { // @memeworldraidbot
      const chatId = ctx.chat.id.toString();
      const currentGame = getCurrentGame(chatId);
      const messageText = message.text;
      
      // Check if there's an active game that can be paused for raids
      if (messageText && (messageText.includes('⚔️ RAID IN PROGRESS ⚔️') || 
                          messageText.includes('🚨 Raid ongoing') ||
                          messageText.includes('RAID IN PROGRESS'))) {
        logger.info(`Raid message detected. Current game: ${currentGame ? 'exists' : 'none'}, state: ${currentGame?.state}, raidEnabled: ${currentGame?.raidEnabled}`);
      }
      
      if (currentGame && currentGame.state === 'DRAWING' && currentGame.raidEnabled) {
        
        // Detect RAID IN PROGRESS - pause the game if not already paused
        if ((messageText.includes('⚔️ RAID IN PROGRESS ⚔️') || 
             messageText.includes('🚨 Raid ongoing') ||
             messageText.includes('RAID IN PROGRESS')) && !currentGame.raidPaused) {
          logger.info('Active raid detected - pausing lottery');
          logger.info(`Game state: ${currentGame.state}, raidEnabled: ${currentGame.raidEnabled}, raidPaused: ${currentGame.raidPaused}`);
          
          // Check if we're past halfway point
          const totalPlayers = currentGame.players.size;
          const activePlayers = new Set();
          for (const [playerId, player] of currentGame.players) {
            if (!player.eliminated) {
              activePlayers.add(playerId);
            }
          }
          const eliminated = totalPlayers - activePlayers.size;
          const halfwayPoint = Math.floor(totalPlayers / 2);
          
          if (eliminated >= halfwayPoint && activePlayers.size > currentGame.winnerCount + 2) {
            await pauseForRaid(chatId, currentGame);
          }
        }
      }
      
      // Check for raid completion if game is paused and waiting
      if (currentGame && currentGame.raidPaused && currentGame.raidMonitorActive) {
        
        // Check for success message
        if (messageText.includes('🎊 Raid Ended - Targets Reached!') || 
            messageText.includes('🟩 Likes') || 
            messageText.includes('🔥 Trending')) {
          logger.info('Raid success detected from raid bot');
          await handleRaidSuccess(chatId, currentGame);
        }
        // Check for failure message
        else if (messageText.includes('⚠️ Raid Ended - Time limit reached!') || 
                 messageText.includes('🟥 Likes')) {
          logger.info('Raid failure detected from raid bot');
          const isFirstFailure = !currentGame.raidFailureCount || currentGame.raidFailureCount === 0;
          await handleRaidFailure(chatId, currentGame, isFirstFailure);
        }
      }
    }
  } catch (error) {
    logger.error('Error in message handler:', error);
  }
});

// Error handler
bot.catch((err: any, ctx) => {
  logger.error(`Error for ${ctx.updateType}:`, err);
});

// Simple health check endpoint for Railway
if (process.env.PORT) {
  const http = require('http');
  const server = http.createServer((req: any, res: any) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  server.listen(process.env.PORT, () => {
    logger.info(`Health check server listening on port ${process.env.PORT}`);
  });
}

// Start bot
async function startBot() {
  try {
    // Initialize Redis connection
    await initializeRedis();
    console.log('🔴 Redis initialized for game persistence');
    
    // Initialize wallet manager if Solana RPC is configured
    try {
      if (process.env.SOLANA_RPC_URL) {
        await botWalletManager.initializeWallet();
      } else {
        console.log('⚠️  Solana wallet not configured, running without blockchain features');
      }
    } catch (walletError) {
      console.log('⚠️  Wallet initialization failed, continuing without blockchain features:', walletError.message);
    }
    
    const me = await bot.telegram.getMe();
    logger.info('✅ Bot started:', me.username);
    
    await bot.launch();
    
    console.log('🎰 Enhanced Lottery Bot Running!');
    console.log('📬 Advanced message queuing active');
    console.log('🎯 Dynamic game speed enabled');
    console.log('🎭 Suspense messages ready');
    console.log('🚀 Zero response to late joins');
    
  } catch (error: any) {
    logger.error('Failed to start bot:', error.message);
    logger.error('Full error:', error);
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Exports for admin commands and other modules
export { getCurrentGame, getActiveGames, isAdminUser };

// Export function to create event games
export async function createEventGame(params: {
  chatId: string;
  prizeAmount: number;
  eventName: string;
}): Promise<void> {
  const { chatId, prizeAmount, eventName } = params;
  
  // Check if there's already an active game
  const currentGame = getCurrentGame(chatId);
  if (currentGame) {
    throw new Error('A game is already active in this chat');
  }
  
  // Create the event game using the bot context
  const ctx = {
    chat: { id: chatId },
    from: { id: 'system', username: 'System' },
    reply: async (text: string, options?: any) => {
      await bot.telegram.sendMessage(chatId, text, options);
    }
  };
  
  // Trigger game creation with event parameters
  const command = `/create --event ${prizeAmount} "${eventName}"`;
  const fakeMessage = {
    message: {
      text: command,
      from: { id: 'system' },
      chat: { id: chatId },
      date: Date.now()
    }
  };
  
  await bot.handleUpdate(fakeMessage as any);
}