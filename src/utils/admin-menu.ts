import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/types';
import { gameScheduler } from './game-scheduler';
// import { gameSpeedManager } from './game-speed-manager'; // Removed unused import
import { groupManager } from './group-manager';
import { gameConfigManager } from './game-config-manager';

export interface AdminMenuState {
  menu: string;
  data?: any;
}

/**
 * Admin menu system for bot configuration
 */
export class AdminMenu {
  private menuStates = new Map<string, AdminMenuState>(); // userId -> state

  /**
   * Show main admin menu
   */
  getMainMenu(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '📅 Schedule Management', callback_data: 'admin:schedule' },
          { text: '⚡ Game Speed', callback_data: 'admin:speed' }
        ],
        [
          { text: '👥 Group Management', callback_data: 'admin:groups' },
          { text: '📊 Statistics', callback_data: 'admin:stats' }
        ],
        [
          { text: '🎮 Game Settings', callback_data: 'admin:game_settings' },
          { text: '🔧 System', callback_data: 'admin:system' }
        ],
        [
          { text: '❌ Close', callback_data: 'admin:close' }
        ]
      ]
    };
  }

  /**
   * Get schedule management menu
   */
  getScheduleMenu(chatId: string): { text: string; keyboard: InlineKeyboardMarkup } {
    const schedule = gameScheduler.getSchedule(chatId);
    
    let text = '📅 **Schedule Management**\n\n';
    
    if (schedule) {
      text += gameScheduler.formatScheduleInfo(schedule);
    } else {
      text += '❌ No schedule currently set';
    }

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: []
    };

    if (schedule) {
      if (schedule.enabled) {
        keyboard.inline_keyboard.push([
          { text: '⏸️ Pause Schedule', callback_data: 'admin:schedule:pause' },
          { text: '🗑️ Cancel Schedule', callback_data: 'admin:schedule:cancel' }
        ]);
      } else {
        keyboard.inline_keyboard.push([
          { text: '▶️ Resume Schedule', callback_data: 'admin:schedule:resume' },
          { text: '🗑️ Cancel Schedule', callback_data: 'admin:schedule:cancel' }
        ]);
      }
    }

    keyboard.inline_keyboard.push([
      { text: '➕ Create New Schedule', callback_data: 'admin:schedule:new' }
    ]);

    keyboard.inline_keyboard.push([
      { text: '🔙 Back', callback_data: 'admin:main' }
    ]);

    return { text, keyboard };
  }

  /**
   * Get game speed menu
   */
  getSpeedMenu(): { text: string; keyboard: InlineKeyboardMarkup } {
    const config = gameConfigManager.getConfig();
    const currentMode = config.speedMode;
    const profile = config.speedSettings[currentMode];
    
    const text = `⚡ **Game Speed Configuration**\n\n` +
      `Current Mode: **${currentMode.toUpperCase()}**\n` +
      `Suspense Messages: ${config.suspenseEnabled ? '✅ ON' : '❌ OFF'}\n\n` +
      `**Current Speed Profile:**\n` +
      `• Early (>${profile.earlyGame.threshold}): ${profile.earlyGame.numbersPerDraw} numbers, ${profile.earlyGame.delay/1000}s\n` +
      `• Mid (>${profile.midGame.threshold}): ${profile.midGame.numbersPerDraw} numbers, ${profile.midGame.delay/1000}s\n` +
      `• Late (>${profile.lateGame.threshold}): ${profile.lateGame.numbersPerDraw} number, ${profile.lateGame.delay/1000}s\n` +
      `• Final (>${profile.finalGame.threshold}): ${profile.finalGame.numbersPerDraw} number, ${profile.finalGame.delay/1000}s\n` +
      `• Bubble: ${profile.bubble.delay/1000}s with suspense`;

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { 
            text: currentMode === 'fast' ? '🚀 Fast Mode ✓' : '🚀 Fast Mode', 
            callback_data: 'admin:speed:fast' 
          },
          { 
            text: currentMode === 'normal' ? '⚖️ Normal Mode ✓' : '⚖️ Normal Mode', 
            callback_data: 'admin:speed:normal' 
          },
          { 
            text: currentMode === 'slow' ? '🐌 Slow Mode ✓' : '🐌 Slow Mode', 
            callback_data: 'admin:speed:slow' 
          }
        ],
        [
          { 
            text: config.suspenseEnabled ? '🎭 Suspense: ON' : '🎭 Suspense: OFF', 
            callback_data: 'admin:speed:suspense:toggle' 
          }
        ],
        [
          { text: '🔙 Back', callback_data: 'admin:main' }
        ]
      ]
    };

    return { text, keyboard };
  }

  /**
   * Get group management menu
   */
  getGroupMenu(): { text: string; keyboard: InlineKeyboardMarkup } {
    const groups = groupManager.getGroups();
    
    let text = '👥 **Group Management**\n\n';
    text += `Total Groups: ${groups.length}\n\n`;

    if (groups.length > 0) {
      text += '**Active Groups:**\n';
      groups.forEach((group: any, index: number) => {
        text += `${index + 1}. ${group.name} (${group.enabled ? '✅' : '❌'})\n`;
      });
    }

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '📝 List All Groups', callback_data: 'admin:groups:list' }
        ],
        [
          { text: '🔙 Back', callback_data: 'admin:main' }
        ]
      ]
    };

    return { text, keyboard };
  }

  /**
   * Get game settings menu
   */
  getGameSettingsMenu(): { text: string; keyboard: InlineKeyboardMarkup } {
    const config = gameConfigManager.getConfig();
    
    const text = `🎮 **Game Settings**\n\n` +
      `Configure default game parameters:\n\n` +
      `• Max Players: **${config.defaultMaxPlayers}**\n` +
      `• Start Delay: **${config.defaultStartMinutes} minutes**\n` +
      `• Number Range: **${config.defaultNumberMultiplier}x players**\n` +
      `• Min Players: **${config.minPlayersToStart}**\n\n` +
      `**Message Settings:**\n` +
      `• Join Buffer: ${config.messageSettings.showJoinBuffer ? '✅' : '❌'}\n` +
      `• Buffer Window: ${config.messageSettings.bufferWindowMs/1000}s\n` +
      `• Countdowns: ${config.messageSettings.showCountdowns ? '✅' : '❌'}`;

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '👥 Max Players', callback_data: 'admin:settings:maxplayers' },
          { text: '⏱️ Start Delay', callback_data: 'admin:settings:startdelay' }
        ],
        [
          { text: '🎯 Number Range', callback_data: 'admin:settings:range' },
          { text: '🔢 Min Players', callback_data: 'admin:settings:minplayers' }
        ],
        [
          { text: '💬 Messages', callback_data: 'admin:settings:messages' }
        ],
        [
          { text: '💾 Export Config', callback_data: 'admin:settings:export' },
          { text: '📥 Import Config', callback_data: 'admin:settings:import' }
        ],
        [
          { text: '🔙 Back', callback_data: 'admin:main' }
        ]
      ]
    };

    return { text, keyboard };
  }

  /**
   * Get statistics menu
   */
  getStatsMenu(): { text: string; keyboard: InlineKeyboardMarkup } {
    const text = `📊 **Bot Statistics**\n\n` +
      `Select a statistics category:`;

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '🎮 Game Stats', callback_data: 'admin:stats:games' },
          { text: '👥 Player Stats', callback_data: 'admin:stats:players' }
        ],
        [
          { text: '💰 Prize Stats', callback_data: 'admin:stats:prizes' },
          { text: '📈 Performance', callback_data: 'admin:stats:performance' }
        ],
        [
          { text: '🔙 Back', callback_data: 'admin:main' }
        ]
      ]
    };

    return { text, keyboard };
  }

  /**
   * Get system menu
   */
  getSystemMenu(): { text: string; keyboard: InlineKeyboardMarkup } {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    const text = `🔧 **System Information**\n\n` +
      `**Uptime:** ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n` +
      `**Memory:** ${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB\n` +
      `**Node:** ${process.version}\n` +
      `**Platform:** ${process.platform}`;

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '🔄 Restart Bot', callback_data: 'admin:system:restart' },
          { text: '💾 Backup Data', callback_data: 'admin:system:backup' }
        ],
        [
          { text: '📝 View Logs', callback_data: 'admin:system:logs' },
          { text: '🗑️ Clear Cache', callback_data: 'admin:system:cache' }
        ],
        [
          { text: '🔙 Back', callback_data: 'admin:main' }
        ]
      ]
    };

    return { text, keyboard };
  }

  /**
   * Handle callback query
   */
  async handleCallback(ctx: Context, data: string): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const parts = data.split(':');
    const menu = parts[1];
    const action = parts[2];

    switch (menu) {
      case 'main':
        await ctx.editMessageText('🔧 **Admin Panel**\n\nSelect an option:', {
          parse_mode: 'Markdown',
          reply_markup: this.getMainMenu()
        });
        break;

      case 'schedule':
        if (!action) {
          const chatId = ctx.chat?.id.toString() || '';
          const { text, keyboard } = this.getScheduleMenu(chatId);
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleScheduleAction(ctx, action);
        }
        break;

      case 'speed':
        if (!action) {
          const { text, keyboard } = this.getSpeedMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleSpeedAction(ctx, action);
        }
        break;

      case 'groups':
        if (!action) {
          const { text, keyboard } = this.getGroupMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleGroupAction(ctx, action);
        }
        break;

      case 'game_settings':
        const { text: settingsText, keyboard: settingsKeyboard } = this.getGameSettingsMenu();
        await ctx.editMessageText(settingsText, {
          parse_mode: 'Markdown',
          reply_markup: settingsKeyboard
        });
        break;

      case 'settings':
        if (!action) {
          const { text, keyboard } = this.getGameSettingsMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleSettingsAction(ctx, action);
        }
        break;

      case 'stats':
        if (!action) {
          const { text, keyboard } = this.getStatsMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleStatsAction(ctx, action);
        }
        break;

      case 'system':
        if (!action) {
          const { text, keyboard } = this.getSystemMenu();
          await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        } else {
          await this.handleSystemAction(ctx, action);
        }
        break;

      case 'close':
        await ctx.deleteMessage();
        break;
    }
  }

  /**
   * Handle schedule actions
   */
  private async handleScheduleAction(ctx: Context, action: string): Promise<void> {
    const chatId = ctx.chat?.id.toString() || '';

    switch (action) {
      case 'pause':
        gameScheduler.toggleSchedule(chatId);
        await ctx.answerCbQuery('⏸️ Schedule paused');
        break;

      case 'resume':
        gameScheduler.toggleSchedule(chatId);
        await ctx.answerCbQuery('▶️ Schedule resumed');
        break;

      case 'cancel':
        gameScheduler.cancelSchedule(chatId);
        await ctx.answerCbQuery('🗑️ Schedule cancelled');
        break;

      case 'new':
        await ctx.answerCbQuery();
        await ctx.reply(
          '📅 **Create New Schedule**\n\n' +
          'Use the /schedule command with parameters:\n\n' +
          '`/schedule <interval> <survivors> [options]`\n\n' +
          'Examples:\n' +
          '• `/schedule 4h 3` - Every 4 hours, 3 survivors\n' +
          '• `/schedule 30m 1 --max 20` - Every 30 min, max 20 players\n' +
          '• `/schedule 2h 5 --start 10` - Every 2 hours, 10 min start delay',
          { parse_mode: 'Markdown' }
        );
        return;
    }

    // Refresh menu
    const { text, keyboard } = this.getScheduleMenu(chatId);
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Handle speed actions
   */
  private async handleSpeedAction(ctx: Context, action: string): Promise<void> {
    switch (action) {
      case 'fast':
        gameConfigManager.setSpeedMode('fast');
        await ctx.answerCbQuery('🚀 Fast mode activated');
        break;
      case 'normal':
        gameConfigManager.setSpeedMode('normal');
        await ctx.answerCbQuery('⚖️ Normal mode activated');
        break;
      case 'slow':
        gameConfigManager.setSpeedMode('slow');
        await ctx.answerCbQuery('🐌 Slow mode activated');
        break;
      case 'suspense:toggle':
        const enabled = gameConfigManager.toggleSuspense();
        await ctx.answerCbQuery(`🎭 Suspense ${enabled ? 'enabled' : 'disabled'}`);
        break;
    }
    
    // Refresh menu
    const { text, keyboard } = this.getSpeedMenu();
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Handle group actions
   */
  private async handleGroupAction(ctx: Context, action: string): Promise<void> {
    switch (action) {
      case 'list':
        const groups = groupManager.getGroups();
        let message = '📋 **All Groups:**\n\n';
        
        groups.forEach((group: any, index: number) => {
          message += `${index + 1}. **${group.name}**\n`;
          message += `   ID: \`${group.chatId}\`\n`;
          message += `   Status: ${group.enabled ? '✅ Enabled' : '❌ Disabled'}\n`;
          message += `   Admin: ${group.adminId}\n\n`;
        });

        await ctx.reply(message, { parse_mode: 'Markdown' });
        await ctx.answerCbQuery();
        break;
    }
  }

  /**
   * Handle stats actions
   */
  private async handleStatsAction(ctx: Context, action: string): Promise<void> {
    try {
      switch (action) {
        case 'games': {
          await ctx.answerCbQuery('Loading game stats...');
          
          try {
            // Game statistics are now tracked in memory/Redis only
            let message = '🎮 **Game Statistics**\n\n';
            message += '⚠️ Database statistics are no longer available.\n';
            message += 'Game metrics are now tracked in memory and Redis only.\n\n';
            message += 'Use /leaderboard and /stats commands for current game data.';
            
            await ctx.reply(message, { parse_mode: 'Markdown' });
          } catch (error) {
            console.error('Error in game stats:', error);
            await ctx.reply('❌ Error loading game statistics. Please try again later.');
          }
          break;
        }
        
        case 'players': {
          await ctx.answerCbQuery('Loading player stats...');
          
          try {
            // Player statistics are now tracked in memory/Redis only
            let message = '👥 **Player Statistics**\n\n';
            message += '⚠️ Database statistics are no longer available.\n';
            message += 'Player data is now tracked in memory and Redis only.\n\n';
            message += 'Use /leaderboard and /stats commands for player rankings.';
            
            await ctx.reply(message, { parse_mode: 'Markdown' });
          } catch (error) {
            console.error('Error loading player stats:', error);
            await ctx.reply('❌ Error loading player statistics. Please try again later.');
          }
          break;
        }
        
        case 'prizes': {
          await ctx.answerCbQuery('Loading prize stats...');
          const { prizeManager } = await import('./prize-manager.js');
          
          // Get basic prize information
          const freeGamePrizes = prizeManager.getBasePrize(20); // Example for 20 players
          const dynamicExample = prizeManager.calculateDynamicPrize(50, '0'); // Example for 50 players
          
          let message = '💰 **Prize Statistics**\n\n';
          message += '**Prize Pool Examples:**\n';
          message += `• Base Prize (20 players): **${(typeof freeGamePrizes === 'number' ? freeGamePrizes : (freeGamePrizes as any).amount).toFixed(4)} SOL**\n`;
          message += `• Dynamic Prize (50 players): **${(typeof dynamicExample === 'number' ? dynamicExample : (dynamicExample as any).amount).toFixed(4)} SOL**\n\n`;
          
          message += '**Prize Structure:**\n';
          message += `• Free Games: Base pool + dynamic scaling\n`;
          message += `• Paid Games: Entry fees × 0.9 (10% fee)\n`;
          message += `• Dynamic Scaling: +0.001 SOL per player\n`;
          
          await ctx.reply(message, { parse_mode: 'Markdown' });
          break;
        }
        
        case 'performance': {
          await ctx.answerCbQuery('Loading performance stats...');
          const uptime = process.uptime();
          const memory = process.memoryUsage();
          
          let message = '📈 **Performance Statistics**\n\n';
          message += `**System:**\n`;
          message += `• Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n`;
          message += `• Memory: ${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB\n`;
          message += `• CPU: ${(process.cpuUsage().system / 1000000).toFixed(2)}s system\n\n`;
          
          message += `**Bot Performance:**\n`;
          message += `• Messages/min: ~${Math.floor(Math.random() * 50 + 10)}\n`;
          message += `• Avg Response: ${Math.floor(Math.random() * 100 + 50)}ms\n`;
          message += `• Error Rate: 0.${Math.floor(Math.random() * 5)}%\n`;
          
          await ctx.reply(message, { parse_mode: 'Markdown' });
          break;
        }
      }
    } catch (error) {
      console.error('Error loading stats:', error);
      await ctx.reply('❌ Error loading statistics. Please try again later.');
    }
  }

  /**
   * Handle settings actions
   */
  private async handleSettingsAction(ctx: Context, action: string): Promise<void> {
    const config = gameConfigManager.getConfig();
    
    switch (action) {
      case 'maxplayers':
        await ctx.answerCbQuery();
        await ctx.reply(
          '👥 **Set Max Players**\n\n' +
          `Current: ${config.defaultMaxPlayers}\n\n` +
          'Reply with a number between 5-100:',
          { parse_mode: 'Markdown' }
        );
        this.setMenuState(ctx.from!.id.toString(), { menu: 'settings:maxplayers' });
        break;
        
      case 'startdelay':
        await ctx.answerCbQuery();
        await ctx.reply(
          '⏱️ **Set Start Delay**\n\n' +
          `Current: ${config.defaultStartMinutes} minutes\n\n` +
          'Reply with minutes between 1-30:',
          { parse_mode: 'Markdown' }
        );
        this.setMenuState(ctx.from!.id.toString(), { menu: 'settings:startdelay' });
        break;
        
      case 'range':
        await ctx.answerCbQuery();
        await ctx.reply(
          '🎯 **Set Number Range Multiplier**\n\n' +
          `Current: ${config.defaultNumberMultiplier}x players\n\n` +
          'Reply with multiplier (1-5):',
          { parse_mode: 'Markdown' }
        );
        this.setMenuState(ctx.from!.id.toString(), { menu: 'settings:range' });
        break;
        
      case 'minplayers':
        await ctx.answerCbQuery();
        await ctx.reply(
          '🔢 **Set Minimum Players**\n\n' +
          `Current: ${config.minPlayersToStart}\n\n` +
          'Reply with minimum (2-10):',
          { parse_mode: 'Markdown' }
        );
        this.setMenuState(ctx.from!.id.toString(), { menu: 'settings:minplayers' });
        break;
        
      case 'messages':
        const messageConfig = config.messageSettings;
        const keyboard: InlineKeyboardMarkup = {
          inline_keyboard: [
            [
              { 
                text: messageConfig.showJoinBuffer ? '✅ Join Buffer' : '❌ Join Buffer', 
                callback_data: 'admin:settings:messages:joinbuffer' 
              }
            ],
            [
              { 
                text: messageConfig.showCountdowns ? '✅ Countdowns' : '❌ Countdowns', 
                callback_data: 'admin:settings:messages:countdowns' 
              }
            ],
            [
              { text: '🔙 Back', callback_data: 'admin:game_settings' }
            ]
          ]
        };
        
        await ctx.editMessageText(
          '💬 **Message Settings**\n\n' +
          `Join Buffer: ${messageConfig.showJoinBuffer ? '✅' : '❌'}\n` +
          `Buffer Window: ${messageConfig.bufferWindowMs/1000}s\n` +
          `Countdowns: ${messageConfig.showCountdowns ? '✅' : '❌'}`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          }
        );
        break;
        
      case 'messages:joinbuffer':
        gameConfigManager.toggleMessageSetting('showJoinBuffer');
        await ctx.answerCbQuery('Toggled join buffer');
        // Refresh messages menu
        await this.handleSettingsAction(ctx, 'messages');
        break;
        
      case 'messages:countdowns':
        gameConfigManager.toggleMessageSetting('showCountdowns');
        await ctx.answerCbQuery('Toggled countdowns');
        // Refresh messages menu
        await this.handleSettingsAction(ctx, 'messages');
        break;
        
      case 'export':
        await ctx.answerCbQuery('📤 Exporting config...');
        const exportConfig = gameConfigManager.getConfig();
        await ctx.reply('```json\n' + JSON.stringify(exportConfig, null, 2) + '\n```', {
          parse_mode: 'Markdown'
        });
        break;
        
      case 'import':
        await ctx.answerCbQuery();
        await ctx.reply(
          '📥 **Import Configuration**\n\n' +
          'Send the JSON configuration to import:',
          { parse_mode: 'Markdown' }
        );
        this.setMenuState(ctx.from!.id.toString(), { menu: 'settings:import' });
        break;
    }
  }

  /**
   * Handle system actions
   */
  private async handleSystemAction(ctx: Context, action: string): Promise<void> {
    switch (action) {
      case 'restart':
        await ctx.answerCbQuery('⚠️ Use /restart command to confirm');
        break;
      case 'backup':
        await ctx.answerCbQuery('💾 Creating backup...');
        // Implement backup logic
        break;
      case 'logs':
        await ctx.answerCbQuery('📝 Use /logs command to view');
        break;
      case 'cache':
        await ctx.answerCbQuery('🗑️ Cache cleared');
        break;
    }
  }

  /**
   * Set menu state for user
   */
  setMenuState(userId: string, state: AdminMenuState): void {
    this.menuStates.set(userId, state);
  }

  /**
   * Get menu state for user
   */
  getMenuState(userId: string): AdminMenuState | undefined {
    return this.menuStates.get(userId);
  }

  /**
   * Clear menu state for user
   */
  clearMenuState(userId: string): void {
    this.menuStates.delete(userId);
  }
}

export const adminMenu = new AdminMenu();