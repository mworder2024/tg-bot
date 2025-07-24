# Dual-Instance Telegram Quiz Bot Architecture

## System Overview

This architecture defines a dual-instance Telegram bot system for running educational quiz competitions with MWOR token rewards:

### Instance 1: Question Generator Bot
- **Purpose**: Continuous question generation and database management
- **Operation**: Background service using Anthropic API
- **Scope**: Cryptocurrency, tech, and pop-culture topics (tech/crypto focused)

### Instance 2: Quiz Runner Bot  
- **Purpose**: Interactive quiz sessions with elimination mechanics
- **Operation**: User-facing Telegram bot interface
- **Scope**: Admin-controlled quiz sessions with token rewards

## Architecture Components

### 1. Database Schema

#### Quiz Questions Table
```sql
CREATE TABLE quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic VARCHAR(100) NOT NULL, -- 'cryptocurrency', 'tech', 'pop-culture'
  difficulty VARCHAR(20) NOT NULL, -- 'easy', 'medium', 'hard', 'expert'
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer CHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  explanation TEXT,
  source_context TEXT,
  question_hash VARCHAR(64) UNIQUE NOT NULL, -- Prevent duplicates
  usage_count INT DEFAULT 0,
  is_bonus_eligible BOOLEAN DEFAULT false, -- For bonus rounds
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_quiz_questions_topic ON quiz_questions(topic);
CREATE INDEX idx_quiz_questions_difficulty ON quiz_questions(difficulty);
CREATE INDEX idx_quiz_questions_used_at ON quiz_questions(used_at);
CREATE INDEX idx_quiz_questions_hash ON quiz_questions(question_hash);
```

#### Quiz Sessions Table
```sql
CREATE TABLE quiz_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(20) UNIQUE NOT NULL, -- Human readable ID
  created_by_user_id VARCHAR(255) NOT NULL, -- Admin who created
  chat_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'recruiting', 
  -- 'recruiting', 'voting', 'active', 'completed', 'cancelled'
  selected_topics TEXT[], -- User-voted topics
  max_participants INT DEFAULT 50,
  join_window_minutes INT DEFAULT 5,
  round_structure JSONB, -- Dynamic elimination structure
  prize_pool DECIMAL(20, 8) DEFAULT 0,
  winner_reward DECIMAL(20, 8),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);
```

#### Quiz Participants Table
```sql
CREATE TABLE quiz_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES quiz_sessions(id),
  user_id VARCHAR(255) NOT NULL,
  username VARCHAR(255),
  current_round INT DEFAULT 1,
  is_eliminated BOOLEAN DEFAULT false,
  elimination_round INT,
  is_winner BOOLEAN DEFAULT false,
  reward_amount DECIMAL(20, 8) DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  eliminated_at TIMESTAMPTZ,
  UNIQUE(session_id, user_id)
);
```

#### Quiz Rounds Table
```sql
CREATE TABLE quiz_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES quiz_sessions(id),
  round_number INT NOT NULL,
  round_type VARCHAR(20) NOT NULL, -- 'elimination', 'bonus'
  question_id UUID REFERENCES quiz_questions(id),
  time_limit_seconds INT DEFAULT 30,
  participants_count INT NOT NULL,
  elimination_count INT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  UNIQUE(session_id, round_number)
);
```

#### Quiz Answers Table
```sql
CREATE TABLE quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID REFERENCES quiz_rounds(id),
  user_id VARCHAR(255) NOT NULL,
  selected_answer CHAR(1) CHECK (selected_answer IN ('A', 'B', 'C', 'D')),
  is_correct BOOLEAN NOT NULL,
  answer_time_ms INT NOT NULL, -- Time taken to answer
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(round_id, user_id)
);
```

#### Topic Voting Table
```sql
CREATE TABLE topic_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES quiz_sessions(id),
  user_id VARCHAR(255) NOT NULL,
  topic VARCHAR(100) NOT NULL,
  voted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, user_id, topic)
);
```

### 2. Instance 1: Question Generator Bot

#### Core Components

```typescript
// src/generators/question-generator.ts
export class QuestionGenerator {
  private anthropicClient: AnthropicAPI;
  private database: DatabaseService;
  private rateLimiter: RateLimiter;

  async generateQuestions(topic: string, difficulty: string, count: number): Promise<Question[]> {
    // Generate questions using Anthropic API
    // Ensure no duplicates via hash comparison
    // Store in database with usage tracking
  }

  async maintainQuestionPool(): Promise<void> {
    // Monitor question inventory levels
    // Generate new questions when pool is low
    // Delete used questions older than 30 days
  }

  private async createQuestionHash(question: string): Promise<string> {
    // Create SHA-256 hash for duplicate detection
  }
}
```

#### Question Generation Prompts

```typescript
const QUESTION_PROMPTS = {
  cryptocurrency: {
    easy: "Generate educational multiple choice questions about basic cryptocurrency concepts...",
    medium: "Create intermediate cryptocurrency questions covering DeFi, protocols...",
    hard: "Generate advanced questions about blockchain consensus, security...",
    expert: "Create expert-level questions about cryptographic primitives, scaling..."
  },
  tech: {
    easy: "Generate questions about basic technology concepts...",
    medium: "Create questions about software development, cloud computing...",
    hard: "Generate advanced questions about system architecture, algorithms...",
    expert: "Create expert questions about distributed systems, AI/ML..."
  },
  "pop-culture": {
    easy: "Generate questions about popular tech personalities, companies...",
    medium: "Create questions about tech industry events, acquisitions...",
    hard: "Generate questions about tech history, milestones...",
    expert: "Create questions about tech industry insider knowledge..."
  }
};
```

#### Background Services

```typescript
// src/services/question-pool-manager.ts
export class QuestionPoolManager {
  private readonly MIN_QUESTIONS_PER_TOPIC = 100;
  private readonly MIN_BONUS_QUESTIONS = 50;

  async monitorAndGenerate(): Promise<void> {
    setInterval(async () => {
      await this.checkQuestionLevels();
      await this.generateMissingQuestions();
      await this.cleanupUsedQuestions();
    }, 60000); // Check every minute
  }

  private async checkQuestionLevels(): Promise<QuestionInventory> {
    // Check current question counts by topic/difficulty
    // Return inventory status
  }

  private async generateMissingQuestions(): Promise<void> {
    // Generate questions for topics below minimum threshold
    // Respect API rate limits
  }

  private async cleanupUsedQuestions(): Promise<void> {
    // Delete questions used > 30 days ago
    // Maintain minimum pool size
  }
}
```

### 3. Instance 2: Quiz Runner Bot

#### Session Management

```typescript
// src/quiz/session-manager.ts
export class QuizSessionManager {
  async createSession(adminUserId: string, chatId: number): Promise<QuizSession> {
    const session = await this.database.createSession({
      sessionId: this.generateSessionId(),
      createdByUserId: adminUserId,
      chatId,
      status: 'recruiting'
    });

    // Start join window timer
    this.scheduleJoinWindowEnd(session.id);
    
    return session;
  }

  async handleUserJoin(sessionId: string, userId: string, username: string): Promise<boolean> {
    // Add user to session if within join window
    // Return success/failure
  }

  async startTopicVoting(sessionId: string): Promise<void> {
    // Present available topics for voting
    // Collect votes for 60 seconds
  }

  async calculateRoundStructure(participantCount: number): Promise<RoundStructure> {
    if (participantCount === 2) {
      return { totalRounds: 1, eliminationPerRound: [1] };
    } else if (participantCount === 3) {
      return { totalRounds: 2, eliminationPerRound: [1, 1] };
    } else if (participantCount >= 4) {
      // Max 3 elimination rounds + bonus round
      const rounds = Math.min(3, Math.ceil(Math.log2(participantCount)));
      const eliminationPerRound = this.distributeEliminations(participantCount, rounds);
      return { totalRounds: rounds, eliminationPerRound };
    }
    
    throw new Error('Invalid participant count');
  }

  private distributeEliminations(total: number, rounds: number): number[] {
    // Calculate optimal elimination distribution
    // Ensure exactly 1 winner remains
  }
}
```

#### Question Delivery System

```typescript
// src/quiz/question-delivery.ts
export class QuestionDelivery {
  async startRound(sessionId: string, roundNumber: number): Promise<void> {
    const participants = await this.getActiveParticipants(sessionId);
    const question = await this.selectQuestion(sessionId, roundNumber);
    
    // Send question to all participants simultaneously
    await this.broadcastQuestion(participants, question);
    
    // Start answer collection timer (30 seconds)
    setTimeout(() => this.collectAnswers(sessionId, roundNumber), 30000);
  }

  private async selectQuestion(sessionId: string, roundNumber: number): Promise<Question> {
    const session = await this.database.getSession(sessionId);
    const difficulty = this.determineDifficulty(roundNumber, session.selectedTopics);
    
    return await this.database.getRandomQuestion(
      session.selectedTopics,
      difficulty,
      sessionId // Avoid reusing questions in same session
    );
  }

  private determineDifficulty(roundNumber: number, totalRounds: number): string {
    if (roundNumber <= totalRounds * 0.4) return 'easy';
    if (roundNumber <= totalRounds * 0.7) return 'medium';
    if (roundNumber <= totalRounds) return 'hard';
    return 'expert'; // Bonus round
  }

  async collectAnswers(sessionId: string, roundNumber: number): Promise<void> {
    // Process all submitted answers
    // Calculate eliminations based on incorrect answers + time
    // If tie, use answer speed as tiebreaker
  }
}
```

#### Elimination Logic

```typescript
// src/quiz/elimination-engine.ts
export class EliminationEngine {
  async processRoundEliminations(roundId: string): Promise<EliminationResult> {
    const answers = await this.database.getRoundAnswers(roundId);
    const round = await this.database.getRound(roundId);
    
    // Group by correctness
    const correct = answers.filter(a => a.isCorrect);
    const incorrect = answers.filter(a => !a.isCorrect);
    
    let eliminated: string[] = [];
    
    if (incorrect.length >= round.eliminationCount) {
      // Eliminate all incorrect answers
      eliminated = incorrect.map(a => a.userId);
    } else {
      // Need to eliminate some correct answers too
      eliminated = incorrect.map(a => a.userId);
      
      // Sort correct answers by speed (slowest eliminated first)
      const sortedCorrect = correct.sort((a, b) => b.answerTimeMs - a.answerTimeMs);
      const additionalEliminations = round.eliminationCount - incorrect.length;
      eliminated.push(...sortedCorrect.slice(0, additionalEliminations).map(a => a.userId));
    }

    await this.database.eliminateParticipants(roundId, eliminated);
    
    return {
      eliminated,
      remaining: await this.database.getActiveParticipants(round.sessionId)
    };
  }
}
```

#### Bonus Round System

```typescript
// src/quiz/bonus-round.ts
export class BonusRound {
  async startBonusRound(sessionId: string, winnerId: string): Promise<void> {
    const bonusQuestions = await this.database.getBonusQuestions(3); // 3 difficult questions
    let correctCount = 0;
    
    for (let i = 0; i < bonusQuestions.length; i++) {
      const answer = await this.askBonusQuestion(winnerId, bonusQuestions[i]);
      if (answer.isCorrect) correctCount++;
    }
    
    // Calculate bonus reward based on correct answers
    const bonusMultiplier = this.calculateBonusMultiplier(correctCount);
    const bonusReward = await this.calculateBonusReward(sessionId, bonusMultiplier);
    
    await this.awardBonusReward(winnerId, bonusReward);
  }

  private calculateBonusMultiplier(correctCount: number): number {
    switch (correctCount) {
      case 3: return 2.0; // Double reward
      case 2: return 1.5; // 50% bonus
      case 1: return 1.2; // 20% bonus
      default: return 1.0; // No bonus
    }
  }
}
```

### 4. Reward System

#### MWOR Token Distribution

```typescript
// src/rewards/token-distributor.ts
export class TokenDistributor {
  async calculateSessionRewards(sessionId: string): Promise<RewardDistribution> {
    const session = await this.database.getSession(sessionId);
    const participantCount = await this.database.getParticipantCount(sessionId);
    
    // Base reward: 1,000 - 100,000 MWOR (random)
    const baseReward = this.generateRandomReward(1000, 100000);
    
    // Scale by participant count
    const scaledReward = baseReward * Math.log10(participantCount + 1);
    
    return {
      winnerReward: scaledReward,
      bonusEligible: true,
      maxBonus: scaledReward * 2 // Up to 2x for perfect bonus round
    };
  }

  private generateRandomReward(min: number, max: number): number {
    // Use VRF for provably fair random rewards
    const vrf = VRF.generateRandomNumber(min, max, `reward_${Date.now()}`);
    return vrf.number;
  }

  async distributeRewards(sessionId: string): Promise<void> {
    const winners = await this.database.getSessionWinners(sessionId);
    const rewards = await this.calculateSessionRewards(sessionId);
    
    for (const winner of winners) {
      await this.solanaService.transferTokens(
        winner.userId,
        rewards.winnerReward,
        'QUIZ_WINNER'
      );
    }
  }
}
```

### 5. API Coordination Layer

#### Inter-Instance Communication

```typescript
// src/coordination/bot-coordinator.ts
export class BotCoordinator {
  async requestQuestions(topic: string[], difficulty: string, count: number): Promise<Question[]> {
    // Request fresh questions from Generator instance
    return await this.http.post('/api/questions/request', {
      topics: topic,
      difficulty,
      count,
      sessionId: this.currentSessionId
    });
  }

  async markQuestionsUsed(questionIds: string[]): Promise<void> {
    // Mark questions as used in Generator instance
    await this.http.post('/api/questions/mark-used', {
      questionIds,
      usedAt: new Date()
    });
  }

  async getQuestionInventory(): Promise<QuestionInventory> {
    // Check available question counts
    return await this.http.get('/api/questions/inventory');
  }
}
```

### 6. Configuration Management

#### Bot Settings

```typescript
export const QUIZ_CONFIG = {
  questionGeneration: {
    minPoolSize: 100,
    maxPoolSize: 500,
    generationBatchSize: 10,
    anthropicRateLimit: 60, // requests per minute
    cleanupIntervalHours: 24
  },
  
  sessions: {
    maxParticipants: 50,
    joinWindowMinutes: 5,
    votingTimeSeconds: 60,
    answerTimeSeconds: 30,
    roundBreakSeconds: 10
  },
  
  elimination: {
    maxRounds: 3,
    bonusRoundQuestions: 3,
    tiebreakBySpeed: true
  },
  
  rewards: {
    minReward: 1000,
    maxReward: 100000,
    bonusMultipliers: [1.0, 1.2, 1.5, 2.0], // 0, 1, 2, 3 correct
    participantScaling: true
  }
};
```

### 7. Deployment Architecture

#### Docker Compose Configuration

```yaml
version: '3.8'

services:
  quiz-generator:
    build: 
      context: .
      dockerfile: Dockerfile.generator
    environment:
      - INSTANCE_TYPE=generator
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DATABASE_URL=${DATABASE_URL}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  quiz-runner:
    build:
      context: .
      dockerfile: Dockerfile.runner
    environment:
      - INSTANCE_TYPE=runner
      - BOT_TOKEN=${BOT_TOKEN}
      - DATABASE_URL=${DATABASE_URL}
    depends_on:
      - postgres
      - redis
      - quiz-generator
    restart: unless-stopped

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: quiz_bot_db
      POSTGRES_USER: quiz_bot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/quiz-schema.sql:/docker-entrypoint-initdb.d/init.sql

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 8. Monitoring and Analytics

#### Quiz Performance Metrics

```typescript
// src/monitoring/quiz-metrics.ts
export class QuizMetrics {
  async trackSessionMetrics(sessionId: string): Promise<void> {
    const session = await this.database.getSession(sessionId);
    const metrics = {
      participantCount: session.participantCount,
      sessionDuration: session.endedAt - session.startedAt,
      topicsVoted: session.selectedTopics,
      roundsCompleted: session.roundsCompleted,
      averageAnswerTime: await this.calculateAverageAnswerTime(sessionId),
      eliminationAccuracy: await this.calculateEliminationAccuracy(sessionId)
    };

    await this.database.recordQuizMetrics(sessionId, metrics);
  }

  async generateDailyReport(): Promise<QuizReport> {
    // Generate comprehensive daily analytics
    // Question usage patterns, popular topics, participant engagement
  }
}
```

## Implementation Timeline

### Phase 1: Database & Core Architecture (Days 1-3)
- Set up dual-instance database schema
- Create base service classes
- Implement question storage and retrieval

### Phase 2: Question Generator Bot (Days 4-6)
- Integrate Anthropic API
- Build question generation pipeline
- Implement duplicate detection and cleanup

### Phase 3: Quiz Runner Bot (Days 7-10)
- Build session management system
- Implement elimination mechanics
- Create topic voting system

### Phase 4: Reward System (Days 11-12)
- Integrate MWOR token distribution
- Implement bonus round mechanics
- Add VRF-based random rewards

### Phase 5: Testing & Deployment (Days 13-14)
- End-to-end testing
- Performance optimization
- Production deployment

## Security Considerations

1. **Question Integrity**: Hash-based duplicate detection prevents question reuse
2. **Fair Elimination**: VRF ensures random but verifiable elimination mechanics
3. **Reward Security**: Blockchain-based token distribution with audit trails
4. **Rate Limiting**: Protect Anthropic API from abuse
5. **Admin Controls**: Restrict session creation to authorized users

## Scalability Features

1. **Question Pool Management**: Automatic inventory maintenance
2. **Concurrent Sessions**: Support multiple simultaneous quiz sessions
3. **Database Optimization**: Indexed queries for fast question retrieval
4. **Caching Layer**: Redis for frequently accessed questions
5. **Horizontal Scaling**: Stateless service design for easy scaling

This architecture provides a robust, scalable foundation for the dual-instance quiz bot system with educational value, fair competition mechanics, and meaningful token rewards.