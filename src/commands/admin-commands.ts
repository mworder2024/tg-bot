import { Context } from 'telegraf';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { groupManager } from '../utils/group-manager';
import { notificationManager } from '../utils/notification-manager';

/**
 * Handle /restart command - restart the bot
 */
export async function handleRestartCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id.toString();
  if (!userId || !(await groupManager.isAdmin(userId))) {
    await ctx.reply('❌ This command is for admins only.');
    return;
  }

  await ctx.reply(
    '🔄 **Bot Restart**\n\n' +
    '⚠️ Are you sure you want to restart the bot?\n' +
    'All active games will be preserved.\n\n' +
    'Type `/restart confirm` to proceed.',
    { parse_mode: 'Markdown' }
  );

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (text.includes('confirm')) {
    await ctx.reply('✅ Restarting bot...\n\nThe bot will be back online shortly.');
    logger.info('Bot restart requested by admin', { userId });
    
    // Give time for the message to send
    setTimeout(() => {
      process.exit(0); // Exit cleanly - process manager should restart
    }, 1000);
  }
}

/**
 * Handle /logs command - view recent logs
 */
export async function handleLogsCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id.toString();
  if (!userId || !(await groupManager.isAdmin(userId))) {
    await ctx.reply('❌ This command is for admins only.');
    return;
  }

  try {
    // Read the last 50 lines from the log file
    const logPath = path.join(process.cwd(), 'logs', 'bot.log');
    const logContent = await fs.readFile(logPath, 'utf-8');
    const lines = logContent.split('\n');
    const recentLines = lines.slice(-50).join('\n');

    if (recentLines.length > 3000) {
      // If too long for one message, send as file
      const buffer = Buffer.from(recentLines, 'utf-8');
      await ctx.replyWithDocument({
        source: buffer,
        filename: 'recent-logs.txt'
      }, {
        caption: '📝 **Recent Bot Logs** (last 50 entries)'
      });
    } else {
      await ctx.reply(
        '📝 **Recent Bot Logs**\n\n```\n' + 
        recentLines + 
        '\n```',
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    logger.error('Error reading logs:', error);
    await ctx.reply('❌ Error reading log file. Logs may not be available.');
  }
}

/**
 * Handle /activegames command - show all active games
 */
export async function handleActiveGamesCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id.toString();
  if (!userId || !(await groupManager.isAdmin(userId))) {
    await ctx.reply('❌ This command is for admins only.');
    return;
  }

  try {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) {
      await ctx.reply('❌ Unable to determine chat ID.');
      return;
    }

    // Import game state from main module
    const { getActiveGames } = await import('../index.js');
    const activeGames = getActiveGames(chatId);

    if (activeGames.length === 0) {
      await ctx.reply('📊 **Active Games**\n\n❌ No active games currently running in this chat.');
      return;
    }

    let message = '📊 **Active Games**\n\n';
    
    activeGames.forEach((game: any, index: number) => {
      const timeLeft = game.nextDrawTime ? 
        Math.max(0, Math.floor((game.nextDrawTime - Date.now()) / 1000)) : 0;
      
      message += `${index + 1}. **Chat ID:** \`${game.chatId}\`\n`;
      message += `   👥 Players: ${game.players.length}/${game.maxPlayers}\n`;
      message += `   📊 State: ${game.state}\n`;
      message += `   🎯 Phase: ${game.phase || 'N/A'}\n`;
      message += `   ⏱️ Next Draw: ${timeLeft > 0 ? `${timeLeft}s` : 'Now'}\n`;
      message += `   💰 Prize: ${game.prizeAmount || 'Standard'}\n\n`;
    });

    message += `Total Active Games: ${activeGames.length}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error getting active games:', error);
    await ctx.reply('❌ Error retrieving active games.');
  }
}

/**
 * Handle /scheduleevent command - schedule one-time event
 */
export async function handleScheduleEventCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id.toString();
  const chatId = ctx.chat?.id.toString();
  
  if (!userId || !chatId || !(await groupManager.isAdmin(userId))) {
    await ctx.reply('❌ This command is for admins only.');
    return;
  }

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);

  if (args.length < 3) {
    await ctx.reply(
      '🌟 **Schedule One-Time Event**\n\n' +
      'Usage: `/scheduleevent <time> <prize> "<name>"`\n\n' +
      '**Time Formats:**\n' +
      '• `30m` - 30 minutes from now\n' +
      '• `2h` - 2 hours from now\n' +
      '• `1d` - 1 day from now\n' +
      '• `2d12h` - 2 days and 12 hours\n' +
      '• `20:00` - Today at 8 PM\n' +
      '• `15:30` - Today at 3:30 PM\n\n' +
      '**Examples:**\n' +
      '`/scheduleevent 12h 100000 "Mega Weekend"`\n' +
      '`/scheduleevent 2d 200000 "Special Event"`\n' +
      '`/scheduleevent 20:00 75000 "Evening Draw"`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Parse time
  const timeStr = args[0];
  const prize = parseInt(args[1]);
  const name = args.slice(2).join(' ').replace(/['"]/g, '');

  if (isNaN(prize) || prize < 1000 || prize > 1000000) {
    await ctx.reply('❌ Prize must be between 1,000 and 1,000,000 tokens.');
    return;
  }

  if (name.length > 50) {
    await ctx.reply('❌ Event name must be 50 characters or less.');
    return;
  }

  // Import event scheduler
  const { eventScheduler } = await import('../utils/event-scheduler.js');
  
  try {
    const eventId = await eventScheduler.scheduleEvent({
      chatId,
      time: timeStr,
      prizeAmount: prize,
      eventName: name,
      createdBy: userId
    });

    await ctx.reply(
      `✅ **Event Scheduled!**\n\n` +
      `🎯 Event: "${name}"\n` +
      `💰 Prize: ${prize.toLocaleString()} tokens\n` +
      `⏰ Time: ${timeStr}\n` +
      `🆔 Event ID: \`${eventId}\`\n\n` +
      `Use \`/cancelevent ${eventId}\` to cancel.`,
      { parse_mode: 'Markdown' }
    );

    // Additional notification can be sent via bot if needed
    logger.info(`Special event "${name}" scheduled for chat ${chatId} with prize ${prize}`);
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

/**
 * Handle /cancelevent command - cancel scheduled event
 */
export async function handleCancelEventCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id.toString();
  const chatId = ctx.chat?.id.toString();
  
  if (!userId || !chatId || !(await groupManager.isAdmin(userId))) {
    await ctx.reply('❌ This command is for admins only.');
    return;
  }

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply(
      '❌ **Cancel Event**\n\n' +
      'Usage: `/cancelevent <eventId>`\n\n' +
      'Use `/scheduled` to see event IDs.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const eventId = args[0];
  const { eventScheduler } = await import('../utils/event-scheduler.js');
  
  try {
    const cancelled = await eventScheduler.cancelEvent(eventId, chatId);
    
    if (cancelled) {
      await ctx.reply(
        `✅ **Event Cancelled**\n\n` +
        `Event ID: \`${eventId}\` has been cancelled.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('❌ Event not found or you don\'t have permission to cancel it.');
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}