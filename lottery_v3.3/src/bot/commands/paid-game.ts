import { Context } from 'telegraf';
import { EnhancedGameService } from '../../services/enhanced-game.service';
import { PublicKey } from '@solana/web3.js';
import QRCode from 'qrcode';
import config from '../../config';

export class PaidGameCommand {
  constructor(
    private gameService: EnhancedGameService
  ) {}

  /**
   * Handle /paidgame command
   */
  async handlePaidGame(ctx: Context) {
    if (!config.features.paidGames || !config.features.blockchain) {
      await ctx.reply('💰 Paid games are currently disabled.');
      return;
    }

    try {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;

      // Parse command arguments
      const args = ctx.message?.text?.split(' ').slice(1) || [];
      const entryFee = parseFloat(args[0] || '1'); // Default 1 MWOR
      const maxPlayers = parseInt(args[1] || '10'); // Default 10 players
      const winnerCount = parseInt(args[2] || '1'); // Default 1 winner

      // Validate inputs
      if (entryFee <= 0 || entryFee > 1000) {
        await ctx.reply('❌ Entry fee must be between 0.01 and 1000 MWOR');
        return;
      }

      if (maxPlayers < 2 || maxPlayers > 100) {
        await ctx.reply('❌ Player count must be between 2 and 100');
        return;
      }

      if (winnerCount < 1 || winnerCount >= maxPlayers) {
        await ctx.reply('❌ Invalid winner count');
        return;
      }

      // Create game
      const game = await this.gameService.createGame(chatId, {
        type: 'paid',
        maxPlayers,
        durationMinutes: 60, // 60 minutes to join
        winnersCount: winnerCount,
        entryFee,
        metadata: {
          createdBy: ctx.from?.id,
          createdByUsername: ctx.from?.username,
        }
      });

      // Calculate prize pool
      const prizePool = entryFee * maxPlayers * 0.9; // 90% to winners
      const prizePerWinner = prizePool / winnerCount;

      // Create join button
      const keyboard = {
        inline_keyboard: [
          [
            { text: '💰 Join Game', callback_data: `join_paid:${game.id}` },
            { text: '📊 View Details', callback_data: `game_info:${game.id}` }
          ],
          [
            { text: '🏆 View Leaderboard', callback_data: 'leaderboard' }
          ]
        ]
      };

      await ctx.reply(
        `🎰 <b>Paid Lottery Game Created!</b>\n\n` +
        `💰 Entry Fee: <b>${entryFee} MWOR</b>\n` +
        `👥 Max Players: <b>${maxPlayers}</b>\n` +
        `🏆 Winners: <b>${winnerCount}</b>\n` +
        `💎 Prize per Winner: <b>${prizePerWinner.toFixed(2)} MWOR</b>\n` +
        `⏰ Join Deadline: <b>60 minutes</b>\n\n` +
        `🔗 Game ID: <code>${game.id}</code>\n` +
        `🌐 On-chain: <a href="https://solscan.io/account/${game.gamePDA}?cluster=${config.solana.network}">View on Solscan</a>\n\n` +
        `Click "Join Game" to participate!`,
        { 
          parse_mode: 'HTML',
          reply_markup: keyboard,
          disable_web_page_preview: true
        }
      );
    } catch (error) {
      console.error('Error creating paid game:', error);
      await ctx.reply('❌ Failed to create paid game. Please try again.');
    }
  }

  /**
   * Handle join paid game callback
   */
  async handleJoinPaidGame(ctx: Context, gameId: string) {
    try {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      // Check if already in game
      const isInGame = await this.gameService.isUserInGame(gameId, userId);
      if (isInGame) {
        await ctx.answerCbQuery('You are already in this game!');
        return;
      }

      // Get payment details
      const paymentDetails = await this.gameService.getPaymentDetails(gameId, userId);

      // Generate QR code
      const qrCodeBuffer = await QRCode.toBuffer(paymentDetails.qrCode, {
        type: 'png',
        width: 400,
        margin: 2,
      });

      // Payment instructions
      const instructions = 
        `💰 <b>Payment Required</b>\n\n` +
        `To join this game, send <b>${paymentDetails.amount} MWOR</b> to:\n\n` +
        `<code>${paymentDetails.escrowAddress}</code>\n\n` +
        `📝 Memo: <code>${paymentDetails.memo}</code>\n\n` +
        `🔍 <b>Instructions:</b>\n` +
        `1. Open your Solana wallet (Phantom, Solflare, etc.)\n` +
        `2. Scan the QR code or send to the address above\n` +
        `3. Include the exact memo in your transaction\n` +
        `4. Wait for confirmation\n\n` +
        `⚠️ <b>Important:</b>\n` +
        `• Send exact amount (${paymentDetails.amount} MWOR)\n` +
        `• Include the memo or payment won't be recognized\n` +
        `• Payments are held in escrow until game completes\n` +
        `• Winners receive automatic payouts`;

      // Send QR code and instructions
      await ctx.replyWithPhoto(
        { source: qrCodeBuffer },
        {
          caption: instructions,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: '✅ I\'ve Sent Payment', 
                  callback_data: `verify_payment:${gameId}:${userId}` 
                }
              ],
              [
                { 
                  text: '❓ Help', 
                  url: 'https://docs.lottery-bot.com/payments' 
                }
              ]
            ]
          }
        }
      );

      await ctx.answerCbQuery('Payment instructions sent!');
    } catch (error) {
      console.error('Error handling join paid game:', error);
      await ctx.answerCbQuery('Failed to generate payment details');
    }
  }

  /**
   * Handle payment verification
   */
  async handleVerifyPayment(ctx: Context, gameId: string, userId: string) {
    try {
      await ctx.answerCbQuery('Verifying payment...', { show_alert: false });

      // Get user's wallet address (would come from a wallet connection flow)
      // For now, we'll simulate this
      const walletAddress = await this.getUserWallet(userId);
      
      if (!walletAddress) {
        await ctx.reply(
          '❌ No wallet connected. Please connect your wallet first.\n' +
          'Use /wallet to connect your Solana wallet.'
        );
        return;
      }

      // Verify payment
      const verified = await this.gameService.verifyPaymentAndJoin(
        gameId,
        userId,
        walletAddress
      );

      if (verified) {
        await ctx.reply(
          '✅ <b>Payment Verified!</b>\n\n' +
          'You have successfully joined the game.\n' +
          'Good luck! 🍀',
          { parse_mode: 'HTML' }
        );

        // Send number selection prompt for elimination games
        const keyboard = {
          inline_keyboard: [
            [
              { text: '🎯 Select Number', callback_data: `select_number:${gameId}` }
            ]
          ]
        };

        await ctx.reply(
          '🎯 <b>Number Selection</b>\n\n' +
          'Please select your lucky number for the elimination rounds.',
          { 
            parse_mode: 'HTML',
            reply_markup: keyboard
          }
        );
      } else {
        await ctx.reply(
          '⏳ <b>Payment Not Found</b>\n\n' +
          'We couldn\'t find your payment yet. Please ensure:\n' +
          '• You sent the exact amount\n' +
          '• You included the correct memo\n' +
          '• The transaction is confirmed\n\n' +
          'Try again in a few seconds or contact support.',
          { parse_mode: 'HTML' }
        );
      }
    } catch (error) {
      console.error('Error verifying payment:', error);
      await ctx.reply('❌ Failed to verify payment. Please try again.');
    }
  }

  /**
   * Handle number selection
   */
  async handleNumberSelection(ctx: Context, gameId: string) {
    try {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      const game = await this.gameService.getGame(gameId);
      if (!game) {
        await ctx.reply('❌ Game not found');
        return;
      }

      // Generate number buttons
      const maxNumber = game.maxPlayers * 2;
      const buttons = [];
      const buttonsPerRow = 5;

      for (let i = 1; i <= maxNumber; i += buttonsPerRow) {
        const row = [];
        for (let j = i; j < i + buttonsPerRow && j <= maxNumber; j++) {
          row.push({
            text: j.toString(),
            callback_data: `pick_number:${gameId}:${j}`
          });
        }
        buttons.push(row);
      }

      await ctx.reply(
        '🎯 <b>Select Your Number</b>\n\n' +
        `Choose a number between 1 and ${maxNumber}.\n` +
        'Each player must select a unique number.\n' +
        'Numbers will be eliminated randomly each round.',
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons }
        }
      );
    } catch (error) {
      console.error('Error handling number selection:', error);
      await ctx.reply('❌ Failed to show number selection');
    }
  }

  /**
   * Handle number pick
   */
  async handlePickNumber(ctx: Context, gameId: string, number: string) {
    try {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      const numberInt = parseInt(number);
      await this.gameService.selectNumber(gameId, userId, numberInt);

      await ctx.answerCbQuery(`Number ${number} selected! 🎯`);
      
      await ctx.reply(
        `✅ <b>Number Selected!</b>\n\n` +
        `Your number: <b>${number}</b>\n\n` +
        `Wait for all players to select their numbers.\n` +
        `The elimination rounds will begin soon! 🎰`,
        { parse_mode: 'HTML' }
      );
    } catch (error: any) {
      if (error.message.includes('already taken')) {
        await ctx.answerCbQuery('This number is already taken!', { show_alert: true });
      } else {
        console.error('Error picking number:', error);
        await ctx.answerCbQuery('Failed to select number', { show_alert: true });
      }
    }
  }

  /**
   * Get user's connected wallet
   */
  private async getUserWallet(userId: string): Promise<string | null> {
    // In production, this would retrieve the user's connected wallet
    // For testing, we can use a test wallet
    if (config.isDevelopment) {
      return 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Test wallet
    }
    
    // TODO: Implement wallet connection flow
    return null;
  }
}