import { Context } from 'telegraf';
import { leaderboard } from '../leaderboard';
import { prizeManager } from '../utils/prize-manager';
import { logger } from '../utils/logger';
import { escapeUsername } from '../utils/markdown-escape';

/**
 * Handle leaderboard command
 */
export async function handleLeaderboardCommand(ctx: Context): Promise<void> {
  try {
    const topPlayers = await leaderboard.getLeaderboardAsync(15);
    const totalGames = await leaderboard.getTotalGamesAsync();
    
    if (topPlayers.length === 0) {
      await ctx.reply('🏆 No games played yet!\n\nUse /create to start the first lottery!');
      return;
    }
    
    let leaderboardMessage = `🏆 **SURVIVAL LOTTERY LEADERBOARD** 🏆\n\n`;
    leaderboardMessage += `📊 Total Games Played: ${totalGames}\n\n`;
    leaderboardMessage += '```\n';
    
    for (let i = 0; i < topPlayers.length; i++) {
      const player = topPlayers[i];
      const rank = i + 1;
      const winRate = player.gamesEntered > 0 ? (player.gamesWon / player.gamesEntered * 100).toFixed(1) : '0.0';
      
      let medal = '';
      if (rank === 1) medal = '🥇';
      else if (rank === 2) medal = '🥈';
      else if (rank === 3) medal = '🥉';
      else medal = `${rank}.`;
      
      const rankStr = medal.padEnd(4, ' ');
      const username = player.username.padEnd(18, ' ');
      const wins = player.gamesWon.toString().padStart(2, ' ');
      const games = player.gamesEntered.toString().padStart(3, ' ');
      const rate = winRate.padStart(5, ' ');
      
      leaderboardMessage += `${rankStr}${username} 🏅 ${wins} wins | 🎮 ${games} games | 📈 ${rate}%\n`;
    }
    
    leaderboardMessage += '```';
    
    leaderboardMessage += '\n🎮 Play more games to climb the ranks!';
    
    await ctx.reply(leaderboardMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in leaderboard command:', error);
    await ctx.reply('Sorry, there was an error loading the leaderboard.');
  }
}

/**
 * Handle stats command
 */
export async function handleStatsCommand(ctx: Context): Promise<void> {
  try {
    const userId = ctx.from!.id.toString();
    const username = ctx.from!.username || ctx.from!.first_name || 'Player';
    const stats = await leaderboard.getPlayerStatsAsync(userId);
    
    let statsMessage = `📊 STATS FOR ${username.toUpperCase()} 📊\n\n`;
    
    if (!stats || stats.gamesEntered === 0) {
      statsMessage += `No games played yet!\n\nUse /join to enter a lottery!`;
    } else {
      const winRate = (stats.gamesWon / stats.gamesEntered * 100).toFixed(1);
      const globalRank = await leaderboard.getPlayerRankAsync(userId);
      const totalWinnings = prizeManager.getUserTotalWinnings(userId);
      
      statsMessage += `🏆 Rank: #${globalRank || 'Unranked'}\n`;
      statsMessage += `🏅 Games Won: ${stats.gamesWon}\n`;
      statsMessage += `🎮 Games Entered: ${stats.gamesEntered}\n`;
      statsMessage += `📈 Win Rate: ${winRate}%\n`;
      statsMessage += `💰 Total Winnings: ${totalWinnings.toLocaleString()} tokens\n`;
      
      // Get recent games
      const recentGames = leaderboard.getPlayerRecentGames(userId, 5);
      if (recentGames.length > 0) {
        statsMessage += `\n📝 Recent Games:\n`;
        recentGames.forEach((game, index) => {
          const result = game.won ? '✅ Won' : '❌ Lost';
          const date = new Date(game.timestamp).toLocaleDateString();
          statsMessage += `${index + 1}. ${result} - ${date}\n`;
        });
      }
    }
    
    await ctx.reply(statsMessage);
  } catch (error) {
    logger.error('Error in stats command:', error);
    await ctx.reply('Sorry, there was an error loading your stats.');
  }
}

/**
 * Handle prize stats command
 */
export async function handlePrizeStatsCommand(ctx: Context): Promise<void> {
  try {
    const prizeStats = await prizeManager.getPrizeStatsAsync();
    const recentPrizes = await prizeManager.getRecentPrizesAsync(20);
    const recentWinners = await prizeManager.getRecentWinnersAsync(20);
    
    let statsMessage = '💰 **PRIZE STATISTICS** 💰\n\n';
    statsMessage += `💸 Total Prizes Paid: ${prizeStats.totalPaid.toLocaleString()}\n`;
    statsMessage += `🎮 Total Games with Prizes: ${prizeStats.totalGames}\n`;
    statsMessage += `📊 Average Prize: ${Math.round(prizeStats.averagePrize).toLocaleString()}\n\n`;
    
    if (recentPrizes.length > 0) {
      statsMessage += '🏆 **Recent Prizes:**\n\n```\n';
      recentPrizes.forEach((prize, index) => {
        const num = (index + 1).toString();
        const rank = num.padEnd(3, ' ');
        const date = new Date(prize.timestamp).toLocaleDateString();
        const dateStr = date.padEnd(12, ' ');
        const prizeAmount = prize.prizeAmount.toLocaleString().padStart(8, ' ');
        const perSurvivor = prize.prizePerSurvivor.toLocaleString().padStart(8, ' ');
        
        // Get winners for this game
        const gameWinners = recentWinners.filter(w => w.gameId === prize.gameId);
        const winnerNames = gameWinners.map(w => w.username || 'Unknown').join(', ');
        
        if (gameWinners.length > 0) {
          const names = winnerNames.length > 25 ? winnerNames.substring(0, 22) + '...' : winnerNames.padEnd(25, ' ');
          statsMessage += `${rank}${dateStr} 💰${prizeAmount} → ${names} (${gameWinners.length}x${perSurvivor})\n`;
        } else {
          statsMessage += `${rank}${dateStr} 💰${prizeAmount} → No winner data (${prize.totalSurvivors} winners)\n`;
        }
      });
      statsMessage += '```';
    }
    
    statsMessage += '\n💡 Use /create to start a new lottery with automatic VRF prize generation!';
    
    await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in prize stats command:', error);
    await ctx.reply('Sorry, there was an error loading prize statistics.');
  }
}

/**
 * Handle winner stats command
 */
export async function handleWinnerStatsCommand(ctx: Context): Promise<void> {
  try {
    const userWinnings = await prizeManager.getUserWinningsAsync();
    const topWinners = userWinnings.slice(0, 20);
    
    let winnersMessage = '🏆 **TOP WINNERS** 🏆\n\n';
    
    if (topWinners.length === 0) {
      winnersMessage += 'No winners yet!';
    } else {
      topWinners.forEach((winner, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${(index + 1).toString().padEnd(2, ' ')}.`;
        const username = winner.username || 'Unknown';
        const paddedUsername = username.padEnd(18, ' ');
        const tokens = winner.totalWinnings.toLocaleString().padStart(9, ' ');
        const wins = winner.gamesWon;
        const winText = wins === 1 ? 'win' : 'wins';
        winnersMessage += `${medal}  ${paddedUsername} 💰 ${tokens} tokens (🏆 ${wins} ${winText})\n`;
      });
    }
    
    await ctx.reply(winnersMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in winner stats command:', error);
    await ctx.reply('Sorry, there was an error loading winner statistics.');
  }
}

/**
 * Handle status command
 */
export async function handleStatusCommand(ctx: Context, getCurrentGame: () => any): Promise<void> {
  try {
    // const chatId = ctx.chat!.id.toString(); // Removed unused variable
    const currentGame = getCurrentGame();
    
    if (!currentGame) {
      await ctx.reply('🎮 No active lottery in this chat.\n\nUse /create to start a new lottery!');
      return;
    }
    
    let statusMessage = '🎰 **LOTTERY STATUS** 🎰\n\n';
    statusMessage += `🎮 Game ID: ${currentGame.id}\n`;
    statusMessage += `👥 Players: ${currentGame.players.length}/${currentGame.maxPlayers}\n`;
    statusMessage += `🏆 Survivors: ${currentGame.survivors}\n`;
    statusMessage += `📍 State: ${currentGame.state}\n`;
    
    if (currentGame.state === 'WAITING') {
      const timeRemaining = Math.max(0, currentGame.startTime - Date.now());
      const minutesRemaining = Math.ceil(timeRemaining / 60000);
      statusMessage += `⏱️ Starting in: ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}\n`;
    }
    
    statusMessage += '\n👥 **Players:**\n';
    currentGame.players.forEach((player: any, index: number) => {
      statusMessage += `${index + 1}. ${player.username}\n`;
    });
    
    await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in status command:', error);
    await ctx.reply('Sorry, there was an error loading the game status.');
  }
}