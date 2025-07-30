import { Context } from 'telegraf';
import { logger } from './logger';
import { escapeUsername } from './markdown-escape';

/**
 * Quick join functionality for lottery games with minimal UI disruption
 */
export class QuickJoin {
  /**
   * Handle quick join with ephemeral response
   */
  static async handleQuickJoin(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id.toString();
      const chatId = ctx.chat?.id.toString();
      
      if (!userId || !chatId) {
        await ctx.answerCbQuery('❌ Error processing request');
        return;
      }

      // Import game functions
      const { getCurrentGame } = await import('../index.js');
      const currentGame = getCurrentGame(chatId);

      if (!currentGame) {
        await ctx.answerCbQuery('❌ No active game to join', { show_alert: true });
        return;
      }

      if (currentGame.state !== 'WAITING') {
        await ctx.answerCbQuery('❌ Game not accepting players', { show_alert: true });
        return;
      }

      // Check if already joined
      const existingPlayer = currentGame.players.find((p: any) => p.userId === userId);
      if (existingPlayer) {
        await ctx.answerCbQuery('✅ You\'re already in the game!', { show_alert: false });
        return;
      }

      // Check if game is full
      if (currentGame.players.length >= currentGame.maxPlayers) {
        await ctx.answerCbQuery('❌ Game is full', { show_alert: true });
        return;
      }

      // Add player
      const username = ctx.from?.username || ctx.from?.first_name || 'Player';
      const playerNumber = Math.floor(Math.random() * (currentGame.maxPlayers * 2)) + 1;
      
      currentGame.players.push({
        userId,
        username,
        number: playerNumber,
        isAlive: true,
        joinedAt: Date.now()
      });

      // Private success response to user
      await ctx.answerCbQuery(`✅ Joined! Your number: ${playerNumber}`, { show_alert: false });

      // Send public announcement to group
      const displayName = ctx.from?.username || ctx.from?.first_name || 'Player';
      await ctx.telegram.sendMessage(
        chatId,
        `🎯 **${escapeUsername(displayName)}** joined the lottery! ` +
        `(${currentGame.players.length}/${currentGame.maxPlayers} players)`,
        { parse_mode: 'Markdown' }
      );

      // Optional: Update the original message to show new player count
      if (ctx.callbackQuery?.message) {
        try {
          const updatedText = `🎰 **Lottery Game Active**\n\n` +
            `👥 Players: ${currentGame.players.length}/${currentGame.maxPlayers}\n` +
            `💰 Prize Pool: ${currentGame.prizeAmount || 'Standard'}\n` +
            `⏰ Status: ${currentGame.state}\n` +
            `\n📝 **Recent Players:**\n` +
            currentGame.players.slice(-3).map((p: any) => `• ${p.username}`).join('\n');

          await ctx.editMessageText(updatedText, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: `👥 Quick Join (${currentGame.players.length}/${currentGame.maxPlayers})`, callback_data: 'quick:join' },
                  { text: '📊 Status', callback_data: 'user:status' }
                ],
                [
                  { text: '🔢 My Number', callback_data: 'user:mynumber' },
                  { text: '📈 Stats', callback_data: 'user:stats' }
                ]
              ]
            }
          });
        } catch (error) {
          // Message might be too old to edit, that's okay
          logger.debug('Could not update message after join:', error);
        }
      }

    } catch (error) {
      logger.error('Error in quick join:', error);
      await ctx.answerCbQuery('❌ Error joining game');
    }
  }

  /**
   * Show minimal game status
   */
  static async showQuickStatus(ctx: Context): Promise<void> {
    try {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;

      const { getCurrentGame } = await import('../index.js');
      const currentGame = getCurrentGame(chatId);

      if (!currentGame) {
        await ctx.answerCbQuery('❌ No active game', { show_alert: true });
        return;
      }

      const status = `🎰 Game Status:\n` +
        `👥 Players: ${currentGame.players.length}/${currentGame.maxPlayers}\n` +
        `📊 State: ${currentGame.state}\n` +
        `💰 Prize: ${currentGame.prizeAmount || 'Standard'}`;

      await ctx.answerCbQuery(status, { show_alert: true });

    } catch (error) {
      logger.error('Error showing quick status:', error);
      await ctx.answerCbQuery('❌ Error loading status');
    }
  }
}

export const quickJoin = QuickJoin;