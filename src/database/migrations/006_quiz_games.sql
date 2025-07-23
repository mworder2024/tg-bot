-- Quiz Games System Migration
-- Implements sophisticated quiz game logic with elimination algorithms

-- Quiz games table
CREATE TABLE IF NOT EXISTS quiz_games (
    id UUID PRIMARY KEY,
    chat_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'waiting',
    players JSONB DEFAULT '[]',
    current_round INTEGER DEFAULT 0,
    max_rounds INTEGER DEFAULT 3,
    elimination_history JSONB DEFAULT '[]',
    category_votes JSONB DEFAULT '{}',
    selected_category VARCHAR(255),
    current_question JSONB,
    question_start_time TIMESTAMP,
    question_time_limit INTEGER DEFAULT 30,
    bonus_round JSONB,
    winner VARCHAR(255),
    settings JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes for performance
    INDEX idx_quiz_games_chat_id (chat_id),
    INDEX idx_quiz_games_status (status),
    INDEX idx_quiz_games_created_at (created_at),
    INDEX idx_quiz_games_winner (winner)
);

-- Quiz questions bank
CREATE TABLE IF NOT EXISTS quiz_questions (
    id SERIAL PRIMARY KEY,
    category VARCHAR(255) NOT NULL,
    question TEXT NOT NULL,
    options JSONB NOT NULL, -- Array of answer options
    correct_answer INTEGER NOT NULL, -- Index of correct option
    difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
    time_limit INTEGER DEFAULT 30,
    explanation TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    
    -- Constraints
    CONSTRAINT quiz_questions_difficulty_check 
        CHECK (difficulty IN ('easy', 'medium', 'hard')),
    CONSTRAINT quiz_questions_correct_answer_check 
        CHECK (correct_answer >= 0 AND correct_answer <= 9),
    CONSTRAINT quiz_questions_time_limit_check 
        CHECK (time_limit > 0 AND time_limit <= 300),
    
    -- Indexes
    INDEX idx_quiz_questions_category (category),
    INDEX idx_quiz_questions_difficulty (difficulty),
    INDEX idx_quiz_questions_active (is_active)
);

-- Quiz game analytics
CREATE TABLE IF NOT EXISTS quiz_game_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES quiz_games(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    final_score INTEGER DEFAULT 0,
    questions_answered INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    average_response_time_ms INTEGER DEFAULT 0,
    was_eliminated BOOLEAN DEFAULT false,
    elimination_round INTEGER,
    bonus_questions_correct INTEGER DEFAULT 0,
    mwor_tokens_earned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(game_id, user_id),
    
    -- Indexes
    INDEX idx_quiz_analytics_game_id (game_id),
    INDEX idx_quiz_analytics_user_id (user_id),
    INDEX idx_quiz_analytics_score (final_score),
    INDEX idx_quiz_analytics_created_at (created_at)
);

-- Quiz player responses (for detailed analysis)
CREATE TABLE IF NOT EXISTS quiz_player_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES quiz_games(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    question_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    selected_answer INTEGER NOT NULL,
    correct_answer INTEGER NOT NULL,
    is_correct BOOLEAN NOT NULL,
    response_time_ms INTEGER NOT NULL,
    points_earned INTEGER DEFAULT 0,
    round_number INTEGER NOT NULL,
    is_bonus_question BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(game_id, user_id, question_id),
    
    -- Indexes
    INDEX idx_quiz_responses_game_user (game_id, user_id),
    INDEX idx_quiz_responses_question (question_id),
    INDEX idx_quiz_responses_correctness (is_correct),
    INDEX idx_quiz_responses_round (round_number),
    INDEX idx_quiz_responses_bonus (is_bonus_question)
);

-- Quiz categories configuration
CREATE TABLE IF NOT EXISTS quiz_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    question_count INTEGER DEFAULT 0,
    difficulty_distribution JSONB DEFAULT '{"easy": 0, "medium": 0, "hard": 0}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes
    INDEX idx_quiz_categories_active (is_active),
    INDEX idx_quiz_categories_name (name)
);

-- Quiz elimination rounds tracking
CREATE TABLE IF NOT EXISTS quiz_elimination_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES quiz_games(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    eliminated_players JSONB NOT NULL DEFAULT '[]',
    remaining_players JSONB NOT NULL DEFAULT '[]',
    elimination_method VARCHAR(50) NOT NULL,
    vrf_seed VARCHAR(255),
    elimination_criteria JSONB,
    timestamp TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(game_id, round_number),
    CONSTRAINT elimination_method_check 
        CHECK (elimination_method IN ('score_based', 'time_based', 'random', 'hybrid')),
    
    -- Indexes
    INDEX idx_quiz_eliminations_game (game_id),
    INDEX idx_quiz_eliminations_round (round_number),
    INDEX idx_quiz_eliminations_method (elimination_method)
);

-- Quiz game leaderboard (materialized view for performance)
CREATE MATERIALIZED VIEW quiz_global_leaderboard AS
SELECT 
    user_id,
    username,
    COUNT(*) as games_played,
    SUM(CASE WHEN was_eliminated = false THEN 1 ELSE 0 END) as games_won,
    AVG(final_score) as average_score,
    SUM(correct_answers) as total_correct_answers,
    SUM(questions_answered) as total_questions_answered,
    CASE 
        WHEN SUM(questions_answered) > 0 
        THEN (SUM(correct_answers)::FLOAT / SUM(questions_answered)::FLOAT) * 100 
        ELSE 0 
    END as accuracy_percentage,
    AVG(average_response_time_ms) as avg_response_time,
    SUM(mwor_tokens_earned) as total_mwor_earned,
    MAX(created_at) as last_played
FROM quiz_game_analytics
GROUP BY user_id, username
ORDER BY games_won DESC, average_score DESC, accuracy_percentage DESC;

-- Create index on materialized view
CREATE UNIQUE INDEX idx_quiz_leaderboard_user ON quiz_global_leaderboard(user_id);
CREATE INDEX idx_quiz_leaderboard_games_won ON quiz_global_leaderboard(games_won);
CREATE INDEX idx_quiz_leaderboard_avg_score ON quiz_global_leaderboard(average_score);

-- Triggers for updating question count in categories
CREATE OR REPLACE FUNCTION update_category_question_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- Update question count and difficulty distribution
        UPDATE quiz_categories 
        SET 
            question_count = (
                SELECT COUNT(*) 
                FROM quiz_questions 
                WHERE category = NEW.category AND is_active = true
            ),
            difficulty_distribution = (
                SELECT jsonb_build_object(
                    'easy', COUNT(*) FILTER (WHERE difficulty = 'easy'),
                    'medium', COUNT(*) FILTER (WHERE difficulty = 'medium'),
                    'hard', COUNT(*) FILTER (WHERE difficulty = 'hard')
                )
                FROM quiz_questions 
                WHERE category = NEW.category AND is_active = true
            ),
            updated_at = NOW()
        WHERE name = NEW.category;
        
        -- Insert category if it doesn't exist
        INSERT INTO quiz_categories (name, question_count, difficulty_distribution)
        SELECT NEW.category, 1, 
               jsonb_build_object(NEW.difficulty, 1, 
                                CASE WHEN NEW.difficulty != 'easy' THEN 'easy' ELSE 'medium' END, 0,
                                CASE WHEN NEW.difficulty != 'hard' THEN 'hard' ELSE 'medium' END, 0)
        WHERE NOT EXISTS (SELECT 1 FROM quiz_categories WHERE name = NEW.category);
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Update counts after deletion
        UPDATE quiz_categories 
        SET 
            question_count = (
                SELECT COUNT(*) 
                FROM quiz_questions 
                WHERE category = OLD.category AND is_active = true
            ),
            difficulty_distribution = (
                SELECT jsonb_build_object(
                    'easy', COUNT(*) FILTER (WHERE difficulty = 'easy'),
                    'medium', COUNT(*) FILTER (WHERE difficulty = 'medium'),
                    'hard', COUNT(*) FILTER (WHERE difficulty = 'hard')
                )
                FROM quiz_questions 
                WHERE category = OLD.category AND is_active = true
            ),
            updated_at = NOW()
        WHERE name = OLD.category;
        
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger
CREATE TRIGGER trigger_update_category_question_count
    AFTER INSERT OR UPDATE OR DELETE ON quiz_questions
    FOR EACH ROW EXECUTE FUNCTION update_category_question_count();

-- Function to refresh leaderboard
CREATE OR REPLACE FUNCTION refresh_quiz_leaderboard()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_global_leaderboard;
END;
$$ LANGUAGE plpgsql;

-- Auto-refresh leaderboard trigger
CREATE OR REPLACE FUNCTION trigger_refresh_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
    -- Refresh leaderboard asynchronously (in practice, you'd use a job queue)
    PERFORM refresh_quiz_leaderboard();
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_quiz_analytics_leaderboard_refresh
    AFTER INSERT OR UPDATE OR DELETE ON quiz_game_analytics
    FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_leaderboard();

-- Insert default categories
INSERT INTO quiz_categories (name, description) VALUES
('General Knowledge', 'Broad range of common knowledge questions'),
('Science & Technology', 'Questions about science, technology, and innovations'),
('History', 'Historical events, figures, and timelines'),
('Sports', 'Sports trivia, athletes, and competitions'),
('Entertainment', 'Movies, music, TV shows, and celebrities'),
('Geography', 'Countries, capitals, landmarks, and physical geography'),
('Literature', 'Books, authors, and literary works'),
('Mathematics', 'Math problems, concepts, and famous mathematicians'),
('Art & Culture', 'Art, artists, cultural movements, and traditions'),
('Current Events', 'Recent news, trends, and contemporary topics')
ON CONFLICT (name) DO NOTHING;

-- Insert sample questions for testing
INSERT INTO quiz_questions (category, question, options, correct_answer, difficulty, explanation) VALUES
('General Knowledge', 'What is the largest planet in our solar system?', 
 '["Earth", "Jupiter", "Saturn", "Neptune"]', 1, 'easy',
 'Jupiter is the largest planet in our solar system by both mass and volume.'),

('General Knowledge', 'Which element has the chemical symbol "Au"?', 
 '["Silver", "Gold", "Aluminum", "Argon"]', 1, 'medium',
 'Gold has the chemical symbol "Au" from the Latin word "aurum".'),

('Science & Technology', 'What does CPU stand for?', 
 '["Central Processing Unit", "Computer Processing Unit", "Central Program Unit", "Computer Program Unit"]', 
 0, 'easy', 'CPU stands for Central Processing Unit.'),

('Science & Technology', 'What is the speed of light in vacuum?', 
 '["299,792,458 m/s", "300,000,000 m/s", "299,000,000 m/s", "298,792,458 m/s"]', 
 0, 'hard', 'The speed of light in vacuum is exactly 299,792,458 meters per second.'),

('History', 'Who was the first President of the United States?', 
 '["John Adams", "George Washington", "Thomas Jefferson", "Benjamin Franklin"]', 
 1, 'easy', 'George Washington was the first President of the United States.'),

('Mathematics', 'What is the value of π (pi) to 3 decimal places?', 
 '["3.141", "3.142", "3.140", "3.143"]', 0, 'medium',
 'Pi (π) is approximately 3.141592..., so to 3 decimal places it is 3.142.'),

('Sports', 'How many players are on a basketball team on the court at once?', 
 '["4", "5", "6", "7"]', 1, 'easy',
 'A basketball team has 5 players on the court at any given time.'),

('Entertainment', 'Which movie won the Academy Award for Best Picture in 2020?', 
 '["1917", "Joker", "Parasite", "Once Upon a Time in Hollywood"]', 2, 'medium',
 'Parasite won the Academy Award for Best Picture in 2020.'),

('Geography', 'What is the capital of Australia?', 
 '["Sydney", "Melbourne", "Canberra", "Perth"]', 2, 'medium',
 'Canberra is the capital city of Australia, not Sydney or Melbourne.'),

('Literature', 'Who wrote the novel "Pride and Prejudice"?', 
 '["Charlotte Brontë", "Jane Austen", "Emily Dickinson", "Virginia Woolf"]', 1, 'easy',
 'Jane Austen wrote "Pride and Prejudice", published in 1813.')
ON CONFLICT DO NOTHING;

-- Update triggers timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update timestamp triggers
CREATE TRIGGER update_quiz_games_updated_at 
    BEFORE UPDATE ON quiz_games 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quiz_questions_updated_at 
    BEFORE UPDATE ON quiz_questions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quiz_categories_updated_at 
    BEFORE UPDATE ON quiz_categories 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE quiz_games IS 'Main table storing quiz game instances with sophisticated elimination algorithms';
COMMENT ON TABLE quiz_questions IS 'Question bank for quiz games with categorization and difficulty levels';
COMMENT ON TABLE quiz_game_analytics IS 'Player performance analytics for each game';
COMMENT ON TABLE quiz_player_responses IS 'Detailed response tracking for advanced analytics';
COMMENT ON TABLE quiz_categories IS 'Quiz categories configuration and statistics';
COMMENT ON TABLE quiz_elimination_rounds IS 'Tracking of elimination rounds with VRF fairness';
COMMENT ON MATERIALIZED VIEW quiz_global_leaderboard IS 'Global leaderboard for quiz game performance';

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_app_user;
-- GRANT ALL PRIVILEGES ON quiz_global_leaderboard TO your_app_user;