import { Telegraf, Context, Markup } from 'telegraf';
import { WalletVerificationService } from '../../services/wallet/wallet-verification.service';
import { StructuredLogger } from '../../utils/structured-logger';

interface WalletCommandContext extends Context {
  walletService: WalletVerificationService;
  logger: StructuredLogger;
}

export function registerWalletCommands(bot: Telegraf<WalletCommandContext>) {
  // Start wallet verification
  bot.command('verify_wallet', async (ctx) => {
    const logContext = ctx.logger.createContext();

    try {
      // Check if in private chat
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('⚠️ Please use this command in a private chat with the bot.');
        return;
      }

      await ctx.reply(
        '🔐 *Wallet Verification*\n\n' +
        'Please enter your Solana wallet address:\n\n' +
        '_Make sure this is a wallet you control!_',
        { 
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'cancel_verification')]
          ])
        }
      );

      // Set state to wait for wallet address
      ctx.session = { ...ctx.session, state: 'awaiting_wallet_address' };
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'verify_wallet',
        userId: ctx.from?.id
      });
      await ctx.reply('❌ An error occurred. Please try again later.');
    }
  });

  // List user's wallets
  bot.command('my_wallets', async (ctx) => {
    const logContext = ctx.logger.createContext();

    try {
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('⚠️ Please use this command in a private chat with the bot.');
        return;
      }

      const userId = ctx.from!.id.toString();
      const wallets = await ctx.walletService.getUserWallets(userId);

      if (wallets.length === 0) {
        await ctx.reply(
          '📝 You have no verified wallets.\n\n' +
          'Use /verify_wallet to add your first wallet!'
        );
        return;
      }

      let message = '💳 *Your Verified Wallets*\n\n';
      
      for (const wallet of wallets) {
        const shortAddress = `${wallet.walletAddress.slice(0, 4)}...${wallet.walletAddress.slice(-4)}`;
        const primaryBadge = wallet.isPrimary ? ' 🌟 _Primary_' : '';
        message += `• \`${shortAddress}\`${primaryBadge}\n`;
      }

      message += '\n_Use /set_primary to change your primary wallet_';

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'my_wallets',
        userId: ctx.from?.id
      });
      await ctx.reply('❌ An error occurred. Please try again later.');
    }
  });

  // Set primary wallet
  bot.command('set_primary', async (ctx) => {
    const logContext = ctx.logger.createContext();

    try {
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('⚠️ Please use this command in a private chat with the bot.');
        return;
      }

      const userId = ctx.from!.id.toString();
      const wallets = await ctx.walletService.getUserWallets(userId);

      if (wallets.length === 0) {
        await ctx.reply('📝 You have no verified wallets.');
        return;
      }

      if (wallets.length === 1) {
        await ctx.reply('ℹ️ You only have one wallet, which is already set as primary.');
        return;
      }

      // Create inline keyboard with wallet options
      const keyboard = wallets
        .filter(w => !w.isPrimary)
        .map(wallet => {
          const shortAddress = `${wallet.walletAddress.slice(0, 6)}...${wallet.walletAddress.slice(-4)}`;
          return [Markup.button.callback(
            shortAddress,
            `set_primary:${wallet.walletAddress}`
          )];
        });

      keyboard.push([Markup.button.callback('❌ Cancel', 'cancel_set_primary')]);

      await ctx.reply(
        '🌟 *Select Primary Wallet*\n\n' +
        'Choose which wallet to set as your primary:',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(keyboard)
        }
      );
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'set_primary',
        userId: ctx.from?.id
      });
      await ctx.reply('❌ An error occurred. Please try again later.');
    }
  });

  // Remove wallet
  bot.command('remove_wallet', async (ctx) => {
    const logContext = ctx.logger.createContext();

    try {
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('⚠️ Please use this command in a private chat with the bot.');
        return;
      }

      const userId = ctx.from!.id.toString();
      const wallets = await ctx.walletService.getUserWallets(userId);

      if (wallets.length === 0) {
        await ctx.reply('📝 You have no verified wallets.');
        return;
      }

      // Create inline keyboard with wallet options
      const keyboard = wallets.map(wallet => {
        const shortAddress = `${wallet.walletAddress.slice(0, 6)}...${wallet.walletAddress.slice(-4)}`;
        const primaryBadge = wallet.isPrimary ? ' 🌟' : '';
        return [Markup.button.callback(
          `${shortAddress}${primaryBadge}`,
          `remove_wallet:${wallet.walletAddress}`
        )];
      });

      keyboard.push([Markup.button.callback('❌ Cancel', 'cancel_remove_wallet')]);

      await ctx.reply(
        '🗑 *Remove Wallet*\n\n' +
        '⚠️ Select a wallet to remove:',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(keyboard)
        }
      );
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'remove_wallet',
        userId: ctx.from?.id
      });
      await ctx.reply('❌ An error occurred. Please try again later.');
    }
  });

  // Handle wallet address input
  bot.on('text', async (ctx, next) => {
    if (ctx.session?.state !== 'awaiting_wallet_address') {
      return next();
    }

    const logContext = ctx.logger.createContext();

    try {
      const walletAddress = ctx.message.text.trim();
      const userId = ctx.from!.id.toString();

      // Validate address
      if (!ctx.walletService.isValidAddress(walletAddress)) {
        await ctx.reply(
          '❌ Invalid Solana wallet address.\n\n' +
          'Please enter a valid address:',
          {
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'cancel_verification')]
            ])
          }
        );
        return;
      }

      // Check if already verified
      const existingWallet = await ctx.walletService.getVerifiedWallet(userId, walletAddress);
      if (existingWallet) {
        await ctx.reply('ℹ️ This wallet is already verified for your account.');
        ctx.session.state = null;
        return;
      }

      // Initiate verification
      const verification = await ctx.walletService.initiateVerification(userId, walletAddress);
      
      const botAddress = process.env.BOT_WALLET_ADDRESS!;
      const message = 
        `💸 *Verification Payment Required*\n\n` +
        `To verify ownership, send exactly *${verification.amount} MWOR* to:\n\n` +
        `\`${botAddress}\`\n\n` +
        `📝 Reference: *${verification.token}*\n\n` +
        `⏱ Expires in 10 minutes\n\n` +
        `_This amount will be returned after verification (minus network fee)_`;

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Check Payment', `check_verify:${verification.token}`)],
          [Markup.button.callback('❌ Cancel', 'cancel_verification')]
        ])
      });

      ctx.session.state = null;
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        command: 'wallet_address_input',
        userId: ctx.from?.id
      });
      await ctx.reply('❌ An error occurred. Please try again later.');
      ctx.session.state = null;
    }
  });

  // Handle verification check
  bot.action(/check_verify:(.+)/, async (ctx) => {
    const token = ctx.match[1];
    const userId = ctx.from!.id.toString();
    const logContext = ctx.logger.createContext();

    try {
      await ctx.answerCbQuery();

      const verified = await ctx.walletService.checkVerification(userId, token);

      if (verified) {
        await ctx.editMessageText(
          '✅ *Wallet Verified Successfully!*\n\n' +
          'Your wallet has been linked to your account.\n' +
          'The verification amount will be returned shortly.\n\n' +
          '_Use /my_wallets to view your verified wallets._',
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.answerCbQuery(
          '⏳ Payment not found yet. Please wait a moment and try again.',
          { show_alert: true }
        );
      }
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        action: 'check_verify',
        userId,
        token
      });
      
      if (error.message.includes('expired')) {
        await ctx.editMessageText('❌ Verification expired. Please start again with /verify_wallet');
      } else {
        await ctx.answerCbQuery('❌ An error occurred. Please try again.', { show_alert: true });
      }
    }
  });

  // Handle set primary action
  bot.action(/set_primary:(.+)/, async (ctx) => {
    const walletAddress = ctx.match[1];
    const userId = ctx.from!.id.toString();
    const logContext = ctx.logger.createContext();

    try {
      await ctx.answerCbQuery();

      await ctx.walletService.setPrimaryWallet(userId, walletAddress);

      const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
      
      await ctx.editMessageText(
        `✅ *Primary Wallet Updated*\n\n` +
        `\`${shortAddress}\` is now your primary wallet.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        action: 'set_primary',
        userId,
        walletAddress
      });
      await ctx.answerCbQuery('❌ An error occurred. Please try again.', { show_alert: true });
    }
  });

  // Handle remove wallet action
  bot.action(/remove_wallet:(.+)/, async (ctx) => {
    const walletAddress = ctx.match[1];
    const userId = ctx.from!.id.toString();
    const logContext = ctx.logger.createContext();

    try {
      await ctx.answerCbQuery();

      // Add confirmation step
      const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
      
      await ctx.editMessageText(
        `⚠️ *Confirm Wallet Removal*\n\n` +
        `Are you sure you want to remove this wallet?\n` +
        `\`${shortAddress}\`\n\n` +
        `_You can verify it again later if needed._`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Yes, Remove', `confirm_remove:${walletAddress}`),
              Markup.button.callback('❌ Cancel', 'cancel_remove_wallet')
            ]
          ])
        }
      );
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        action: 'remove_wallet',
        userId,
        walletAddress
      });
      await ctx.answerCbQuery('❌ An error occurred. Please try again.', { show_alert: true });
    }
  });

  // Handle remove confirmation
  bot.action(/confirm_remove:(.+)/, async (ctx) => {
    const walletAddress = ctx.match[1];
    const userId = ctx.from!.id.toString();
    const logContext = ctx.logger.createContext();

    try {
      await ctx.answerCbQuery();

      await ctx.walletService.removeWallet(userId, walletAddress);

      const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
      
      await ctx.editMessageText(
        `✅ *Wallet Removed*\n\n` +
        `\`${shortAddress}\` has been removed from your account.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      ctx.logger.logError(logContext, error as Error, {
        action: 'confirm_remove',
        userId,
        walletAddress
      });
      await ctx.answerCbQuery('❌ An error occurred. Please try again.', { show_alert: true });
    }
  });

  // Cancel actions
  bot.action('cancel_verification', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Wallet verification cancelled.');
    ctx.session.state = null;
  });

  bot.action('cancel_set_primary', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Operation cancelled.');
  });

  bot.action('cancel_remove_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Operation cancelled.');
  });
}