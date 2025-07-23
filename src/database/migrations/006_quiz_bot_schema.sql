-- Quiz Bot Database Schema Migration
-- Comprehensive schema for quiz bot system with real-time management and MWOR token integration
-- Database Designer Agent - Coordinated Schema Design

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================================
-- CORE QUIZ SYSTEM TABLES
-- ============================================================================

-- Questions table - Store generated quiz questions with metadata
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id VARCHAR(100) UNIQUE NOT NULL, -- External question ID for deduplication
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    question_text TEXT NOT NULL,
    question_type VARCHAR(50) NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false', 'text', 'numeric')),
    correct_answer TEXT NOT NULL,
    options JSONB, -- For multiple choice: ["A", "B", "C", "D"]
    difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
    estimated_time_seconds INTEGER DEFAULT 30,
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    source VARCHAR(255), -- AI model, manual, imported, etc.
    metadata JSONB DEFAULT '{}', -- Additional question metadata
    tags TEXT[], -- Question tags for categorization
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate questions
    CONSTRAINT unique_question_text_category UNIQUE(question_text, category_id)
);

-- Categories table - Subject categories for voting and organization
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    color_hex VARCHAR(7), -- For UI display
    icon VARCHAR(50), -- Emoji or icon identifier
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    parent_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quizzes table - Quiz session management
CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_code VARCHAR(20) UNIQUE NOT NULL, -- Short code for users to join
    title VARCHAR(255) NOT NULL,
    description TEXT,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    chat_id BIGINT, -- Telegram chat ID
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    
    -- Quiz configuration
    max_participants INTEGER DEFAULT 100,
    current_participants INTEGER DEFAULT 0,
    questions_per_round INTEGER DEFAULT 1,
    total_rounds INTEGER DEFAULT 10,
    time_per_question_seconds INTEGER DEFAULT 30,
    elimination_percentage DECIMAL(4,2) DEFAULT 50.00, -- % eliminated each round
    
    -- Quiz state
    status VARCHAR(50) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'waiting_for_players', 'active', 'paused', 'completed', 'cancelled')),
    current_round INTEGER DEFAULT 0,
    current_question_id UUID REFERENCES questions(id),
    round_start_time TIMESTAMPTZ,
    round_end_time TIMESTAMPTZ,
    
    -- Game type and rewards
    is_paid BOOLEAN DEFAULT false,
    entry_fee DECIMAL(20, 9) DEFAULT 0, -- MWOR tokens
    prize_pool DECIMAL(20, 9) DEFAULT 0,
    winner_count INTEGER DEFAULT 1,
    
    -- VRF for fairness
    vrf_seed VARCHAR(255),
    vrf_proof TEXT,
    
    -- Timestamps
    scheduled_start_time TIMESTAMPTZ,
    actual_start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quiz participants table - Track users in each quiz
CREATE TABLE IF NOT EXISTS quiz_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    
    -- Participation status
    status VARCHAR(50) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'eliminated', 'winner', 'disqualified', 'left')),
    elimination_round INTEGER, -- Round when eliminated
    final_rank INTEGER, -- Final ranking in quiz
    
    -- Performance tracking
    correct_answers INTEGER DEFAULT 0,
    total_answers INTEGER DEFAULT 0,
    accuracy_percentage DECIMAL(5,2) DEFAULT 0.00,
    average_response_time_ms INTEGER DEFAULT 0,
    
    -- Entry and elimination
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    eliminated_at TIMESTAMPTZ,
    prize_amount DECIMAL(20, 9) DEFAULT 0,
    
    UNIQUE(quiz_id, user_id)
);

-- Quiz rounds table - Individual round data
CREATE TABLE IF NOT EXISTS quiz_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    question_id UUID NOT NULL REFERENCES questions(id),
    
    -- Round timing
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_seconds INTEGER,
    
    -- Round statistics
    participants_count INTEGER DEFAULT 0,
    correct_answers_count INTEGER DEFAULT 0,
    eliminated_count INTEGER DEFAULT 0,
    average_response_time_ms INTEGER DEFAULT 0,
    
    -- VRF data for elimination
    elimination_vrf_seed VARCHAR(255),
    elimination_vrf_proof TEXT,
    elimination_threshold DECIMAL(5,2), -- Score threshold for elimination
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(quiz_id, round_number)
);

-- User answers table - Track user responses
CREATE TABLE IF NOT EXISTS user_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    round_id UUID NOT NULL REFERENCES quiz_rounds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id),
    
    -- Answer data
    user_answer TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    response_time_ms INTEGER NOT NULL,
    confidence_level INTEGER CHECK (confidence_level BETWEEN 1 AND 5),
    
    -- Scoring
    points_earned INTEGER DEFAULT 0,
    time_bonus INTEGER DEFAULT 0,
    
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(quiz_id, round_id, user_id, question_id)
);

-- ============================================================================
-- TOKEN REWARDS AND TRANSACTIONS
-- ============================================================================

-- Token rewards table - MWOR token transaction history
CREATE TABLE IF NOT EXISTS token_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL,
    
    -- Transaction details
    transaction_type VARCHAR(50) NOT NULL 
        CHECK (transaction_type IN ('entry_fee', 'prize_payout', 'bonus', 'refund', 'penalty')),
    amount DECIMAL(20, 9) NOT NULL,
    balance_before DECIMAL(20, 9) NOT NULL,
    balance_after DECIMAL(20, 9) NOT NULL,
    
    -- Blockchain data
    blockchain_hash VARCHAR(255),
    wallet_address VARCHAR(44),
    block_number BIGINT,
    
    -- Transaction status
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'confirmed', 'failed', 'cancelled')),
    
    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- VOTING AND ENGAGEMENT SYSTEM
-- ============================================================================

-- Category votes table - Track voting for quiz categories
CREATE TABLE IF NOT EXISTS category_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL, -- Optional: votes for specific quiz
    
    vote_weight INTEGER DEFAULT 1,
    voted_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, category_id, quiz_id)
);

-- Quiz feedback table - User feedback and ratings
CREATE TABLE IF NOT EXISTS quiz_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Ratings (1-5 scale)
    difficulty_rating INTEGER CHECK (difficulty_rating BETWEEN 1 AND 5),
    enjoyment_rating INTEGER CHECK (enjoyment_rating BETWEEN 1 AND 5),
    fairness_rating INTEGER CHECK (fairness_rating BETWEEN 1 AND 5),
    
    -- Written feedback
    comments TEXT,
    suggestions TEXT,
    
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(quiz_id, user_id)
);

-- ============================================================================
-- PERFORMANCE OPTIMIZATION INDEXES
-- ============================================================================

-- Questions table indexes
CREATE INDEX idx_questions_category ON questions(category_id) WHERE is_active = true;
CREATE INDEX idx_questions_usage ON questions(usage_count, last_used_at);
CREATE INDEX idx_questions_difficulty ON questions(difficulty_level);
CREATE INDEX idx_questions_tags ON questions USING GIN(tags);
CREATE INDEX idx_questions_active ON questions(is_active, created_at);
CREATE INDEX idx_questions_metadata ON questions USING GIN(metadata);

-- Categories table indexes
CREATE INDEX idx_categories_active ON categories(is_active, sort_order);
CREATE INDEX idx_categories_parent ON categories(parent_category_id);

-- Quizzes table indexes
CREATE INDEX idx_quizzes_status ON quizzes(status, created_at);
CREATE INDEX idx_quizzes_creator ON quizzes(creator_id);
CREATE INDEX idx_quizzes_category ON quizzes(category_id);
CREATE INDEX idx_quizzes_chat ON quizzes(chat_id);
CREATE INDEX idx_quizzes_scheduled ON quizzes(scheduled_start_time) WHERE status = 'pending';
CREATE INDEX idx_quizzes_active ON quizzes(status, current_round) WHERE status = 'active';
CREATE INDEX idx_quizzes_paid ON quizzes(is_paid, status);

-- Quiz participants indexes
CREATE INDEX idx_quiz_participants_quiz ON quiz_participants(quiz_id, status);
CREATE INDEX idx_quiz_participants_user ON quiz_participants(user_id, status);
CREATE INDEX idx_quiz_participants_performance ON quiz_participants(accuracy_percentage DESC, average_response_time_ms ASC);
CREATE INDEX idx_quiz_participants_elimination ON quiz_participants(elimination_round, eliminated_at);

-- Quiz rounds indexes
CREATE INDEX idx_quiz_rounds_quiz ON quiz_rounds(quiz_id, round_number);
CREATE INDEX idx_quiz_rounds_question ON quiz_rounds(question_id);
CREATE INDEX idx_quiz_rounds_timing ON quiz_rounds(start_time, end_time);

-- User answers indexes
CREATE INDEX idx_user_answers_quiz_user ON user_answers(quiz_id, user_id);
CREATE INDEX idx_user_answers_round ON user_answers(round_id, is_correct);
CREATE INDEX idx_user_answers_performance ON user_answers(response_time_ms, points_earned);
CREATE INDEX idx_user_answers_user_stats ON user_answers(user_id, is_correct, submitted_at);

-- Token rewards indexes
CREATE INDEX idx_token_rewards_user ON token_rewards(user_id, transaction_type);
CREATE INDEX idx_token_rewards_quiz ON token_rewards(quiz_id, transaction_type);
CREATE INDEX idx_token_rewards_status ON token_rewards(status, created_at);
CREATE INDEX idx_token_rewards_blockchain ON token_rewards(blockchain_hash) WHERE blockchain_hash IS NOT NULL;
CREATE INDEX idx_token_rewards_amount ON token_rewards(amount DESC, created_at);

-- Voting indexes
CREATE INDEX idx_category_votes_category ON category_votes(category_id, voted_at);
CREATE INDEX idx_category_votes_user ON category_votes(user_id, voted_at);
CREATE INDEX idx_quiz_feedback_quiz ON quiz_feedback(quiz_id);

-- ============================================================================
-- PERFORMANCE VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active quizzes with participant counts
CREATE OR REPLACE VIEW active_quizzes AS
SELECT 
    q.*,
    COUNT(qp.id) as actual_participants,
    AVG(qp.accuracy_percentage) as average_accuracy,
    c.name as category_name
FROM quizzes q
LEFT JOIN quiz_participants qp ON q.id = qp.quiz_id AND qp.status = 'active'
LEFT JOIN categories c ON q.category_id = c.id
WHERE q.status IN ('waiting_for_players', 'active', 'paused')
GROUP BY q.id, c.name;

-- User performance leaderboard
CREATE OR REPLACE VIEW user_leaderboard AS
SELECT 
    u.id,
    u.username,
    u.display_name,
    COUNT(DISTINCT qp.quiz_id) as quizzes_participated,
    COUNT(DISTINCT CASE WHEN qp.status = 'winner' THEN qp.quiz_id END) as quizzes_won,
    AVG(qp.accuracy_percentage) as average_accuracy,
    AVG(qp.average_response_time_ms) as average_response_time,
    SUM(qp.prize_amount) as total_winnings,
    RANK() OVER (ORDER BY COUNT(CASE WHEN qp.status = 'winner' THEN 1 END) DESC, AVG(qp.accuracy_percentage) DESC) as rank
FROM users u
LEFT JOIN quiz_participants qp ON u.id = qp.user_id
WHERE u.is_active = true
GROUP BY u.id, u.username, u.display_name
ORDER BY rank;

-- Question usage analytics
CREATE OR REPLACE VIEW question_analytics AS
SELECT 
    q.*,
    c.name as category_name,
    COUNT(ua.id) as times_answered,
    COUNT(CASE WHEN ua.is_correct THEN 1 END) as correct_answers,
    CASE 
        WHEN COUNT(ua.id) > 0 THEN 
            (COUNT(CASE WHEN ua.is_correct THEN 1 END)::DECIMAL / COUNT(ua.id)) * 100
        ELSE 0 
    END as success_rate,
    AVG(ua.response_time_ms) as average_response_time
FROM questions q
LEFT JOIN categories c ON q.category_id = c.id
LEFT JOIN user_answers ua ON q.id = ua.question_id
GROUP BY q.id, c.name
ORDER BY q.usage_count DESC, success_rate ASC;

-- Category popularity
CREATE OR REPLACE VIEW category_popularity AS
SELECT 
    c.*,
    COUNT(DISTINCT q.id) as quiz_count,
    COUNT(DISTINCT cv.user_id) as vote_count,
    COUNT(DISTINCT qp.user_id) as participant_count,
    AVG(qf.difficulty_rating) as avg_difficulty_rating,
    AVG(qf.enjoyment_rating) as avg_enjoyment_rating
FROM categories c
LEFT JOIN quizzes q ON c.id = q.category_id
LEFT JOIN category_votes cv ON c.id = cv.category_id
LEFT JOIN quiz_participants qp ON q.id = qp.quiz_id
LEFT JOIN quiz_feedback qf ON q.id = qf.quiz_id
WHERE c.is_active = true
GROUP BY c.id
ORDER BY vote_count DESC, participant_count DESC;

-- Real-time quiz state
CREATE OR REPLACE VIEW quiz_real_time_state AS
SELECT 
    q.id,
    q.quiz_code,
    q.title,
    q.status,
    q.current_round,
    q.total_rounds,
    q.round_start_time,
    q.round_end_time,
    qr.question_id,
    qu.question_text,
    qu.question_type,
    qu.options,
    COUNT(qp.id) as active_participants,
    COUNT(ua.id) as answers_received,
    EXTRACT(EPOCH FROM (NOW() - q.round_start_time)) as elapsed_seconds
FROM quizzes q
LEFT JOIN quiz_rounds qr ON q.id = qr.quiz_id AND qr.round_number = q.current_round
LEFT JOIN questions qu ON qr.question_id = qu.id
LEFT JOIN quiz_participants qp ON q.id = qp.quiz_id AND qp.status = 'active'
LEFT JOIN user_answers ua ON qr.id = ua.round_id
WHERE q.status = 'active'
GROUP BY q.id, q.quiz_code, q.title, q.status, q.current_round, q.total_rounds, 
         q.round_start_time, q.round_end_time, qr.question_id, qu.question_text, 
         qu.question_type, qu.options;

-- ============================================================================
-- TRIGGERS AND FUNCTIONS
-- ============================================================================

-- Update question usage counter
CREATE OR REPLACE FUNCTION update_question_usage()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE questions 
    SET usage_count = usage_count + 1,
        last_used_at = NOW()
    WHERE id = NEW.question_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_question_usage
    AFTER INSERT ON quiz_rounds
    FOR EACH ROW
    EXECUTE FUNCTION update_question_usage();

-- Update participant accuracy
CREATE OR REPLACE FUNCTION update_participant_accuracy()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE quiz_participants 
    SET 
        total_answers = (SELECT COUNT(*) FROM user_answers WHERE quiz_id = NEW.quiz_id AND user_id = NEW.user_id),
        correct_answers = (SELECT COUNT(*) FROM user_answers WHERE quiz_id = NEW.quiz_id AND user_id = NEW.user_id AND is_correct = true),
        accuracy_percentage = (
            SELECT 
                CASE 
                    WHEN COUNT(*) = 0 THEN 0 
                    ELSE (COUNT(CASE WHEN is_correct THEN 1 END)::DECIMAL / COUNT(*)) * 100 
                END
            FROM user_answers 
            WHERE quiz_id = NEW.quiz_id AND user_id = NEW.user_id
        ),
        average_response_time_ms = (
            SELECT COALESCE(AVG(response_time_ms), 0)
            FROM user_answers 
            WHERE quiz_id = NEW.quiz_id AND user_id = NEW.user_id
        )
    WHERE quiz_id = NEW.quiz_id AND user_id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_participant_accuracy
    AFTER INSERT OR UPDATE ON user_answers
    FOR EACH ROW
    EXECUTE FUNCTION update_participant_accuracy();

-- Update quiz participant count
CREATE OR REPLACE FUNCTION update_quiz_participant_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE quizzes 
        SET current_participants = current_participants + 1
        WHERE id = NEW.quiz_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE quizzes 
        SET current_participants = current_participants - 1
        WHERE id = OLD.quiz_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_quiz_participant_count
    AFTER INSERT OR DELETE ON quiz_participants
    FOR EACH ROW
    EXECUTE FUNCTION update_quiz_participant_count();

-- Apply update triggers to existing tables
CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quizzes_updated_at BEFORE UPDATE ON quizzes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_token_rewards_updated_at BEFORE UPDATE ON token_rewards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INITIAL DATA SETUP
-- ============================================================================

-- Insert default categories
INSERT INTO categories (name, description, color_hex, icon, sort_order) VALUES
    ('General Knowledge', 'Mixed topics and general trivia', '#3498db', '🧠', 1),
    ('Science & Technology', 'STEM topics, physics, chemistry, biology, tech', '#e74c3c', '🔬', 2),
    ('History & Geography', 'World history, countries, capitals, landmarks', '#f39c12', '🌍', 3),
    ('Sports & Entertainment', 'Sports, movies, music, celebrities', '#9b59b6', '⚽', 4),
    ('Literature & Arts', 'Books, poetry, painting, sculpture', '#1abc9c', '📚', 5),
    ('Mathematics', 'Numbers, equations, logic puzzles', '#34495e', '🔢', 6),
    ('Current Events', 'Recent news and trending topics', '#e67e22', '📰', 7),
    ('Pop Culture', 'Social media, internet culture, memes', '#f1c40f', '🎭', 8)
ON CONFLICT (name) DO NOTHING;

-- Insert sample questions for testing
INSERT INTO questions (question_id, question_text, question_type, correct_answer, options, difficulty_level, category_id, source, tags) 
SELECT 
    'SAMPLE_' || gen_random_uuid()::text,
    'What is the capital of France?',
    'multiple_choice',
    'Paris',
    '["Paris", "London", "Berlin", "Madrid"]'::jsonb,
    1,
    c.id,
    'manual',
    ARRAY['geography', 'capitals', 'europe']
FROM categories c 
WHERE c.name = 'History & Geography'
ON CONFLICT DO NOTHING;

INSERT INTO questions (question_id, question_text, question_type, correct_answer, options, difficulty_level, category_id, source, tags) 
SELECT 
    'SAMPLE_' || gen_random_uuid()::text,
    'What is 2 + 2?',
    'multiple_choice',
    '4',
    '["3", "4", "5", "6"]'::jsonb,
    1,
    c.id,
    'manual',
    ARRAY['basic_math', 'arithmetic']
FROM categories c 
WHERE c.name = 'Mathematics'
ON CONFLICT DO NOTHING;

-- Insert sample quiz for testing
INSERT INTO quizzes (quiz_code, title, description, category_id, max_participants, questions_per_round, total_rounds, time_per_question_seconds)
SELECT 
    'TEST001',
    'Sample Geography Quiz',
    'Test quiz for geography knowledge',
    c.id,
    50,
    1,
    5,
    30
FROM categories c 
WHERE c.name = 'History & Geography'
ON CONFLICT (quiz_code) DO NOTHING;

-- ============================================================================
-- PERFORMANCE MONITORING
-- ============================================================================

-- Create monitoring table for query performance
CREATE TABLE IF NOT EXISTS query_performance_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_type VARCHAR(100) NOT NULL,
    execution_time_ms INTEGER NOT NULL,
    rows_affected INTEGER,
    table_name VARCHAR(100),
    index_used BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_query_performance_type ON query_performance_log(query_type, created_at);
CREATE INDEX idx_query_performance_time ON query_performance_log(execution_time_ms DESC);

-- Clean up old performance logs (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_performance_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM query_performance_log 
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION COMPLETION LOG
-- ============================================================================

INSERT INTO system_events (event_type, severity, component, message, details)
VALUES (
    'database_migration',
    'low',
    'database',
    'Quiz bot schema migration 006 completed successfully',
    jsonb_build_object(
        'migration_file', '006_quiz_bot_schema.sql',
        'tables_created', ARRAY['questions', 'categories', 'quizzes', 'quiz_participants', 'quiz_rounds', 'user_answers', 'token_rewards', 'category_votes', 'quiz_feedback'],
        'indexes_created', 25,
        'views_created', 5,
        'triggers_created', 4,
        'sample_data_inserted', true
    )
);

-- Grant appropriate permissions (uncomment and adjust as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quiz_bot_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quiz_bot_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO quiz_bot_user;

-- Performance optimization: analyze tables for better query planning
ANALYZE;

-- Migration complete
SELECT 'Quiz Bot Database Schema Migration 006 - COMPLETED' as status;