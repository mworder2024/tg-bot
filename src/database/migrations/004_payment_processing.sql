-- Payment requests tracking
CREATE TABLE IF NOT EXISTS payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    game_id UUID REFERENCES games(id),
    wallet_address VARCHAR(44) NOT NULL,
    amount DECIMAL(20, 9) NOT NULL,
    token_mint VARCHAR(44) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN (
        'initiated', 'awaiting_payment', 'confirming', 
        'confirmed', 'distributing', 'completed', 
        'failed', 'refunded', 'expired'
    )),
    payment_signature VARCHAR(88),
    treasury_signature VARCHAR(88),
    reference_key VARCHAR(32) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Payment state transitions log
CREATE TABLE IF NOT EXISTS payment_state_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES payment_requests(id) ON DELETE CASCADE,
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment confirmations tracking
CREATE TABLE IF NOT EXISTS payment_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES payment_requests(id) ON DELETE CASCADE,
    transaction_signature VARCHAR(88) NOT NULL UNIQUE,
    block_height BIGINT,
    confirmations INT DEFAULT 0,
    amount DECIMAL(20, 9) NOT NULL,
    from_address VARCHAR(44) NOT NULL,
    to_address VARCHAR(44) NOT NULL,
    confirmed_at TIMESTAMP,
    raw_transaction JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Treasury distributions
CREATE TABLE IF NOT EXISTS treasury_distributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES payment_requests(id),
    game_id UUID REFERENCES games(id),
    amount DECIMAL(20, 9) NOT NULL,
    token_mint VARCHAR(44) NOT NULL,
    transaction_signature VARCHAR(88) UNIQUE,
    status VARCHAR(20) CHECK (status IN ('pending', 'completed', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Refunds tracking
CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES payment_requests(id),
    user_id BIGINT NOT NULL,
    amount DECIMAL(20, 9) NOT NULL,
    token_mint VARCHAR(44) NOT NULL,
    reason VARCHAR(255),
    transaction_signature VARCHAR(88),
    status VARCHAR(20) CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'failed')),
    approved_by VARCHAR(255),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_payment_requests_user ON payment_requests(user_id);
CREATE INDEX idx_payment_requests_game ON payment_requests(game_id);
CREATE INDEX idx_payment_requests_status ON payment_requests(status);
CREATE INDEX idx_payment_requests_reference ON payment_requests(reference_key);
CREATE INDEX idx_payment_requests_expires ON payment_requests(expires_at) WHERE status IN ('initiated', 'awaiting_payment');

CREATE INDEX idx_payment_state_payment ON payment_state_logs(payment_id);
CREATE INDEX idx_payment_state_created ON payment_state_logs(created_at);

CREATE INDEX idx_payment_confirmations_sig ON payment_confirmations(transaction_signature);
CREATE INDEX idx_payment_confirmations_payment ON payment_confirmations(payment_id);

CREATE INDEX idx_treasury_distributions_payment ON treasury_distributions(payment_id);
CREATE INDEX idx_treasury_distributions_game ON treasury_distributions(game_id);
CREATE INDEX idx_treasury_distributions_status ON treasury_distributions(status);

CREATE INDEX idx_refunds_payment ON refunds(payment_id);
CREATE INDEX idx_refunds_user ON refunds(user_id);
CREATE INDEX idx_refunds_status ON refunds(status);

-- Triggers for updated_at
CREATE TRIGGER update_payment_requests_updated_at BEFORE UPDATE ON payment_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for monitoring
CREATE VIEW active_payments AS
SELECT 
    pr.*,
    EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)) as seconds_remaining,
    vw.username,
    g.chat_id as game_chat_id
FROM payment_requests pr
LEFT JOIN verified_wallets vw ON pr.user_id = vw.user_id AND pr.wallet_address = vw.wallet_address
LEFT JOIN games g ON pr.game_id = g.id
WHERE pr.status IN ('initiated', 'awaiting_payment', 'confirming')
    AND pr.expires_at > CURRENT_TIMESTAMP;

CREATE VIEW payment_statistics AS
SELECT 
    DATE_TRUNC('day', created_at) as date,
    COUNT(*) as total_payments,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_payments,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments,
    COUNT(CASE WHEN status = 'refunded' THEN 1 END) as refunded_payments,
    SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_volume,
    AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) as avg_payment_amount
FROM payment_requests
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

-- Function to calculate treasury fee
CREATE OR REPLACE FUNCTION calculate_treasury_fee(payment_amount DECIMAL)
RETURNS DECIMAL AS $$
BEGIN
    RETURN payment_amount * 0.10; -- 10% fee
END;
$$ LANGUAGE plpgsql;

-- Function to update payment status with logging
CREATE OR REPLACE FUNCTION update_payment_status(
    p_payment_id UUID,
    p_new_status VARCHAR(50),
    p_reason TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_status VARCHAR(50);
BEGIN
    -- Get current status
    SELECT status INTO v_current_status
    FROM payment_requests
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found: %', p_payment_id;
    END IF;

    -- Update payment status
    UPDATE payment_requests
    SET status = p_new_status,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CASE 
            WHEN p_new_status IN ('completed', 'failed', 'refunded') 
            THEN CURRENT_TIMESTAMP 
            ELSE completed_at 
        END
    WHERE id = p_payment_id;

    -- Log state transition
    INSERT INTO payment_state_logs (payment_id, from_status, to_status, reason, metadata)
    VALUES (p_payment_id, v_current_status, p_new_status, p_reason, p_metadata);

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;