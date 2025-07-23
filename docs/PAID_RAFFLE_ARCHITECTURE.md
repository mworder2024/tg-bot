# Paid Raffle System Architecture Plan

## Overview
This document outlines the comprehensive architecture for implementing a paid raffle system using Solana blockchain and MWOR token payments. The system extends the existing free lottery bot with secure payment processing, wallet management, and automatic prize distribution.

## Core Requirements

### 1. Payment System
- **Entry Fee**: Users pay MWOR tokens to enter paid raffles
- **Prize Pool**: Accumulated from all entry fees
- **System Fee**: 10% goes to treasury wallet
- **Winner Distribution**: 90% of pool distributed to winners

### 2. Wallet Management
- **Bot Wallet**: Primary wallet for receiving payments
- **Treasury Wallet**: Separate wallet for system fees
- **User Wallets**: Verified Solana wallets linked to Telegram accounts
- **Security**: Private keys securely stored and managed

### 3. User Experience
- **Verification**: `/verify` command to link Solana wallet
- **Paid Creation**: `/create-paid --ticket X` command
- **Payment Flow**: User pays → Entry confirmed → Game proceeds
- **Automatic Distribution**: Winners receive tokens directly

## Technical Architecture

### 1. Dependencies & Libraries

```json
{
  "@solana/web3.js": "^1.87.6",
  "@solana/spl-token": "^0.3.9",
  "bs58": "^5.0.0",
  "tweetnacl": "^1.0.3",
  "@coral-xyz/anchor": "^0.29.0"
}
```

### 2. Database Schema Extensions

#### User Wallet Verification
```typescript
interface UserWallet {
  userId: string;           // Telegram user ID
  walletAddress: string;    // Solana wallet address
  verificationDate: Date;   // When wallet was verified
  isActive: boolean;        // Wallet status
  lastUsed: Date;          // Last payment date
}
```

#### Payment Tracking
```typescript
interface PaymentRecord {
  paymentId: string;        // Unique payment identifier
  userId: string;           // Telegram user ID
  gameId: string;           // Associated game ID
  amount: number;           // MWOR token amount
  transactionHash: string;  // Solana transaction hash
  status: 'pending' | 'confirmed' | 'failed' | 'refunded';
  timestamp: Date;          // Payment initiation time
  confirmationTime?: Date;  // Blockchain confirmation time
  refundHash?: string;      // Refund transaction hash if applicable
}
```

#### Paid Game Records
```typescript
interface PaidGameRecord extends GameRecord {
  isPaid: boolean;          // Payment required flag
  entryFee: number;         // MWOR tokens required
  prizePool: number;        // Total accumulated pool
  systemFee: number;        // 10% for treasury
  distributionHash?: string; // Prize distribution transaction
  payments: PaymentRecord[]; // All payment records for game
}
```

### 3. Wallet Service Architecture

#### Bot Wallet Manager
```typescript
class BotWalletManager {
  private primaryWallet: Keypair;
  private treasuryWallet: Keypair;
  private connection: Connection;
  
  // Generate and securely store bot wallets
  async initializeWallets(): Promise<void>
  
  // Create payment request for user
  async createPaymentRequest(userId: string, amount: number): Promise<PaymentRequest>
  
  // Verify payment completion
  async verifyPayment(paymentId: string): Promise<boolean>
  
  // Distribute prizes to winners
  async distributePrizes(gameId: string, winners: WinnerInfo[]): Promise<string>
  
  // Handle refunds for cancelled games
  async processRefunds(gameId: string): Promise<void>
}
```

#### User Wallet Verification
```typescript
class WalletVerificationService {
  // Initiate wallet verification process
  async initiateVerification(userId: string): Promise<VerificationChallenge>
  
  // Verify ownership with signature
  async verifyOwnership(userId: string, signature: string, message: string): Promise<boolean>
  
  // Link verified wallet to user
  async linkWallet(userId: string, walletAddress: string): Promise<void>
  
  // Get user's verified wallet
  async getUserWallet(userId: string): Promise<UserWallet | null>
}
```

### 4. Payment Flow Architecture

#### Step 1: Game Creation
```
User → /create-paid --ticket 5
Bot → Creates pending paid game
Bot → Generates entry fee requirement (5 MWOR)
Bot → Announces game with payment instructions
```

#### Step 2: User Entry & Payment
```
User → /join (on paid game)
Bot → Checks wallet verification status
Bot → Generates payment request
Bot → Sends payment instructions to DM
User → Sends MWOR tokens to bot wallet
Bot → Monitors blockchain for confirmation
Bot → Confirms entry once payment received
```

#### Step 3: Game Execution
```
Payment Phase Complete → Game starts normally
Game Proceeds → Standard lottery mechanics
Game Ends → Prize distribution triggered
Bot → Calculates prize amounts (90% to winners, 10% to treasury)
Bot → Executes automatic token transfers
Bot → Records distribution transaction
```

### 5. Security Considerations

#### Private Key Management
- **Environment Variables**: Store encrypted private keys
- **Key Derivation**: Use secure seed phrases
- **Access Control**: Limit wallet access to payment functions only
- **Backup Strategy**: Secure key backup and recovery

#### Payment Security
- **Transaction Verification**: Multiple confirmation requirements
- **Timeout Handling**: Automatic refunds for failed payments
- **Amount Validation**: Prevent over/under payments
- **Duplicate Prevention**: Transaction hash tracking

#### User Security
- **Wallet Verification**: Cryptographic signature verification
- **Rate Limiting**: Prevent payment spam
- **Audit Trail**: Complete transaction logging
- **Error Handling**: Graceful failure recovery

### 6. New Commands & Functionality

#### /verify Command
```typescript
// In DM only - initiate wallet verification
bot.command('verify', async (ctx) => {
  // Generate verification challenge
  // Send instructions for signing message
  // Await signature verification
  // Link wallet to user account
});
```

#### /create-paid Command
```typescript
// Create paid raffle with entry fee
bot.command('create-paid', async (ctx) => {
  // Parse --ticket parameter
  // Validate MWOR amount
  // Create paid game instance
  // Announce with payment details
});
```

#### Payment Status Commands
```typescript
// Check payment status
bot.command('payment-status', async (ctx) => {
  // Show pending payments
  // Display transaction status
  // Provide troubleshooting info
});

// Manual payment verification
bot.command('check-payment', async (ctx) => {
  // Force re-check of blockchain
  // Update payment status
  // Confirm or reject entry
});
```

### 7. Error Handling & Edge Cases

#### Payment Failures
- **Insufficient Balance**: Clear error message with balance check
- **Network Issues**: Retry mechanism with exponential backoff
- **Wrong Amount**: Refund or credit difference handling
- **Transaction Timeout**: Automatic refund after timeout period

#### Game Cancellation
- **Minimum Players**: Automatic refunds if min not met
- **System Error**: Emergency refund protocol
- **User Disputes**: Manual refund capability

#### Wallet Issues
- **Invalid Address**: Verification failure handling
- **Unverified Wallet**: Require verification before payment
- **Changed Wallet**: Re-verification requirement

### 8. Configuration & Environment

#### New Environment Variables
```env
# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta
MWOR_TOKEN_MINT=<MWOR_TOKEN_MINT_ADDRESS>

# Bot Wallet Configuration
BOT_WALLET_PRIVATE_KEY=<ENCRYPTED_PRIVATE_KEY>
TREASURY_WALLET_PRIVATE_KEY=<ENCRYPTED_PRIVATE_KEY>

# Payment Configuration
PAYMENT_TIMEOUT_MINUTES=15
MINIMUM_CONFIRMATION_COUNT=3
SYSTEM_FEE_PERCENTAGE=10

# Security
WALLET_ENCRYPTION_KEY=<ENCRYPTION_KEY>
VERIFICATION_MESSAGE_PREFIX="TelegramBot-Verify-"
```

### 9. Testing Strategy

#### Unit Tests
- Wallet generation and management
- Payment verification logic
- Prize distribution calculations
- Error handling scenarios

#### Integration Tests
- End-to-end payment flow
- Blockchain interaction testing
- Multi-user game scenarios
- Refund processing

#### Security Tests
- Private key security
- Payment tampering prevention
- User verification bypassing
- Transaction replay attacks

#### Load Tests
- Multiple simultaneous payments
- High-frequency game creation
- Concurrent winner distributions
- Database performance under load

### 10. Implementation Phases

#### Phase 1: Foundation (Week 1)
- Set up Solana dependencies
- Implement wallet generation
- Create basic payment tracking
- Add database schema changes

#### Phase 2: Verification (Week 2)
- Implement wallet verification flow
- Add /verify command
- Create signature validation
- Test verification security

#### Phase 3: Payment Processing (Week 3)
- Build payment request system
- Implement blockchain monitoring
- Add payment confirmation logic
- Create refund mechanisms

#### Phase 4: Game Integration (Week 4)
- Integrate paid games with existing system
- Add /create-paid command
- Implement prize distribution
- Create comprehensive error handling

#### Phase 5: Testing & Deployment (Week 5)
- Complete testing suite
- Security audit
- Performance optimization
- Production deployment

### 11. Monitoring & Analytics

#### Payment Metrics
- Total volume processed
- Success/failure rates
- Average confirmation times
- Refund frequency

#### Game Metrics
- Paid vs free game ratio
- Average entry fees
- Prize pool distributions
- User participation rates

#### System Health
- Wallet balance monitoring
- Transaction fee optimization
- Error rate tracking
- Performance metrics

### 12. Future Enhancements

#### Advanced Features
- Multi-token support (SOL, USDC)
- Dynamic fee structures
- Subscription-based entries
- NFT prize distributions

#### Integration Opportunities
- DeFi yield farming for treasury
- Cross-game prize pools
- Tournament structures
- Social features (referrals, teams)

## Conclusion

This architecture provides a secure, scalable foundation for implementing paid raffles with blockchain payments. The modular design allows for incremental development while maintaining security and user experience standards.

Key success factors:
1. **Security First**: Comprehensive security measures throughout
2. **User Experience**: Smooth payment and verification flows
3. **Reliability**: Robust error handling and recovery
4. **Scalability**: Architecture supports growth and new features
5. **Compliance**: Transparent fee structures and audit trails

The implementation should proceed through careful phases with extensive testing at each stage to ensure a secure and reliable paid raffle system.