-- Wallet verification tracking
CREATE TABLE IF NOT EXISTS wallet_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    wallet_address VARCHAR(44) NOT NULL,
    verification_amount DECIMAL(20, 9) NOT NULL,
    verification_token VARCHAR(16) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'failed')),
    transaction_signature VARCHAR(88),
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, wallet_address, status)
);

-- Verified wallets (permanent record)
CREATE TABLE IF NOT EXISTS verified_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    username VARCHAR(255),
    wallet_address VARCHAR(44) NOT NULL UNIQUE,
    is_primary BOOLEAN DEFAULT false,
    verification_tx VARCHAR(88),
    last_balance_check TIMESTAMP,
    cached_balance DECIMAL(20, 9),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_wallet_verif_user ON wallet_verifications(user_id);
CREATE INDEX idx_wallet_verif_token ON wallet_verifications(verification_token);
CREATE INDEX idx_wallet_verif_status ON wallet_verifications(status, expires_at);
CREATE INDEX idx_wallet_verif_address ON wallet_verifications(wallet_address);

CREATE INDEX idx_verified_wallets_user ON verified_wallets(user_id);
CREATE INDEX idx_verified_wallets_primary ON verified_wallets(user_id, is_primary) WHERE is_primary = true;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_wallet_verifications_updated_at BEFORE UPDATE ON wallet_verifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_verified_wallets_updated_at BEFORE UPDATE ON verified_wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for active verifications
CREATE VIEW active_wallet_verifications AS
SELECT 
    wv.*,
    EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)) as seconds_remaining
FROM wallet_verifications wv
WHERE status = 'pending' 
    AND expires_at > CURRENT_TIMESTAMP;