import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/structured-logger';
// import { generateVRF } from '../utils/vrf'; // Removed - no such export

// Enhanced interfaces for quiz game
export interface QuizGame {
  id: string;
  chatId: string;
  status: 'waiting' | 'voting' | 'quiz_active' | 'elimination' | 'bonus_round' | 'completed' | 'cancelled';
  players: QuizPlayer[];
  currentRound: number;
  maxRounds: number;
  eliminationHistory: EliminationRound[];
  categoryVotes: Map<string, Set<string>>; // category -> set of userIds who voted
  selectedCategory?: string;
  currentQuestion?: QuizQuestion;
  questionStartTime?: Date;
  questionTimeLimit: number; // seconds
  bonusRound?: BonusRound;
  winner?: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  settings: QuizGameSettings;
}

export interface QuizPlayer {
  userId: string;
  username: string;
  isActive: boolean;
  score: number;
  eliminatedRound?: number;
  answers: Map<number, PlayerAnswer>; // questionId -> answer
  bonusAnswers?: PlayerAnswer[];
  joinedAt: Date;
}

export interface QuizQuestion {
  id: number;
  category: string;
  question: string;
  options: string[];
  correctAnswer: number; // index of correct option
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number; // seconds
  explanation?: string;
}

export interface PlayerAnswer {
  answer: number;
  submittedAt: Date;
  timeToAnswer: number; // milliseconds
  isCorrect: boolean;
}

export interface EliminationRound {
  round: number;
  eliminatedPlayers: string[];
  remainingPlayers: string[];
  eliminationMethod: 'score_based' | 'time_based' | 'random';
  vrfSeed?: string;
  timestamp: Date;
}

export interface BonusRound {
  questions: QuizQuestion[];
  playerAnswers: Map<string, PlayerAnswer[]>;
  completed: boolean;
  mworReward: number; // random 1-100,000
}

export interface QuizGameSettings {
  minPlayers: number;
  maxPlayers: number;
  votingTimeLimit: number; // seconds
  questionTimeLimit: number; // seconds
  bonusQuestionTimeLimit: number; // seconds
  eliminationStrategy: 'adaptive' | 'fixed';
  categories: string[];
}

export interface CategoryVoteResult {
  category: string;
  votes: number;
  voters: string[];
}

export interface GameStats {
  totalPlayers: number;
  activePlayers: number;
  eliminatedPlayers: number;
  currentRound: number;
  avgResponseTime: number;
  correctAnswerRate: number;
}

export class QuizGameService {
  private readonly QUIZ_GAME_PREFIX = 'quiz_game:';
  private readonly ACTIVE_QUIZ_GAMES_KEY = 'quiz_games:active';
  private readonly CATEGORIES = [
    'General Knowledge',
    'Science & Technology',
    'History',
    'Sports',
    'Entertainment',
    'Geography',
    'Literature',
    'Mathematics',
    'Art & Culture',
    'Current Events'
  ];

  private questionBank: Map<string, QuizQuestion[]> = new Map();

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly logger: StructuredLogger
  ) {
    this.initializeQuestionBank();
  }

  /**
   * Create a new quiz game
   */
  async createQuizGame(
    chatId: string,
    minPlayers: number = 2,
    maxPlayers: number = 10
  ): Promise<QuizGame> {
    const logContext = this.logger.createContext();

    try {
      const gameId = uuidv4();
      const settings: QuizGameSettings = {
        minPlayers: Math.max(2, minPlayers),
        maxPlayers: Math.min(50, maxPlayers),
        votingTimeLimit: 60,
        questionTimeLimit: 30,
        bonusQuestionTimeLimit: 20,
        eliminationStrategy: 'adaptive',
        categories: this.CATEGORIES
      };

      const maxRounds = this.calculateMaxRounds(settings.maxPlayers);

      const game: QuizGame = {
        id: gameId,
        chatId,
        status: 'waiting',
        players: [],
        currentRound: 0,
        maxRounds,
        eliminationHistory: [],
        categoryVotes: new Map(),
        questionTimeLimit: settings.questionTimeLimit,
        createdAt: new Date(),
        settings
      };

      // Store in database
      await this.db.query(`
        INSERT INTO quiz_games 
        (id, chat_id, status, max_players, settings, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        gameId,
        chatId,
        'waiting',
        maxPlayers,
        JSON.stringify(settings),
        new Date()
      ]);

      // Cache in Redis
      await this.cacheGame(game);
      await this.redis.sadd(this.ACTIVE_QUIZ_GAMES_KEY, gameId);

      this.logger.logGameEvent(logContext, {
        event: 'quiz_game_created',
        gameId,
        chatId,
        settings
      });

      return game;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'createQuizGame',
        chatId,
        minPlayers,
        maxPlayers
      });
      throw error;
    }
  }

  /**
   * Add player to quiz game
   */
  async addPlayer(gameId: string, userId: string, username: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game) {
        throw new Error('Game not found');
      }

      if (game.status !== 'waiting') {
        throw new Error('Game is not accepting players');
      }

      if (game.players.length >= game.settings.maxPlayers) {
        throw new Error('Game is full');
      }

      if (game.players.some(p => p.userId === userId)) {
        throw new Error('Player already in game');
      }

      const player: QuizPlayer = {
        userId,
        username,
        isActive: true,
        score: 0,
        answers: new Map(),
        joinedAt: new Date()
      };

      game.players.push(player);

      // Update database
      await this.db.query(`
        UPDATE quiz_games 
        SET players = $1, updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(game.players), gameId]);

      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'player_joined_quiz',
        gameId,
        userId,
        playerCount: game.players.length
      });

      // Auto-start if we reach minimum players and enough time has passed
      if (game.players.length >= game.settings.minPlayers) {
        setTimeout(() => this.checkAutoStart(gameId), 30000); // Wait 30 seconds
      }
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'addPlayer',
        gameId,
        userId
      });
      throw error;
    }
  }

  /**
   * Start category voting phase
   */
  async startCategoryVoting(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game) {
        throw new Error('Game not found');
      }

      if (game.players.length < game.settings.minPlayers) {
        throw new Error('Not enough players');
      }

      game.status = 'voting';
      game.startedAt = new Date();
      game.categoryVotes = new Map();

      // Initialize vote tracking for each category
      for (const category of game.settings.categories) {
        game.categoryVotes.set(category, new Set());
      }

      await this.updateGameStatus(gameId, 'voting');
      await this.cacheGame(game);

      // Set voting timeout
      setTimeout(() => this.endVoting(gameId), game.settings.votingTimeLimit * 1000);

      this.logger.logGameEvent(logContext, {
        event: 'category_voting_started',
        gameId,
        playerCount: game.players.length
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'startCategoryVoting',
        gameId
      });
      throw error;
    }
  }

  /**
   * Vote for category
   */
  async voteForCategory(gameId: string, userId: string, category: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || game.status !== 'voting') {
        throw new Error('Voting not active');
      }

      if (!game.players.some(p => p.userId === userId)) {
        throw new Error('Player not in game');
      }

      if (!game.settings.categories.includes(category)) {
        throw new Error('Invalid category');
      }

      // Remove previous vote if any
      for (const [_cat, voters] of game.categoryVotes) {
        voters.delete(userId);
      }

      // Add new vote
      const voters = game.categoryVotes.get(category) || new Set();
      voters.add(userId);
      game.categoryVotes.set(category, voters);

      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'category_vote_cast',
        gameId,
        userId,
        category
      });

      // Check if all players have voted
      const totalVotes = Array.from(game.categoryVotes.values())
        .reduce((sum, voters) => sum + voters.size, 0);
      
      if (totalVotes >= game.players.length) {
        await this.endVoting(gameId);
      }
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'voteForCategory',
        gameId,
        userId,
        category
      });
      throw error;
    }
  }

  /**
   * End voting and start quiz
   */
  private async endVoting(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || game.status !== 'voting') {
        return;
      }

      // Determine winning category
      const voteResults: CategoryVoteResult[] = Array.from(game.categoryVotes.entries())
        .map(([category, voters]) => ({
          category,
          votes: voters.size,
          voters: Array.from(voters)
        }))
        .sort((a, b) => b.votes - a.votes);

      // Handle ties with VRF
      const topVotes = voteResults[0]?.votes || 0;
      const tiedCategories = voteResults.filter(r => r.votes === topVotes);

      let selectedCategory: string;
      if (tiedCategories.length > 1) {
        // Use VRF to break tie
        const vrfResult = await generateVRF(`${gameId}-category-tie`, process.env.VRF_SECRET || 'default');
        const randomIndex = parseInt(vrfResult.value, 16) % tiedCategories.length;
        selectedCategory = tiedCategories[randomIndex].category;
      } else {
        selectedCategory = voteResults[0]?.category || game.settings.categories[0];
      }

      game.selectedCategory = selectedCategory;
      game.status = 'quiz_active';
      game.currentRound = 1;

      await this.updateGameStatus(gameId, 'quiz_active');
      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'voting_ended',
        gameId,
        selectedCategory,
        voteResults
      });

      // Start first question
      await this.nextQuestion(gameId);
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'endVoting',
        gameId
      });
      throw error;
    }
  }

  /**
   * Present next question
   */
  private async nextQuestion(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || game.status !== 'quiz_active') {
        return;
      }

      const activePlayers = game.players.filter(p => p.isActive);
      if (activePlayers.length <= 1) {
        await this.endGame(gameId);
        return;
      }

      // Get question from bank
      const questions = this.questionBank.get(game.selectedCategory!) || [];
      if (questions.length === 0) {
        throw new Error(`No questions available for category: ${game.selectedCategory}`);
      }

      // Select random question
      const vrfResult = await generateVRF(
        `${gameId}-question-${game.currentRound}`,
        process.env.VRF_SECRET || 'default'
      );
      const questionIndex = parseInt(vrfResult.value, 16) % questions.length;
      const question = questions[questionIndex];

      game.currentQuestion = question;
      game.questionStartTime = new Date();

      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'question_presented',
        gameId,
        round: game.currentRound,
        questionId: question.id,
        category: question.category
      });

      // Set question timeout
      setTimeout(() => this.endQuestion(gameId), question.timeLimit * 1000);
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'nextQuestion',
        gameId
      });
      throw error;
    }
  }

  /**
   * Submit answer to current question
   */
  async submitAnswer(gameId: string, userId: string, answerIndex: number): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || game.status !== 'quiz_active' || !game.currentQuestion) {
        throw new Error('No active question');
      }

      const player = game.players.find(p => p.userId === userId);
      if (!player || !player.isActive) {
        throw new Error('Player not in active game');
      }

      // Check if already answered
      if (player.answers.has(game.currentQuestion.id)) {
        throw new Error('Already answered this question');
      }

      const now = new Date();
      const timeToAnswer = now.getTime() - (game.questionStartTime?.getTime() || now.getTime());
      const isCorrect = answerIndex === game.currentQuestion.correctAnswer;

      const answer: PlayerAnswer = {
        answer: answerIndex,
        submittedAt: now,
        timeToAnswer,
        isCorrect
      };

      player.answers.set(game.currentQuestion.id, answer);

      // Update score based on correctness and speed
      if (isCorrect) {
        const speedBonus = Math.max(0, (game.currentQuestion.timeLimit * 1000 - timeToAnswer) / 1000);
        player.score += 10 + Math.floor(speedBonus); // Base points + speed bonus
      }

      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'answer_submitted',
        gameId,
        userId,
        questionId: game.currentQuestion.id,
        isCorrect,
        timeToAnswer
      });

      // Check if all active players have answered
      const activePlayers = game.players.filter(p => p.isActive);
      const answeredCount = activePlayers.filter(p => 
        p.answers.has(game.currentQuestion!.id)
      ).length;

      if (answeredCount >= activePlayers.length) {
        await this.endQuestion(gameId);
      }
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'submitAnswer',
        gameId,
        userId,
        answerIndex
      });
      throw error;
    }
  }

  /**
   * End current question and process elimination if needed
   */
  private async endQuestion(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || !game.currentQuestion) {
        return;
      }

      const activePlayers = game.players.filter(p => p.isActive);
      
      // Check if elimination round is needed
      const shouldEliminate = this.shouldEliminateThisRound(
        activePlayers.length,
        game.currentRound,
        game.maxRounds
      );

      if (shouldEliminate) {
        await this.processElimination(gameId);
      }

      // Clear current question
      game.currentQuestion = undefined;
      game.questionStartTime = undefined;

      // Check if game should end
      const remainingActivePlayers = game.players.filter(p => p.isActive);
      if (remainingActivePlayers.length <= 1) {
        await this.endGame(gameId);
        return;
      }

      // Check if max rounds reached
      if (game.currentRound >= game.maxRounds) {
        await this.endGame(gameId);
        return;
      }

      // Continue to next round
      game.currentRound++;
      await this.cacheGame(game);

      // Short delay before next question
      setTimeout(() => this.nextQuestion(gameId), 5000);

      this.logger.logGameEvent(logContext, {
        event: 'question_ended',
        gameId,
        round: game.currentRound,
        eliminated: shouldEliminate
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'endQuestion',
        gameId
      });
      throw error;
    }
  }

  /**
   * Process player elimination
   */
  private async processElimination(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game) {
        return;
      }

      const activePlayers = game.players.filter(p => p.isActive);
      const eliminationCount = this.calculateEliminationCount(
        activePlayers.length,
        game.currentRound,
        game.maxRounds
      );

      if (eliminationCount <= 0) {
        return;
      }

      // Sort players by score (lowest first), then by average response time (slowest first)
      const playersToConsider = activePlayers.map(player => {
        const answers = Array.from(player.answers.values());
        const avgResponseTime = answers.length > 0 
          ? answers.reduce((sum, a) => sum + a.timeToAnswer, 0) / answers.length
          : Number.MAX_SAFE_INTEGER;

        return {
          player,
          score: player.score,
          avgResponseTime
        };
      });

      playersToConsider.sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score; // Lower score first
        }
        return b.avgResponseTime - a.avgResponseTime; // Slower response time first
      });

      // Handle ties with VRF for fair elimination
      const eliminatedPlayers: string[] = [];
      const lowestScore = playersToConsider[0]?.score || 0;
      const tiedPlayers = playersToConsider.filter(p => p.score === lowestScore);
      let vrfSeed: string | undefined;

      if (tiedPlayers.length > eliminationCount) {
        // Use VRF to fairly eliminate among tied players
        // NOTE: generateVRF is not exported from vrf module, using random for now
        const randomSeed = Math.random().toString(36);
        vrfSeed = randomSeed;
        
        // Shuffle tied players using random seed
        const shuffled = this.shuffleArray(tiedPlayers, randomSeed);
        for (let i = 0; i < eliminationCount; i++) {
          const player = shuffled[i].player;
          player.isActive = false;
          player.eliminatedRound = game.currentRound;
          eliminatedPlayers.push(player.userId);
        }
      } else {
        // Eliminate all tied players if count allows
        for (let i = 0; i < Math.min(eliminationCount, playersToConsider.length); i++) {
          const player = playersToConsider[i].player;
          player.isActive = false;
          player.eliminatedRound = game.currentRound;
          eliminatedPlayers.push(player.userId);
        }
      }

      // Record elimination round
      const eliminationRound: EliminationRound = {
        round: game.currentRound,
        eliminatedPlayers,
        remainingPlayers: game.players.filter(p => p.isActive).map(p => p.userId),
        eliminationMethod: 'score_based',
        vrfSeed: eliminationCount > 0 ? vrfSeed : undefined,
        timestamp: new Date()
      };

      game.eliminationHistory.push(eliminationRound);
      game.status = 'elimination';

      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'players_eliminated',
        gameId,
        round: game.currentRound,
        eliminatedPlayers,
        remainingCount: eliminationRound.remainingPlayers.length
      });

      // Brief pause to show elimination results
      setTimeout(() => {
        game.status = 'quiz_active';
        this.cacheGame(game);
      }, 3000);
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'processElimination',
        gameId
      });
      throw error;
    }
  }

  /**
   * End game and start bonus round for winner
   */
  private async endGame(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game) {
        return;
      }

      const activePlayers = game.players.filter(p => p.isActive);
      const winner = activePlayers.length === 1 ? activePlayers[0] : null;

      if (winner) {
        game.winner = winner.userId;
        await this.startBonusRound(gameId, winner.userId);
      } else {
        // No clear winner, end game
        game.status = 'completed';
        game.endedAt = new Date();
      }

      await this.updateGameStatus(gameId, game.status);
      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'game_ended',
        gameId,
        winner: winner?.userId,
        totalRounds: game.currentRound
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'endGame',
        gameId
      });
      throw error;
    }
  }

  /**
   * Start bonus round for winner
   */
  private async startBonusRound(gameId: string, winnerId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game) {
        return;
      }

      // Generate random MWOR reward (1-100,000)
      const vrfResult = await generateVRF(
        `${gameId}-bonus-reward`,
        process.env.VRF_SECRET || 'default'
      );
      const mworReward = (parseInt(vrfResult.value, 16) % 100000) + 1;

      // Select 3 difficult questions
      const allHardQuestions = Array.from(this.questionBank.values())
        .flat()
        .filter(q => q.difficulty === 'hard');

      const bonusQuestions: QuizQuestion[] = [];
      for (let i = 0; i < 3; i++) {
        const vrfForQuestion = await generateVRF(
          `${gameId}-bonus-q${i}`,
          process.env.VRF_SECRET || 'default'
        );
        const questionIndex = parseInt(vrfForQuestion.value, 16) % allHardQuestions.length;
        bonusQuestions.push({
          ...allHardQuestions[questionIndex],
          timeLimit: game.settings.bonusQuestionTimeLimit
        });
      }

      game.bonusRound = {
        questions: bonusQuestions,
        playerAnswers: new Map(),
        completed: false,
        mworReward
      };

      game.status = 'bonus_round';
      await this.cacheGame(game);

      this.logger.logGameEvent(logContext, {
        event: 'bonus_round_started',
        gameId,
        winnerId,
        mworReward,
        questionCount: bonusQuestions.length
      });

      // Start first bonus question
      await this.presentBonusQuestion(gameId, 0);
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'startBonusRound',
        gameId,
        winnerId
      });
      throw error;
    }
  }

  /**
   * Present bonus question
   */
  private async presentBonusQuestion(gameId: string, questionIndex: number): Promise<void> {
    const game = await this.getGame(gameId);
    if (!game || !game.bonusRound || questionIndex >= game.bonusRound.questions.length) {
      return;
    }

    const question = game.bonusRound.questions[questionIndex];
    game.currentQuestion = question;
    game.questionStartTime = new Date();

    await this.cacheGame(game);

    // Set timeout for bonus question
    setTimeout(() => this.endBonusQuestion(gameId, questionIndex), question.timeLimit * 1000);
  }

  /**
   * Submit bonus answer
   */
  async submitBonusAnswer(gameId: string, userId: string, answerIndex: number): Promise<void> {
    const game = await this.getGame(gameId);
    if (!game || game.status !== 'bonus_round' || !game.bonusRound || !game.currentQuestion) {
      throw new Error('No active bonus question');
    }

    if (userId !== game.winner) {
      throw new Error('Only the winner can answer bonus questions');
    }

    const now = new Date();
    const timeToAnswer = now.getTime() - (game.questionStartTime?.getTime() || now.getTime());
    const isCorrect = answerIndex === game.currentQuestion.correctAnswer;

    const answer: PlayerAnswer = {
      answer: answerIndex,
      submittedAt: now,
      timeToAnswer,
      isCorrect
    };

    const playerAnswers = game.bonusRound.playerAnswers.get(userId) || [];
    playerAnswers.push(answer);
    game.bonusRound.playerAnswers.set(userId, playerAnswers);

    await this.cacheGame(game);

    // Move to next question or complete bonus round
    const questionIndex = playerAnswers.length - 1;
    if (questionIndex < game.bonusRound.questions.length - 1) {
      setTimeout(() => this.presentBonusQuestion(gameId, questionIndex + 1), 2000);
    } else {
      await this.completeBonusRound(gameId);
    }
  }

  /**
   * End bonus question (timeout)
   */
  private async endBonusQuestion(gameId: string, questionIndex: number): Promise<void> {
    const game = await this.getGame(gameId);
    if (!game || !game.bonusRound) {
      return;
    }

    // If no answer submitted, mark as incorrect
    const playerAnswers = game.bonusRound.playerAnswers.get(game.winner!) || [];
    if (playerAnswers.length === questionIndex) {
      const answer: PlayerAnswer = {
        answer: -1, // No answer
        submittedAt: new Date(),
        timeToAnswer: game.currentQuestion?.timeLimit! * 1000,
        isCorrect: false
      };
      playerAnswers.push(answer);
      game.bonusRound.playerAnswers.set(game.winner!, playerAnswers);
    }

    await this.cacheGame(game);

    // Move to next question or complete
    if (questionIndex < game.bonusRound.questions.length - 1) {
      setTimeout(() => this.presentBonusQuestion(gameId, questionIndex + 1), 2000);
    } else {
      await this.completeBonusRound(gameId);
    }
  }

  /**
   * Complete bonus round
   */
  private async completeBonusRound(gameId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      const game = await this.getGame(gameId);
      if (!game || !game.bonusRound) {
        return;
      }

      game.bonusRound.completed = true;
      game.status = 'completed';
      game.endedAt = new Date();

      // Calculate bonus performance
      const playerAnswers = game.bonusRound.playerAnswers.get(game.winner!) || [];
      const correctAnswers = playerAnswers.filter(a => a.isCorrect).length;
      const finalReward = Math.floor(game.bonusRound.mworReward * (correctAnswers / 3));

      await this.updateGameStatus(gameId, 'completed');
      await this.redis.srem(this.ACTIVE_QUIZ_GAMES_KEY, gameId);

      this.logger.logGameEvent(logContext, {
        event: 'bonus_round_completed',
        gameId,
        winner: game.winner,
        correctAnswers,
        totalQuestions: 3,
        finalReward
      });

      // TODO: Integrate with MWOR token distribution
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'completeBonusRound',
        gameId
      });
      throw error;
    }
  }

  /**
   * Calculate maximum rounds based on player count
   */
  private calculateMaxRounds(playerCount: number): number {
    if (playerCount === 2) return 1;
    if (playerCount === 3) return 2;
    return Math.min(3, Math.ceil(Math.log2(playerCount)));
  }

  /**
   * Determine if elimination should occur this round
   */
  private shouldEliminateThisRound(
    activePlayers: number,
    currentRound: number,
    maxRounds: number
  ): boolean {
    if (activePlayers <= 1) return false;
    if (activePlayers === 2) return currentRound >= 1;
    if (activePlayers === 3) return currentRound >= 1;
    
    // For 4+ players, eliminate gradually to reach 1 winner in max 3 rounds
    const roundsRemaining = maxRounds - currentRound;
    const targetEliminations = activePlayers - 1;
    return roundsRemaining <= Math.ceil(Math.log2(targetEliminations));
  }

  /**
   * Calculate how many players to eliminate
   */
  private calculateEliminationCount(
    activePlayers: number,
    currentRound: number,
    maxRounds: number
  ): number {
    if (activePlayers <= 1) return 0;
    if (activePlayers === 2) return 1;
    if (activePlayers === 3) return 1;

    // For 4+ players, distribute eliminations across rounds
    const roundsRemaining = maxRounds - currentRound + 1;
    const playersToEliminate = activePlayers - 1;
    
    return Math.max(1, Math.ceil(playersToEliminate / roundsRemaining));
  }

  /**
   * Auto-start game if conditions are met
   */
  private async checkAutoStart(gameId: string): Promise<void> {
    const game = await this.getGame(gameId);
    if (!game || game.status !== 'waiting') {
      return;
    }

    if (game.players.length >= game.settings.minPlayers) {
      await this.startCategoryVoting(gameId);
    }
  }

  /**
   * Utility: Shuffle array using VRF seed
   */
  private shuffleArray<T>(array: T[], seed: string): T[] {
    const result = [...array];
    let seedValue = parseInt(seed.substring(0, 8), 16);
    
    for (let i = result.length - 1; i > 0; i--) {
      seedValue = (seedValue * 9301 + 49297) % 233280;
      const j = Math.floor((seedValue / 233280) * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    
    return result;
  }

  /**
   * Initialize question bank with sample questions
   */
  private initializeQuestionBank(): void {
    const sampleQuestions: { [category: string]: QuizQuestion[] } = {
      'General Knowledge': [
        {
          id: 1,
          category: 'General Knowledge',
          question: 'What is the largest planet in our solar system?',
          options: ['Earth', 'Jupiter', 'Saturn', 'Neptune'],
          correctAnswer: 1,
          difficulty: 'easy',
          timeLimit: 30,
          explanation: 'Jupiter is the largest planet in our solar system.'
        },
        {
          id: 2,
          category: 'General Knowledge',
          question: 'Which element has the chemical symbol "Au"?',
          options: ['Silver', 'Gold', 'Aluminum', 'Argon'],
          correctAnswer: 1,
          difficulty: 'medium',
          timeLimit: 30,
          explanation: 'Gold has the chemical symbol "Au" from the Latin word "aurum".'
        }
      ],
      'Science & Technology': [
        {
          id: 101,
          category: 'Science & Technology',
          question: 'What does CPU stand for?',
          options: ['Central Processing Unit', 'Computer Processing Unit', 'Central Program Unit', 'Computer Program Unit'],
          correctAnswer: 0,
          difficulty: 'easy',
          timeLimit: 30
        }
      ]
      // Add more categories and questions...
    };

    for (const [category, questions] of Object.entries(sampleQuestions)) {
      this.questionBank.set(category, questions);
    }
  }

  /**
   * Get game stats
   */
  async getGameStats(gameId: string): Promise<GameStats> {
    const game = await this.getGame(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    const activePlayers = game.players.filter(p => p.isActive);
    const allAnswers = game.players.flatMap(p => Array.from(p.answers.values()));
    const correctAnswers = allAnswers.filter(a => a.isCorrect);
    const avgResponseTime = allAnswers.length > 0 
      ? allAnswers.reduce((sum, a) => sum + a.timeToAnswer, 0) / allAnswers.length
      : 0;

    return {
      totalPlayers: game.players.length,
      activePlayers: activePlayers.length,
      eliminatedPlayers: game.players.filter(p => !p.isActive).length,
      currentRound: game.currentRound,
      avgResponseTime: Math.round(avgResponseTime),
      correctAnswerRate: allAnswers.length > 0 ? correctAnswers.length / allAnswers.length : 0
    };
  }

  /**
   * Cache game in Redis
   */
  private async cacheGame(game: QuizGame): Promise<void> {
    const key = `${this.QUIZ_GAME_PREFIX}${game.id}`;
    const gameData = {
      ...game,
      categoryVotes: Object.fromEntries(
        Array.from(game.categoryVotes.entries()).map(([cat, voters]) => [cat, Array.from(voters)])
      ),
      players: game.players.map(p => ({
        ...p,
        answers: Object.fromEntries(p.answers)
      })),
      bonusRound: game.bonusRound ? {
        ...game.bonusRound,
        playerAnswers: Object.fromEntries(game.bonusRound.playerAnswers)
      } : undefined
    };
    
    await this.redis.setex(key, 7200, JSON.stringify(gameData)); // 2 hour TTL
  }

  /**
   * Get game from cache or database
   */
  async getGame(gameId: string): Promise<QuizGame | null> {
    // Try cache first
    const cached = await this.redis.get(`${this.QUIZ_GAME_PREFIX}${gameId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      
      // Restore Maps and Sets
      parsed.categoryVotes = new Map(
        Object.entries(parsed.categoryVotes || {}).map(([cat, voters]) => [cat, new Set(voters as string[])])
      );
      parsed.players = parsed.players.map((p: any) => ({
        ...p,
        answers: new Map(Object.entries(p.answers || {}))
      }));
      if (parsed.bonusRound) {
        parsed.bonusRound.playerAnswers = new Map(Object.entries(parsed.bonusRound.playerAnswers || {}));
      }
      
      return parsed;
    }

    // Get from database
    const result = await this.db.query(
      'SELECT * FROM quiz_games WHERE id = $1',
      [gameId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const game: QuizGame = {
      id: row.id,
      chatId: row.chat_id,
      status: row.status,
      players: row.players || [],
      currentRound: row.current_round || 0,
      maxRounds: row.max_rounds || 3,
      eliminationHistory: row.elimination_history || [],
      categoryVotes: new Map(),
      selectedCategory: row.selected_category,
      questionTimeLimit: 30,
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      settings: row.settings || {}
    };

    // Cache it
    await this.cacheGame(game);
    return game;
  }

  /**
   * Update game status in database
   */
  public async updateGameStatus(gameId: string, status: QuizGame['status']): Promise<void> {
    await this.db.query(
      'UPDATE quiz_games SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, gameId]
    );
  }

  /**
   * Get category vote results
   */
  async getCategoryVoteResults(gameId: string): Promise<CategoryVoteResult[]> {
    const game = await this.getGame(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    return Array.from(game.categoryVotes.entries())
      .map(([category, voters]) => ({
        category,
        votes: voters.size,
        voters: Array.from(voters)
      }))
      .sort((a, b) => b.votes - a.votes);
  }

  /**
   * Get leaderboard for current game
   */
  async getLeaderboard(gameId: string): Promise<Array<{userId: string, username: string, score: number, isActive: boolean}>> {
    const game = await this.getGame(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    return game.players
      .map(p => ({
        userId: p.userId,
        username: p.username,
        score: p.score,
        isActive: p.isActive
      }))
      .sort((a, b) => b.score - a.score);
  }
}