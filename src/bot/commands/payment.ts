import { Telegraf, Context, Markup } from 'telegraf';
import { PaymentService, PaymentStatus } from '../../services/payment/payment.service';
import { WalletVerificationService } from '../../services/wallet/wallet-verification.service';
import { GameService } from '../../services/game.service';
import { StructuredLogger } from '../../utils/structured-logger';

interface PaymentCommandContext extends Context {
  paymentService: PaymentService;
  walletService: WalletVerificationService;
  gameService: GameService;
  logger: StructuredLogger;
}

export function registerPaymentCommands(bot: Telegraf<PaymentCommandContext>) {
  // Join paid game command
  bot.command('join_paid_game', async (ctx) => {
    const logContext = ctx.logger.createContext();

    try {
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('⚠️ Please use this command in a private chat with the bot.');
        return;
      }

      const userId = ctx.from!.id.toString();

      // Check if user has verified wallet
      const primaryWallet = await ctx.walletService.getPrimaryWallet(userId);
      if (!primaryWallet) {
        await ctx.reply(
          '❌ *No Verified Wallet*\n\n' +
          'You need to verify a wallet before joining paid games.\n\n' +
          'Use /verify_wallet to get started!',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Get active paid games
      const activeGames = await ctx.gameService.getActivePaidGames();
      
      if (activeGames.length === 0) {
        await ctx.reply('📭 No paid games are currently active.');
        return;
      }

      // Show game selection
      const keyboard = activeGames.map(game => {
        const fee = game.entryFee || '0';
        const players = game.currentPlayers || 0;
        const maxPlayers = game.maxPlayers || 100;
        
        return [Markup.button.callback(
          `💰 ${fee} MWOR | 👥 ${players}/${maxPlayers}`,
          `join_game:${game.id}`
        )];
      });

      keyboard.push([Markup.button.callback('❌ Cancel', 'cancel_join_game')]);

      await ctx.reply(
        '🎮 *Select a Game to Join*\n\n' +
        'Choose from the available paid games:',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
        }
      );
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'join_paid_game',
        userId: ctx.from?.id.toString()
      });
      await ctx.reply('❌ An error occurred. Please try again later.');
    }
  });

  // Check payment status
  bot.command('payment_status', async (ctx) => {
    const logContext = ctx.logger.createContext();

    try {
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('⚠️ Please use this command in a private chat with the bot.');
        return;
      }

      const args = ctx.message.text.split(' ');
      if (args.length < 2) {
        await ctx.reply(
          '📋 *Usage:* `/payment_status [reference]`\n\n' +
          'Example: `/payment_status PAY-ABC123XY`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const referenceKey = args[1];
      const userId = ctx.from!.id.toString();

      const payment = await ctx.paymentService.checkPaymentStatus(userId, referenceKey);
      
      if (!payment) {
        await ctx.reply('❌ Payment not found. Please check your reference code.');
        return;
      }

      const statusEmoji = {
        [PaymentStatus.INITIATED]: '🔵',
        [PaymentStatus.AWAITING_PAYMENT]: '🟡',
        [PaymentStatus.CONFIRMING]: '🟠',
        [PaymentStatus.CONFIRMED]: '🟢',
        [PaymentStatus.DISTRIBUTING]: '🔄',
        [PaymentStatus.COMPLETED]: '✅',
        [PaymentStatus.FAILED]: '❌',
        [PaymentStatus.REFUNDED]: '↩️',
        [PaymentStatus.EXPIRED]: '⏰'
      };

      const statusText = {
        [PaymentStatus.INITIATED]: 'Payment initiated',
        [PaymentStatus.AWAITING_PAYMENT]: 'Awaiting payment',
        [PaymentStatus.CONFIRMING]: 'Confirming transaction',
        [PaymentStatus.CONFIRMED]: 'Payment confirmed',
        [PaymentStatus.DISTRIBUTING]: 'Processing treasury fee',
        [PaymentStatus.COMPLETED]: 'Payment completed',
        [PaymentStatus.FAILED]: 'Payment failed',
        [PaymentStatus.REFUNDED]: 'Payment refunded',
        [PaymentStatus.EXPIRED]: 'Payment expired'
      };

      await ctx.reply(
        `${statusEmoji[payment.status]} *Payment Status*\n\n` +
        `Reference: \`${payment.referenceKey}\`\n` +
        `Amount: ${payment.amount} MWOR\n` +
        `Status: ${statusText[payment.status]}\n` +
        `${payment.gameId ? `Game: #${payment.gameId.slice(0, 8)}\n` : ''}` +
        `\n_Last updated: ${new Date().toLocaleTimeString()}_`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'payment_status',
        userId: ctx.from?.id.toString()
      });
      await ctx.reply('❌ An error occurred. Please try again later.');
    }
  });

  // Handle game join selection
  bot.action(/join_game:(.+)/, async (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from!.id.toString();
    const logContext = ctx.logger.createContext();

    try {
      await ctx.answerCbQuery();

      // Check if user is already in the game
      const isInGame = await ctx.gameService.isUserInGame(gameId, userId);
      if (isInGame) {
        await ctx.editMessageText('ℹ️ You are already in this game!');
        return;
      }

      // Get game details
      const game = await ctx.gameService.getGame(gameId);
      if (!game) {
        await ctx.editMessageText('❌ Game not found.');
        return;
      }

      if (game.status !== 'active') {
        await ctx.editMessageText('❌ This game is no longer accepting players.');
        return;
      }

      // Create payment request
      const payment = await ctx.paymentService.createPaymentRequest(
        userId,
        game.entryFee || 0,
        {
          gameId,
          metadata: {
            gameType: 'paid_lottery',
            chatId: game.chatId
          }
        }
      );

      const botAddress = process.env.BOT_WALLET_ADDRESS!;
      let message = 
        `💸 *Payment Required*\n\n` +
        `Game Entry Fee: *${payment.amount} MWOR*\n\n` +
        `Send exactly ${payment.amount} MWOR to:\n` +
        `\`${botAddress}\`\n\n` +
        `📝 Reference: *${payment.referenceKey}*\n\n` +
        `⏱ Expires in 10 minutes\n\n`;

      // Add QR code if available
      if (payment.qrCodeUrl) {
        message += `_Or scan the QR code with your Solana wallet_`;
      }

      const keyboard = [
        [Markup.button.callback('✅ Check Payment', `check_payment:${payment.referenceKey}`)],
        [Markup.button.callback('📋 Copy Address', `copy_address:${botAddress}`)],
        [Markup.button.callback('❌ Cancel', 'cancel_payment')]
      ];

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
      });

      // Send QR code as separate image if available
      if (payment.qrCodeUrl) {
        const base64Data = payment.qrCodeUrl.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        await ctx.replyWithPhoto({ source: buffer }, {
          caption: `Solana Pay QR Code for ${payment.referenceKey}`
        });
      }
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        action: 'join_game',
        userId,
        gameId
      });
      await ctx.answerCbQuery('❌ An error occurred. Please try again.', { show_alert: true });
    }
  });

  // Check payment
  bot.action(/check_payment:(.+)/, async (ctx) => {
    const referenceKey = ctx.match[1];
    const userId = ctx.from!.id.toString();
    const logContext = ctx.logger.createContext();

    try {
      await ctx.answerCbQuery('🔍 Checking payment...');

      const payment = await ctx.paymentService.checkPaymentStatus(userId, referenceKey);
      
      if (!payment) {
        await ctx.answerCbQuery('❌ Payment not found.', { show_alert: true });
        return;
      }

      switch (payment.status) {
        case PaymentStatus.COMPLETED:
          // Add user to game
          if (payment.gameId) {
            await ctx.gameService.addUserToGame(payment.gameId, userId);
          }
          
          await ctx.editMessageText(
            '✅ *Payment Successful!*\n\n' +
            'You have been added to the game.\n' +
            'Good luck! 🍀',
            { parse_mode: 'Markdown' }
          );
          break;

        case PaymentStatus.CONFIRMING:
        case PaymentStatus.CONFIRMED:
        case PaymentStatus.DISTRIBUTING:
          await ctx.answerCbQuery(
            '⏳ Payment is being processed. Please wait a moment...',
            { show_alert: true }
          );
          break;

        case PaymentStatus.AWAITING_PAYMENT:
          await ctx.answerCbQuery(
            '💳 Payment not detected yet. Please ensure you sent the exact amount.',
            { show_alert: true }
          );
          break;

        case PaymentStatus.FAILED:
          await ctx.editMessageText(
            '❌ *Payment Failed*\n\n' +
            'There was an issue with your payment.\n' +
            'Please contact support if you believe this is an error.',
            { parse_mode: 'Markdown' }
          );
          break;

        case PaymentStatus.EXPIRED:
          await ctx.editMessageText(
            '⏰ *Payment Expired*\n\n' +
            'The payment window has closed.\n' +
            'Please start a new payment if you wish to join.',
            { parse_mode: 'Markdown' }
          );
          break;

        default:
          await ctx.answerCbQuery('Please wait...', { show_alert: true });
      }
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        action: 'check_payment',
        userId,
        referenceKey
      });
      await ctx.answerCbQuery('❌ An error occurred.', { show_alert: true });
    }
  });

  // Copy address helper
  bot.action(/copy_address:(.+)/, async (ctx) => {
    const address = ctx.match[1];
    await ctx.answerCbQuery(`Address: ${address}`, { show_alert: true });
  });

  // Cancel payment
  bot.action('cancel_payment', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Payment cancelled.');
  });

  // Cancel join game
  bot.action('cancel_join_game', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Cancelled.');
  });

  // Admin refund command
  bot.command('refund', async (ctx) => {
    const logContext = ctx.logger.createContext();

    try {
      // Check if user is admin
      if (!ctx.from || !isAdmin(ctx.from.id)) {
        return;
      }

      const args = ctx.message.text.split(' ');
      if (args.length < 3) {
        await ctx.reply(
          '📋 *Admin Refund Usage:*\n' +
          '`/refund [payment_id] [reason]`\n\n' +
          'Example: `/refund abc123 User request - duplicate payment`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const paymentId = args[1];
      const reason = args.slice(2).join(' ');

      const refundSignature = await ctx.paymentService.processRefund(
        paymentId,
        reason,
        ctx.from.username || ctx.from.id.toString()
      );

      await ctx.reply(
        '✅ *Refund Processed*\n\n' +
        `Payment ID: \`${paymentId}\`\n` +
        `Reason: ${reason}\n` +
        `Transaction: \`${refundSignature}\``,
        { parse_mode: 'Markdown' }
      );
    } catch (error: unknown) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'refund',
        userId: ctx.from?.id.toString()
      });
      await ctx.reply(`❌ Refund failed: ${(error as Error).message}`);
    }
  });
}

// Helper function to check if user is admin
function isAdmin(userId: number): boolean {
  const adminIds = process.env.ADMIN_USER_IDS?.split(',').map(id => parseInt(id)) || [];
  return adminIds.includes(userId);
}