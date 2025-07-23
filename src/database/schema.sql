-- Raffle Hub v4 Database Schema
-- Enhanced user system with profiles, gamification, and referrals

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Game metrics table for analytics
CREATE TABLE IF NOT EXISTS game_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id VARCHAR(255) NOT NULL UNIQUE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  player_count INT NOT NULL DEFAULT 0,
  max_number INT NOT NULL,
  duration_seconds INT,
  is_paid BOOLEAN DEFAULT false,
  entry_fee DECIMAL(20, 8),
  prize_pool DECIMAL(20, 8),
  system_fee DECIMAL(20, 8),
  winners_count INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for game metrics
CREATE INDEX idx_game_metrics_status ON game_metrics(status);
CREATE INDEX idx_game_metrics_created_at ON game_metrics(created_at);
CREATE INDEX idx_game_metrics_is_paid ON game_metrics(is_paid);

-- Player analytics table
CREATE TABLE IF NOT EXISTS player_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(255),
  games_played INT DEFAULT 0,
  games_won INT DEFAULT 0,
  total_spent DECIMAL(20, 8) DEFAULT 0,
  total_won DECIMAL(20, 8) DEFAULT 0,
  last_active TIMESTAMPTZ,
  wallet_address VARCHAR(255),
  wallet_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for player analytics
CREATE INDEX idx_player_analytics_user_id ON player_analytics(user_id);
CREATE INDEX idx_player_analytics_last_active ON player_analytics(last_active);

-- Transaction logs table
CREATE TABLE IF NOT EXISTS transaction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type VARCHAR(50) NOT NULL, -- payment, refund, prize_distribution
  user_id VARCHAR(255),
  game_id VARCHAR(255),
  payment_id VARCHAR(255),
  amount DECIMAL(20, 8) NOT NULL,
  token VARCHAR(50) DEFAULT 'MWOR',
  status VARCHAR(50) NOT NULL, -- pending, confirmed, failed, refunded
  blockchain_hash VARCHAR(255),
  from_address VARCHAR(255),
  to_address VARCHAR(255),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for transaction logs
CREATE INDEX idx_transaction_logs_user_id ON transaction_logs(user_id);
CREATE INDEX idx_transaction_logs_game_id ON transaction_logs(game_id);
CREATE INDEX idx_transaction_logs_payment_id ON transaction_logs(payment_id);
CREATE INDEX idx_transaction_logs_status ON transaction_logs(status);
CREATE INDEX idx_transaction_logs_created_at ON transaction_logs(created_at);

-- System events table for monitoring
CREATE TABLE IF NOT EXISTS system_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
  component VARCHAR(100),
  message TEXT NOT NULL,
  details JSONB,
  error_stack TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_by VARCHAR(255),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for system events
CREATE INDEX idx_system_events_severity ON system_events(severity);
CREATE INDEX idx_system_events_resolved ON system_events(resolved);
CREATE INDEX idx_system_events_created_at ON system_events(created_at);
CREATE INDEX idx_system_events_event_type ON system_events(event_type);

-- Bot configuration table
CREATE TABLE IF NOT EXISTS bot_configuration (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  category VARCHAR(100),
  is_sensitive BOOLEAN DEFAULT false,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(255) NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  actor_username VARCHAR(255),
  actor_ip VARCHAR(45),
  target_type VARCHAR(100),
  target_id VARCHAR(255),
  old_value JSONB,
  new_value JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for audit logs
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- API keys table for service authentication
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  permissions JSONB,
  rate_limit INT DEFAULT 1000,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  session_token VARCHAR(255) NOT NULL UNIQUE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for user sessions
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_session_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name VARCHAR(255) NOT NULL,
  metric_value DECIMAL(20, 8) NOT NULL,
  unit VARCHAR(50),
  component VARCHAR(100),
  tags JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance metrics
CREATE INDEX idx_performance_metrics_name ON performance_metrics(metric_name);
CREATE INDEX idx_performance_metrics_timestamp ON performance_metrics(timestamp);
CREATE INDEX idx_performance_metrics_component ON performance_metrics(component);

-- Alert configurations table
CREATE TABLE IF NOT EXISTS alert_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  condition VARCHAR(50) NOT NULL, -- greater_than, less_than, equals
  threshold DECIMAL(20, 8) NOT NULL,
  time_window_minutes INT DEFAULT 5,
  notification_channels JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Game participants table (for detailed tracking)
CREATE TABLE IF NOT EXISTS game_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  username VARCHAR(255),
  selected_number INT,
  elimination_round INT,
  is_winner BOOLEAN DEFAULT false,
  prize_amount DECIMAL(20, 8),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  eliminated_at TIMESTAMPTZ,
  UNIQUE(game_id, user_id)
);

-- Create indexes for game participants
CREATE INDEX idx_game_participants_game_id ON game_participants(game_id);
CREATE INDEX idx_game_participants_user_id ON game_participants(user_id);
CREATE INDEX idx_game_participants_is_winner ON game_participants(is_winner);

-- Wallet verifications table
CREATE TABLE IF NOT EXISTS wallet_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  challenge_message TEXT NOT NULL,
  signature TEXT,
  status VARCHAR(50) DEFAULT 'pending', -- pending, verified, failed, expired
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for wallet verifications
CREATE INDEX idx_wallet_verifications_user_id ON wallet_verifications(user_id);
CREATE INDEX idx_wallet_verifications_status ON wallet_verifications(status);
CREATE INDEX idx_wallet_verifications_wallet_address ON wallet_verifications(wallet_address);

-- Scheduled tasks table
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name VARCHAR(255) NOT NULL,
  task_type VARCHAR(100) NOT NULL,
  cron_expression VARCHAR(100),
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(50),
  last_run_error TEXT,
  is_active BOOLEAN DEFAULT true,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add update triggers to relevant tables
CREATE TRIGGER update_game_metrics_updated_at BEFORE UPDATE ON game_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_player_analytics_updated_at BEFORE UPDATE ON player_analytics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transaction_logs_updated_at BEFORE UPDATE ON transaction_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_configuration_updated_at BEFORE UPDATE ON bot_configuration
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alert_configurations_updated_at BEFORE UPDATE ON alert_configurations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_tasks_updated_at BEFORE UPDATE ON scheduled_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE OR REPLACE VIEW active_games AS
SELECT 
  gm.*,
  COUNT(gp.id) as current_players
FROM game_metrics gm
LEFT JOIN game_participants gp ON gm.game_id = gp.game_id
WHERE gm.status IN ('pending', 'in_progress')
GROUP BY gm.id;

CREATE OR REPLACE VIEW player_leaderboard AS
SELECT 
  pa.*,
  CASE 
    WHEN pa.games_played > 0 THEN pa.games_won::DECIMAL / pa.games_played::DECIMAL
    ELSE 0
  END as win_rate,
  pa.total_won - pa.total_spent as net_profit
FROM player_analytics pa
ORDER BY pa.games_won DESC, pa.games_played DESC;

CREATE OR REPLACE VIEW daily_revenue AS
SELECT 
  DATE(created_at) as date,
  COUNT(DISTINCT game_id) as games_count,
  SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END) as revenue,
  COUNT(DISTINCT user_id) as unique_players
FROM transaction_logs
WHERE transaction_type = 'payment'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Indexes for performance optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_logs_date 
ON transaction_logs(DATE(created_at));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_metrics_date 
ON game_metrics(DATE(created_at));

-- Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO lottery_bot_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lottery_bot_user;