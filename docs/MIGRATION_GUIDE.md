# Solana Integration Migration Guide

This guide explains how to migrate from the current centralized lottery system to the new Solana-based decentralized system.

## Overview

The migration introduces:
- On-chain game management using Solana smart contracts
- Escrow-based payment system using PDAs
- Verifiable random function (VRF) for fair draws
- Automatic prize distribution
- Web dashboard for monitoring

## Architecture Changes

### Before (Centralized)
```
User → Telegram Bot → Database → Manual Payment Processing
```

### After (Decentralized)
```
User → Telegram Bot → Solana Program → Automatic Escrow & Distribution
                    ↓
                Web Dashboard
```

## Migration Steps

### 1. Environment Setup

Add the following to your `.env` file:

```bash
# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
SOLANA_PROGRAM_ID=<your-program-id>
SOLANA_TREASURY_PDA=<treasury-pda>
MWOR_TOKEN_MINT=<mwor-token-address>
VRF_ORACLE_PUBKEY=<vrf-oracle-pubkey>
BOT_WALLET_KEY=<bot-wallet-private-key>

# Feature Flags
ENABLE_PAID_GAMES=true
ENABLE_BLOCKCHAIN=true
```

### 2. Deploy Solana Program

```bash
# Build the program
npm run build:program

# Deploy to devnet
npm run deploy:devnet

# This will output your program ID and update .env
```

### 3. Database Migration

Run the migration to add Solana fields:

```sql
-- Add Solana fields to games table
ALTER TABLE games ADD COLUMN IF NOT EXISTS chain_id VARCHAR(64);
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_pda VARCHAR(64);
ALTER TABLE games ADD COLUMN IF NOT EXISTS escrow_pda VARCHAR(64);
ALTER TABLE games ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS drawn_numbers INTEGER[];

-- Add index for chain_id
CREATE INDEX IF NOT EXISTS idx_games_chain_id ON games(chain_id);

-- Create wallet mapping table
CREATE TABLE IF NOT EXISTS user_wallets (
  user_id VARCHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 4. Code Updates

#### Replace GameService with EnhancedGameService

```typescript
// Before
import { GameService } from './services/game.service';

// After
import { EnhancedGameService } from './services/enhanced-game.service';
```

#### Update Bot Commands

```typescript
// Add new paid game command
import { PaidGameCommand } from './bot/commands/paid-game';

// Register command
bot.command('paidgame', (ctx) => paidGameCommand.handlePaidGame(ctx));

// Register callbacks
bot.action(/^join_paid:(.+)$/, (ctx) => {
  const gameId = ctx.match[1];
  return paidGameCommand.handleJoinPaidGame(ctx, gameId);
});
```

### 5. Initialize Services

```typescript
// Initialize Solana integration
await enhancedGameService.initialize();

// Start web dashboard
if (config.features.webDashboard) {
  await startWebServer();
}
```

## Testing

### 1. Local Testing

```bash
# Start local validator
solana-test-validator

# Run tests
npm run test:solana

# Test bot locally
npm run dev
```

### 2. Devnet Testing

```bash
# Ensure you have devnet SOL
solana airdrop 2 --url devnet

# Deploy to devnet
npm run deploy:devnet

# Test with real devnet
SOLANA_NETWORK=devnet npm run start
```

### 3. Test Scenarios

1. **Create Paid Game**
   ```
   /paidgame 1 10 2
   ```
   Creates game with 1 MWOR entry, 10 max players, 2 winners

2. **Join Game**
   - Click "Join Game" button
   - Scan QR code with wallet
   - Send payment with memo
   - Verify payment

3. **Number Selection**
   - Select unique number
   - Wait for elimination rounds

4. **Monitor Progress**
   - Check web dashboard at http://localhost:3000
   - View blockchain monitor
   - Check game state

## Monitoring

### Web Dashboard Pages

1. **Log Viewer** (`/logs`)
   - Real-time application logs
   - Filter by level and service
   - Search functionality

2. **Blockchain Monitor** (`/blockchain`)
   - Wallet balances
   - Payment tracking
   - Transaction history

3. **Game Monitor** (`/games`)
   - Active games
   - Player status
   - Prize distribution

### Metrics to Track

- Payment success rate
- Average game completion time
- Transaction fees
- Player retention
- Prize distribution accuracy

## Rollback Plan

If issues arise:

1. **Disable Blockchain Features**
   ```bash
   ENABLE_BLOCKCHAIN=false
   ENABLE_PAID_GAMES=false
   ```

2. **Use Original GameService**
   - Comment out EnhancedGameService
   - Revert to GameService

3. **Database Rollback**
   - Solana fields are nullable
   - No data loss for existing games

## Common Issues

### 1. Transaction Failures

**Issue**: "Transaction simulation failed"
**Solution**: Ensure wallet has SOL for fees and token account exists

### 2. Payment Not Detected

**Issue**: Payment sent but not recognized
**Solution**: Check memo is exact match, wait for confirmation

### 3. VRF Timeout

**Issue**: VRF oracle not responding
**Solution**: Check oracle configuration, use backup oracle

### 4. Escrow Balance Mismatch

**Issue**: Escrow doesn't match expected amount
**Solution**: Check for failed transactions, reconcile on-chain

## Security Considerations

1. **Private Keys**
   - Never commit bot wallet private key
   - Use environment variables
   - Rotate keys regularly

2. **Program Authority**
   - Use multisig for treasury
   - Limit bot wallet permissions
   - Monitor for unusual activity

3. **Payment Verification**
   - Always verify on-chain
   - Check transaction signatures
   - Validate amounts exactly

## Performance Optimization

1. **RPC Endpoints**
   - Use dedicated RPC for production
   - Implement request pooling
   - Cache frequently accessed data

2. **Transaction Batching**
   - Group similar operations
   - Use priority fees wisely
   - Monitor confirmation times

3. **Database Queries**
   - Index chain_id column
   - Cache game states in Redis
   - Use connection pooling

## Future Enhancements

1. **Multi-token Support**
   - Accept multiple SPL tokens
   - Dynamic pricing
   - Token swaps

2. **Advanced Games**
   - Progressive jackpots
   - Tournament modes
   - Referral rewards

3. **DAO Governance**
   - Community voting
   - Treasury management
   - Fee adjustments

## Support

- Documentation: [Link to docs]
- Discord: [Support channel]
- GitHub Issues: [Repository issues]

## Checklist

- [ ] Environment variables configured
- [ ] Solana program deployed
- [ ] Database migrated
- [ ] Bot code updated
- [ ] Web dashboard running
- [ ] Test transactions successful
- [ ] Monitoring active
- [ ] Team trained on new system
- [ ] Rollback plan documented
- [ ] Go-live date scheduled