import { Context } from 'telegraf';
import { QuizGameService, QuizGame, CategoryVoteResult } from '../../game/quiz-game.service';
import { StructuredLogger } from '../../utils/structured-logger';

export class QuizGameCommand {
  constructor(
    private quizService: QuizGameService,
    private logger: StructuredLogger
  ) {}

  /**
   * Handle /quiz command to start a new quiz game
   */
  async handleStartQuiz(ctx: Context) {
    try {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;

      // Parse command arguments
      const args = ctx.message?.text?.split(' ').slice(1) || [];
      const minPlayers = parseInt(args[0] || '2');
      const maxPlayers = parseInt(args[1] || '10');

      // Validate inputs
      if (minPlayers < 2 || minPlayers > 20) {
        await ctx.reply('❌ Minimum players must be between 2 and 20');
        return;
      }

      if (maxPlayers < minPlayers || maxPlayers > 50) {
        await ctx.reply('❌ Maximum players must be between minimum players and 50');
        return;
      }

      // Create quiz game
      const game = await this.quizService.createQuizGame(chatId, minPlayers, maxPlayers);

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🎯 Join Quiz', callback_data: `join_quiz:${game.id}` },
            { text: '📊 Game Info', callback_data: `quiz_info:${game.id}` }
          ],
          [
            { text: '🏆 View Leaderboard', callback_data: 'leaderboard' }
          ]
        ]
      };

      await ctx.reply(
        `🧠 <b>Quiz Game Created!</b>\n\n` +
        `🎯 <b>How to Play:</b>\n` +
        `• Players vote on quiz category\n` +
        `• Answer questions quickly and correctly\n` +
        `• Elimination rounds remove slowest/worst players\n` +
        `• Winner faces bonus round for MWOR tokens!\n\n` +
        `👥 Players: <b>${minPlayers}-${maxPlayers}</b>\n` +
        `⏰ Waiting for players to join...\n\n` +
        `🔗 Game ID: <code>${game.id}</code>\n\n` +
        `Click "Join Quiz" to participate!`,
        { 
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );
    } catch (error) {
      console.error('Error creating quiz game:', error);
      await ctx.reply('❌ Failed to create quiz game. Please try again.');
    }
  }

  /**
   * Handle join quiz callback
   */
  async handleJoinQuiz(ctx: Context, gameId: string) {
    try {
      const userId = ctx.from?.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name || 'Unknown';
      
      if (!userId) return;

      await this.quizService.addPlayer(gameId, userId, username);

      await ctx.answerCbQuery('✅ Joined quiz game!');
      
      const game = await this.quizService.getGame(gameId);
      if (!game) return;

      // Update game status message
      const statusMessage = this.formatGameStatus(game);
      
      try {
        await ctx.editMessageText(
          statusMessage,
          { 
            parse_mode: 'HTML',
            reply_markup: ctx.callbackQuery?.message?.reply_markup
          }
        );
      } catch (editError) {
        // If edit fails, send new message
        await ctx.reply(statusMessage, { parse_mode: 'HTML' });
      }

      // Check if ready to start voting
      if (game.players.length >= game.settings.minPlayers && game.status === 'waiting') {
        setTimeout(async () => {
          try {
            await this.quizService.startCategoryVoting(gameId);
            await this.presentCategoryVoting(ctx, gameId);
          } catch (error) {
            console.error('Error starting category voting:', error);
          }
        }, 5000); // 5 second delay to let more players join
      }
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to join quiz';
      await ctx.answerCbQuery(`❌ ${errorMsg}`, { show_alert: true });
    }
  }

  /**
   * Present category voting interface
   */
  async presentCategoryVoting(ctx: Context, gameId: string) {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game || game.status !== 'voting') return;

      const keyboard = {
        inline_keyboard: this.createCategoryButtons(gameId, game.settings.categories)
      };

      const votingMessage = 
        `🗳️ <b>Category Voting</b>\n\n` +
        `Choose the quiz category by voting!\n` +
        `Majority wins, ties broken randomly.\n\n` +
        `⏰ Voting ends in ${game.settings.votingTimeLimit} seconds\n` +
        `👥 Votes needed: ${game.players.length}\n\n` +
        `<b>Available Categories:</b>`;

      await ctx.reply(votingMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Error presenting category voting:', error);
    }
  }

  /**
   * Handle category vote
   */
  async handleCategoryVote(ctx: Context, gameId: string, category: string) {
    try {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      await this.quizService.voteForCategory(gameId, userId, category);
      
      await ctx.answerCbQuery(`✅ Voted for ${category}!`);

      // Update vote display
      const voteResults = await this.quizService.getCategoryVoteResults(gameId);
      const game = await this.quizService.getGame(gameId);
      
      if (game && game.status === 'voting') {
        const updatedMessage = this.formatVotingStatus(game, voteResults);
        
        try {
          await ctx.editMessageText(updatedMessage, {
            parse_mode: 'HTML',
            reply_markup: ctx.callbackQuery?.message?.reply_markup
          });
        } catch (editError) {
          // Ignore edit errors
        }
      }
    } catch (error: any) {
      await ctx.answerCbQuery(`❌ ${error.message}`, { show_alert: true });
    }
  }

  /**
   * Present quiz question
   */
  async presentQuestion(ctx: Context, gameId: string) {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game || !game.currentQuestion) return;

      const question = game.currentQuestion;
      const keyboard = {
        inline_keyboard: question.options.map((option, index) => [
          { 
            text: `${String.fromCharCode(65 + index)}. ${option}`, 
            callback_data: `quiz_answer:${gameId}:${index}` 
          }
        ])
      };

      const questionMessage = 
        `❓ <b>Question ${game.currentRound}</b>\n\n` +
        `📚 Category: <b>${question.category}</b>\n` +
        `⚡ Difficulty: <b>${question.difficulty.toUpperCase()}</b>\n\n` +
        `<b>${question.question}</b>\n\n` +
        `⏰ Time limit: <b>${question.timeLimit} seconds</b>\n` +
        `🎯 Points: Base 10 + speed bonus\n\n` +
        `Choose your answer:`;

      await ctx.reply(questionMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      // Auto-present results after time limit
      setTimeout(async () => {
        try {
          await this.presentQuestionResults(ctx, gameId, question.id);
        } catch (error) {
          console.error('Error presenting question results:', error);
        }
      }, question.timeLimit * 1000);
    } catch (error) {
      console.error('Error presenting question:', error);
    }
  }

  /**
   * Handle quiz answer
   */
  async handleQuizAnswer(ctx: Context, gameId: string, answerIndex: string) {
    try {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      const answer = parseInt(answerIndex);
      await this.quizService.submitAnswer(gameId, userId, answer);
      
      await ctx.answerCbQuery('✅ Answer submitted!');
    } catch (error: any) {
      if (error.message.includes('Already answered')) {
        await ctx.answerCbQuery('You already answered this question!', { show_alert: true });
      } else {
        await ctx.answerCbQuery(`❌ ${error.message}`, { show_alert: true });
      }
    }
  }

  /**
   * Present question results
   */
  async presentQuestionResults(ctx: Context, gameId: string, questionId: number) {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game) return;

      const question = game.currentQuestion;
      if (!question || question.id !== questionId) return;

      const activePlayers = game.players.filter(p => p.isActive);
      const answeredPlayers = activePlayers.filter(p => p.answers.has(questionId));
      const correctAnswers = answeredPlayers.filter(p => 
        p.answers.get(questionId)?.isCorrect
      );

      const correctOption = question.options[question.correctAnswer];
      
      let resultsMessage = 
        `📊 <b>Question ${game.currentRound} Results</b>\n\n` +
        `❓ ${question.question}\n\n` +
        `✅ Correct Answer: <b>${String.fromCharCode(65 + question.correctAnswer)}. ${correctOption}</b>\n\n`;

      if (question.explanation) {
        resultsMessage += `💡 ${question.explanation}\n\n`;
      }

      resultsMessage += 
        `📈 <b>Statistics:</b>\n` +
        `👥 Answered: ${answeredPlayers.length}/${activePlayers.length}\n` +
        `✅ Correct: ${correctAnswers.length}\n` +
        `📊 Accuracy: ${activePlayers.length > 0 ? Math.round(correctAnswers.length / activePlayers.length * 100) : 0}%\n\n`;

      // Show leaderboard
      const leaderboard = await this.quizService.getLeaderboard(gameId);
      resultsMessage += `🏆 <b>Current Standings:</b>\n`;
      
      leaderboard.slice(0, 5).forEach((player, index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
        const status = player.isActive ? '' : ' ❌';
        resultsMessage += `${emoji} ${player.username}: ${player.score} pts${status}\n`;
      });

      // Check for elimination
      const eliminationRound = game.eliminationHistory.find(e => e.round === game.currentRound);
      if (eliminationRound && eliminationRound.eliminatedPlayers.length > 0) {
        resultsMessage += `\n⚰️ <b>Eliminated:</b> ${eliminationRound.eliminatedPlayers.length} player(s)\n`;
      }

      await ctx.reply(resultsMessage, { parse_mode: 'HTML' });

      // Continue to next question or end game
      const remainingActivePlayers = game.players.filter(p => p.isActive);
      if (remainingActivePlayers.length <= 1) {
        setTimeout(() => this.presentGameEnd(ctx, gameId), 3000);
      } else if (game.currentRound < game.maxRounds) {
        setTimeout(() => this.presentQuestion(ctx, gameId), 5000);
      } else {
        setTimeout(() => this.presentGameEnd(ctx, gameId), 3000);
      }
    } catch (error) {
      console.error('Error presenting question results:', error);
    }
  }

  /**
   * Present game end and bonus round
   */
  async presentGameEnd(ctx: Context, gameId: string) {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game) return;

      const finalLeaderboard = await this.quizService.getLeaderboard(gameId);
      const winner = finalLeaderboard[0];

      let endMessage = 
        `🏁 <b>Quiz Game Complete!</b>\n\n` +
        `🏆 <b>Final Results:</b>\n`;

      finalLeaderboard.slice(0, 5).forEach((player, index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        endMessage += `${emoji} ${player.username}: ${player.score} pts\n`;
      });

      if (game.winner && game.status === 'bonus_round') {
        endMessage += 
          `\n🎉 <b>Congratulations ${winner.username}!</b>\n` +
          `You've qualified for the bonus round!\n\n` +
          `💎 <b>Bonus Challenge:</b>\n` +
          `• 3 difficult questions\n` +
          `• Shorter time limits\n` +
          `• MWOR token reward based on performance\n\n` +
          `🎯 Potential reward: 1-100,000 MWOR tokens!`;

        const bonusKeyboard = {
          inline_keyboard: [
            [{ text: '🚀 Start Bonus Round', callback_data: `start_bonus:${gameId}` }]
          ]
        };

        await ctx.reply(endMessage, {
          parse_mode: 'HTML',
          reply_markup: bonusKeyboard
        });
      } else {
        endMessage += `\n🎮 Thanks for playing!`;
        await ctx.reply(endMessage, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error('Error presenting game end:', error);
    }
  }

  /**
   * Handle bonus round start
   */
  async handleStartBonus(ctx: Context, gameId: string) {
    try {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      const game = await this.quizService.getGame(gameId);
      if (!game || game.winner !== userId) {
        await ctx.answerCbQuery('Only the winner can start the bonus round!', { show_alert: true });
        return;
      }

      await ctx.answerCbQuery('🚀 Starting bonus round!');
      
      setTimeout(() => this.presentBonusQuestion(ctx, gameId, 0), 2000);
    } catch (error) {
      console.error('Error starting bonus round:', error);
    }
  }

  /**
   * Present bonus question
   */
  async presentBonusQuestion(ctx: Context, gameId: string, questionIndex: number) {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game || !game.bonusRound) return;

      const question = game.bonusRound.questions[questionIndex];
      const keyboard = {
        inline_keyboard: question.options.map((option, index) => [
          { 
            text: `${String.fromCharCode(65 + index)}. ${option}`, 
            callback_data: `bonus_answer:${gameId}:${index}` 
          }
        ])
      };

      const bonusMessage = 
        `💎 <b>Bonus Question ${questionIndex + 1}/3</b>\n\n` +
        `📚 Category: <b>${question.category}</b>\n` +
        `⚡ Difficulty: <b>HARD</b>\n\n` +
        `<b>${question.question}</b>\n\n` +
        `⏰ Time limit: <b>${question.timeLimit} seconds</b>\n` +
        `💰 Potential reward: <b>${game.bonusRound.mworReward} MWOR</b>\n\n` +
        `Choose your answer:`;

      await ctx.reply(bonusMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Error presenting bonus question:', error);
    }
  }

  /**
   * Handle bonus answer
   */
  async handleBonusAnswer(ctx: Context, gameId: string, answerIndex: string) {
    try {
      const userId = ctx.from?.id.toString();
      if (!userId) return;

      const answer = parseInt(answerIndex);
      await this.quizService.submitBonusAnswer(gameId, userId, answer);
      
      await ctx.answerCbQuery('✅ Bonus answer submitted!');
    } catch (error: any) {
      await ctx.answerCbQuery(`❌ ${error.message}`, { show_alert: true });
    }
  }

  /**
   * Handle quiz info request
   */
  async handleQuizInfo(ctx: Context, gameId: string) {
    try {
      const game = await this.quizService.getGame(gameId);
      if (!game) {
        await ctx.answerCbQuery('Game not found!', { show_alert: true });
        return;
      }

      const stats = await this.quizService.getGameStats(gameId);
      
      const infoMessage = 
        `ℹ️ <b>Quiz Game Info</b>\n\n` +
        `🆔 Game ID: <code>${game.id}</code>\n` +
        `📊 Status: <b>${game.status.toUpperCase()}</b>\n` +
        `👥 Players: <b>${stats.activePlayers}/${stats.totalPlayers}</b>\n` +
        `🏆 Eliminated: <b>${stats.eliminatedPlayers}</b>\n` +
        `🔢 Round: <b>${stats.currentRound}/${game.maxRounds}</b>\n\n`;

      if (game.selectedCategory) {
        infoMessage += `📚 Category: <b>${game.selectedCategory}</b>\n`;
      }

      if (stats.avgResponseTime > 0) {
        infoMessage += 
          `⏱️ Avg Response: <b>${(stats.avgResponseTime / 1000).toFixed(1)}s</b>\n` +
          `✅ Accuracy: <b>${(stats.correctAnswerRate * 100).toFixed(1)}%</b>\n`;
      }

      await ctx.answerCbQuery();
      await ctx.reply(infoMessage, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Error showing quiz info:', error);
      await ctx.answerCbQuery('Failed to load game info');
    }
  }

  /**
   * Format game status message
   */
  private formatGameStatus(game: QuizGame): string {
    const activePlayers = game.players.filter(p => p.isActive);
    
    let message = 
      `🧠 <b>Quiz Game Status</b>\n\n` +
      `📊 Status: <b>${game.status.toUpperCase()}</b>\n` +
      `👥 Players: <b>${game.players.length}/${game.settings.maxPlayers}</b>\n` +
      `🎯 Min Players: <b>${game.settings.minPlayers}</b>\n\n`;

    if (game.players.length > 0) {
      message += `<b>Joined Players:</b>\n`;
      game.players.forEach((player, index) => {
        const status = player.isActive ? '✅' : '❌';
        message += `${index + 1}. ${player.username} ${status}\n`;
      });
    }

    if (game.status === 'waiting' && game.players.length < game.settings.minPlayers) {
      message += `\n⏳ Waiting for ${game.settings.minPlayers - game.players.length} more players...`;
    }

    return message;
  }

  /**
   * Format voting status
   */
  private formatVotingStatus(game: QuizGame, voteResults: CategoryVoteResult[]): string {
    let message = 
      `🗳️ <b>Category Voting</b>\n\n` +
      `⏰ Time remaining: ${game.settings.votingTimeLimit}s\n` +
      `👥 Players: ${game.players.length}\n\n` +
      `<b>Current Results:</b>\n`;

    voteResults.forEach((result, index) => {
      const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📊';
      message += `${emoji} ${result.category}: ${result.votes} votes\n`;
    });

    const totalVotes = voteResults.reduce((sum, r) => sum + r.votes, 0);
    if (totalVotes < game.players.length) {
      message += `\n📋 ${game.players.length - totalVotes} players still need to vote`;
    }

    return message;
  }

  /**
   * Create category voting buttons
   */
  private createCategoryButtons(gameId: string, categories: string[]): Array<Array<{text: string, callback_data: string}>> {
    const buttons = [];
    const buttonsPerRow = 2;

    for (let i = 0; i < categories.length; i += buttonsPerRow) {
      const row = [];
      for (let j = i; j < i + buttonsPerRow && j < categories.length; j++) {
        row.push({
          text: categories[j],
          callback_data: `vote_category:${gameId}:${categories[j]}`
        });
      }
      buttons.push(row);
    }

    return buttons;
  }
}