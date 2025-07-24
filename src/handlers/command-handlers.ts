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
    leaderboardMessage += 'Rank Player              Wins Games  Rate\n';
    leaderboardMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    
    for (let i = 0; i < topPlayers.length; i++) {
      const player = topPlayers[i];
      const rank = i + 1;
      const winRate = player.gamesEntered > 0 ? (player.gamesWon / player.gamesEntered * 100).toFixed(1) : '0.0';
      
      let medal = '';
      if (rank === 1) medal = '🥇';
      else if (rank === 2) medal = '🥈';
      else if (rank === 3) medal = '🥉';
      else medal = `${rank}.`.padStart(3, ' ');
      
      const rankStr = medal.padEnd(4, ' ');
      const username = player.username.length > 16 ? player.username.substring(0, 16) : player.username;
      const usernameStr = username.padEnd(18, ' ');
      const wins = player.gamesWon.toString().padStart(4, ' ');
      const games = player.gamesEntered.toString().padStart(5, ' ');
      const rate = `${winRate}%`.padStart(6, ' ');
      
      leaderboardMessage += `${rankStr}${usernameStr} ${wins} ${games} ${rate}\n`;
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
      const totalWinnings = await prizeManager.getUserTotalWinningsAsync(userId);
      
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
    // Get top players from leaderboard (players with wins)
    const allPlayers = await leaderboard.getLeaderboardAsync(100);
    const topWinners = allPlayers.filter(player => player.gamesWon > 0).slice(0, 20);
    
    let winnersMessage = '🏆 **TOP WINNERS** 🏆\n\n';
    
    if (topWinners.length === 0) {
      winnersMessage += 'No winners yet!\n\nUse /create to start a lottery!';
    } else {
      winnersMessage += '```\n';
      winnersMessage += 'Rank Player              Wins Games  Rate\n';
      winnersMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      
      topWinners.forEach((winner, index) => {
        const rank = index + 1;
        const winRate = (winner.gamesWon / winner.gamesEntered * 100).toFixed(1);
        
        let medal = '';
        if (rank === 1) medal = '🥇';
        else if (rank === 2) medal = '🥈'; 
        else if (rank === 3) medal = '🥉';
        else medal = `${rank}.`.padStart(3, ' ');
        
        const rankStr = medal.padEnd(4, ' ');
        const username = winner.username.length > 16 ? winner.username.substring(0, 16) : winner.username;
        const usernameStr = username.padEnd(18, ' ');
        const wins = winner.gamesWon.toString().padStart(4, ' ');
        const games = winner.gamesEntered.toString().padStart(5, ' ');
        const rate = `${winRate}%`.padStart(6, ' ');
        
        winnersMessage += `${rankStr}${usernameStr} ${wins} ${games} ${rate}\n`;
      });
      
      winnersMessage += '```';
    }
    
    winnersMessage += '\n🎮 Only showing players with wins!';
    
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