# Paid Raffle Implementation Plan

## Quick Start Guide

This document provides step-by-step implementation tasks for the paid raffle system. Follow phases sequentially for best results.

## Phase 1: Foundation Setup (Days 1-3)

### Task 1.1: Update Dependencies
```bash
npm install @solana/web3.js @solana/spl-token bs58 tweetnacl @coral-xyz/anchor
npm install --save-dev @types/bs58
```

### Task 1.2: Create Core Infrastructure Files
- `src/blockchain/wallet-manager.ts` - Bot wallet management
- `src/blockchain/solana-service.ts` - Solana blockchain interface
- `src/blockchain/payment-service.ts` - Payment processing logic
- `src/database/paid-game-storage.ts` - Extended database for paid games
- `src/database/payment-storage.ts` - Payment tracking storage
- `src/database/wallet-storage.ts` - User wallet verification storage

### Task 1.3: Environment Configuration
Update `.env.example` with new variables:
```env
# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta
MWOR_TOKEN_MINT=

# Bot Wallet Configuration (populate after wallet generation)
BOT_WALLET_PRIVATE_KEY=
TREASURY_WALLET_PRIVATE_KEY=

# Payment Configuration
PAYMENT_TIMEOUT_MINUTES=15
MINIMUM_CONFIRMATION_COUNT=3
SYSTEM_FEE_PERCENTAGE=10

# Security
WALLET_ENCRYPTION_KEY=
VERIFICATION_MESSAGE_PREFIX=TelegramBot-Verify-
```

### Task 1.4: Type Definitions
Create `src/types/blockchain.ts` with all payment-related interfaces

## Phase 2: Wallet Generation & Management (Days 4-6)

### Task 2.1: Wallet Manager Implementation
```typescript
// Priority methods to implement:
- generateBotWallets()
- encryptPrivateKey()
- decryptPrivateKey()
- getWalletBalance()
- createPaymentRequest()
```

### Task 2.2: Wallet Security Setup
- Implement secure key storage
- Create wallet backup mechanism
- Add wallet balance monitoring
- Test wallet generation and encryption

### Task 2.3: Initial Wallet Generation Script
Create `scripts/generate-wallets.ts` for one-time setup:
```bash
npm run generate-wallets
```

## Phase 3: User Verification System (Days 7-9)

### Task 3.1: Verification Service
Implement `/verify` command flow:
1. Generate verification challenge message
2. Send signing instructions to user
3. Verify signature authenticity
4. Store verified wallet address

### Task 3.2: Verification Database
- User wallet storage
- Verification status tracking
- Verification history logging

### Task 3.3: Verification Testing
- Test signature verification
- Test duplicate wallet prevention
- Test verification expiry

## Phase 4: Payment Processing (Days 10-14)

### Task 4.1: Payment Request System
```typescript
// Core payment flow:
1. User joins paid game
2. Bot generates payment instruction
3. User sends MWOR tokens
4. Bot monitors blockchain
5. Confirms payment and entry
```

### Task 4.2: Blockchain Monitoring
- Real-time transaction monitoring
- Payment confirmation tracking
- Failed payment detection
- Timeout handling

### Task 4.3: Payment Status Management
- Payment state machine
- Status update notifications
- Payment verification retries
- Manual verification commands

## Phase 5: Paid Game Integration (Days 15-17)

### Task 5.1: Paid Game Creation
Implement `/create-paid` command:
- Parse `--ticket` parameter
- Validate entry fee amount
- Create paid game instance
- Announce payment requirements

### Task 5.2: Entry Processing
Modify `/join` command for paid games:
- Check wallet verification
- Generate payment request
- Send payment instructions
- Track payment status

### Task 5.3: Game State Management
- Separate paid/free game logic
- Payment phase timeout handling
- Entry confirmation flow

## Phase 6: Prize Distribution (Days 18-20)

### Task 6.1: Distribution Calculator
```typescript
// Prize calculation logic:
- Total pool from entry fees
- 10% system fee to treasury
- 90% distributed to winners
- Handle multiple winners
```

### Task 6.2: Automatic Distribution
- Winner token transfer
- Treasury fee transfer
- Transaction hash recording
- Distribution confirmation

### Task 6.3: Distribution Verification
- Verify successful transfers
- Handle failed distributions
- Retry mechanism for failures
- Manual distribution capability

## Phase 7: Error Handling & Edge Cases (Days 21-22)

### Task 7.1: Payment Error Handling
- Insufficient balance detection
- Wrong payment amount handling
- Network error recovery
- Transaction timeout processing

### Task 7.2: Refund System
- Automatic refund for cancelled games
- Manual refund capability
- Refund transaction tracking
- Refund notification system

### Task 7.3: Game Cancellation Logic
- Minimum player requirements
- Payment timeout handling
- Emergency cancellation
- Full refund processing

## Phase 8: Testing & Quality Assurance (Days 23-25)

### Task 8.1: Unit Tests
```bash
# Test files to create:
tests/wallet-manager.test.ts
tests/payment-service.test.ts
tests/verification-service.test.ts
tests/prize-distribution.test.ts
```

### Task 8.2: Integration Tests
- End-to-end payment flow
- Multi-user scenarios
- Concurrent game handling
- Blockchain interaction testing

### Task 8.3: Security Testing
- Private key security audit
- Payment tampering tests
- Verification bypass attempts
- Transaction replay prevention

## Phase 9: Commands & User Interface (Days 26-27)

### Task 9.1: New Commands Implementation
```typescript
// Commands to implement:
/verify - Wallet verification
/create-paid --ticket X - Paid game creation
/payment-status - Check payment status
/wallet-info - Show linked wallet
/my-payments - Payment history
```

### Task 9.2: Enhanced Messaging
- Payment instruction messages
- Status update notifications
- Error message improvements
- Success confirmation messages

### Task 9.3: Help Documentation
- Update /start command with paid features
- Create payment troubleshooting guide
- Add verification instructions
- Document all new commands

## Phase 10: Deployment & Monitoring (Days 28-30)

### Task 10.1: Production Configuration
- Mainnet vs testnet configuration
- Production wallet setup
- Security key management
- Environment variable validation

### Task 10.2: Monitoring Setup
- Payment volume tracking
- Error rate monitoring
- Wallet balance alerts
- Performance metrics

### Task 10.3: Deployment & Testing
- Staging environment testing
- Production deployment
- Live payment testing
- User acceptance testing

## Implementation Checklist

### Critical Security Requirements
- [ ] Private keys encrypted and secure
- [ ] Wallet verification cryptographically sound
- [ ] Payment amounts validated
- [ ] Refund system tested
- [ ] Error handling comprehensive
- [ ] Transaction monitoring reliable

### Core Functionality Requirements
- [ ] Wallet generation working
- [ ] User verification functional
- [ ] Payment processing reliable
- [ ] Prize distribution automatic
- [ ] Game integration seamless
- [ ] Error recovery robust

### User Experience Requirements
- [ ] Clear payment instructions
- [ ] Status updates informative
- [ ] Error messages helpful
- [ ] Verification process smooth
- [ ] Commands intuitive
- [ ] Help documentation complete

## Testing Scripts

### Quick Test Commands
```bash
# Run all tests
npm test

# Test specific components
npm run test:wallet
npm run test:payments
npm run test:verification

# Integration test
npm run test:integration

# Security test
npm run test:security
```

### Manual Testing Checklist
1. [ ] Generate and encrypt wallet keys
2. [ ] Verify wallet verification flow
3. [ ] Test payment with small amount
4. [ ] Verify prize distribution
5. [ ] Test refund mechanism
6. [ ] Test error scenarios
7. [ ] Validate security measures

## Rollback Plan

### Emergency Procedures
1. **Disable paid games**: Environment flag to disable paid features
2. **Process refunds**: Automated refund for all pending payments
3. **Wallet security**: Secure private keys and prevent access
4. **User communication**: Clear notification about issues

### Rollback Commands
```bash
# Disable paid features
export ENABLE_PAID_GAMES=false

# Emergency refund script
npm run emergency-refund

# Secure wallets
npm run secure-wallets
```

## Success Metrics

### Technical Metrics
- Payment success rate > 99%
- Verification completion rate > 95%
- Prize distribution success > 99.5%
- Average payment confirmation time < 30 seconds

### User Experience Metrics
- User completion rate for verification > 90%
- Support ticket rate < 1% of payments
- User satisfaction with payment flow > 95%

### Security Metrics
- Zero security incidents
- All penetration tests passed
- Private key security audited
- Payment validation 100% effective

## Future Enhancements

### Short-term (Next Month)
- Multiple token support (SOL, USDC)
- Bulk payment processing
- Advanced error recovery
- Performance optimization

### Medium-term (Next Quarter)
- Tournament structures
- Subscription payments
- Cross-game prize pools
- Mobile app integration

### Long-term (Next Year)
- DeFi integration
- NFT prizes
- DAO governance
- Multi-chain support