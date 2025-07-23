// Simple sync utility to keep Telegram bot and web in sync
import { Server as SocketIOServer } from 'socket.io';

export class LotterySync {
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  // Call this when someone joins via Telegram
  playerJoinedFromTelegram(gameId: string, username: string, walletAddress: string) {
    this.io.emit('lottery_update', {
      type: 'player_joined',
      source: 'telegram',
      gameId,
      username,
      walletAddress,
      timestamp: new Date()
    });
  }

  // Call this when someone joins via Web
  playerJoinedFromWeb(gameId: string, walletAddress: string) {
    this.io.emit('lottery_update', {
      type: 'player_joined',
      source: 'web',
      gameId,
      walletAddress,
      timestamp: new Date()
    });
  }

  // Call this when a draw starts
  drawStarting(gameId: string) {
    this.io.emit('draw_starting', {
      gameId,
      countdown: 10,
      timestamp: new Date()
    });
  }

  // Call this when draw is complete
  drawComplete(gameId: string, winningNumbers: number[], winners: string[]) {
    this.io.emit('draw_result', {
      gameId,
      winningNumbers,
      winners,
      timestamp: new Date()
    });
  }

  // Call this when a new lottery is created
  lotteryCreated(gameId: string, type: string, drawTime: Date) {
    this.io.emit('lottery_created', {
      gameId,
      type,
      drawTime,
      timestamp: new Date()
    });
  }
}

// Usage in your Telegram bot:
// const sync = new LotterySync(io);
// 
// bot.on('text', async (ctx) => {
//   if (ctx.message.text === '/join') {
//     // ... existing join logic ...
//     sync.playerJoinedFromTelegram(gameId, username, wallet);
//   }
// });