import { Context } from 'telegraf';
import { logger } from './logger';

/**
 * Handle private menu responses to avoid cluttering group chats
 */
export class PrivateMenuHandler {
  /**
   * Send a private menu to the user
   */
  async sendPrivateMenu(ctx: Context, menuContent: {
    text: string;
    keyboard: any;
  }): Promise<boolean> {
    try {
      const userId = ctx.from?.id;
      if (!userId) return false;

      // Try to send private message
      try {
        await ctx.telegram.sendMessage(userId, menuContent.text, {
          parse_mode: 'Markdown',
          reply_markup: menuContent.keyboard
        });
        
        // In group, send a simple acknowledgment
        if (ctx.chat?.type !== 'private') {
          await ctx.reply(`✅ ${ctx.from?.first_name}, I've sent you a private message with the menu.`);
        }
        
        return true;
      } catch (error: any) {
        // User hasn't started bot in private
        if (error.code === 403) {
          await ctx.reply(
            `❌ ${ctx.from?.first_name}, please start a private chat with me first:\n` +
            `@${ctx.botInfo?.username}\n\n` +
            `Then try again.`,
            {
              reply_markup: {
                inline_keyboard: [[
                  { text: '💬 Start Private Chat', url: `https://t.me/${ctx.botInfo?.username}` }
                ]]
              }
            }
          );
          return false;
        }
        throw error;
      }
    } catch (error) {
      logger.error('Error sending private menu:', error);
      await ctx.reply('❌ Error sending private menu. Please try again.');
      return false;
    }
  }

  /**
   * Check if user can receive private messages
   */
  async canReceivePrivateMessages(ctx: Context, userId: string): Promise<boolean> {
    try {
      // Try sending a test message
      await ctx.telegram.sendChatAction(userId, 'typing');
      return true;
    } catch (error: any) {
      return false;
    }
  }
}

export const privateMenuHandler = new PrivateMenuHandler();