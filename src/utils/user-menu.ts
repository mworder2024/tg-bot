import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/types';

export interface UserMenuState {
  menu: string;
  data?: any;
}

/**
 * User menu system for bot interaction
 */
export class UserMenu {
  private menuStates = new Map<string, UserMenuState>(); // userId -> state

  /**
   * Show main user menu
   */
  getMainMenu(isAdmin: boolean = false, isPrivate: boolean = false): InlineKeyboardMarkup {
    const keyboard = [];
    
    // Privacy notice for group chats
    if (!isPrivate) {
      keyboard.push([
        { text: '🔒 Private Menu', callback_data: 'user:private' }
      ]);
    }
    
    // Game Actions
    keyboard.push([
      { text: '🎮 Create Game', callback_data: 'user:create' },
      { text: '🎯 Join Game', callback_data: 'user:join' }
    ]);
    
    // Game Info
    keyboard.push([
      { text: '📊 Game Status', callback_data: 'user:status' },
      { text: '🔢 My Number', callback_data: 'user:mynumber' }
    ]);
    
    // Statistics
    keyboard.push([
      { text: '📈 My Stats', callback_data: 'user:stats' },
      { text: '🏆 Leaderboard', callback_data: 'user:leaderboard' }
    ]);
    
    // More Stats
    keyboard.push([
      { text: '💰 Prize Stats', callback_data: 'user:prizestats' },
      { text: '🏅 Top Winners', callback_data: 'user:winnerstats' }
    ]);
    
    // Schedule Info
    keyboard.push([
      { text: '📅 View Schedule', callback_data: 'user:scheduled' },
      { text: '❓ Help', callback_data: 'user:help' }
    ]);
    
    // Admin Options
    if (isAdmin) {
      keyboard.push([
        { text: '👑 Admin Panel', callback_data: 'admin:main' },
        { text: '🔧 Quick Admin', callback_data: 'user:quickadmin' }
      ]);
    }

    return {
      inline_keyboard: keyboard
    };
  }

  /**
   * Get quick admin menu
   */
  getQuickAdminMenu(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '▶️ Force Start', callback_data: 'user:admin:forcestart' },
          { text: '✅ Approve Game', callback_data: 'user:admin:approve' }
        ],
        [
          { text: '⏸️ Pause Game', callback_data: 'user:admin:pauselottery' },
          { text: '▶️ Resume Game', callback_data: 'user:admin:resumelottery' }
        ],
        [
          { text: '🔚 End Game', callback_data: 'user:admin:endgame' },
          { text: '🔄 Resume Draw', callback_data: 'user:admin:resumedraw' }
        ],
        [
          { text: '📅 Schedule Menu', callback_data: 'user:admin:schedule' },
          { text: '🎯 Activate Next', callback_data: 'user:admin:activatenext' }
        ],
        [
          { text: '🔙 Back', callback_data: 'user:main' }
        ]
      ]
    };
  }

  /**
   * Get create game menu
   */
  getCreateGameMenu(): { text: string; keyboard: InlineKeyboardMarkup } {
    const text = `🎮 **Create New Game**\n\n` +
      `Choose game type:\n\n` +
      `**Standard Game**\n` +
      `• Random prize pool (10K-50K tokens)\n` +
      `• Default settings\n\n` +
      `**Custom Game**\n` +
      `• Set player limit\n` +
      `• Custom start delay\n` +
      `• Configure survivors\n\n` +
      `**Event Game**\n` +
      `• Custom prize pool\n` +
      `• Special event name\n` +
      `• Premium features`;

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '🎲 Standard Game', callback_data: 'user:create:standard' }
        ],
        [
          { text: '⚙️ Custom Game', callback_data: 'user:create:custom' }
        ],
        [
          { text: '🌟 Event Game', callback_data: 'user:create:event' }
        ],
        [
          { text: '🔙 Back', callback_data: 'user:main' }
        ]
      ]
    };

    return { text, keyboard };
  }

  /**
   * Get help menu
   */
  getHelpMenu(isAdmin: boolean = false): { text: string; keyboard: InlineKeyboardMarkup } {
    const text = `❓ **Help Topics**\n\n` +
      `Select a topic to learn more:`;

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '🎮 How to Play', callback_data: 'user:help:howto' },
          { text: '💰 Prizes', callback_data: 'user:help:prizes' }
        ],
        [
          { text: '📊 Statistics', callback_data: 'user:help:stats' },
          { text: '📅 Schedules', callback_data: 'user:help:schedules' }
        ],
        [
          { text: '🎯 Game Types', callback_data: 'user:help:gametypes' },
          { text: '🔢 Commands', callback_data: 'user:help:commands' }
        ]
      ]
    };

    if (isAdmin) {
      keyboard.inline_keyboard.push([
        { text: '👑 Admin Help', callback_data: 'user:help:admin' }
      ]);
    }

    keyboard.inline_keyboard.push([
      { text: '🔙 Back', callback_data: 'user:main' }
    ]);

    return { text, keyboard };
  }

  /**
   * Get stats menu
   */
  getStatsMenu(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '📊 My Stats', callback_data: 'user:stats:personal' },
          { text: '🏆 Leaderboard', callback_data: 'user:stats:leaderboard' }
        ],
        [
          { text: '💰 Prize Stats', callback_data: 'user:stats:prizes' },
          { text: '🏅 Top Winners', callback_data: 'user:stats:winners' }
        ],
        [
          { text: '📈 Global Stats', callback_data: 'user:stats:global' }
        ],
        [
          { text: '🔙 Back', callback_data: 'user:main' }
        ]
      ]
    };
  }

  /**
   * Handle callback query with privacy options
   */
  async handleCallback(ctx: Context, data: string, usePrivateMenu: boolean = false): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const parts = data.split(':');
    const menu = parts[1];
    const action = parts[2];
    const subAction = parts[3];
    
    // For group chats, offer private menu option
    if (ctx.chat?.type !== 'private' && usePrivateMenu) {
      const { privateMenuHandler } = await import('./private-menu-handler.js');
      
      if (menu === 'main') {
        const isAdmin = ctx.from?.id ? await this.checkIsAdmin(ctx.from.id.toString()) : false;
        const menuContent = {
          text: 'šŸŽ° **Welcome to Survival Lottery!**\n\nChoose an option below:',
          keyboard: this.getMainMenu(isAdmin)
        };
        
        await privateMenuHandler.sendPrivateMenu(ctx, menuContent);
        return;
      }
    }

    switch (menu) {
      case 'main':
        const isAdmin = ctx.from?.id ? await this.checkIsAdmin(ctx.from.id.toString()) : false;
        const isPrivate = ctx.chat?.type === 'private';
        await ctx.editMessageText('🎰 **Welcome to Survival Lottery!**\n\nChoose an option below:', {
          parse_mode: 'Markdown',
          reply_markup: this.getMainMenu(isAdmin, isPrivate)
        });
        break;
        
      case 'private':
        // Send private menu
        const { privateMenuHandler } = await import('./private-menu-handler.js');
        const adminStatus = ctx.from?.id ? await this.checkIsAdmin(ctx.from.id.toString()) : false;
        const menuContent = {
          text: '🎰 **Private Lottery Menu**\n\nThis menu is private to you:',
          keyboard: this.getMainMenu(adminStatus, true)
        };
        
        await privateMenuHandler.sendPrivateMenu(ctx, menuContent);
        await ctx.answerCbQuery('🔒 Private menu sent!');
        break;

      case 'create':
        if (!action) {
          const { text, keyboard } = this.getCreateGameMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleCreateAction(ctx, action);
        }
        break;

      case 'help':
        if (!action) {
          const isAdmin = ctx.from?.id ? await this.checkIsAdmin(ctx.from.id.toString()) : false;
          const { text, keyboard } = this.getHelpMenu(isAdmin);
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleHelpAction(ctx, action);
        }
        break;

      case 'stats':
        if (!action) {
          await ctx.editMessageText('📊 **Statistics**\n\nSelect a category:', {
            parse_mode: 'Markdown',
            reply_markup: this.getStatsMenu()
          });
        } else {
          await this.handleStatsAction(ctx, action);
        }
        break;

      case 'quickadmin':
        await ctx.editMessageText('🔧 **Quick Admin Actions**\n\nSelect an action:', {
          parse_mode: 'Markdown',
          reply_markup: this.getQuickAdminMenu()
        });
        break;

      case 'admin':
        if (action) {
          await this.handleAdminAction(ctx, action);
        }
        break;

      // Direct command triggers
      case 'join':
        await this.triggerCommand(ctx, '/join');
        break;
      case 'status':
        await this.triggerCommand(ctx, '/status');
        break;
      case 'mynumber':
        await this.triggerCommand(ctx, '/mynumber');
        break;
      case 'leaderboard':
        await this.triggerCommand(ctx, '/leaderboard');
        break;
      case 'prizestats':
        await this.triggerCommand(ctx, '/prizestats');
        break;
      case 'winnerstats':
        await this.triggerCommand(ctx, '/winnerstats');
        break;
      case 'scheduled':
        await this.triggerCommand(ctx, '/scheduled');
        break;
    }
  }

  /**
   * Handle create actions
   */
  private async handleCreateAction(ctx: Context, action: string): Promise<void> {
    switch (action) {
      case 'standard':
        await this.triggerCommand(ctx, '/create');
        break;
      case 'custom':
        await ctx.answerCbQuery();
        await ctx.reply(
          '⚙️ **Custom Game Creation**\n\n' +
          'Use these options:\n' +
          '`/create --max 20` - Set max players\n' +
          '`/create --start 10` - Set 10 min start delay\n' +
          '`/create --survivors 3` - Set 3 survivors\n\n' +
          'Combine options:\n' +
          '`/create --max 30 --start 5 --survivors 2`',
          { parse_mode: 'Markdown' }
        );
        break;
      case 'event':
        await ctx.answerCbQuery();
        await ctx.reply(
          '🌟 **Event Game Creation**\n\n' +
          'Create special event:\n' +
          '`/create --event 100000 "Weekend Special"`\n\n' +
          'Options:\n' +
          '• Prize: 1,000 - 1,000,000 tokens\n' +
          '• Name: Up to 50 characters\n' +
          '• Can combine with --max, --start, --survivors',
          { parse_mode: 'Markdown' }
        );
        break;
    }
  }

  /**
   * Handle help actions
   */
  private async handleHelpAction(ctx: Context, action: string): Promise<void> {
    switch (action) {
      case 'howto':
        await ctx.answerCbQuery();
        await ctx.reply(
          '🎮 **How to Play**\n\n' +
          '1. Join or create a lottery game\n' +
          '2. Each player gets a unique number\n' +
          '3. Numbers are drawn randomly\n' +
          '4. If your number is drawn, you\'re eliminated!\n' +
          '5. Last survivor(s) win the prize pool!\n\n' +
          'It\'s that simple! Good luck! 🍀',
          { parse_mode: 'Markdown' }
        );
        break;
      case 'commands':
        await this.triggerCommand(ctx, '/help');
        break;
      case 'admin':
        await this.triggerCommand(ctx, '/help --admin');
        break;
      default:
        await this.triggerCommand(ctx, `/help --${action}`);
        break;
    }
  }

  /**
   * Handle stats actions
   */
  private async handleStatsAction(ctx: Context, action: string): Promise<void> {
    switch (action) {
      case 'personal':
        await this.triggerCommand(ctx, '/stats');
        break;
      case 'leaderboard':
        await this.triggerCommand(ctx, '/leaderboard');
        break;
      case 'prizes':
        await this.triggerCommand(ctx, '/prizestats');
        break;
      case 'winners':
        await this.triggerCommand(ctx, '/winnerstats');
        break;
      case 'global':
        await ctx.answerCbQuery();
        await ctx.reply(
          '📈 **Global Statistics**\n\n' +
          'Use these commands:\n' +
          '• `/leaderboard` - Top players\n' +
          '• `/prizestats` - Prize distribution\n' +
          '• `/winnerstats` - Biggest winners',
          { parse_mode: 'Markdown' }
        );
        break;
    }
  }

  /**
   * Handle admin actions
   */
  private async handleAdminAction(ctx: Context, action: string): Promise<void> {
    const adminCommands: Record<string, string> = {
      'forcestart': '/forcestart',
      'approve': '/approve',
      'pauselottery': '/pauselottery',
      'resumelottery': '/resumelottery',
      'endgame': '/endgame',
      'resumedraw': '/resumedraw',
      'activatenext': '/activatenext',
      'schedule': '/admin'
    };

    const command = adminCommands[action];
    if (command) {
      if (command === '/admin') {
        // Switch to admin panel
        await ctx.answerCbQuery('Opening admin panel...');
        await this.triggerCommand(ctx, command);
      } else {
        await this.triggerCommand(ctx, command);
      }
    }
  }

  /**
   * Trigger a command
   */
  private async triggerCommand(ctx: Context, command: string): Promise<void> {
    await ctx.answerCbQuery();
    // Create a fake message update to trigger the command
    const fakeMessage = {
      ...ctx.update,
      message: {
        ...ctx.update.callback_query?.message,
        text: command,
        from: ctx.from,
        chat: ctx.chat,
        date: Date.now()
      }
    };
    
    // @ts-ignore - Trigger the command through the bot
    await ctx.tg.handleUpdate(fakeMessage);
  }

  /**
   * Check if user is admin
   */
  private async checkIsAdmin(userId: string): Promise<boolean> {
    // Import the function from the main module
    const { isAdminUser } = await import('../index.js');
    return isAdminUser(userId);
  }

  /**
   * Set menu state for user
   */
  setMenuState(userId: string, state: UserMenuState): void {
    this.menuStates.set(userId, state);
  }

  /**
   * Get menu state for user
   */
  getMenuState(userId: string): UserMenuState | undefined {
    return this.menuStates.get(userId);
  }

  /**
   * Clear menu state for user
   */
  clearMenuState(userId: string): void {
    this.menuStates.delete(userId);
  }
}

export const userMenu = new UserMenu();