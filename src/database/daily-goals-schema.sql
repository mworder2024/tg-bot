-- Daily Goals System Extension for Raffle Hub v4
-- Adds daily tasks, check-in rewards, and streak bonuses

-- Daily goals definition table
CREATE TABLE daily_goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    goal_type VARCHAR(50) NOT NULL, -- 'social_share', 'ticket_purchase', 'twitter_post', 'referral', 'check_in', 'custom'
    requirement_value INTEGER DEFAULT 1, -- How many times task must be completed
    reward_xp INTEGER DEFAULT 0, -- XP reward for completion
    reward_bonus BIGINT DEFAULT 0, -- Bonus reward (in lamports) for completion
    icon_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_daily BOOLEAN DEFAULT TRUE, -- Whether this resets daily
    sort_order INTEGER DEFAULT 0,
    metadata JSONB, -- Additional configuration (e.g., required hashtags for Twitter)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_goal_type CHECK (goal_type IN (
        'social_share', 'ticket_purchase', 'twitter_post', 'referral', 
        'check_in', 'raffle_creation', 'community_engagement', 'profile_update'
    ))
);

-- User daily progress tracking
CREATE TABLE user_daily_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL REFERENCES daily_goals(id) ON DELETE CASCADE,
    progress_date DATE NOT NULL DEFAULT CURRENT_DATE,
    current_progress INTEGER DEFAULT 0, -- Current count towards goal
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    reward_claimed BOOLEAN DEFAULT FALSE,
    reward_claimed_at TIMESTAMP,
    
    CONSTRAINT unique_user_goal_date UNIQUE(user_id, goal_id, progress_date)
);

-- Daily check-in tracking and streak system
CREATE TABLE user_check_ins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    check_in_date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    streak_count INTEGER DEFAULT 1, -- Current streak at time of check-in
    reward_xp INTEGER DEFAULT 0, -- XP earned from this check-in
    reward_bonus BIGINT DEFAULT 0, -- Bonus earned from streak
    ip_address INET,
    user_agent TEXT,
    
    CONSTRAINT unique_user_checkin_date UNIQUE(user_id, check_in_date)
);

-- Daily rewards configuration
CREATE TABLE daily_rewards_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reward_type VARCHAR(50) NOT NULL, -- 'check_in', 'goal_completion', 'all_goals_bonus'
    min_streak INTEGER DEFAULT 1, -- Minimum streak for this reward
    max_streak INTEGER, -- Maximum streak (null = unlimited)
    base_xp INTEGER DEFAULT 0, -- Base XP reward
    base_bonus BIGINT DEFAULT 0, -- Base bonus reward (lamports)
    multiplier DECIMAL(3,2) DEFAULT 1.00, -- Multiplier for streak bonuses
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User streak history for analytics
CREATE TABLE user_streak_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    streak_start_date DATE NOT NULL,
    streak_end_date DATE, -- NULL if streak is ongoing
    streak_length INTEGER NOT NULL,
    streak_type VARCHAR(50) DEFAULT 'check_in', -- 'check_in', 'goals_completion'
    total_rewards_earned BIGINT DEFAULT 0,
    ended_reason VARCHAR(100), -- 'missed_day', 'manual_reset', null if ongoing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily goals completion summary (for quick analytics)
CREATE TABLE daily_completion_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_goals_available INTEGER DEFAULT 0,
    total_goals_completed INTEGER DEFAULT 0,
    completion_percentage DECIMAL(5,2) DEFAULT 0.00,
    total_xp_earned INTEGER DEFAULT 0,
    total_bonus_earned BIGINT DEFAULT 0,
    all_goals_bonus_earned BOOLEAN DEFAULT FALSE, -- Did they get the all-goals bonus?
    check_in_completed BOOLEAN DEFAULT FALSE,
    current_streak INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_user_summary_date UNIQUE(user_id, summary_date)
);

-- Indexes for performance
CREATE INDEX idx_user_daily_progress_user_date ON user_daily_progress(user_id, progress_date);
CREATE INDEX idx_user_daily_progress_goal ON user_daily_progress(goal_id);
CREATE INDEX idx_user_daily_progress_completed ON user_daily_progress(is_completed, progress_date);

CREATE INDEX idx_user_check_ins_user ON user_check_ins(user_id);
CREATE INDEX idx_user_check_ins_date ON user_check_ins(check_in_date);
CREATE INDEX idx_user_check_ins_streak ON user_check_ins(streak_count DESC);

CREATE INDEX idx_user_streak_history_user ON user_streak_history(user_id);
CREATE INDEX idx_user_streak_history_length ON user_streak_history(streak_length DESC);
CREATE INDEX idx_user_streak_history_ongoing ON user_streak_history(user_id, streak_end_date) WHERE streak_end_date IS NULL;

CREATE INDEX idx_daily_completion_summary_user_date ON daily_completion_summary(user_id, summary_date);
CREATE INDEX idx_daily_completion_summary_date ON daily_completion_summary(summary_date);

-- Functions for daily goals system

-- Function to calculate current user streak
CREATE OR REPLACE FUNCTION get_user_current_streak(target_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    current_streak INTEGER := 0;
    last_checkin_date DATE;
    check_date DATE;
    consecutive_days INTEGER := 0;
BEGIN
    -- Get the most recent check-in
    SELECT check_in_date INTO last_checkin_date
    FROM user_check_ins
    WHERE user_id = target_user_id
    ORDER BY check_in_date DESC
    LIMIT 1;
    
    -- If no check-ins, return 0
    IF last_checkin_date IS NULL THEN
        RETURN 0;
    END IF;
    
    -- If last check-in was not today or yesterday, streak is broken
    IF last_checkin_date < CURRENT_DATE - INTERVAL '1 day' THEN
        RETURN 0;
    END IF;
    
    -- Count consecutive days working backwards from most recent check-in
    check_date := last_checkin_date;
    
    LOOP
        -- Check if there's a check-in for this date
        IF EXISTS(SELECT 1 FROM user_check_ins WHERE user_id = target_user_id AND check_in_date = check_date) THEN
            consecutive_days := consecutive_days + 1;
            check_date := check_date - INTERVAL '1 day';
        ELSE
            EXIT;
        END IF;
    END LOOP;
    
    RETURN consecutive_days;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate check-in reward based on streak
CREATE OR REPLACE FUNCTION calculate_checkin_reward(streak_count INTEGER)
RETURNS TABLE(xp_reward INTEGER, bonus_reward BIGINT) AS $$
BEGIN
    -- Base rewards
    xp_reward := 50; -- Base 50 XP for checking in
    bonus_reward := 0;
    
    -- Streak bonuses
    IF streak_count >= 7 THEN
        xp_reward := xp_reward + 100; -- Weekly bonus
        bonus_reward := bonus_reward + 1000000; -- 0.001 SOL bonus
    END IF;
    
    IF streak_count >= 30 THEN
        xp_reward := xp_reward + 500; -- Monthly bonus
        bonus_reward := bonus_reward + 5000000; -- 0.005 SOL bonus
    END IF;
    
    IF streak_count >= 100 THEN
        xp_reward := xp_reward + 1000; -- 100-day milestone
        bonus_reward := bonus_reward + 10000000; -- 0.01 SOL bonus
    END IF;
    
    -- Add progressive streak multiplier (every 7 days adds 10% more XP)
    IF streak_count > 7 THEN
        xp_reward := xp_reward + (((streak_count / 7) * 10) * xp_reward / 100);
    END IF;
    
    RETURN QUERY SELECT xp_reward, bonus_reward;
END;
$$ LANGUAGE plpgsql;

-- Function to process daily check-in
CREATE OR REPLACE FUNCTION process_daily_checkin(
    target_user_id UUID,
    checkin_ip INET DEFAULT NULL,
    checkin_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    current_streak INTEGER,
    xp_earned INTEGER,
    bonus_earned BIGINT,
    is_new_record BOOLEAN
) AS $$
DECLARE
    today_date DATE := CURRENT_DATE;
    user_exists BOOLEAN;
    already_checked_in BOOLEAN;
    calculated_streak INTEGER;
    reward_xp INTEGER;
    reward_bonus BIGINT;
    previous_best_streak INTEGER;
    new_record BOOLEAN := FALSE;
BEGIN
    -- Check if user exists
    SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO user_exists;
    IF NOT user_exists THEN
        RETURN QUERY SELECT FALSE, 'User not found', 0, 0, 0::BIGINT, FALSE;
        RETURN;
    END IF;
    
    -- Check if already checked in today
    SELECT EXISTS(
        SELECT 1 FROM user_check_ins 
        WHERE user_id = target_user_id AND check_in_date = today_date
    ) INTO already_checked_in;
    
    IF already_checked_in THEN
        SELECT streak_count FROM user_check_ins 
        WHERE user_id = target_user_id AND check_in_date = today_date 
        INTO calculated_streak;
        
        RETURN QUERY SELECT FALSE, 'Already checked in today', 
                    calculated_streak, 0, 0::BIGINT, FALSE;
        RETURN;
    END IF;
    
    -- Calculate current streak (including today)
    calculated_streak := get_user_current_streak(target_user_id);
    
    -- If last check-in was yesterday, increment streak, otherwise start new streak
    IF EXISTS(
        SELECT 1 FROM user_check_ins 
        WHERE user_id = target_user_id 
        AND check_in_date = today_date - INTERVAL '1 day'
    ) THEN
        calculated_streak := calculated_streak + 1;
    ELSE
        calculated_streak := 1;
    END IF;
    
    -- Calculate rewards
    SELECT cr.xp_reward, cr.bonus_reward 
    INTO reward_xp, reward_bonus
    FROM calculate_checkin_reward(calculated_streak) cr;
    
    -- Check if this is a new record
    SELECT COALESCE(MAX(streak_length), 0) INTO previous_best_streak
    FROM user_streak_history
    WHERE user_id = target_user_id;
    
    IF calculated_streak > previous_best_streak THEN
        new_record := TRUE;
    END IF;
    
    -- Insert check-in record
    INSERT INTO user_check_ins (
        user_id, check_in_date, streak_count, reward_xp, reward_bonus,
        ip_address, user_agent
    ) VALUES (
        target_user_id, today_date, calculated_streak, reward_xp, reward_bonus,
        checkin_ip, checkin_user_agent
    );
    
    -- Update user XP
    UPDATE users 
    SET total_xp = total_xp + reward_xp,
        last_active = CURRENT_TIMESTAMP
    WHERE id = target_user_id;
    
    -- Log XP transaction
    INSERT INTO xp_transactions (user_id, amount, transaction_type, description, metadata)
    VALUES (
        target_user_id, reward_xp, 'daily_bonus', 
        'Daily check-in bonus (streak: ' || calculated_streak || ')',
        jsonb_build_object('streak_count', calculated_streak, 'bonus_amount', reward_bonus)
    );
    
    -- Update or create streak history
    -- End previous streak if there was a gap
    IF calculated_streak = 1 AND previous_best_streak > 0 THEN
        UPDATE user_streak_history 
        SET streak_end_date = today_date - INTERVAL '1 day',
            ended_reason = 'missed_day'
        WHERE user_id = target_user_id AND streak_end_date IS NULL;
    END IF;
    
    -- Create new streak record if starting fresh
    IF calculated_streak = 1 THEN
        INSERT INTO user_streak_history (user_id, streak_start_date, streak_length)
        VALUES (target_user_id, today_date, 1);
    ELSE
        -- Update existing ongoing streak
        UPDATE user_streak_history 
        SET streak_length = calculated_streak
        WHERE user_id = target_user_id AND streak_end_date IS NULL;
    END IF;
    
    RETURN QUERY SELECT TRUE, 'Check-in successful!', 
                calculated_streak, reward_xp, reward_bonus, new_record;
END;
$$ LANGUAGE plpgsql;

-- Function to update daily goal progress
CREATE OR REPLACE FUNCTION update_daily_goal_progress(
    target_user_id UUID,
    goal_type_param VARCHAR(50),
    increment_amount INTEGER DEFAULT 1,
    metadata_param JSONB DEFAULT NULL
)
RETURNS TABLE(
    goals_updated INTEGER,
    goals_completed INTEGER,
    total_xp_earned INTEGER,
    completed_goal_names TEXT[]
) AS $$
DECLARE
    today_date DATE := CURRENT_DATE;
    goal_record RECORD;
    progress_record RECORD;
    total_xp INTEGER := 0;
    updated_count INTEGER := 0;
    completed_count INTEGER := 0;
    completed_names TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Get all active goals of the specified type
    FOR goal_record IN 
        SELECT * FROM daily_goals 
        WHERE goal_type = goal_type_param AND is_active = TRUE
    LOOP
        -- Get or create progress record for today
        SELECT * INTO progress_record
        FROM user_daily_progress
        WHERE user_id = target_user_id 
        AND goal_id = goal_record.id 
        AND progress_date = today_date;
        
        IF progress_record.id IS NULL THEN
            -- Create new progress record
            INSERT INTO user_daily_progress (user_id, goal_id, progress_date, current_progress)
            VALUES (target_user_id, goal_record.id, today_date, increment_amount)
            RETURNING * INTO progress_record;
        ELSE
            -- Update existing progress
            UPDATE user_daily_progress 
            SET current_progress = current_progress + increment_amount
            WHERE id = progress_record.id
            RETURNING * INTO progress_record;
        END IF;
        
        updated_count := updated_count + 1;
        
        -- Check if goal is now completed
        IF progress_record.current_progress >= goal_record.requirement_value 
           AND NOT progress_record.is_completed THEN
            
            -- Mark as completed
            UPDATE user_daily_progress 
            SET is_completed = TRUE, completed_at = CURRENT_TIMESTAMP
            WHERE id = progress_record.id;
            
            -- Award XP
            UPDATE users 
            SET total_xp = total_xp + goal_record.reward_xp
            WHERE id = target_user_id;
            
            -- Log XP transaction
            INSERT INTO xp_transactions (user_id, amount, transaction_type, description, reference_id, metadata)
            VALUES (
                target_user_id, goal_record.reward_xp, 'daily_bonus',
                'Daily goal completed: ' || goal_record.name,
                goal_record.id, metadata_param
            );
            
            total_xp := total_xp + goal_record.reward_xp;
            completed_count := completed_count + 1;
            completed_names := array_append(completed_names, goal_record.name);
        END IF;
    END LOOP;
    
    RETURN QUERY SELECT updated_count, completed_count, total_xp, completed_names;
END;
$$ LANGUAGE plpgsql;

-- Insert default daily goals
INSERT INTO daily_goals (name, description, goal_type, requirement_value, reward_xp, reward_bonus, sort_order, metadata) VALUES
-- Core daily tasks as requested
('Social Media Share', 'Share a link on one of the social platforms', 'social_share', 1, 100, 0, 1, 
 jsonb_build_object('platforms', ARRAY['facebook', 'twitter', 'instagram', 'discord', 'telegram', 'snapchat', 'tiktok'])),

('Purchase Lottery Ticket', 'Purchase at least 1 lottery ticket', 'ticket_purchase', 1, 150, 0, 2, 
 jsonb_build_object('min_tickets', 1)),

('Twitter $MWOR Post', 'Make a Twitter/X post mentioning $MWOR', 'twitter_post', 1, 200, 1000000, 3,
 jsonb_build_object('required_hashtags', ARRAY['$MWOR'], 'platform', 'twitter')),

('Invite New User', 'Successfully invite 1 new user to the platform', 'referral', 1, 300, 2000000, 4,
 jsonb_build_object('must_register', true, 'bonus_for_referrer', true)),

('Daily Check-in', 'Log in to the platform', 'check_in', 1, 50, 0, 0,
 jsonb_build_object('streak_bonus', true, 'auto_complete', true)),

-- Additional suggested goals
('Create Raffle', 'Create your own lottery/raffle', 'raffle_creation', 1, 500, 5000000, 5,
 jsonb_build_object('min_prize_value', 1000000)), -- 0.001 SOL minimum

('Profile Update', 'Update your profile (bio, username, or picture)', 'profile_update', 1, 75, 0, 6,
 jsonb_build_object('fields', ARRAY['bio', 'username', 'profile_image'])),

('Community Engagement', 'Engage with 3 different raffles (view/subscribe)', 'community_engagement', 3, 125, 0, 7,
 jsonb_build_object('unique_raffles', true, 'engagement_types', ARRAY['view', 'subscribe', 'share'])),

-- Bonus weekly goals
('Weekly Social Warrior', 'Share on social media 5 times this week', 'social_share', 5, 500, 3000000, 8,
 jsonb_build_object('weekly_goal', true, 'reset_weekly', true)),

('Weekly High Roller', 'Purchase 10 lottery tickets this week', 'ticket_purchase', 10, 750, 5000000, 9,
 jsonb_build_object('weekly_goal', true, 'reset_weekly', true));

-- Insert daily reward configurations
INSERT INTO daily_rewards_config (reward_type, min_streak, max_streak, base_xp, base_bonus, multiplier, description) VALUES
('check_in', 1, 6, 50, 0, 1.00, 'Basic daily check-in reward'),
('check_in', 7, 13, 100, 1000000, 1.10, 'Weekly streak bonus'),
('check_in', 14, 29, 150, 2000000, 1.20, 'Bi-weekly streak bonus'),
('check_in', 30, 99, 300, 5000000, 1.50, 'Monthly streak bonus'),
('check_in', 100, NULL, 1000, 10000000, 2.00, 'Legendary streak bonus (100+ days)'),
('all_goals_bonus', 1, NULL, 1000, 10000000, 1.00, 'Bonus for completing all daily goals');

-- Create trigger for automatic daily summary updates
CREATE OR REPLACE FUNCTION update_daily_completion_summary()
RETURNS TRIGGER AS $$
DECLARE
    summary_exists BOOLEAN;
    total_available INTEGER;
    total_completed INTEGER;
    completion_pct DECIMAL(5,2);
    total_xp INTEGER;
    total_bonus BIGINT;
    all_bonus_earned BOOLEAN := FALSE;
    checkin_done BOOLEAN := FALSE;
    current_streak_count INTEGER;
BEGIN
    -- Check if summary exists for today
    SELECT EXISTS(
        SELECT 1 FROM daily_completion_summary 
        WHERE user_id = NEW.user_id AND summary_date = NEW.progress_date
    ) INTO summary_exists;
    
    -- Get totals for the day
    SELECT COUNT(*) INTO total_available
    FROM daily_goals WHERE is_active = TRUE AND is_daily = TRUE;
    
    SELECT COUNT(*), 
           COALESCE(SUM(dg.reward_xp), 0),
           COALESCE(SUM(dg.reward_bonus), 0)
    INTO total_completed, total_xp, total_bonus
    FROM user_daily_progress udp
    JOIN daily_goals dg ON udp.goal_id = dg.id
    WHERE udp.user_id = NEW.user_id 
    AND udp.progress_date = NEW.progress_date 
    AND udp.is_completed = TRUE;
    
    -- Calculate completion percentage
    IF total_available > 0 THEN
        completion_pct := (total_completed::DECIMAL / total_available::DECIMAL) * 100;
    ELSE
        completion_pct := 0;
    END IF;
    
    -- Check if all goals completed (bonus eligible)
    IF total_completed >= total_available AND total_available > 0 THEN
        all_bonus_earned := TRUE;
    END IF;
    
    -- Check if checked in today
    SELECT EXISTS(
        SELECT 1 FROM user_check_ins
        WHERE user_id = NEW.user_id AND check_in_date = NEW.progress_date
    ) INTO checkin_done;
    
    -- Get current streak
    current_streak_count := get_user_current_streak(NEW.user_id);
    
    IF summary_exists THEN
        -- Update existing summary
        UPDATE daily_completion_summary 
        SET total_goals_available = total_available,
            total_goals_completed = total_completed,
            completion_percentage = completion_pct,
            total_xp_earned = total_xp,
            total_bonus_earned = total_bonus,
            all_goals_bonus_earned = all_bonus_earned,
            check_in_completed = checkin_done,
            current_streak = current_streak_count
        WHERE user_id = NEW.user_id AND summary_date = NEW.progress_date;
    ELSE
        -- Create new summary
        INSERT INTO daily_completion_summary (
            user_id, summary_date, total_goals_available, total_goals_completed,
            completion_percentage, total_xp_earned, total_bonus_earned,
            all_goals_bonus_earned, check_in_completed, current_streak
        ) VALUES (
            NEW.user_id, NEW.progress_date, total_available, total_completed,
            completion_pct, total_xp, total_bonus, all_bonus_earned, 
            checkin_done, current_streak_count
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_daily_summary_on_progress_change
    AFTER INSERT OR UPDATE ON user_daily_progress
    FOR EACH ROW EXECUTE FUNCTION update_daily_completion_summary();

-- Create views for easy querying

-- User daily dashboard view
CREATE VIEW user_daily_dashboard AS
SELECT 
    u.id as user_id,
    u.username,
    u.display_name,
    dcs.summary_date,
    dcs.total_goals_available,
    dcs.total_goals_completed,
    dcs.completion_percentage,
    dcs.check_in_completed,
    dcs.current_streak,
    dcs.all_goals_bonus_earned,
    dcs.total_xp_earned as daily_xp_earned,
    
    -- Next streak milestone
    CASE 
        WHEN dcs.current_streak < 7 THEN 7 - dcs.current_streak
        WHEN dcs.current_streak < 30 THEN 30 - dcs.current_streak
        WHEN dcs.current_streak < 100 THEN 100 - dcs.current_streak
        ELSE NULL
    END as days_to_next_milestone,
    
    -- Goal progress details
    (
        SELECT json_agg(
            json_build_object(
                'goal_name', dg.name,
                'goal_description', dg.description,
                'requirement', dg.requirement_value,
                'current_progress', COALESCE(udp.current_progress, 0),
                'is_completed', COALESCE(udp.is_completed, false),
                'reward_xp', dg.reward_xp,
                'reward_bonus', dg.reward_bonus
            ) ORDER BY dg.sort_order
        )
        FROM daily_goals dg
        LEFT JOIN user_daily_progress udp ON (
            dg.id = udp.goal_id 
            AND udp.user_id = u.id 
            AND udp.progress_date = dcs.summary_date
        )
        WHERE dg.is_active = TRUE AND dg.is_daily = TRUE
    ) as goal_progress
    
FROM users u
LEFT JOIN daily_completion_summary dcs ON (
    u.id = dcs.user_id 
    AND dcs.summary_date = CURRENT_DATE
)
WHERE u.is_banned = FALSE;

-- Leaderboard view for streaks
CREATE VIEW daily_streak_leaderboard AS
SELECT 
    u.id,
    u.username,
    u.display_name,
    u.profile_image_url,
    get_user_current_streak(u.id) as current_streak,
    COALESCE(MAX(ush.streak_length), 0) as best_streak_ever,
    COUNT(uc.id) as total_checkins,
    u.total_xp,
    ROW_NUMBER() OVER (ORDER BY get_user_current_streak(u.id) DESC, u.total_xp DESC) as streak_rank
FROM users u
LEFT JOIN user_check_ins uc ON u.id = uc.user_id
LEFT JOIN user_streak_history ush ON u.id = ush.user_id
WHERE u.is_banned = FALSE
GROUP BY u.id, u.username, u.display_name, u.profile_image_url, u.total_xp
ORDER BY current_streak DESC, u.total_xp DESC;

-- Updated trigger for users table
CREATE TRIGGER update_users_updated_at_daily BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();