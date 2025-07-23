import { Context } from 'telegraf';
import { CallbackQuery } from 'telegraf/types';
import { logger } from './logger';
import { groupManager } from './group-manager';
import { prizeManager } from './prize-manager';
import { botWalletManager } from './wallet-manager';
import { leaderboard } from '../leaderboard';
import {
  handleLeaderboardCommand,
  handleStatsCommand,
  handlePrizeStatsCommand,
  handleWinnerStatsCommand
} from '../handlers/command-handlers';

interface CallbackContext extends Context {
  callbackQuery: CallbackQuery & { data: string };
}

type CallbackHandler = (ctx: CallbackContext, data: string) => Promise<void>;
type CommandHandler = (ctx: any) => Promise<any>;

class CallbackManager {
  private handlers: Map<string, CallbackHandler> = new Map();
  private prefixHandlers: Map<string, CallbackHandler> = new Map();
  private commandHandlers: Map<string, CommandHandler> = new Map(); // Unused but kept for compatibility
  private getCurrentGame: (() => any) | null = null; // Unused but kept for compatibility

  constructor() {
    this.registerHandlers();
  }

  /**
   * Set the function to get current game state
   */
  setGetCurrentGame(fn: () => any): void {
    this.getCurrentGame = fn;
  }

  /**
   * Register all callback handlers
   */
  private registerHandlers(): void {
    // Admin callbacks
    this.registerPrefixHandler('admin_', this.handleAdminCallbacks.bind(this));
    this.registerPrefixHandler('group_', this.handleGroupCallbacks.bind(this));
    this.registerPrefixHandler('superadmin_', this.handleSuperAdminCallbacks.bind(this));
    this.registerPrefixHandler('user_', this.handleUserMenuCallbacks.bind(this));
  }

  /**
   * Register a handler for exact callback data match
   */
  registerHandler(callbackData: string, handler: CallbackHandler): void {
    this.handlers.set(callbackData, handler);
  }

  /**
   * Register a handler for callback data prefix
   */
  registerPrefixHandler(prefix: string, handler: CallbackHandler): void {
    this.prefixHandlers.set(prefix, handler);
  }

  /**
   * Main callback processing method
   */
  async handleCallback(ctx: CallbackContext): Promise<void> {
    try {
      if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
        await ctx.answerCbQuery('Invalid callback');
        return;
      }

      const data = ctx.callbackQuery.data;
      logger.info(`CALLBACK DEBUG: User ${ctx.from!.id} clicked button: ${data}`);

      // Check exact match handlers
      const exactHandler = this.handlers.get(data);
      if (exactHandler) {
        await exactHandler(ctx, data);
        return;
      }

      // Check prefix handlers
      for (const [prefix, handler] of this.prefixHandlers) {
        if (data.startsWith(prefix)) {
          await handler(ctx, data);
          return;
        }
      }

      // No handler found
      logger.warn(`CALLBACK WARNING: Unhandled callback data: ${data}`);
      await ctx.answerCbQuery('🔄 Action processed');

    } catch (error) {
      logger.error('Error in callback query:', error);
      await ctx.answerCbQuery('An error occurred');
    }
  }

  /**
   * Handle admin-related callbacks
   */
  private async handleAdminCallbacks(ctx: CallbackContext, data: string): Promise<void> {
    const userId = ctx.from!.id.toString();
    
    // Check admin permission
    if (!this.isAdminUser(userId)) {
      await ctx.answerCbQuery('❌ Unauthorized');
      return;
    }

    switch (data) {
      case 'admin_main':
        await this.showAdminMenu(ctx);
        break;
      case 'admin_groups':
        await this.showGroupManagement(ctx);
        break;
      case 'admin_stats':
        await this.showAdminStats(ctx);
        break;
      case 'admin_debug':
        await this.showDebugInfo(ctx);
        break;
      case 'admin_prizes':
        await this.showPrizeStats(ctx);
        break;
      case 'admin_winners':
        await this.showWinnerStats(ctx);
        break;
      case 'admin_wallet':
        await this.showWalletInfo(ctx);
        break;
      default:
        await ctx.answerCbQuery('Unknown admin action');
    }
  }

  /**
   * Handle group management callbacks
   */
  private async handleGroupCallbacks(ctx: CallbackContext, data: string): Promise<void> {
    const userId = ctx.from!.id.toString();
    
    if (!this.isAdminUser(userId)) {
      await ctx.answerCbQuery('❌ Unauthorized');
      return;
    }

    if (data.startsWith('group_toggle_')) {
      const groupId = data.replace('group_toggle_', '');
      groupManager.toggleEnabledGroup(groupId);
      await ctx.answerCbQuery('✅ Group toggled');
      await this.showGroupManagement(ctx);
    } else if (data.startsWith('group_remove_')) {
      const groupId = data.replace('group_remove_', '');
      groupManager.removeGroup(groupId);
      await ctx.answerCbQuery('✅ Group removed');
      await this.showGroupManagement(ctx);
    }
  }

  /**
   * Handle super admin callbacks
   */
  private async handleSuperAdminCallbacks(ctx: CallbackContext, data: string): Promise<void> {
    const userId = ctx.from!.id.toString();
    
    if (!this.isSuperAdmin(userId)) {
      await ctx.answerCbQuery('❌ Unauthorized - Super Admin only');
      return;
    }

    switch (data) {
      case 'superadmin_main':
        await this.showSuperAdminMenu(ctx);
        break;
      case 'superadmin_private_key':
        await this.showPrivateKey(ctx);
        break;
      case 'superadmin_wallet':
        await this.showSuperAdminWallet(ctx);
        break;
      case 'superadmin_system':
        await this.showSystemInfo(ctx);
        break;
      default:
        await ctx.answerCbQuery('Unknown super admin action');
    }
  }

  /**
   * Handle user menu callbacks
   */
  private async handleUserMenuCallbacks(ctx: CallbackContext, data: string): Promise<void> {
    try {
      switch (data) {
        case 'user_join_game':
          await this.handleJoinGame(ctx);
          break;
        case 'user_create_game':
          await this.handleCreateGame(ctx);
          break;
        case 'user_my_stats':
          await ctx.answerCbQuery('📊 Loading your stats...');
          await handleStatsCommand(ctx);
          break;
        case 'user_leaderboard':
          await ctx.answerCbQuery('🏆 Loading leaderboard...');
          await handleLeaderboardCommand(ctx);
          break;
        case 'user_prize_stats':
          await ctx.answerCbQuery('💰 Loading prize statistics...');
          await handlePrizeStatsCommand(ctx);
          break;
        case 'user_winner_stats':
          await ctx.answerCbQuery('🎖️ Loading top winners...');
          await handleWinnerStatsCommand(ctx);
          break;
        case 'user_game_status':
          await ctx.answerCbQuery('🎯 Loading game status...');
          // Status command needs special handling since it requires game state
          await ctx.reply('Please use the /status command to check game status.');
          break;
        default:
          await ctx.answerCbQuery('Unknown user action');
      }
    } catch (error) {
      logger.error('Error in user menu callback:', error);
      await ctx.answerCbQuery('❌ An error occurred');
    }
  }

  /**
   * Execute a command by triggering it through the update
   */
  // Unused method - kept for future use
  private async executeCommand(ctx: CallbackContext, command: string, loadingMessage: string): Promise<void> {
    await ctx.answerCbQuery(loadingMessage);
    
    // Create a fake message update to trigger the command
    const fakeUpdate = {
      ...ctx.update,
      message: {
        message_id: ctx.callbackQuery.message?.message_id || 0,
        date: Math.floor(Date.now() / 1000),
        chat: ctx.chat!,
        from: ctx.from!,
        text: `/${command}`,
        entities: [{
          type: 'bot_command',
          offset: 0,
          length: command.length + 1
        }]
      }
    };
    
    // Emit the update to trigger the command handler
    // @ts-ignore
    ctx.telegram.handleUpdate(fakeUpdate);
  }

  /**
   * Handle join game callback
   */
  private async handleJoinGame(ctx: CallbackContext): Promise<void> {
    // This will need access to the game state
    await ctx.answerCbQuery('🎮 Use /join command to join the game');
    await ctx.reply('To join the current game, use the `/join` command in the group chat.');
  }

  /**
   * Handle create game callback
   */
  private async handleCreateGame(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    await ctx.reply(
      '🎮 **CREATE NEW GAME**\n\n' +
      'Use the `/create` command with optional parameters:\n\n' +
      '**Basic:** `/create`\n' +
      '**Custom:** `/create --max 30 --start 5`\n\n' +
      '**Options:**\n' +
      '• `--max [2-100]` - Max players (default: 50)\n' +
      '• `--start [1-30]` - Minutes to start (default: 5)\n' +
      '• `--survivors [1+]` - Winners (auto-calculated)\n\n' +
      '**Example:** `/create --max 20 --start 3`',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Show admin main menu
   */
  private async showAdminMenu(ctx: CallbackContext): Promise<void> {
    const adminKeyboard = {
      inline_keyboard: [
        [
          { text: '🏠 Groups', callback_data: 'admin_groups' },
          { text: '📊 Stats', callback_data: 'admin_stats' }
        ],
        [
          { text: '💰 Prize Stats', callback_data: 'admin_prizes' },
          { text: '🏆 Winners', callback_data: 'admin_winners' }
        ],
        [
          { text: '👛 Wallet Info', callback_data: 'admin_wallet' },
          { text: '🔧 Debug', callback_data: 'admin_debug' }
        ]
      ]
    };

    const userId = ctx.from!.id.toString();
    if (this.isSuperAdmin(userId)) {
      adminKeyboard.inline_keyboard.push([
        { text: '🔱 Super Admin', callback_data: 'superadmin_main' }
      ]);
    }

    await ctx.editMessageText(
      '👑 **ADMIN CONTROL PANEL**\n\n' +
      'Select an option to manage the bot:',
      { parse_mode: 'Markdown', reply_markup: adminKeyboard }
    );
    await ctx.answerCbQuery();
  }

  /**
   * Show group management menu
   */
  private async showGroupManagement(ctx: CallbackContext): Promise<void> {
    const groups = groupManager.getGroups();
    const buttons = [];

    for (const group of groups) {
      const status = group.enabled ? '🟢' : '🔴';
      buttons.push([
        { text: `${status} ${group.name}`, callback_data: `group_toggle_${group.id}` },
        { text: '🗑️ Remove', callback_data: `group_remove_${group.id}` }
      ]);
    }

    buttons.push([
      { text: '🔙 Back to Admin', callback_data: 'admin_main' },
      { text: '🔄 Refresh', callback_data: 'admin_groups' }
    ]);

    await ctx.editMessageText(
      '🏠 **GROUP MANAGEMENT**\n\n' +
      'Manage bot groups:\n\n' +
      '🟢 = Active Group\n' +
      '🔴 = Disabled Group\n\n' +
      `Total Groups: ${groups.length}`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
    await ctx.answerCbQuery();
  }

  /**
   * Show admin statistics
   */
  private async showAdminStats(ctx: CallbackContext): Promise<void> {
    // getGlobalStats not implemented, using getTotalGames instead
    const totalGames = leaderboard.getTotalGames();
    const stats = { totalGames };
    const backButton = [
      [{ text: '🔙 Back to Admin', callback_data: 'admin_main' }]
    ];

    let statsMessage = '📊 **GLOBAL STATISTICS**\n\n';
    statsMessage += `🎮 Total Games: ${stats.totalGames}\n`;
    statsMessage += `👥 Total Players: ${stats.totalPlayers}\n`;
    statsMessage += `🏁 Completed Games: ${stats.completedGames}\n`;
    statsMessage += `🚫 Cancelled Games: ${stats.cancelledGames}\n`;
    statsMessage += `📈 Active Players (30d): ${stats.activePlayers}\n`;

    await ctx.editMessageText(statsMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: backButton }
    });
    await ctx.answerCbQuery('📊 Statistics loaded');
  }

  /**
   * Show debug information
   */
  private async showDebugInfo(ctx: CallbackContext): Promise<void> {
    const chatId = ctx.chat!.id.toString();
    const chatTitle = (ctx.chat as any).title || 'Private Chat';
    const backButton = [
      [{ text: '🔙 Back to Admin', callback_data: 'admin_main' }]
    ];

    const debugInfo = `🔧 **DEBUG INFORMATION**\n\n` +
      `💬 Chat ID: \`${chatId}\`\n` +
      `📝 Chat Title: ${chatTitle}\n` +
      `🤖 Bot Username: ${ctx.botInfo?.username}\n` +
      `👤 Your ID: \`${ctx.from!.id}\`\n` +
      `🔐 Admin Status: ✅\n`;

    await ctx.editMessageText(debugInfo, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: backButton }
    });
    await ctx.answerCbQuery('🔧 Debug info loaded');
  }

  /**
   * Show prize statistics
   */
  private async showPrizeStats(ctx: CallbackContext): Promise<void> {
    const prizeStats = prizeManager.getPrizeStats();
    const recentPrizes = prizeManager.getRecentPrizes(5);
    const backButton = [
      [{ text: '🔙 Back to Admin', callback_data: 'admin_main' }]
    ];

    let statsMessage = '💰 **PRIZE STATISTICS**\n\n';
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

    await ctx.editMessageText(statsMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: backButton }
    });
    await ctx.answerCbQuery('💰 Prize stats loaded');
  }

  /**
   * Show winner statistics
   */
  private async showWinnerStats(ctx: CallbackContext): Promise<void> {
    const userWinnings = prizeManager.getUserWinnings();
    const topWinners = userWinnings.slice(0, 10);
    const backButton = [
      [{ text: '🔙 Back to Admin', callback_data: 'admin_main' }]
    ];

    let winnersMessage = '🏆 **TOP WINNERS**\n\n';
    
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

    await ctx.editMessageText(winnersMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: backButton }
    });
    await ctx.answerCbQuery('🏆 Winners stats loaded');
  }

  /**
   * Show wallet information
   */
  private async showWalletInfo(ctx: CallbackContext): Promise<void> {
    try {
      const walletInfo = await botWalletManager.getWalletInfoCached();
      const backButton = [
        [{ text: '🔙 Back to Admin', callback_data: 'admin_main' }]
      ];

      let walletMessage = '👛 **BOT WALLET INFORMATION**\n\n';
      walletMessage += `📍 **Public Address:**\n\`${walletInfo.publicKey}\`\n\n`;
      walletMessage += `💰 **Balances:**\n`;
      walletMessage += `• SOL: ${walletInfo.solBalance.toFixed(4)} SOL\n`;
      walletMessage += `• MWOR: ${walletInfo.mworBalance.toFixed(4)} MWOR\n\n`;
      walletMessage += `🕐 Last Updated: ${walletInfo.lastUpdated.toLocaleTimeString()}`;

      await ctx.editMessageText(walletMessage, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backButton }
      });
      await ctx.answerCbQuery('👛 Wallet info loaded');
    } catch (error) {
      logger.error('Error loading wallet info:', error);
      await ctx.answerCbQuery('❌ Error loading wallet information');
    }
  }

  /**
   * Show super admin menu
   */
  private async showSuperAdminMenu(ctx: CallbackContext): Promise<void> {
    const superAdminKeyboard = {
      inline_keyboard: [
        [
          { text: '🔑 View Private Key', callback_data: 'superadmin_private_key' },
          { text: '👛 Wallet Details', callback_data: 'superadmin_wallet' }
        ],
        [
          { text: '👑 Admin Panel', callback_data: 'admin_main' },
          { text: '🔧 System Info', callback_data: 'superadmin_system' }
        ]
      ]
    };

    await ctx.editMessageText(
      '🔱 **SUPER ADMIN CONTROL PANEL** 🔱\n\n' +
      '⚠️ **WARNING**: You have access to sensitive bot operations.\n' +
      'Use these functions responsibly.\n\n' +
      'Select an option below:',
      { 
        parse_mode: 'Markdown',
        reply_markup: superAdminKeyboard 
      }
    );
    await ctx.answerCbQuery();
  }

  /**
   * Show private key (super admin only)
   */
  private async showPrivateKey(ctx: CallbackContext): Promise<void> {
    try {
      const privateKey = botWalletManager.getPrivateKey();
      
      await ctx.answerCbQuery('🔑 Private key loaded - handle with care!');
      
      // Send as a separate message that can be deleted
      const keyMessage = await ctx.reply(
        '🔐 **BOT WALLET PRIVATE KEY** 🔐\n\n' +
        '⚠️ **EXTREME CAUTION**: Never share this key!\n\n' +
        `\`${privateKey}\`\n\n` +
        '⏰ This message will auto-delete in 30 seconds for security.',
        { parse_mode: 'Markdown' }
      );
      
      // Auto-delete after 30 seconds
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(ctx.chat!.id, keyMessage.message_id);
        } catch (error) {
          logger.error('Failed to auto-delete private key message:', error);
        }
      }, 30000);
    } catch (error) {
      logger.error('Error showing private key:', error);
      await ctx.answerCbQuery('❌ Error retrieving private key');
    }
  }

  /**
   * Show super admin wallet details
   */
  private async showSuperAdminWallet(ctx: CallbackContext): Promise<void> {
    try {
      const walletInfo = await botWalletManager.getWalletInfoCached();
      const backButton = [
        [{ text: '🔙 Back to Super Admin', callback_data: 'superadmin_main' }]
      ];

      let walletMessage = '👛 **SUPER ADMIN WALLET DETAILS**\n\n';
      walletMessage += `📍 **Public Address:**\n\`${walletInfo.publicKey}\`\n\n`;
      walletMessage += `💰 **Balances:**\n`;
      walletMessage += `• SOL: ${walletInfo.solBalance.toFixed(4)} SOL\n`;
      walletMessage += `• MWOR: ${walletInfo.mworBalance.toFixed(4)} MWOR\n\n`;
      walletMessage += `🔐 **Security Status:** ✅ Encrypted\n`;
      walletMessage += `🕐 **Last Updated:** ${walletInfo.lastUpdated.toLocaleTimeString()}\n\n`;
      walletMessage += `💡 Use "View Private Key" to see the wallet's private key.`;

      await ctx.editMessageText(walletMessage, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backButton }
      });
      await ctx.answerCbQuery('👛 Wallet details loaded');
    } catch (error) {
      logger.error('Error loading wallet details:', error);
      await ctx.answerCbQuery('❌ Error loading wallet details');
    }
  }

  /**
   * Show system information
   */
  private async showSystemInfo(ctx: CallbackContext): Promise<void> {
    try {
      const systemInfo = {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage(),
        botInitialized: botWalletManager.isInitialized()
      };
      
      const backButton = [
        [{ text: '🔙 Back to Super Admin', callback_data: 'superadmin_main' }]
      ];

      let systemMessage = '🔧 **SYSTEM INFORMATION** 🔧\n\n';
      systemMessage += `🚀 Node.js: ${systemInfo.nodeVersion}\n`;
      systemMessage += `💻 Platform: ${systemInfo.platform}\n`;
      systemMessage += `⏱️ Uptime: ${Math.floor(systemInfo.uptime / 3600)}h ${Math.floor((systemInfo.uptime % 3600) / 60)}m\n`;
      systemMessage += `🧠 Memory: ${Math.round(systemInfo.memoryUsage.heapUsed / 1024 / 1024)}MB used\n`;
      systemMessage += `👛 Wallet: ${systemInfo.botInitialized ? '✅ Initialized' : '❌ Not initialized'}\n\n`;
      systemMessage += `🔱 Super Admin Panel Active`;

      await ctx.editMessageText(systemMessage, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: backButton }
      });
      await ctx.answerCbQuery('🔧 System info loaded');
    } catch (error) {
      logger.error('Error loading system info:', error);
      await ctx.answerCbQuery('❌ Error loading system information');
    }
  }

  /**
   * Check if user is admin
   */
  private isAdminUser(userId: string): boolean {
    const adminIds = process.env.ADMIN_USER_IDS?.split(',') || [];
    return adminIds.includes(userId);
  }

  /**
   * Check if user is super admin
   */
  private isSuperAdmin(userId: string): boolean {
    return userId === process.env.SUPER_ADMIN_ID;
  }
}

export const callbackManager = new CallbackManager();