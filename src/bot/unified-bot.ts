import { Telegraf, Context } from 'telegraf';
import { Update } from 'telegraf/types';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';
import { quizService } from '../services/quiz.service.js';
import { anthropicService } from '../services/anthropic.service.js';
import { userRegistrationService } from '../services/user-registration.service.js';
import * as https from 'https';
import * as dns from 'dns';

// Force IPv4 DNS resolution
dns.setDefaultResultOrder('ipv4first');

// Create HTTPS agent with IPv4 forcing
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 60000,
  maxSockets: 10,
  maxFreeSockets: 5,
  scheduling: 'fifo'
});

export interface UnifiedBotContext extends Context<Update> {
  userProfile?: any;
  currentMode?: 'lottery' | 'quiz';
}

export class UnifiedBot {
  private bot: Telegraf<UnifiedBotContext>;
  private instanceMode: 'primary' | 'secondary';

  constructor(instanceMode: 'primary' | 'secondary' = 'primary') {
    this.instanceMode = instanceMode;
    
    const token = instanceMode === 'primary' 
      ? config.botInstance.primaryToken 
      : config.botInstance.secondaryToken;

    if (!token) {
      throw new Error(`${instanceMode.toUpperCase()}_BOT_TOKEN is required`);
    }

    this.bot = new Telegraf(token, {
      handlerTimeout: 90000,
      telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: httpsAgent,
        attachmentAgent: httpsAgent,
        webhookReply: false
      }
    });

    this.setupMiddleware();
    this.setupCommands();
    this.setupCallbacks();

    logger.info(`Unified bot initialized in ${instanceMode} mode`);
  }

  private setupMiddleware(): void {
    // User registration and profile middleware
    this.bot.use(async (ctx, next) => {
      if (ctx.from) {
        const userData = {
          userId: ctx.from.id.toString(),
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          languageCode: ctx.from.language_code,
          chatId: ctx.chat?.id.toString(),
          chatType: ctx.chat?.type,
        };

        const userProfile = userRegistrationService.registerUser(userData);
        ctx.userProfile = userProfile;

        // Track activity
        userRegistrationService.trackActivity(ctx.from.id.toString());
      }

      return next();
    });

    // Rate limiting middleware for AI features
    this.bot.use(async (ctx, next) => {
      if (!ctx.from) return next();

      // Check if command uses AI features
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const isAICommand = text?.startsWith('/quiz_') || text?.startsWith('/generate_');

      if (isAICommand && config.features.anthropicIntegration) {
        const rateLimitInfo = anthropicService.getRateLimitInfo(ctx.from.id.toString());
        if (rateLimitInfo.isLimited) {
          const resetTime = Math.ceil((rateLimitInfo.resetTimeMinute.getTime() - Date.now()) / 1000);
          return ctx.reply(
            `⏰ AI feature rate limit exceeded. Please wait ${resetTime} seconds before trying again.`
          );
        }
      }

      return next();
    });

    // Error handling middleware
    this.bot.catch((err: any, ctx) => {
      logger.error(`Error for ${ctx.updateType}:`, err);
      ctx.reply('❌ An error occurred. Please try again later.');
    });
  }

  private setupCommands(): void {
    // Universal start command
    this.bot.command('start', (ctx) => {
      const instanceEmoji = this.instanceMode === 'primary' ? '🎯' : '🎲';
      const username = ctx.userProfile?.firstName || 'there';
      
      ctx.reply(
        `${instanceEmoji} Welcome to the Universal Bot, ${username}!\n\n` +
        `🎮 I support multiple game modes:\n\n` +
        `🎯 QUIZ MODE (AI-Powered):\n` +
        `• /quiz_start <topic> - Start AI quiz\n` +
        `• /quiz_suggest <topic> - Group voting\n` +
        `• /quiz_stats - Your quiz statistics\n\n` +
        `🎲 LOTTERY MODE:\n` +
        `• /lottery_create - Start survival lottery\n` +
        `• /lottery_join - Join active lottery\n` +
        `• /lottery_status - View game status\n\n` +
        `📊 GENERAL:\n` +
        `• /profile - Your profile & settings\n` +
        `• /leaderboard - Top players\n` +
        `• /help - Detailed help\n\n` +
        `🤖 Instance: ${this.instanceMode.toUpperCase()}\n` +
        `Choose your game mode and let's play! 🚀`
      );
    });

    // User profile and settings
    this.bot.command('profile', (ctx) => {
      const summary = userRegistrationService.getUserSummary(ctx.from!.id.toString());
      
      if (!summary) {
        return ctx.reply('❌ Profile not found. Please start a conversation first.');
      }

      const rateLimitInfo = anthropicService.getRateLimitInfo(ctx.from!.id.toString());
      const analytics = userRegistrationService.getUserAnalytics();
      
      let message = `👤 YOUR PROFILE\n\n${summary}\n\n`;
      message += `🤖 AI Usage Today:\n`;
      message += `• Requests this hour: ${rateLimitInfo.requestsThisHour}/${config.anthropic.rateLimitPerHour}\n`;
      message += `• Requests this minute: ${rateLimitInfo.requestsThisMinute}/${config.anthropic.rateLimitPerMinute}\n\n`;
      message += `🌐 Global Stats:\n`;
      message += `• Total Users: ${analytics.totalUsers}\n`;
      message += `• Active Users: ${analytics.activeUsers}\n`;
      message += `• Your Rank: TBD\n\n`;
      message += `Use /settings to customize your preferences!`;

      ctx.reply(message);
    });

    // Quiz mode commands (enhanced)
    this.setupQuizCommands();

    // Lottery mode commands (from original bot)
    this.setupLotteryCommands();

    // Help command
    this.bot.command('help', (ctx) => {
      const instanceEmoji = this.instanceMode === 'primary' ? '🎯' : '🎲';
      ctx.reply(
        `${instanceEmoji} UNIVERSAL BOT HELP\n\n` +
        `🎯 QUIZ MODE (AI-Powered):\n` +
        `• /quiz_start <topic> [difficulty] - Personal quiz\n` +
        `• /quiz_suggest <topic> - Suggest for group voting\n` +
        `• /quiz_vote - Vote for suggested topic\n` +
        `• /quiz_question - Get current question\n` +
        `• /quiz_answer <answer> - Submit answer\n` +
        `• /quiz_end - End current session\n` +
        `• /quiz_stats - Personal quiz statistics\n` +
        `• /quiz_leaderboard - Quiz leaderboard\n\n` +
        `🎲 LOTTERY MODE:\n` +
        `• /lottery_create [options] - Create survival lottery\n` +
        `• /lottery_join - Join active lottery\n` +
        `• /lottery_status - View game status\n` +
        `• /lottery_stats - Lottery statistics\n` +
        `• /lottery_leaderboard - Lottery leaderboard\n\n` +
        `📊 UNIVERSAL:\n` +
        `• /profile - Your profile & settings\n` +
        `• /leaderboard - Combined leaderboard\n` +
        `• /analytics - Platform analytics\n` +
        `• /switch_mode <quiz|lottery> - Set default mode\n\n` +
        `🎚️ Quiz Difficulties: easy, medium, hard\n` +
        `🔧 Lottery Options: --max, --start, --survivors, --selection\n\n` +
        `🤖 Powered by Anthropic Claude AI + VRF Technology`
      );
    });

    // Analytics command
    this.bot.command('analytics', async (ctx) => {
      if (ctx.chat.type !== 'private') {
        return ctx.reply('📊 Analytics are only available in private chat for privacy.');
      }

      const analytics = userRegistrationService.getUserAnalytics();
      const quizStats = quizService.getQuizStatistics();
      
      let message = `📊 PLATFORM ANALYTICS\n\n`;
      message += `👥 Users:\n`;
      message += `• Total: ${analytics.totalUsers}\n`;
      message += `• Active: ${analytics.activeUsers}\n`;
      message += `• New Today: ${analytics.newUsersToday}\n`;
      message += `• Premium: ${analytics.premiumUsers}\n\n`;
      
      message += `🎯 Quiz Activity:\n`;
      message += `• Total Sessions: ${quizStats.totalSessions}\n`;
      message += `• Total Questions: ${quizStats.totalQuestions}\n`;
      message += `• Average Score: ${quizStats.averageScore}\n\n`;
      
      message += `📚 Popular Topics:\n`;
      analytics.topTopics.slice(0, 5).forEach((topic, index) => {
        message += `${index + 1}. ${topic.topic} (${topic.count} sessions)\n`;
      });
      
      message += `\n🏆 Top Players:\n`;
      quizStats.topPlayers.slice(0, 3).forEach((player, index) => {
        const medal = ['🥇', '🥈', '🥉'][index];
        message += `${medal} ${player.username}: ${player.totalScore} pts\n`;
      });

      await ctx.reply(message);
    });
  }

  private setupQuizCommands(): void {
    // Quiz start command
    this.bot.command('quiz_start', async (ctx) => {
      if (!config.features.quizMode) {
        return ctx.reply('🚫 Quiz mode is currently disabled.');
      }

      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        return ctx.reply(
          '📚 Please specify a topic: /quiz_start <topic> [difficulty]\n\n' +
          'Examples:\n' +
          '• /quiz_start \"World History\" medium\n' +
          '• /quiz_start \"JavaScript Programming\"\n' +
          '• /quiz_start \"Science\" hard\n\n' +
          'Difficulties: easy, medium, hard (default: medium)'
        );
      }

      let topic: string;
      let difficulty: 'easy' | 'medium' | 'hard' = 
        ctx.userProfile?.preferences?.defaultDifficulty || 'medium';

      // Parse topic and difficulty
      if (args[args.length - 1] === 'easy' || args[args.length - 1] === 'medium' || args[args.length - 1] === 'hard') {
        difficulty = args.pop() as 'easy' | 'medium' | 'hard';
        topic = args.join(' ');
      } else {
        topic = args.join(' ');
      }

      topic = topic.replace(/^[\"']|[\"']$/g, '');

      if (!topic.trim()) {
        return ctx.reply('❌ Please provide a valid topic.');
      }

      const userId = ctx.from!.id.toString();
      const username = ctx.from!.username || ctx.from!.first_name || 'Anonymous';

      try {
        await ctx.reply('🔄 Generating AI quiz questions... This may take a moment.');
        
        const session = await quizService.startQuizSession(userId, username, topic, difficulty, 5);
        
        await ctx.reply(
          `🎯 AI QUIZ STARTED!\n\n` +
          `📚 Topic: ${topic}\n` +
          `🎚️ Difficulty: ${difficulty}\n` +
          `📝 Questions: ${session.questions.length}\n` +
          `⏱️ Time limit: ${config.quiz.sessionTimeout / 1000} seconds\n` +
          `🤖 Generated by Claude AI\n\n` +
          `Ready? Let's test your knowledge! 🚀`
        );

        // Send first question
        await this.sendCurrentQuestion(ctx, userId);

      } catch (error) {
        logger.error(`Error starting quiz for ${userId}:`, error);
        ctx.reply(`❌ Error starting AI quiz: ${error.message}`);
      }
    });

    // Other quiz commands...
    this.bot.command('quiz_question', async (ctx) => {
      const userId = ctx.from!.id.toString();
      await this.sendCurrentQuestion(ctx, userId);
    });

    this.bot.command('quiz_answer', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        return ctx.reply('❓ Please provide your answer: /quiz_answer <your answer>');
      }

      const answer = args.join(' ');
      const userId = ctx.from!.id.toString();

      try {
        const result = quizService.submitAnswer(userId, answer);
        await this.handleQuizResult(ctx, result);
      } catch (error) {
        logger.error(`Error submitting answer for ${userId}:`, error);
        ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    this.bot.command('quiz_stats', async (ctx) => {
      const userId = ctx.from!.id.toString();
      const stats = quizService.getUserStats(userId);
      
      if (!stats) {
        return ctx.reply(
          '📊 No quiz statistics found.\n\n' +
          'Start your first AI quiz with /quiz_start <topic>!'
        );
      }

      const message = `🧠 YOUR AI QUIZ STATISTICS\n\n` +
        `👤 Player: ${stats.username}\n` +
        `🎯 Total Score: ${stats.totalScore} points\n` +
        `🎮 Sessions Played: ${stats.sessionsPlayed}\n` +
        `📈 Average Score: ${Math.round(stats.averageScore)} points\n` +
        `🔥 Current Streak: ${stats.currentStreak}\n` +
        `🏆 Best Streak: ${stats.bestStreak}\n` +
        `📅 Last Played: ${stats.lastPlayed.toLocaleDateString()}\n\n` +
        `📚 Favorite Topics:\n${stats.favoriteTopics.slice(0, 5).map(t => `• ${t}`).join('\n') || 'None yet'}\n\n` +
        `🤖 Powered by Claude AI • Keep learning! 🚀`;

      await ctx.reply(message);
    });
  }

  private setupLotteryCommands(): void {
    // Simplified lottery commands (you can expand these based on the original lottery bot)
    this.bot.command('lottery_create', (ctx) => {
      // Implementation would be similar to the original lottery bot
      ctx.reply(
        '🎲 Lottery mode is being updated to work with the new unified system.\n\n' +
        'This feature will be available soon! For now, try the AI Quiz mode:\n' +
        '/quiz_start <topic>'
      );
    });

    this.bot.command('lottery_join', (ctx) => {
      ctx.reply('🎲 Lottery features coming soon! Try /quiz_start for AI-powered quizzes.');
    });

    this.bot.command('lottery_status', (ctx) => {
      ctx.reply('🎲 No active lottery games. Try /quiz_start for instant AI quizzes!');
    });
  }

  private setupCallbacks(): void {
    this.bot.on('callback_query', async (ctx) => {
      try {
        if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
          return ctx.answerCbQuery('Invalid callback');
        }

        const data = ctx.callbackQuery.data;

        if (data.startsWith('quiz_answer_')) {
          const answer = data.replace('quiz_answer_', '');
          const userId = ctx.from.id.toString();

          try {
            const result = quizService.submitAnswer(userId, answer);
            await this.handleQuizResult(ctx, result, true);
          } catch (error) {
            await ctx.answerCbQuery(`Error: ${error.message}`);
          }
        }
      } catch (error) {
        logger.error('Error in callback query:', error);
        await ctx.answerCbQuery('An error occurred');
      }
    });
  }

  private async sendCurrentQuestion(ctx: Context, userId: string): Promise<void> {
    const session = quizService.getActiveSession(userId);
    if (!session) {
      await ctx.reply('❌ No active quiz session. Start one with /quiz_start <topic>');
      return;
    }

    const question = quizService.getCurrentQuestion(userId);
    if (!question) {
      await ctx.reply('❌ No current question available.');
      return;
    }

    const questionNumber = session.currentQuestionIndex + 1;
    const totalQuestions = session.questions.length;
    
    let message = `❓ AI QUESTION ${questionNumber}/${totalQuestions}\n\n`;
    message += `📚 Topic: ${session.topic}\n`;
    message += `🎚️ Difficulty: ${question.difficulty}\n`;
    message += `⏱️ Estimated time: ${question.estimatedTime}s\n`;
    message += `🤖 Generated by Claude AI\n\n`;
    message += `${question.question}\n\n`;

    if (question.type === 'multiple_choice' && question.options) {
      question.options.forEach((option: string) => {
        message += `${option}\n`;
      });
    }

    await ctx.reply(message, this.getQuestionKeyboard(question));
  }

  private getQuestionKeyboard(question: any): any {
    if (!question) return undefined;

    if (question.type === 'multiple_choice' && question.options) {
      const buttons = question.options.map((option: string) => {
        const letter = option.substring(0, 1);
        return { text: option, callback_data: `quiz_answer_${letter}` };
      });

      return {
        inline_keyboard: [
          buttons.slice(0, 2),
          buttons.slice(2, 4),
        ]
      };
    }

    return undefined;
  }

  private async handleQuizResult(ctx: Context, result: any, isCallback: boolean = false): Promise<void> {
    const emoji = result.isCorrect ? '✅' : '❌';
    const scoreText = result.isCorrect ? `+${result.score} points` : '0 points';
    
    let message = `${emoji} ${result.isCorrect ? 'Correct!' : 'Incorrect!'}\n\n`;
    message += `💡 ${result.explanation}\n`;
    message += `📊 Score: ${scoreText}\n\n`;

    if (result.sessionComplete) {
      const finalResults = result.finalResults;
      message += `🏁 AI QUIZ COMPLETED!\n\n`;
      message += `📊 Final Results:\n`;
      message += `• Questions: ${finalResults.correctAnswers}/${finalResults.totalQuestions}\n`;
      message += `• Accuracy: ${finalResults.accuracy}%\n`;
      message += `• Total Score: ${finalResults.totalScore} points\n`;
      message += `• Duration: ${finalResults.duration} seconds\n\n`;
      message += `🤖 Thank you for using AI Quiz! Try another topic! 🎉`;

      // Update user statistics
      if ((ctx as any).userProfile) {
        userRegistrationService.updateUserStatistics(ctx.from!.id.toString(), {
          questionsAnswered: finalResults.totalQuestions,
          correctAnswers: finalResults.correctAnswers,
          score: finalResults.totalScore,
          topic: result.topic || 'Unknown',
          difficulty: 'medium',
        });
      }
    } else if (result.nextQuestion) {
      message += `📝 Next Question:\n\n`;
      message += `${result.nextQuestion.question}\n\n`;
      
      if (result.nextQuestion.options) {
        result.nextQuestion.options.forEach((option: string) => {
          message += `${option}\n`;
        });
      }
    }

    if (isCallback && ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        reply_markup: result.nextQuestion ? this.getQuestionKeyboard(result.nextQuestion) : undefined
      });
    } else {
      await ctx.reply(message, this.getQuestionKeyboard(result.nextQuestion));
    }
  }

  public async start(): Promise<void> {
    try {
      logger.info(`🔧 Testing ${this.instanceMode} unified bot connection...`);
      
      const me = await this.bot.telegram.getMe();
      logger.info(`✅ ${this.instanceMode} unified bot connection successful:`, me.username);
      
      await this.bot.launch();
      
      logger.info(`🎯 Unified bot (${this.instanceMode}) is running!`);
      console.log(`✅ ${this.instanceMode} unified bot started successfully!`);
      console.log(`🤖 Bot username: @${me.username}`);
      console.log(`🧠 AI Quiz + 🎲 Lottery functionality enabled`);
      
    } catch (error: any) {
      logger.error(`Failed to start ${this.instanceMode} unified bot:`, error.message);
      console.error(`❌ ${this.instanceMode} bot startup failed - check token and network`);
      throw error;
    }
  }

  public stop(): void {
    this.bot.stop();
    logger.info(`🛑 Unified bot (${this.instanceMode}) stopped`);
  }

  public getBot(): Telegraf<UnifiedBotContext> {
    return this.bot;
  }
}