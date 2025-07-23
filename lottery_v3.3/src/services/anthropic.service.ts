import Anthropic from '@anthropic-ai/sdk';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface QuestionGenerationRequest {
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
  questionType: 'multiple_choice' | 'true_false' | 'open_ended';
  context?: string;
}

export interface GeneratedQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'true_false' | 'open_ended';
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  estimatedTime: number; // seconds
}

export interface QuizSession {
  id: string;
  userId: string;
  username: string;
  topic: string;
  questions: GeneratedQuestion[];
  currentQuestionIndex: number;
  answers: Map<string, string>;
  score: number;
  startTime: Date;
  endTime?: Date;
  timeRemaining: number;
  isActive: boolean;
}

export interface RateLimitInfo {
  requestsThisMinute: number;
  requestsThisHour: number;
  resetTimeMinute: Date;
  resetTimeHour: Date;
  isLimited: boolean;
}

class AnthropicService {
  private client: Anthropic;
  private rateLimitTracking: Map<string, RateLimitInfo> = new Map();
  private questionCache: Map<string, GeneratedQuestion[]> = new Map();
  private duplicateTracker: Set<string> = new Set();

  constructor() {
    if (!config.features.anthropicIntegration) {
      logger.warn('Anthropic integration is disabled');
      return;
    }

    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required when ENABLE_ANTHROPIC_INTEGRATION is true');
    }

    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });

    logger.info('Anthropic service initialized');
  }

  /**
   * Rate limiting check before API calls
   */
  private checkRateLimit(userId: string): boolean {
    if (!this.rateLimitTracking.has(userId)) {
      this.rateLimitTracking.set(userId, {
        requestsThisMinute: 0,
        requestsThisHour: 0,
        resetTimeMinute: new Date(Date.now() + 60000),
        resetTimeHour: new Date(Date.now() + 3600000),
        isLimited: false,
      });
    }

    const userLimits = this.rateLimitTracking.get(userId)!;
    const now = new Date();

    // Reset counters if time windows have passed
    if (now > userLimits.resetTimeMinute) {
      userLimits.requestsThisMinute = 0;
      userLimits.resetTimeMinute = new Date(now.getTime() + 60000);
    }

    if (now > userLimits.resetTimeHour) {
      userLimits.requestsThisHour = 0;
      userLimits.resetTimeHour = new Date(now.getTime() + 3600000);
    }

    // Check limits
    if (
      userLimits.requestsThisMinute >= config.anthropic.rateLimitPerMinute ||
      userLimits.requestsThisHour >= config.anthropic.rateLimitPerHour
    ) {
      userLimits.isLimited = true;
      return false;
    }

    // Increment counters
    userLimits.requestsThisMinute++;
    userLimits.requestsThisHour++;
    userLimits.isLimited = false;
    
    return true;
  }

  /**
   * Get rate limit info for a user
   */
  getRateLimitInfo(userId: string): RateLimitInfo {
    return this.rateLimitTracking.get(userId) || {
      requestsThisMinute: 0,
      requestsThisHour: 0,
      resetTimeMinute: new Date(Date.now() + 60000),
      resetTimeHour: new Date(Date.now() + 3600000),
      isLimited: false,
    };
  }

  /**
   * Generate quiz questions using Claude API
   */
  async generateQuestions(
    request: QuestionGenerationRequest,
    userId: string
  ): Promise<GeneratedQuestion[]> {
    if (!config.features.anthropicIntegration) {
      throw new Error('Anthropic integration is disabled');
    }

    // Check rate limiting
    if (!this.checkRateLimit(userId)) {
      const limitInfo = this.getRateLimitInfo(userId);
      throw new Error(
        `Rate limit exceeded. Try again in ${Math.ceil((limitInfo.resetTimeMinute.getTime() - Date.now()) / 1000)} seconds`
      );
    }

    // Check cache first
    const cacheKey = `${request.topic}_${request.difficulty}_${request.questionType}_${request.count}`;
    if (this.questionCache.has(cacheKey)) {
      logger.info(`Using cached questions for: ${cacheKey}`);
      return this.questionCache.get(cacheKey)!;
    }

    try {
      const prompt = this.buildQuestionPrompt(request);
      
      logger.info(`Generating ${request.count} questions for topic: ${request.topic}`);
      
      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API');
      }

      const questions = this.parseQuestions(content.text, request);
      const uniqueQuestions = this.deduplicateQuestions(questions);

      // Cache questions for future use
      this.questionCache.set(cacheKey, uniqueQuestions);

      logger.info(`Generated ${uniqueQuestions.length} unique questions`);
      return uniqueQuestions;

    } catch (error) {
      logger.error('Error generating questions:', error);
      throw new Error(`Failed to generate questions: ${error.message}`);
    }
  }

  /**
   * Build the prompt for question generation
   */
  private buildQuestionPrompt(request: QuestionGenerationRequest): string {
    const difficultyGuide = {
      easy: 'Basic knowledge level, suitable for beginners',
      medium: 'Intermediate knowledge level, requires some understanding',
      hard: 'Advanced knowledge level, requires deep understanding',
    };

    let prompt = `Generate ${request.count} ${request.difficulty} quiz questions about "${request.topic}".

REQUIREMENTS:
- Difficulty: ${difficultyGuide[request.difficulty]}
- Question type: ${request.questionType}
- Questions should be engaging and educational
- Avoid overly obscure or trick questions
- Each question should be answerable within 30 seconds
`;

    if (request.questionType === 'multiple_choice') {
      prompt += `
- Provide exactly 4 answer options (A, B, C, D)
- Only one option should be correct
- Make incorrect options plausible but clearly wrong
- Options should be roughly the same length
`;
    }

    if (request.questionType === 'true_false') {
      prompt += `
- Questions should have clear true/false answers
- Avoid ambiguous statements
- Provide brief explanations for the correct answer
`;
    }

    if (request.context) {
      prompt += `\nADDITIONAL CONTEXT:\n${request.context}\n`;
    }

    prompt += `
OUTPUT FORMAT (JSON):
{
  "questions": [
    {
      "question": "What is...?",
      "type": "${request.questionType}",
      ${request.questionType === 'multiple_choice' ? '"options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],' : ''}
      "correctAnswer": "${request.questionType === 'true_false' ? 'true' : 'A) Option 1'}",
      "explanation": "Brief explanation of why this is correct",
      "difficulty": "${request.difficulty}",
      "topic": "${request.topic}",
      "estimatedTime": 25
    }
  ]
}

IMPORTANT: Return ONLY valid JSON, no additional text.`;

    return prompt;
  }

  /**
   * Parse questions from Claude's response
   */
  private parseQuestions(response: string, request: QuestionGenerationRequest): GeneratedQuestion[] {
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const questions: GeneratedQuestion[] = [];

      if (!parsed.questions || !Array.isArray(parsed.questions)) {
        throw new Error('Invalid response format: missing questions array');
      }

      for (const q of parsed.questions) {
        const question: GeneratedQuestion = {
          id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          question: q.question,
          type: request.questionType,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation || '',
          difficulty: request.difficulty,
          topic: request.topic,
          estimatedTime: q.estimatedTime || 30,
        };

        if (request.questionType === 'multiple_choice' && q.options) {
          question.options = q.options;
        }

        questions.push(question);
      }

      return questions;
    } catch (error) {
      logger.error('Error parsing questions:', error);
      throw new Error(`Failed to parse questions: ${error.message}`);
    }
  }

  /**
   * Remove duplicate questions using content hashing
   */
  private deduplicateQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
    const unique: GeneratedQuestion[] = [];
    
    for (const question of questions) {
      // Create a hash of the question content
      const questionHash = this.hashQuestion(question.question);
      
      if (!this.duplicateTracker.has(questionHash)) {
        this.duplicateTracker.add(questionHash);
        unique.push(question);
      } else {
        logger.warn(`Duplicate question detected and filtered: ${question.question.substring(0, 50)}...`);
      }
    }

    return unique;
  }

  /**
   * Simple hash function for question deduplication
   */
  private hashQuestion(question: string): string {
    // Normalize the question text
    const normalized = question
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Simple hash
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return hash.toString();
  }

  /**
   * Evaluate user's answer to a question
   */
  evaluateAnswer(question: GeneratedQuestion, userAnswer: string): {
    isCorrect: boolean;
    explanation: string;
    score: number;
  } {
    let isCorrect = false;
    let score = 0;

    // Normalize answers for comparison
    const normalizedCorrect = question.correctAnswer.toLowerCase().trim();
    const normalizedUser = userAnswer.toLowerCase().trim();

    if (question.type === 'multiple_choice') {
      // For multiple choice, check exact match or just the letter
      const correctLetter = normalizedCorrect.match(/^([a-d])/)?.[1];
      const userLetter = normalizedUser.match(/^([a-d])/)?.[1];
      
      isCorrect = normalizedCorrect === normalizedUser || 
                  (correctLetter && userLetter && correctLetter === userLetter);
    } else if (question.type === 'true_false') {
      // For true/false, be flexible with input
      const userBoolean = normalizedUser.includes('true') || normalizedUser === 't' || normalizedUser === 'yes';
      const correctBoolean = normalizedCorrect.includes('true');
      isCorrect = userBoolean === correctBoolean;
    } else {
      // For open-ended, use fuzzy matching
      isCorrect = this.fuzzyMatch(normalizedCorrect, normalizedUser);
    }

    // Calculate score based on difficulty and correctness
    if (isCorrect) {
      const difficultyMultiplier = {
        easy: 1,
        medium: 1.5,
        hard: 2,
      };
      score = Math.round(10 * difficultyMultiplier[question.difficulty]);
    }

    return {
      isCorrect,
      explanation: question.explanation || '',
      score,
    };
  }

  /**
   * Simple fuzzy matching for open-ended questions
   */
  private fuzzyMatch(correct: string, user: string): boolean {
    // If exact match
    if (correct === user) return true;
    
    // If user answer contains the correct answer
    if (user.includes(correct) || correct.includes(user)) return true;
    
    // Word-by-word matching (at least 70% of words match)
    const correctWords = correct.split(/\s+/);
    const userWords = user.split(/\s+/);
    
    let matches = 0;
    for (const word of correctWords) {
      if (userWords.some(uw => uw.includes(word) || word.includes(uw))) {
        matches++;
      }
    }
    
    return matches / correctWords.length >= 0.7;
  }

  /**
   * Clear old cache entries to prevent memory issues
   */
  clearOldCache(): void {
    // Clear cache every hour to ensure fresh questions
    this.questionCache.clear();
    logger.info('Question cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.questionCache.size,
      entries: Array.from(this.questionCache.keys()),
    };
  }
}

export const anthropicService = new AnthropicService();

// Clear cache periodically
if (config.features.anthropicIntegration) {
  setInterval(() => {
    anthropicService.clearOldCache();
  }, 3600000); // Every hour
}