# Solana Program Architecture for Telegram Lottery Bot

## Overview

This document outlines the complete architecture for the Solana program (smart contract) that will handle the paid lottery system. The design prioritizes security, transparency, and efficiency while enabling trustless game mechanics.

## Core Design Principles

1. **Escrow-Based**: All funds held in Program Derived Addresses (PDAs)
2. **Atomic Operations**: Prize distribution happens on-chain in single transaction
3. **Verifiable Randomness**: VRF proofs stored on-chain
4. **No Admin Withdrawal**: Funds can only be distributed according to game rules
5. **Emergency Recovery**: Players can claim refunds if game doesn't complete

## Program Architecture

### Account Structure

```rust
// 1. Game State Account (PDA)
// Seeds: ["game", game_id]
pub struct GameState {
    pub game_id: String,              // Unique game identifier
    pub authority: Pubkey,            // Bot wallet that created the game
    pub treasury: Pubkey,             // Treasury wallet for fees
    pub entry_fee: u64,               // Entry fee in MWOR tokens
    pub max_players: u8,              // Maximum players allowed
    pub winner_count: u8,             // Number of winners
    pub state: GameStatus,            // Current game state
    pub players: Vec<Player>,         // List of players
    pub prize_pool: u64,              // Total prize pool
    pub number_range: NumberRange,    // Min/max for number selection
    pub created_at: i64,              // Unix timestamp
    pub started_at: Option<i64>,      // When game started
    pub completed_at: Option<i64>,    // When game completed
    pub vrf_result: Option<VrfResult>, // VRF verification data
    pub drawn_numbers: Vec<u8>,       // Numbers drawn so far
}

// 2. Player Structure (stored in GameState)
pub struct Player {
    pub wallet: Pubkey,               // Player's wallet address
    pub telegram_id: String,          // Telegram user ID
    pub selected_number: Option<u8>,  // Player's chosen number
    pub eliminated_round: Option<u8>, // Round when eliminated (0 = not eliminated)
    pub is_winner: bool,              // Winner flag
    pub prize_claimed: bool,          // Prize claim status
}

// 3. Treasury State Account (PDA)
// Seeds: ["treasury"]
pub struct TreasuryState {
    pub authority: Pubkey,            // Multisig or DAO authority
    pub total_collected: u64,         // Total fees collected
    pub total_distributed: u64,       // Total distributed to treasury
    pub pending_withdrawal: u64,      // Available for withdrawal
}

// 4. VRF Oracle Account (PDA)
// Seeds: ["vrf", game_id, round]
pub struct VrfResult {
    pub game_id: String,
    pub round: u8,
    pub seed: [u8; 32],              // VRF seed
    pub proof: [u8; 64],             // VRF proof
    pub result: u8,                  // Random number result
    pub verified: bool,              // Verification status
    pub timestamp: i64,
}
```

### Instruction Set

```rust
pub enum LotteryInstruction {
    // 1. Initialize the program (one-time setup)
    Initialize {
        treasury_authority: Pubkey,
        fee_percentage: u8,  // 10 for 10%
    },
    
    // 2. Create a new game
    CreateGame {
        game_id: String,
        entry_fee: u64,
        max_players: u8,
        winner_count: u8,
        payment_deadline_minutes: u16,
    },
    
    // 3. Join game and pay entry fee
    JoinGame {
        game_id: String,
        telegram_id: String,
    },
    
    // 4. Select number (after all players joined)
    SelectNumber {
        game_id: String,
        number: u8,
    },
    
    // 5. Submit VRF result (oracle only)
    SubmitVrfResult {
        game_id: String,
        round: u8,
        seed: [u8; 32],
        proof: [u8; 64],
        result: u8,
    },
    
    // 6. Process elimination round
    ProcessElimination {
        game_id: String,
        round: u8,
    },
    
    // 7. Complete game and distribute prizes
    CompleteGame {
        game_id: String,
    },
    
    // 8. Claim individual prize (winner)
    ClaimPrize {
        game_id: String,
    },
    
    // 9. Request refund (if game cancelled)
    RequestRefund {
        game_id: String,
    },
    
    // 10. Cancel game (if not enough players)
    CancelGame {
        game_id: String,
        reason: CancelReason,
    },
    
    // 11. Withdraw treasury fees
    WithdrawTreasury {
        amount: u64,
    },
}
```

### State Transitions

```
CREATED → JOINING → NUMBER_SELECTION → PLAYING → DISTRIBUTING → COMPLETED
                ↓                                         ↓
            CANCELLED ←─────────────────────────────────┘
```

### Security Measures

1. **PDA Authority Checks**
   - Only bot wallet can create/manage games
   - Only players can select their numbers
   - Only oracle can submit VRF results

2. **Timeout Protection**
   - Games auto-cancel if not enough players join
   - Automatic refunds on cancellation
   - Prize claim deadline to prevent locked funds

3. **Anti-Gaming Measures**
   - Players can't change numbers after selection
   - VRF proofs must be verified on-chain
   - No way to predict or manipulate draws

## TypeScript SDK Design

### Core Classes

```typescript
// 1. Main Program Client
export class LotteryProgramClient {
  constructor(
    connection: Connection,
    programId: PublicKey,
    wallet: Wallet
  ) {}
  
  // Game Management
  async createGame(params: CreateGameParams): Promise<GameState>
  async joinGame(gameId: string, telegramId: string): Promise<TransactionSignature>
  async selectNumber(gameId: string, number: number): Promise<TransactionSignature>
  async completeGame(gameId: string): Promise<TransactionSignature>
  
  // Player Actions
  async claimPrize(gameId: string): Promise<TransactionSignature>
  async requestRefund(gameId: string): Promise<TransactionSignature>
  
  // Query Methods
  async getGame(gameId: string): Promise<GameState>
  async getPlayerGames(wallet: PublicKey): Promise<GameState[]>
  async getTreasuryState(): Promise<TreasuryState>
  
  // Event Subscriptions
  onGameCreated(callback: (game: GameState) => void): void
  onPlayerJoined(gameId: string, callback: (player: Player) => void): void
  onGameCompleted(gameId: string, callback: (winners: Player[]) => void): void
}

// 2. PDA Helper
export class LotteryPDAHelper {
  static getGamePDA(gameId: string): [PublicKey, number]
  static getTreasuryPDA(): [PublicKey, number]
  static getVrfPDA(gameId: string, round: number): [PublicKey, number]
  static getPlayerReceiptPDA(gameId: string, player: PublicKey): [PublicKey, number]
}

// 3. Game Monitor Service
export class GameMonitorService {
  constructor(client: LotteryProgramClient) {}
  
  // Monitor game state changes
  async monitorGame(gameId: string): Promise<GameMonitor>
  
  // Track payment confirmations
  async trackPayments(gameId: string): Promise<PaymentTracker>
  
  // VRF coordination
  async requestVrfDraw(gameId: string, round: number): Promise<void>
}
```

### Integration Points

```typescript
// Bot Integration Example
const lotteryClient = new LotteryProgramClient(connection, programId, botWallet);

// Create paid game
const game = await lotteryClient.createGame({
  gameId: generateGameId(),
  entryFee: 5 * MWOR_DECIMALS,
  maxPlayers: 20,
  winnerCount: 1,
  paymentDeadline: 10, // minutes
});

// Monitor for joins
lotteryClient.onPlayerJoined(game.gameId, async (player) => {
  // Notify in Telegram
  await bot.telegram.sendMessage(chatId, `${player.telegramId} joined!`);
  
  // Check if game is full
  const updatedGame = await lotteryClient.getGame(game.gameId);
  if (updatedGame.players.length === updatedGame.maxPlayers) {
    // Start number selection phase
    await startNumberSelection(game.gameId);
  }
});

// Complete game when draws finish
await lotteryClient.completeGame(game.gameId);
// This automatically:
// - Calculates 10% treasury fee
// - Distributes 90% to winners
// - Updates all on-chain state
```

## Critical Implementation Details

### 1. VRF Integration
- Use Switchboard VRF for verifiable randomness
- Store proofs on-chain for transparency
- Fallback to commit-reveal if VRF fails

### 2. Token Transfers
- Use Associated Token Accounts (ATAs)
- Check/create ATAs before transfers
- Handle rent-exempt minimums

### 3. Error Handling
```rust
#[error_code]
pub enum LotteryError {
    #[msg("Game is full")]
    GameFull,
    
    #[msg("Invalid game state")]
    InvalidGameState,
    
    #[msg("Payment deadline expired")]
    PaymentDeadlineExpired,
    
    #[msg("Number already selected")]
    NumberAlreadySelected,
    
    #[msg("Not authorized")]
    Unauthorized,
    
    #[msg("Insufficient prize pool")]
    InsufficientPrizePool,
    
    #[msg("VRF verification failed")]
    VrfVerificationFailed,
}
```

### 4. Event Emission
```rust
// Emit events for off-chain monitoring
emit!(GameCreatedEvent {
    game_id: game.game_id.clone(),
    entry_fee: game.entry_fee,
    max_players: game.max_players,
});
```

## Deployment Strategy

### Phase 1: Devnet Testing
1. Deploy program to devnet
2. Create test MWOR token
3. Run integration tests
4. Stress test with multiple games

### Phase 2: Security Audit
1. Code review by Solana experts
2. Formal verification of game logic
3. Penetration testing
4. Economic attack analysis

### Phase 3: Mainnet Deployment
1. Deploy with upgrade authority
2. Initialize with multisig treasury
3. Gradual rollout with limits
4. Monitor for first 30 days

## Future Enhancements

1. **Multi-Token Support**
   - Accept SOL, USDC, other SPL tokens
   - Dynamic exchange rates

2. **Advanced Game Modes**
   - Tournament brackets
   - Progressive jackpots
   - Team games

3. **DAO Governance**
   - Vote on treasury usage
   - Adjust fee percentages
   - Add new game types

4. **Cross-Chain Bridge**
   - Support other blockchains
   - Unified prize pools

## Risk Mitigation

1. **Smart Contract Risks**
   - Timelock on upgrades
   - Emergency pause function
   - Audit before mainnet

2. **Economic Risks**
   - Maximum game size limits
   - Minimum player requirements
   - Anti-whale mechanisms

3. **Operational Risks**
   - Automated monitoring
   - Redundant oracles
   - Manual intervention tools

## Conclusion

This architecture provides a secure, transparent, and efficient foundation for the paid lottery system. The use of PDAs ensures funds are always under program control, while the instruction set covers all necessary game operations. The TypeScript SDK will make integration seamless with the existing bot infrastructure.

The design prioritizes player protection and transparency while maintaining the excitement and fairness of the lottery game mechanics.