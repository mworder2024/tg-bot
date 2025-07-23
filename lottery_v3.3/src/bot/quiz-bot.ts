import { Telegraf, Context } from 'telegraf';
import { Update } from 'telegraf/types';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';
import { quizService } from '../services/quiz.service.js';
import { anthropicService } from '../services/anthropic.service.js';
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

export interface QuizBotContext extends Context<Update> {
  quizSession?: any;
}

export class QuizBot {
  private bot: Telegraf<QuizBotContext>;
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

    this.setupCommands();
    this.setupCallbacks();
    this.setupMiddleware();

    logger.info(`Quiz bot initialized in ${instanceMode} mode`);
  }

  private setupMiddleware(): void {
    // Error handling middleware
    this.bot.catch((err: any, ctx) => {
      logger.error(`Error for ${ctx.updateType}:`, err);
      ctx.reply('❌ An error occurred. Please try again later.');
    });

    // Rate limiting middleware
    this.bot.use(async (ctx, next) => {
      if (!ctx.from) return next();

      const rateLimitInfo = anthropicService.getRateLimitInfo(ctx.from.id.toString());
      if (rateLimitInfo.isLimited) {
        const resetTime = Math.ceil((rateLimitInfo.resetTimeMinute.getTime() - Date.now()) / 1000);
        return ctx.reply(
          `⏰ Rate limit exceeded. Please wait ${resetTime} seconds before trying again.`
        );
      }

      return next();
    });
  }

  private setupCommands(): void {
    // Start command
    this.bot.command('start', (ctx) => {
      const instanceEmoji = this.instanceMode === 'primary' ? '🎯' : '🎲';
      ctx.reply(
        `${instanceEmoji} Welcome to the Quiz Bot (${this.instanceMode.toUpperCase()} instance)!\n\n` +
        `🧠 I can generate quiz questions on any topic using AI.\n\n` +
        `Commands:\n` +
        `📚 /quiz_suggest <topic> - Suggest a quiz topic for voting\n` +
        `🗳️ /quiz_vote - Vote for the current topic\n` +
        `🎯 /quiz_start <topic> [difficulty] - Start a personal quiz\n` +
        `❓ /quiz_question - Get current question\n` +
        `✅ /quiz_answer <answer> - Submit your answer\n` +
        `🏁 /quiz_end - End current quiz session\n` +
        `📊 /quiz_stats - View your statistics\n` +
        `🏆 /quiz_leaderboard - View top players\n` +
        `ℹ️ /quiz_help - Get detailed help\n\n` +
        `Let's test your knowledge! 🚀`
      );
    });

    // Suggest topic for group voting
    this.bot.command('quiz_suggest', async (ctx) => {
      if (ctx.chat.type === 'private') {
        return ctx.reply('📝 Topic voting is only available in groups. Use /quiz_start for personal quizzes.');
      }

      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        return ctx.reply('📚 Please specify a topic: /quiz_suggest <topic>\n\nExample: /quiz_suggest World History');
      }

      const topic = args.join(' ');
      const username = ctx.from?.username || ctx.from?.first_name || 'Anonymous';
      
      try {
        const vote = quizService.startTopicVoting(ctx.chat.id.toString(), topic, ctx.from!.id.toString());
        
        await ctx.reply(
          `🗳️ QUIZ TOPIC VOTING STARTED!\n\n` +
          `📚 Topic: "${topic}"\n` +
          `👤 Suggested by: ${username}\n` +
          `🗳️ Votes: 1/${Math.max(3, Math.ceil(5))} required\n` +
          `⏰ Voting ends in ${config.quiz.votingTimeout / 1000} seconds\n\n` +
          `Use /quiz_vote to support this topic!`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🗳️ Vote for this topic', callback_data: `vote_${ctx.chat.id}` },
                  { text: '❌ Cancel voting', callback_data: `cancel_${ctx.chat.id}` }
                ]
              ]
            }
          }
        );
      } catch (error) {
        logger.error('Error starting topic voting:', error);
        ctx.reply('❌ Error starting topic voting. Please try again.');
      }
    });

    // Vote for current topic
    this.bot.command('quiz_vote', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const voting = quizService.getVotingStatus(chatId);
      
      if (!voting) {
        return ctx.reply('📝 No active topic voting. Use /quiz_suggest <topic> to start one.');
      }

      const success = quizService.voteForTopic(chatId, ctx.from!.id.toString());
      if (!success) {
        return ctx.reply('❌ No active voting found.');
      }

      const requiredVotes = Math.max(3, Math.ceil(5)); // Adjust based on group size
      
      await ctx.reply(
        `✅ Vote recorded!\n\n` +
        `📚 Topic: "${voting.topic}"\n` +
        `🗳️ Votes: ${voting.votes.size}/${requiredVotes}\n\n` +
        `${voting.votes.size >= requiredVotes ? '🎯 Starting quiz...' : 'Need more votes to start!'}`
      );

      // Auto-start quiz if enough votes
      if (voting.votes.size >= requiredVotes) {
        setTimeout(() => {
          this.startGroupQuiz(ctx, voting.topic);
        }, 2000);
      }
    });

    // Start personal quiz
    this.bot.command('quiz_start', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        return ctx.reply(
          '📚 Please specify a topic: /quiz_start <topic> [difficulty]\n\n' +
          'Examples:\n' +
          '• /quiz_start "World History" medium\n' +
          '• /quiz_start "JavaScript Programming"\n' +
          '• /quiz_start "Science" hard\n\n' +
          'Difficulties: easy, medium, hard (default: medium)'
        );
      }

      let topic: string;
      let difficulty: 'easy' | 'medium' | 'hard' = 'medium';

      // Parse topic and difficulty
      if (args[args.length - 1] === 'easy' || args[args.length - 1] === 'medium' || args[args.length - 1] === 'hard') {
        difficulty = args.pop() as 'easy' | 'medium' | 'hard';
        topic = args.join(' ');
      } else {
        topic = args.join(' ');
      }

      // Remove quotes if present
      topic = topic.replace(/^["']|["']$/g, '');

      if (!topic.trim()) {
        return ctx.reply('❌ Please provide a valid topic.');
      }

      const userId = ctx.from!.id.toString();
      const username = ctx.from!.username || ctx.from!.first_name || 'Anonymous';

      try {
        await ctx.reply('🔄 Generating quiz questions... This may take a moment.');
        
        const session = await quizService.startQuizSession(userId, username, topic, difficulty, 5);
        
        await ctx.reply(
          `🎯 QUIZ STARTED!\n\n` +
          `📚 Topic: ${topic}\n` +
          `🎚️ Difficulty: ${difficulty}\n` +
          `📝 Questions: ${session.questions.length}\n` +
          `⏱️ Time limit: ${config.quiz.sessionTimeout / 1000} seconds\n\n` +
          `Ready? Let's begin! 🚀`
        );

        // Send first question
        await this.sendCurrentQuestion(ctx, userId);

      } catch (error) {
        logger.error(`Error starting quiz for ${userId}:`, error);
        ctx.reply(`❌ Error starting quiz: ${error.message}`);
      }
    });

    // Get current question
    this.bot.command('quiz_question', async (ctx) => {
      const userId = ctx.from!.id.toString();
      await this.sendCurrentQuestion(ctx, userId);
    });

    // Submit answer
    this.bot.command('quiz_answer', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        return ctx.reply('❓ Please provide your answer: /quiz_answer <your answer>');
      }

      const answer = args.join(' ');
      const userId = ctx.from!.id.toString();

      try {
        const result = quizService.submitAnswer(userId, answer);
        
        const emoji = result.isCorrect ? '✅' : '❌';
        const scoreText = result.isCorrect ? `+${result.score} points` : '0 points';
        
        let message = `${emoji} ${result.isCorrect ? 'Correct!' : 'Incorrect!'}\n\n`;
        message += `💡 ${result.explanation}\n`;
        message += `📊 Score: ${scoreText}\n\n`;

        if (result.sessionComplete) {
          // Quiz finished
          const finalResults = result.finalResults;
          message += `🏁 QUIZ COMPLETED!\n\n`;
          message += `📊 Final Results:\n`;
          message += `• Questions: ${finalResults.correctAnswers}/${finalResults.totalQuestions}\n`;
          message += `• Accuracy: ${finalResults.accuracy}%\n`;
          message += `• Total Score: ${finalResults.totalScore} points\n`;
          message += `• Duration: ${finalResults.duration} seconds\n`;
          message += `• Avg. time/question: ${finalResults.averageTimePerQuestion}s\n\n`;
          message += `Great job! Use /quiz_stats to see your overall progress! 🎉`;
        } else if (result.nextQuestion) {
          // Continue to next question
          message += `📝 Next Question:\n\n`;
          message += this.formatQuestion(result.nextQuestion);
        }

        await ctx.reply(message, this.getQuestionKeyboard(result.nextQuestion));

      } catch (error) {
        logger.error(`Error submitting answer for ${userId}:`, error);
        ctx.reply(`❌ Error: ${error.message}`);
      }
    });

    // End quiz session
    this.bot.command('quiz_end', async (ctx) => {
      const userId = ctx.from!.id.toString();
      const session = quizService.endSession(userId);
      
      if (!session) {
        return ctx.reply('❌ No active quiz session found.');
      }

      await ctx.reply(
        `🏁 Quiz session ended.\n\n` +
        `📚 Topic: ${session.topic}\n` +
        `📝 Questions answered: ${session.currentQuestionIndex}/${session.questions.length}\n` +
        `📊 Score: ${session.score} points\n\n` +
        `Thanks for playing! Start a new quiz anytime. 🎮`
      );
    });

    // Show user statistics
    this.bot.command('quiz_stats', async (ctx) => {
      const userId = ctx.from!.id.toString();
      const stats = quizService.getUserStats(userId);
      
      if (!stats) {
        return ctx.reply(
          '📊 No quiz statistics found.\n\n' +
          'Start your first quiz with /quiz_start <topic> to begin tracking your progress!'
        );
      }

      const message = `📊 YOUR QUIZ STATISTICS\n\n` +
        `👤 Player: ${stats.username}\n` +
        `🎯 Total Score: ${stats.totalScore} points\n` +
        `🎮 Sessions Played: ${stats.sessionsPlayed}\n` +
        `📈 Average Score: ${Math.round(stats.averageScore)} points\n` +
        `🔥 Current Streak: ${stats.currentStreak}\n` +
        `🏆 Best Streak: ${stats.bestStreak}\n` +
        `📅 Last Played: ${stats.lastPlayed.toLocaleDateString()}\n\n` +
        `📚 Favorite Topics:\n${stats.favoriteTopics.slice(0, 5).map(t => `• ${t}`).join('\n') || 'None yet'}\n\n` +
        `Keep quizzing to improve your stats! 🚀`;

      await ctx.reply(message);
    });

    // Show leaderboard
    this.bot.command('quiz_leaderboard', async (ctx) => {
      const leaderboard = quizService.getLeaderboard(10);
      
      if (leaderboard.length === 0) {
        return ctx.reply('🏆 No players on the leaderboard yet. Be the first!');
      }

      let message = '🏆 QUIZ LEADERBOARD\n\n';
      
      leaderboard.forEach((player, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
        
        message += `${medal} ${player.username}\n`;
        message += `   📊 ${player.totalScore} pts | 🎮 ${player.sessionsPlayed} games | 📈 ${Math.round(player.averageScore)} avg\n\n`;
      });

      message += 'Compete to reach the top! 🚀';
      
      await ctx.reply(message);
    });

    // Help command
    this.bot.command('quiz_help', (ctx) => {
      const instanceEmoji = this.instanceMode === 'primary' ? '🎯' : '🎲';
      ctx.reply(
        `${instanceEmoji} QUIZ BOT HELP (${this.instanceMode.toUpperCase()} instance)\n\n` +
        `🎯 PERSONAL QUIZZES:\n` +
        `• /quiz_start <topic> [difficulty] - Start a quiz\n` +
        `• /quiz_question - Get current question\n` +
        `• /quiz_answer <answer> - Submit answer\n` +
        `• /quiz_end - End current session\n\n` +
        `🗳️ GROUP QUIZZES:\n` +
        `• /quiz_suggest <topic> - Suggest topic for voting\n` +
        `• /quiz_vote - Vote for current topic\n\n` +
        `📊 STATISTICS:\n` +
        `• /quiz_stats - Your personal stats\n` +
        `• /quiz_leaderboard - Top players\n\n` +
        `🎚️ DIFFICULTIES:\n` +
        `• easy - Basic level questions\n` +
        `• medium - Intermediate level (default)\n` +
        `• hard - Advanced level questions\n\n` +
        `💡 TIPS:\n` +
        `• Use quotes for multi-word topics\n` +
        `• Answer quickly for bonus points\n` +
        `• Try different topics to expand knowledge\n` +
        `• Check your stats regularly to track progress\n\n` +
        `🤖 Powered by Anthropic Claude AI`
      );
    });
  }

  private setupCallbacks(): void {
    // Handle voting callbacks
    this.bot.on('callback_query', async (ctx) => {
      try {
        if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
          return ctx.answerCbQuery('Invalid callback');
        }

        const data = ctx.callbackQuery.data;

        if (data.startsWith('vote_')) {
          const chatId = data.split('_')[1];
          const success = quizService.voteForTopic(chatId, ctx.from.id.toString());
          
          if (success) {
            const voting = quizService.getVotingStatus(chatId);
            if (voting) {
              await ctx.answerCbQuery(`Vote recorded! (${voting.votes.size} votes)`);
              
              // Update message
              await ctx.editMessageText(
                `🗳️ QUIZ TOPIC VOTING\n\n` +
                `📚 Topic: "${voting.topic}"\n` +
                `🗳️ Votes: ${voting.votes.size}/3\n\n` +
                `${voting.votes.size >= 3 ? '🎯 Starting quiz...' : 'Need more votes to start!'}`
              );

              // Auto-start if enough votes
              if (voting.votes.size >= 3) {
                setTimeout(() => {
                  this.startGroupQuiz(ctx, voting.topic);
                }, 2000);
              }
            }
          } else {
            await ctx.answerCbQuery('No active voting found');
          }
        } else if (data.startsWith('cancel_')) {
          const chatId = data.split('_')[1];
          quizService.clearTopicVoting(chatId);
          await ctx.answerCbQuery('Voting cancelled');
          await ctx.editMessageText('❌ Topic voting cancelled.');
        } else if (data.startsWith('answer_')) {
          // Handle multiple choice answers
          const parts = data.split('_');
          const answer = parts[1];
          const userId = ctx.from.id.toString();

          try {
            const result = quizService.submitAnswer(userId, answer);
            await this.handleAnswerResult(ctx, result);
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
      return ctx.reply('❌ No active quiz session. Start one with /quiz_start <topic>');
    }

    const question = quizService.getCurrentQuestion(userId);
    if (!question) {
      return ctx.reply('❌ No current question available.');
    }

    const questionNumber = session.currentQuestionIndex + 1;
    const totalQuestions = session.questions.length;
    
    let message = `❓ QUESTION ${questionNumber}/${totalQuestions}\n\n`;
    message += `📚 Topic: ${session.topic}\n`;
    message += `🎚️ Difficulty: ${question.difficulty}\n`;
    message += `⏱️ Estimated time: ${question.estimatedTime}s\n\n`;
    message += this.formatQuestion(question);

    await ctx.reply(message, this.getQuestionKeyboard(question));
  }

  private formatQuestion(question: any): string {
    let formatted = `${question.question}\n\n`;
    
    if (question.type === 'multiple_choice' && question.options) {
      question.options.forEach((option: string) => {
        formatted += `${option}\n`;
      });
    } else if (question.type === 'true_false') {
      formatted += `A) True\nB) False\n`;
    }
    
    return formatted;
  }

  private getQuestionKeyboard(question: any): any {
    if (!question) return undefined;

    if (question.type === 'multiple_choice' && question.options) {
      const buttons = question.options.map((option: string) => {
        const letter = option.substring(0, 1);
        return { text: option, callback_data: `answer_${letter}` };
      });

      return {
        inline_keyboard: [
          buttons.slice(0, 2),
          buttons.slice(2, 4),
        ]
      };
    } else if (question.type === 'true_false') {
      return {
        inline_keyboard: [
          [
            { text: 'A) True', callback_data: 'answer_A' },
            { text: 'B) False', callback_data: 'answer_B' }
          ]
        ]
      };
    }

    return undefined;
  }

  private async handleAnswerResult(ctx: Context, result: any): Promise<void> {
    const emoji = result.isCorrect ? '✅' : '❌';
    const scoreText = result.isCorrect ? `+${result.score} points` : '0 points';
    
    let message = `${emoji} ${result.isCorrect ? 'Correct!' : 'Incorrect!'}\n\n`;
    message += `💡 ${result.explanation}\n`;
    message += `📊 Score: ${scoreText}\n\n`;

    if (result.sessionComplete) {
      const finalResults = result.finalResults;
      message += `🏁 QUIZ COMPLETED!\n\n`;
      message += `📊 Final Results:\n`;
      message += `• Questions: ${finalResults.correctAnswers}/${finalResults.totalQuestions}\n`;
      message += `• Accuracy: ${finalResults.accuracy}%\n`;
      message += `• Total Score: ${finalResults.totalScore} points\n`;
      message += `• Duration: ${finalResults.duration} seconds\n\n`;
      message += `Great job! 🎉`;
    } else if (result.nextQuestion) {
      message += `📝 Next Question:\n\n`;
      message += this.formatQuestion(result.nextQuestion);
    }

    await ctx.editMessageText(message, {
      reply_markup: result.nextQuestion ? this.getQuestionKeyboard(result.nextQuestion) : undefined
    });
  }

  private async startGroupQuiz(ctx: Context, topic: string): Promise<void> {
    const chatId = ctx.chat!.id.toString();
    quizService.endTopicVoting(chatId);

    // Announce group quiz start
    await ctx.reply(
      `🎯 GROUP QUIZ STARTING!\n\n` +
      `📚 Topic: ${topic}\n` +
      `🎮 This is a group quiz - everyone can participate!\n` +
      `💬 Answer questions by replying to this chat\n\n` +
      `First question coming up... 🚀`
    );

    // Implementation for group quiz would go here
    // For now, direct users to personal quizzes
    setTimeout(async () => {
      await ctx.reply(
        `📝 For now, start your personal quiz with:\n` +
        `/quiz_start "${topic}"\n\n` +
        `Group quizzes will be available in the next update! 🔄`
      );
    }, 3000);
  }

  public async start(): Promise<void> {
    try {
      logger.info(`🔧 Testing ${this.instanceMode} bot connection...`);
      
      const me = await this.bot.telegram.getMe();
      logger.info(`✅ ${this.instanceMode} bot connection successful:`, me.username);
      
      await this.bot.launch();
      
      logger.info(`🎯 Quiz bot (${this.instanceMode}) is running!`);
      console.log(`✅ ${this.instanceMode} bot started successfully!`);
      console.log(`🤖 Bot username: @${me.username}`);
      console.log(`🧠 AI-powered quiz functionality enabled`);
      
    } catch (error: any) {
      logger.error(`Failed to start ${this.instanceMode} bot:`, error.message);
      console.error(`❌ ${this.instanceMode} bot startup failed - check token and network`);
      throw error;
    }
  }

  public stop(): void {
    this.bot.stop();
    logger.info(`🛑 Quiz bot (${this.instanceMode}) stopped`);
  }

  public getBot(): Telegraf<QuizBotContext> {
    return this.bot;
  }
}