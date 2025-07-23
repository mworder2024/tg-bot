-- Migration: Add Solana blockchain fields to games table
-- Date: 2024-01-13

-- Add Solana-specific columns
ALTER TABLE games 
ADD COLUMN IF NOT EXISTS chain_id VARCHAR(64),
ADD COLUMN IF NOT EXISTS game_pda VARCHAR(64),
ADD COLUMN IF NOT EXISTS escrow_pda VARCHAR(64),
ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS drawn_numbers INTEGER[];

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_games_chain_id ON games(chain_id);
CREATE INDEX IF NOT EXISTS idx_games_game_pda ON games(game_pda);
CREATE INDEX IF NOT EXISTS idx_games_status_paid ON games(status, is_paid);

-- Create user wallets table for Solana wallet mapping
CREATE TABLE IF NOT EXISTS user_wallets (
  user_id VARCHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_verified BOOLEAN DEFAULT FALSE,
  last_used TIMESTAMP
);

-- Add index on wallet address
CREATE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(wallet_address);

-- Create payment tracking table
CREATE TABLE IF NOT EXISTS blockchain_payments (
  id SERIAL PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  wallet_address VARCHAR(64) NOT NULL,
  transaction_signature VARCHAR(128) UNIQUE,
  amount DECIMAL(20, 6) NOT NULL,
  token_mint VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB,
  FOREIGN KEY (game_id) REFERENCES games(id),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'confirmed', 'failed', 'refunded'))
);

-- Add indexes for payment tracking
CREATE INDEX IF NOT EXISTS idx_blockchain_payments_game_id ON blockchain_payments(game_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_payments_user_id ON blockchain_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_payments_status ON blockchain_payments(status);
CREATE INDEX IF NOT EXISTS idx_blockchain_payments_signature ON blockchain_payments(transaction_signature);

-- Create VRF tracking table
CREATE TABLE IF NOT EXISTS vrf_results (
  id SERIAL PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  round_number INTEGER NOT NULL,
  random_value VARCHAR(64) NOT NULL,
  drawn_number INTEGER NOT NULL,
  submitted_at TIMESTAMP DEFAULT NOW(),
  transaction_signature VARCHAR(128),
  FOREIGN KEY (game_id) REFERENCES games(id),
  UNIQUE(game_id, round_number)
);

-- Add indexes for VRF results
CREATE INDEX IF NOT EXISTS idx_vrf_results_game_id ON vrf_results(game_id);

-- Create elimination tracking table
CREATE TABLE IF NOT EXISTS player_eliminations (
  id SERIAL PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  selected_number INTEGER NOT NULL,
  eliminated_round INTEGER,
  eliminated_at TIMESTAMP,
  is_winner BOOLEAN DEFAULT FALSE,
  prize_amount DECIMAL(20, 6),
  prize_claimed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (game_id) REFERENCES games(id),
  UNIQUE(game_id, user_id)
);

-- Add indexes for eliminations
CREATE INDEX IF NOT EXISTS idx_player_eliminations_game_id ON player_eliminations(game_id);
CREATE INDEX IF NOT EXISTS idx_player_eliminations_user_id ON player_eliminations(user_id);
CREATE INDEX IF NOT EXISTS idx_player_eliminations_winners ON player_eliminations(game_id, is_winner);

-- Update games table to support new statuses
ALTER TABLE games 
DROP CONSTRAINT IF EXISTS games_status_check;

ALTER TABLE games 
ADD CONSTRAINT games_status_check 
CHECK (status IN ('pending', 'active', 'playing', 'distributing', 'completed', 'cancelled'));

-- Add function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_user_wallets_updated_at 
BEFORE UPDATE ON user_wallets 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at();

-- Add comments for documentation
COMMENT ON COLUMN games.chain_id IS 'Solana blockchain game identifier';
COMMENT ON COLUMN games.game_pda IS 'Game Program Derived Address on Solana';
COMMENT ON COLUMN games.escrow_pda IS 'Escrow account PDA for holding game funds';
COMMENT ON COLUMN games.current_round IS 'Current elimination round number';
COMMENT ON COLUMN games.drawn_numbers IS 'Array of numbers drawn in elimination rounds';

COMMENT ON TABLE user_wallets IS 'Maps Telegram user IDs to Solana wallet addresses';
COMMENT ON TABLE blockchain_payments IS 'Tracks all blockchain payment transactions';
COMMENT ON TABLE vrf_results IS 'Stores VRF results for each game round';
COMMENT ON TABLE player_eliminations IS 'Tracks player eliminations and winner status';