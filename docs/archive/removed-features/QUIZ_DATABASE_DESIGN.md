# Quiz Bot Database Design Documentation

## Overview

This document outlines the comprehensive database schema design for the quiz bot system, implemented as PostgreSQL migration `006_quiz_bot_schema.sql`. The design supports real-time quiz management, elimination-style gameplay, MWOR token integration, and performance optimization for concurrent users.

## Design Principles

### 1. **Scalability First**
- Optimized indexes for real-time queries
- Efficient data structures for concurrent access
- Partitioning-ready design for future growth

### 2. **Data Integrity**
- Foreign key constraints maintain referential integrity
- Check constraints prevent invalid data states
- Unique constraints prevent duplicate questions and participants

### 3. **Performance Optimization**
- 25+ strategic indexes for fast queries
- Materialized views for complex aggregations  
- Triggers for automatic data maintenance

### 4. **Real-time Support**
- Quiz state management for live gameplay
- Participant tracking with elimination progression
- Token transaction handling for immediate rewards

## Core Table Architecture

### Questions Management

#### `questions` Table
**Purpose**: Store generated quiz questions with comprehensive metadata

**Key Features**:
- **Deduplication**: `question_id` prevents duplicate questions
- **Usage Tracking**: `usage_count` and `last_used_at` for question rotation
- **Categorization**: Linked to categories with tags for flexible organization
- **Difficulty Scaling**: 1-5 difficulty levels for progressive gameplay
- **Source Tracking**: Track whether questions are AI-generated, manual, or imported

**Performance Optimizations**:
```sql
-- Fast category-based question selection
CREATE INDEX idx_questions_category ON questions(category_id) WHERE is_active = true;

-- Usage-based question rotation
CREATE INDEX idx_questions_usage ON questions(usage_count, last_used_at);

-- Tag-based searching with GIN index
CREATE INDEX idx_questions_tags ON questions USING GIN(tags);
```

#### `categories` Table
**Purpose**: Hierarchical organization of quiz topics

**Key Features**:
- **Hierarchical Structure**: Support for parent-child relationships
- **UI Support**: Color and icon fields for visual presentation
- **Voting Integration**: Categories can be voted on by users
- **Flexible Ordering**: Sort order for customizable display

### Quiz Session Management

#### `quizzes` Table
**Purpose**: Central management of quiz sessions and state

**Key Features**:
- **Real-time State**: Current round, question, and timing tracking
- **Flexible Configuration**: Customizable elimination rates, timing, and participant limits
- **Payment Integration**: Support for paid quizzes with MWOR tokens
- **VRF Integration**: Verifiable random function for fair elimination
- **Multi-platform Support**: Telegram chat integration with extensible design

**State Machine**:
```
pending → waiting_for_players → active → completed
    ↓              ↓               ↓         ↑
cancelled      cancelled       paused  ────┘
```

#### `quiz_participants` Table
**Purpose**: Track user participation and performance

**Key Features**:
- **Real-time Status**: Active, eliminated, winner, disqualified states
- **Performance Metrics**: Accuracy, response time, ranking
- **Prize Distribution**: Individual prize amounts for winners
- **Elimination Tracking**: Round-by-round elimination history

#### `quiz_rounds` Table
**Purpose**: Individual round management and statistics

**Key Features**:
- **Timing Control**: Precise start/end time tracking
- **Round Statistics**: Participant counts, answer accuracy, elimination data
- **VRF Integration**: Fair elimination using verifiable randomness
- **Performance Analytics**: Response time aggregation per round

### Answer and Response Tracking

#### `user_answers` Table
**Purpose**: Detailed response tracking for analytics and scoring

**Key Features**:
- **Comprehensive Tracking**: Answer content, correctness, timing
- **Scoring System**: Points and time bonuses
- **Confidence Levels**: User-reported confidence for advanced analytics
- **Performance Analysis**: Response time tracking for user profiling

**Performance Optimization**:
```sql
-- Fast user performance queries
CREATE INDEX idx_user_answers_user_stats ON user_answers(user_id, is_correct, submitted_at);

-- Round-based answer aggregation
CREATE INDEX idx_user_answers_round ON user_answers(round_id, is_correct);
```

### Token and Rewards System

#### `token_rewards` Table
**Purpose**: MWOR token transaction management

**Key Features**:
- **Transaction Types**: Entry fees, prizes, bonuses, refunds, penalties
- **Blockchain Integration**: Hash, wallet address, block number tracking
- **Balance Management**: Before/after balance tracking for audit trail
- **Status Tracking**: Pending, processing, confirmed, failed states

**Security Features**:
- Balance verification through before/after tracking
- Blockchain hash verification for confirmed transactions
- Audit trail for all token movements

### Engagement and Feedback

#### `category_votes` Table
**Purpose**: Democratic category selection through voting

**Key Features**:
- **Vote Weighting**: Support for weighted voting systems
- **Quiz-specific Voting**: Optional votes for specific upcoming quizzes
- **Duplicate Prevention**: Unique constraints prevent multiple votes

#### `quiz_feedback` Table
**Purpose**: User experience and difficulty assessment

**Key Features**:
- **Multi-dimensional Ratings**: Difficulty, enjoyment, fairness on 1-5 scale
- **Qualitative Feedback**: Comments and suggestions for improvement
- **Post-quiz Analysis**: Feedback collection after quiz completion

## Performance Views

### `active_quizzes`
Real-time view of ongoing quizzes with participant counts and performance metrics.

### `user_leaderboard`
Comprehensive user ranking based on wins, accuracy, and response time.

### `question_analytics`
Question difficulty analysis based on success rates and usage patterns.

### `category_popularity`
Category engagement metrics combining votes, participation, and ratings.

### `quiz_real_time_state`
Live quiz state for real-time UI updates and game management.

## Automated Data Management

### Triggers and Functions

#### `update_question_usage()`
Automatically increments question usage counters and updates last-used timestamps.

#### `update_participant_accuracy()`
Maintains real-time accuracy and response time statistics for participants.

#### `update_quiz_participant_count()`
Keeps quiz participant counts synchronized with actual participation.

### Performance Monitoring

#### `query_performance_log`
Tracks database query performance for optimization and monitoring.

#### Automatic Cleanup
Scheduled cleanup of old performance logs and temporary data.

## Indexing Strategy

### Primary Performance Indexes
1. **Quiz Management**: Status-based queries for active quiz retrieval
2. **User Lookup**: Fast user-based queries across all tables
3. **Real-time Updates**: Round and question state management
4. **Analytics**: Aggregation-optimized indexes for reporting

### Composite Indexes
Strategic multi-column indexes for complex queries:
- `(quiz_id, user_id)` for participant lookup
- `(status, created_at)` for temporal filtering
- `(category_id, is_active)` for question selection

### GIN Indexes
Advanced indexing for JSON and array data:
- Question tags for flexible categorization
- Metadata fields for extensible data storage

## Scalability Considerations

### Horizontal Scaling
- Quiz data partitioned by date for archival
- Read replicas for analytics and reporting
- Connection pooling for high concurrent access

### Vertical Scaling
- Memory optimization through strategic indexing
- Query optimization through materialized views
- Automatic statistics updates for query planning

### Data Archival
- Automated archival of completed quizzes
- Retention policies for performance data
- Historical analytics preservation

## Security and Integrity

### Data Protection
- Wallet address validation and encryption
- User PII handling compliance
- Audit trails for all administrative actions

### Transaction Safety
- ACID compliance for token transactions
- Deadlock prevention in concurrent operations
- Rollback safety for failed operations

### Access Control
- Role-based permissions for different user types
- API rate limiting integration
- Audit logging for sensitive operations

## Integration Points

### Telegram Bot Integration
- Chat ID mapping for multi-group support
- User ID synchronization with Telegram
- Real-time message updates for quiz state

### Blockchain Integration
- Solana wallet verification
- MWOR token transaction processing
- VRF integration for provable fairness

### Analytics Integration
- Real-time metrics collection
- Performance monitoring hooks
- Business intelligence data pipeline

## Future Enhancements

### Planned Features
1. **Machine Learning Integration**: Question difficulty prediction
2. **Advanced Analytics**: Player behavior analysis
3. **Tournament Mode**: Multi-round elimination tournaments
4. **Team Play**: Group-based quiz competitions
5. **Custom Questions**: User-generated content with moderation

### Scalability Roadmap
1. **Microservices Split**: Separate question, quiz, and user services
2. **Caching Layer**: Redis integration for hot data
3. **Event Sourcing**: Audit trail and state reconstruction
4. **Global Distribution**: Multi-region database deployment

## Monitoring and Maintenance

### Health Checks
- Table size monitoring
- Index usage analysis
- Query performance tracking
- Connection pool monitoring

### Regular Maintenance
- Statistics updates for query optimization
- Index rebuild for fragmentation
- Archive old data for performance
- Security audit and updates

This database design provides a robust, scalable foundation for the quiz bot system while maintaining flexibility for future enhancements and integrations.