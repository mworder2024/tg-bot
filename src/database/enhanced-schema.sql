-- Raffle Hub v4 Enhanced Database Schema
-- Complete user system with Solana wallet auth, profiles, gamification, and multi-tier referrals

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables if they exist (for fresh start)
DROP TABLE IF EXISTS referral_commissions CASCADE;
DROP TABLE IF EXISTS social_shares CASCADE;
DROP TABLE IF EXISTS xp_transactions CASCADE;
DROP TABLE IF EXISTS user_badges CASCADE;
DROP TABLE IF EXISTS badges CASCADE;
DROP TABLE IF EXISTS user_referrals CASCADE;
DROP TABLE IF EXISTS profile_images CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS raffle_tickets CASCADE;
DROP TABLE IF EXISTS raffles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table with enhanced profile features
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address VARCHAR(44) UNIQUE NOT NULL, -- Solana wallet address
    username VARCHAR(30) UNIQUE, -- Optional custom username
    display_name VARCHAR(50), -- Display name for UI
    email VARCHAR(255), -- Optional email
    bio TEXT, -- User bio (max 500 chars via app validation)
    
    -- Profile image
    profile_image_url TEXT, -- URL to profile image
    profile_image_hash VARCHAR(64), -- SHA-256 hash for integrity
    
    -- Account status
    is_verified BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    banned_until TIMESTAMP,
    
    -- Gamification
    total_xp BIGINT DEFAULT 0,
    current_level INTEGER DEFAULT 1,
    total_tickets_purchased INTEGER DEFAULT 0,
    total_amount_spent BIGINT DEFAULT 0, -- in lamports
    total_winnings BIGINT DEFAULT 0, -- in lamports
    total_wins INTEGER DEFAULT 0,
    
    -- Referral system
    referral_code VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_referral_code(), -- User's own referral code
    referred_by UUID REFERENCES users(id), -- Who referred this user
    referral_tier INTEGER DEFAULT 0, -- How many levels deep (0 = direct referral)
    total_referrals INTEGER DEFAULT 0, -- Direct referrals count
    total_referral_earnings BIGINT DEFAULT 0, -- Lifetime referral earnings
    
    -- Social shares tracking
    total_social_shares INTEGER DEFAULT 0,
    facebook_shares INTEGER DEFAULT 0,
    twitter_shares INTEGER DEFAULT 0,
    instagram_shares INTEGER DEFAULT 0,
    discord_shares INTEGER DEFAULT 0,
    telegram_shares INTEGER DEFAULT 0,
    snapchat_shares INTEGER DEFAULT 0,
    tiktok_shares INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_username CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9_]{3,30}$'),
    CONSTRAINT valid_email CHECK (email IS NULL OR email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
    CONSTRAINT valid_bio_length CHECK (bio IS NULL OR LENGTH(bio) <= 500),
    CONSTRAINT valid_display_name_length CHECK (display_name IS NULL OR LENGTH(display_name) <= 50)
);

-- Function to generate unique referral codes (must be created before table)
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
    code TEXT;
    done BOOLEAN := FALSE;
BEGIN
    WHILE NOT done LOOP
        -- Generate 8 character alphanumeric code
        code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
        
        -- Check if code already exists
        IF NOT EXISTS(SELECT 1 FROM users WHERE referral_code = code) THEN
            done := TRUE;
        END IF;
    END LOOP;
    
    RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Referral tracking table for detailed referral analytics
CREATE TABLE user_referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referral_code VARCHAR(20) NOT NULL,
    tier_level INTEGER NOT NULL DEFAULT 1, -- 1 = direct, 2 = second level, etc.
    commission_rate DECIMAL(5,4) NOT NULL, -- e.g., 0.1000 for 10%
    total_earnings BIGINT DEFAULT 0, -- Total earned from this referral
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_referral UNIQUE(referrer_id, referred_id),
    CONSTRAINT valid_tier_level CHECK (tier_level >= 1 AND tier_level <= 10),
    CONSTRAINT valid_commission_rate CHECK (commission_rate >= 0 AND commission_rate <= 1)
);

-- Badge definitions
CREATE TABLE badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    icon_url TEXT,
    badge_type VARCHAR(50) NOT NULL, -- 'lottery_entries', 'wins', 'referrals', 'social', 'special'
    category VARCHAR(50) NOT NULL, -- 'bronze', 'silver', 'gold', 'platinum', 'diamond'
    requirement_value INTEGER, -- Required count for automatic badges
    xp_reward INTEGER DEFAULT 0, -- XP awarded when badge is earned
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User badges (many-to-many relationship)
CREATE TABLE user_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    progress INTEGER DEFAULT 0, -- Current progress towards badge
    is_featured BOOLEAN DEFAULT FALSE, -- Show on profile
    
    CONSTRAINT unique_user_badge UNIQUE(user_id, badge_id)
);

-- XP transactions for detailed tracking
CREATE TABLE xp_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- XP amount (can be negative for penalties)
    transaction_type VARCHAR(50) NOT NULL, -- 'ticket_purchase', 'social_share', 'referral', 'badge_bonus', 'lottery_win'
    description TEXT,
    reference_id UUID, -- Reference to related entity (raffle_id, ticket_id, etc.)
    metadata JSONB, -- Additional data
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_transaction_type CHECK (transaction_type IN (
        'ticket_purchase', 'social_share', 'referral_bonus', 'badge_bonus', 
        'lottery_win', 'admin_adjustment', 'level_bonus', 'daily_bonus'
    ))
);

-- Social share tracking
CREATE TABLE social_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL, -- 'facebook', 'twitter', 'instagram', etc.
    content_type VARCHAR(50) NOT NULL, -- 'raffle', 'profile', 'win', 'general'
    content_id UUID, -- ID of shared content (raffle_id, etc.)
    share_url TEXT,
    xp_earned INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE, -- Whether share was verified
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_platform CHECK (platform IN (
        'facebook', 'twitter', 'instagram', 'discord', 'telegram', 'snapchat', 'tiktok'
    ))
);

-- Enhanced raffles table
CREATE TABLE raffles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    raffle_id BIGINT UNIQUE NOT NULL, -- On-chain raffle ID
    creator_id UUID NOT NULL REFERENCES users(id),
    
    -- Basic raffle info
    title VARCHAR(200) NOT NULL,
    description TEXT,
    prize_amount BIGINT NOT NULL, -- in lamports
    ticket_price BIGINT NOT NULL, -- in lamports
    max_tickets INTEGER NOT NULL,
    tickets_sold INTEGER DEFAULT 0,
    
    -- Timing
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'drawing', 'complete', 'cancelled'
    
    -- Winner info
    winner_id UUID REFERENCES users(id),
    winning_ticket_number INTEGER,
    drawn_at TIMESTAMP,
    distributed_at TIMESTAMP,
    
    -- Blockchain data
    on_chain_address VARCHAR(44), -- Raffle account PDA
    escrow_address VARCHAR(44), -- Escrow account PDA
    vrf_request_address VARCHAR(44), -- VRF request account
    transaction_signature VARCHAR(88), -- Creation transaction
    
    -- Metadata
    image_url TEXT,
    category VARCHAR(50),
    tags TEXT[], -- Array of tags
    
    CONSTRAINT valid_status CHECK (status IN ('active', 'drawing', 'complete', 'cancelled')),
    CONSTRAINT valid_ticket_data CHECK (tickets_sold <= max_tickets),
    CONSTRAINT valid_timing CHECK (end_time > start_time)
);

-- Raffle tickets
CREATE TABLE raffle_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    raffle_id UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_number INTEGER NOT NULL,
    purchase_price BIGINT NOT NULL, -- Price paid (in lamports)
    
    -- Blockchain data
    on_chain_address VARCHAR(44), -- Ticket account PDA
    transaction_signature VARCHAR(88), -- Purchase transaction
    
    -- Status
    is_winner BOOLEAN DEFAULT FALSE,
    is_refunded BOOLEAN DEFAULT FALSE,
    refund_amount BIGINT,
    refunded_at TIMESTAMP,
    
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_raffle_ticket UNIQUE(raffle_id, ticket_number)
);

-- Referral commissions tracking
CREATE TABLE referral_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_transaction_id UUID, -- The original transaction that generated commission
    source_type VARCHAR(50) NOT NULL, -- 'ticket_purchase', 'gamefi_purchase', etc.
    
    -- Commission details
    original_amount BIGINT NOT NULL, -- Original transaction amount
    commission_rate DECIMAL(5,4) NOT NULL, -- Rate applied
    commission_amount BIGINT NOT NULL, -- Commission earned
    tier_level INTEGER NOT NULL, -- Referral tier (1, 2, 3, etc.)
    
    -- Payment status
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'paid', 'cancelled'
    paid_at TIMESTAMP,
    payment_transaction VARCHAR(88), -- Blockchain transaction for payment
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_commission_status CHECK (status IN ('pending', 'paid', 'cancelled'))
);

-- User sessions for security
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    wallet_signature VARCHAR(255) NOT NULL, -- Original wallet signature
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profile image uploads tracking
CREATE TABLE profile_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    width INTEGER,
    height INTEGER,
    file_hash VARCHAR(64) NOT NULL, -- SHA-256 hash
    upload_ip INET,
    is_approved BOOLEAN DEFAULT FALSE,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_image_size CHECK (file_size <= 5242880), -- 5MB max
    CONSTRAINT valid_image_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT valid_dimensions CHECK (width <= 1024 AND height <= 1024)
);

-- Indexes for performance
CREATE INDEX idx_users_wallet_address ON users(wallet_address);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_total_xp ON users(total_xp DESC);

CREATE INDEX idx_user_referrals_referrer ON user_referrals(referrer_id);
CREATE INDEX idx_user_referrals_referred ON user_referrals(referred_id);
CREATE INDEX idx_user_referrals_tier ON user_referrals(tier_level);

CREATE INDEX idx_user_badges_user ON user_badges(user_id);
CREATE INDEX idx_user_badges_badge ON user_badges(badge_id);
CREATE INDEX idx_user_badges_earned ON user_badges(earned_at DESC);

CREATE INDEX idx_xp_transactions_user ON xp_transactions(user_id);
CREATE INDEX idx_xp_transactions_type ON xp_transactions(transaction_type);
CREATE INDEX idx_xp_transactions_created ON xp_transactions(created_at DESC);

CREATE INDEX idx_social_shares_user ON social_shares(user_id);
CREATE INDEX idx_social_shares_platform ON social_shares(platform);
CREATE INDEX idx_social_shares_created ON social_shares(created_at DESC);

CREATE INDEX idx_raffles_creator ON raffles(creator_id);
CREATE INDEX idx_raffles_status ON raffles(status);
CREATE INDEX idx_raffles_end_time ON raffles(end_time);
CREATE INDEX idx_raffles_created ON raffles(created_at DESC);

CREATE INDEX idx_raffle_tickets_raffle ON raffle_tickets(raffle_id);
CREATE INDEX idx_raffle_tickets_owner ON raffle_tickets(owner_id);
CREATE INDEX idx_raffle_tickets_purchased ON raffle_tickets(purchased_at DESC);

CREATE INDEX idx_referral_commissions_referrer ON referral_commissions(referrer_id);
CREATE INDEX idx_referral_commissions_referred ON referral_commissions(referred_user_id);
CREATE INDEX idx_referral_commissions_status ON referral_commissions(status);
CREATE INDEX idx_referral_commissions_tier ON referral_commissions(tier_level);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- Functions for automatic updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate user level from XP
CREATE OR REPLACE FUNCTION calculate_level_from_xp(xp_amount BIGINT)
RETURNS INTEGER AS $$
BEGIN
    -- Level formula: level = floor(sqrt(xp / 1000)) + 1
    -- Level 1: 0-999 XP, Level 2: 1000-3999 XP, Level 3: 4000-8999 XP, etc.
    RETURN FLOOR(SQRT(xp_amount / 1000.0)) + 1;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate XP required for next level
CREATE OR REPLACE FUNCTION xp_for_next_level(current_level INTEGER)
RETURNS INTEGER AS $$
BEGIN
    -- XP required for level = (level - 1)^2 * 1000
    RETURN (current_level * current_level) * 1000;
END;
$$ LANGUAGE plpgsql;

-- Function to update user level when XP changes
CREATE OR REPLACE FUNCTION update_user_level()
RETURNS TRIGGER AS $$
BEGIN
    NEW.current_level = calculate_level_from_xp(NEW.total_xp);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_level_on_xp_change BEFORE UPDATE OF total_xp ON users
    FOR EACH ROW EXECUTE FUNCTION update_user_level();

-- Function to create referral chain when new user signs up
CREATE OR REPLACE FUNCTION create_referral_chain()
RETURNS TRIGGER AS $$
DECLARE
    referrer_record RECORD;
    current_tier INTEGER := 1;
    current_rate DECIMAL(5,4);
    max_tiers INTEGER := 10;
BEGIN
    -- If user was referred by someone
    IF NEW.referred_by IS NOT NULL THEN
        -- Get the referrer
        SELECT * INTO referrer_record FROM users WHERE id = NEW.referred_by;
        
        IF referrer_record.id IS NOT NULL THEN
            -- Create direct referral (tier 1)
            current_rate := 0.1000; -- 10%
            
            INSERT INTO user_referrals (referrer_id, referred_id, referral_code, tier_level, commission_rate)
            VALUES (referrer_record.id, NEW.id, NEW.referral_code, current_tier, current_rate);
            
            -- Update referrer's total count
            UPDATE users SET total_referrals = total_referrals + 1 WHERE id = referrer_record.id;
            
            -- Create chain for higher tiers
            WHILE current_tier < max_tiers AND referrer_record.referred_by IS NOT NULL LOOP
                current_tier := current_tier + 1;
                current_rate := current_rate / 2; -- Halve the rate each tier
                
                -- Get next level referrer
                SELECT * INTO referrer_record FROM users WHERE id = referrer_record.referred_by;
                
                IF referrer_record.id IS NOT NULL AND current_rate >= 0.0125 THEN -- Minimum 1.25%
                    INSERT INTO user_referrals (referrer_id, referred_id, referral_code, tier_level, commission_rate)
                    VALUES (referrer_record.id, NEW.id, NEW.referral_code, current_tier, current_rate);
                ELSE
                    EXIT;
                END IF;
            END LOOP;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_referral_chain_trigger AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION create_referral_chain();

-- Insert default badges
INSERT INTO badges (name, description, badge_type, category, requirement_value, xp_reward) VALUES
-- Lottery entry badges
('First Timer', 'Purchased your first lottery ticket', 'lottery_entries', 'bronze', 1, 100),
('Getting Started', 'Purchased 5 lottery tickets', 'lottery_entries', 'bronze', 5, 250),
('Lottery Explorer', 'Purchased 10 lottery tickets', 'lottery_entries', 'bronze', 10, 500),
('Ticket Collector', 'Purchased 25 lottery tickets', 'lottery_entries', 'silver', 25, 1000),
('Lottery Enthusiast', 'Purchased 50 lottery tickets', 'lottery_entries', 'silver', 50, 2000),
('Dedicated Player', 'Purchased 100 lottery tickets', 'lottery_entries', 'gold', 100, 5000),
('Lottery Master', 'Purchased 250 lottery tickets', 'lottery_entries', 'gold', 250, 10000),
('Legendary Player', 'Purchased 500 lottery tickets', 'lottery_entries', 'platinum', 500, 20000),
('Ultimate Collector', 'Purchased 1000 lottery tickets', 'lottery_entries', 'diamond', 1000, 50000),

-- Win badges
('First Win', 'Won your first lottery', 'wins', 'bronze', 1, 500),
('Lucky Streak', 'Won 3 lotteries', 'wins', 'bronze', 3, 1500),
('Winner', 'Won 5 lotteries', 'wins', 'silver', 5, 2500),
('Champion', 'Won 10 lotteries', 'wins', 'silver', 10, 5000),
('Lottery Legend', 'Won 20 lotteries', 'wins', 'gold', 20, 15000),
('Unstoppable', 'Won 50 lotteries', 'wins', 'platinum', 50, 50000),
('Lottery God', 'Won 100 lotteries', 'wins', 'diamond', 100, 100000),

-- Referral badges
('Influencer', 'Referred your first friend', 'referrals', 'bronze', 1, 250),
('Networker', 'Referred 5 friends', 'referrals', 'bronze', 5, 1000),
('Community Builder', 'Referred 10 friends', 'referrals', 'silver', 10, 2500),
('Brand Ambassador', 'Referred 25 friends', 'referrals', 'gold', 25, 7500),
('Growth Master', 'Referred 50 friends', 'referrals', 'platinum', 50, 20000),
('Viral Legend', 'Referred 100 friends', 'referrals', 'diamond', 100, 50000),

-- Social sharing badges
('Social Butterfly', 'Shared 10 times on social media', 'social', 'bronze', 10, 200),
('Content Creator', 'Shared 50 times on social media', 'social', 'silver', 50, 1000),
('Viral Marketer', 'Shared 100 times on social media', 'social', 'gold', 100, 2500),
('Social Media Master', 'Shared 250 times on social media', 'social', 'platinum', 250, 7500);

-- Create a view for user leaderboard
CREATE VIEW user_leaderboard AS
SELECT 
    u.id,
    u.username,
    u.display_name,
    u.wallet_address,
    u.total_xp,
    u.current_level,
    u.total_wins,
    u.total_tickets_purchased,
    u.total_amount_spent,
    u.total_winnings,
    u.total_referrals,
    u.profile_image_url,
    ROW_NUMBER() OVER (ORDER BY u.total_xp DESC) as xp_rank,
    ROW_NUMBER() OVER (ORDER BY u.total_wins DESC) as wins_rank,
    COUNT(ub.badge_id) as total_badges
FROM users u
LEFT JOIN user_badges ub ON u.id = ub.user_id
WHERE u.is_banned = FALSE
GROUP BY u.id, u.username, u.display_name, u.wallet_address, u.total_xp, 
         u.current_level, u.total_wins, u.total_tickets_purchased, 
         u.total_amount_spent, u.total_winnings, u.total_referrals, u.profile_image_url
ORDER BY u.total_xp DESC;

-- Create view for referral analytics
CREATE VIEW referral_analytics AS
SELECT 
    u.id,
    u.username,
    u.display_name,
    u.referral_code,
    u.total_referrals,
    u.total_referral_earnings,
    COUNT(ur.id) as total_referral_chain,
    SUM(CASE WHEN ur.tier_level = 1 THEN 1 ELSE 0 END) as direct_referrals,
    SUM(CASE WHEN ur.tier_level = 2 THEN 1 ELSE 0 END) as second_tier_referrals,
    SUM(CASE WHEN ur.tier_level >= 3 THEN 1 ELSE 0 END) as deep_tier_referrals,
    AVG(ur.commission_rate) as avg_commission_rate
FROM users u
LEFT JOIN user_referrals ur ON u.id = ur.referrer_id
GROUP BY u.id, u.username, u.display_name, u.referral_code, u.total_referrals, u.total_referral_earnings
ORDER BY u.total_referral_earnings DESC;

-- Create view for badge progress
CREATE VIEW badge_progress AS
SELECT 
    u.id as user_id,
    u.username,
    b.id as badge_id,
    b.name as badge_name,
    b.description,
    b.badge_type,
    b.category,
    b.requirement_value,
    CASE 
        WHEN b.badge_type = 'lottery_entries' THEN u.total_tickets_purchased
        WHEN b.badge_type = 'wins' THEN u.total_wins
        WHEN b.badge_type = 'referrals' THEN u.total_referrals
        WHEN b.badge_type = 'social' THEN u.total_social_shares
        ELSE 0
    END as current_progress,
    CASE 
        WHEN ub.id IS NOT NULL THEN TRUE 
        ELSE FALSE 
    END as is_earned,
    ub.earned_at
FROM users u
CROSS JOIN badges b
LEFT JOIN user_badges ub ON u.id = ub.user_id AND b.id = ub.badge_id
WHERE b.is_active = TRUE
ORDER BY u.username, b.category, b.requirement_value;