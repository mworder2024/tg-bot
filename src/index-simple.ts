import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import * as winston from 'winston';
import { VRF } from './utils/vrf';

// Load environment variables
dotenv.config();

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ],
});

// Check required environment variables
const requiredEnvVars = ['BOT_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Type definitions
interface Player {
  id: string;
  username: string;
  isAlive: boolean;
}

interface Game {
  chatId: string;
  players: Map<string, Player>;
  numbers: number[];
  status: 'waiting' | 'started' | 'finished';
  createdAt: Date;
  round: number;
  currentBubbleNumber: number;
}

// Game states
const gameStates: Map<string, Game> = new Map();

// Helper functions
function getCurrentGame(chatId: string): Game | null {
  return gameStates.get(chatId) || null;
}

function setCurrentGame(chatId: string, game: Game): void {
  gameStates.set(chatId, game);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN!);

// Initialize VRF
const vrf = new VRF();

// Command handlers
bot.command('start', (ctx) => {
  ctx.reply('Welcome to the Lottery Bot! 🎲\n\nCommands:\n/creategame - Create a new lottery game\n/join - Join the current game\n/status - Check game status');
});

bot.command('creategame', async (ctx) => {
  const chatId = ctx.chat!.id.toString();
  
  if (getCurrentGame(chatId)) {
    return ctx.reply('A game is already in progress!');
  }
  
  const game: Game = {
    chatId,
    players: new Map<string, Player>(),
    numbers: [],
    status: 'waiting' as const,
    createdAt: new Date(),
    round: 1,
    currentBubbleNumber: 1
  };
  
  setCurrentGame(chatId, game);
  ctx.reply('🎲 New lottery game created!\n\nPlayers can join using /join\nStart the game with /startgame when ready.');
});

bot.command('join', async (ctx) => {
  const chatId = ctx.chat!.id.toString();
  const game = getCurrentGame(chatId);
  
  if (!game) {
    return ctx.reply('No game in progress. Create one with /creategame');
  }
  
  if (game.status !== 'waiting') {
    return ctx.reply('Game already started!');
  }
  
  const userId = ctx.from!.id.toString();
  const username = ctx.from!.username || ctx.from!.first_name || 'Anonymous';
  
  if (game.players.has(userId)) {
    return ctx.reply('You are already in the game!');
  }
  
  game.players.set(userId, {
    id: userId,
    username,
    isAlive: true
  });
  
  ctx.reply(`${username} joined the game! Total players: ${game.players.size}`);
});

bot.command('startgame', async (ctx) => {
  const chatId = ctx.chat!.id.toString();
  const game = getCurrentGame(chatId);
  
  if (!game) {
    return ctx.reply('No game in progress. Create one with /creategame');
  }
  
  if (game.status !== 'waiting') {
    return ctx.reply('Game already started!');
  }
  
  if (game.players.size < 2) {
    return ctx.reply('Need at least 2 players to start!');
  }
  
  game.status = 'started';
  const totalNumbers = 99;
  game.numbers = Array.from({ length: totalNumbers }, (_, i) => i + 1);
  
  ctx.reply(`🎯 Game started with ${game.players.size} players!\n\nDrawing numbers...`);
  
  // Simple game loop
  const gameLoop = setInterval(async () => {
    if (game.numbers.length === 0 || Array.from(game.players.values()).filter(p => p.isAlive).length <= 1) {
      clearInterval(gameLoop);
      
      const winner = Array.from(game.players.values()).find(p => p.isAlive);
      if (winner) {
        ctx.reply(`🏆 Game Over! Winner: @${winner.username}`);
      } else {
        ctx.reply('Game Over! No winner.');
      }
      
      gameStates.delete(chatId);
      return;
    }
    
    // Draw a random number
    const randomIndex = Math.floor(Math.random() * game.numbers.length);
    const drawnNumber = game.numbers.splice(randomIndex, 1)[0];
    
    // Eliminate a random player
    const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
    if (alivePlayers.length > 1) {
      const randomPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      randomPlayer.isAlive = false;
      
      ctx.reply(`Number ${drawnNumber} drawn! 💥 @${randomPlayer.username} eliminated!\n\nPlayers remaining: ${alivePlayers.length - 1}`);
    }
    
  }, 5000); // Draw every 5 seconds
});

bot.command('status', async (ctx) => {
  const chatId = ctx.chat!.id.toString();
  const game = getCurrentGame(chatId);
  
  if (!game) {
    return ctx.reply('No game in progress.');
  }
  
  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
  ctx.reply(`Game Status: ${game.status}\nPlayers alive: ${alivePlayers.length}\nNumbers remaining: ${game.numbers.length}`);
});

// Error handling
bot.catch((err: any, ctx: any) => {
  logger.error('Bot error:', err);
  ctx.reply('An error occurred!');
});

// Start bot
bot.launch().then(() => {
  logger.info('Simple lottery bot started successfully!');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));