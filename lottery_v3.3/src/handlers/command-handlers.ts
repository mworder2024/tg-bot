import { Context } from 'telegraf';
import { leaderboard } from '../leaderboard';
import { prizeManager } from '../utils/prize-manager';
import { logger } from '../utils/logger';

/**
 * Handle leaderboard command
 */
export async function handleLeaderboardCommand(ctx: Context): Promise<void> {
  try {
    const topPlayers = leaderboard.getLeaderboard(15);
    const totalGames = leaderboard.getTotalGames();
    
    if (topPlayers.length === 0) {
      await ctx.reply('🏆 No games played yet!\n\nUse /create to start the first lottery!');
      return;
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
      
      if (rank < topPlayers.length) {
        leaderboardMessage += '\n';
      }
    }
    
    leaderboardMessage += '\n🎮 Play more games to climb the ranks!';
    
    await ctx.reply(leaderboardMessage);
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
    const stats = leaderboard.getPlayerStats(userId);
    
    let statsMessage = `📊 STATS FOR ${username.toUpperCase()} 📊\n\n`;
    
    if (!stats || stats.gamesEntered === 0) {
      statsMessage += `No games played yet!\n\nUse /join to enter a lottery!`;
    } else {
      const winRate = (stats.gamesWon / stats.gamesEntered * 100).toFixed(1);
      const globalRank = leaderboard.getPlayerRank(userId);
      
      statsMessage += `🏆 Rank: #${globalRank || 'Unranked'}\n`;
      statsMessage += `🏅 Games Won: ${stats.gamesWon}\n`;
      statsMessage += `🎮 Games Entered: ${stats.gamesEntered}\n`;
      statsMessage += `📈 Win Rate: ${winRate}%\n`;
      
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
    const prizeStats = prizeManager.getPrizeStats();
    const recentPrizes = prizeManager.getRecentPrizes(5);
    
    let statsMessage = '💰 **PRIZE STATISTICS** 💰\n\n';
    statsMessage += `🏆 Total Games: ${prizeStats.totalGames}\n`;
    statsMessage += `💵 Total Paid: ${prizeStats.totalPaid.toLocaleString()} tokens\n`;
    statsMessage += `📊 Average Prize: ${Math.round(prizeStats.averagePrize).toLocaleString()} tokens\n\n`;
    
    if (recentPrizes.length > 0) {
      statsMessage += '📝 **Recent Prizes:**\n';
      recentPrizes.forEach((prize, index) => {
        const date = new Date(prize.timestamp).toLocaleDateString();
        statsMessage += `${index + 1}. ${prize.prizeAmount.toLocaleString()} tokens (${date})\n`;
      });
    }
    
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
    const userWinnings = prizeManager.getUserWinnings();
    const topWinners = userWinnings.slice(0, 10);
    
    let winnersMessage = '🏆 **TOP WINNERS** 🏆\n\n';
    
    if (topWinners.length === 0) {
      winnersMessage += 'No winners yet!';
    } else {
      topWinners.forEach((winner, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        winnersMessage += `${medal} **${winner.username}**\n`;
        winnersMessage += `   💰 ${winner.totalWinnings.toLocaleString()} tokens\n`;
        winnersMessage += `   🏆 ${winner.gamesWon} wins\n\n`;
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