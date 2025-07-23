use anchor_lang::prelude::*;

/// Main game state account
#[account]
pub struct GameState {
    /// Unique game identifier
    pub game_id: String,
    /// Bot wallet that created the game
    pub authority: Pubkey,
    /// Treasury wallet for fees
    pub treasury: Pubkey,
    /// Entry fee in MWOR tokens (with decimals)
    pub entry_fee: u64,
    /// Maximum players allowed
    pub max_players: u8,
    /// Number of winners
    pub winner_count: u8,
    /// Current game state
    pub state: GameStatus,
    /// Total prize pool collected
    pub prize_pool: u64,
    /// Treasury fee amount (10%)
    pub treasury_fee: u64,
    /// Number range for selection
    pub number_range: NumberRange,
    /// Unix timestamp when created
    pub created_at: i64,
    /// Unix timestamp when started
    pub started_at: Option<i64>,
    /// Unix timestamp when completed
    pub completed_at: Option<i64>,
    /// Payment deadline timestamp
    pub payment_deadline: i64,
    /// Current elimination round
    pub current_round: u8,
    /// Numbers drawn so far
    pub drawn_numbers: Vec<u8>,
    /// Token mint address (MWOR)
    pub token_mint: Pubkey,
    /// Escrow token account
    pub escrow_account: Pubkey,
    /// VRF oracle authority
    pub vrf_oracle: Pubkey,
    /// Whether a VRF request is pending
    pub vrf_request_pending: bool,
    /// Round number for pending VRF request
    pub pending_round: u8,
    /// Bump seed for PDA
    pub bump: u8,
}

impl GameState {
    pub const MAX_GAME_ID_LEN: usize = 16;
    pub const MAX_PLAYERS: usize = 100;
    pub const MAX_DRAWN_NUMBERS: usize = 100;
    
    pub const SIZE: usize = 
        8 +                                    // discriminator
        4 + Self::MAX_GAME_ID_LEN +           // game_id
        32 +                                   // authority
        32 +                                   // treasury
        8 +                                    // entry_fee
        1 +                                    // max_players
        1 +                                    // winner_count
        1 + 1 +                               // state (enum)
        8 +                                    // prize_pool
        8 +                                    // treasury_fee
        1 + 1 +                               // number_range
        8 +                                    // created_at
        1 + 8 +                               // started_at (Option)
        1 + 8 +                               // completed_at (Option)
        8 +                                    // payment_deadline
        1 +                                    // current_round
        4 + Self::MAX_DRAWN_NUMBERS +         // drawn_numbers
        32 +                                   // token_mint
        32 +                                   // escrow_account
        32 +                                   // vrf_oracle
        1 +                                    // vrf_request_pending
        1 +                                    // pending_round
        1;                                     // bump
}

/// Player information
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Player {
    /// Player's wallet address
    pub wallet: Pubkey,
    /// Telegram user ID
    pub telegram_id: String,
    /// Player's chosen number
    pub selected_number: Option<u8>,
    /// Round when eliminated (0 = not eliminated)
    pub eliminated_round: Option<u8>,
    /// Is this player a winner
    pub is_winner: bool,
    /// Has the player claimed their prize
    pub prize_claimed: bool,
    /// Amount won (if winner)
    pub prize_amount: u64,
    /// Timestamp when joined
    pub joined_at: i64,
}

impl Player {
    pub const MAX_TELEGRAM_ID_LEN: usize = 32;
    pub const SIZE: usize = 
        32 +                                   // wallet
        4 + Self::MAX_TELEGRAM_ID_LEN +       // telegram_id
        1 + 1 +                               // selected_number (Option)
        1 + 1 +                               // eliminated_round (Option)
        1 +                                    // is_winner
        1 +                                    // prize_claimed
        8 +                                    // prize_amount
        8;                                     // joined_at
}

/// Treasury state for fee collection
#[account]
pub struct TreasuryState {
    /// Authority that can withdraw (multisig or DAO)
    pub authority: Pubkey,
    /// Total fees collected all-time
    pub total_collected: u64,
    /// Total distributed to treasury
    pub total_distributed: u64,
    /// Available for withdrawal
    pub pending_withdrawal: u64,
    /// Fee percentage (e.g., 10 for 10%)
    pub fee_percentage: u8,
    /// Treasury token account
    pub treasury_token_account: Pubkey,
    /// Bump seed
    pub bump: u8,
}

impl TreasuryState {
    pub const SIZE: usize = 
        8 +                                    // discriminator
        32 +                                   // authority
        8 +                                    // total_collected
        8 +                                    // total_distributed
        8 +                                    // pending_withdrawal
        1 +                                    // fee_percentage
        32 +                                   // treasury_token_account
        1;                                     // bump
}

/// VRF result for verifiable randomness
#[account]
pub struct VrfResult {
    /// Game ID this result belongs to
    pub game_id: String,
    /// Round number
    pub round: u8,
    /// Random value from VRF
    pub random_value: [u8; 32],
    /// VRF proof (variable length, so we store separately)
    pub proof: Vec<u8>,
    /// Drawn number derived from random value
    pub drawn_number: u8,
    /// Whether this result has been used
    pub used: bool,
    /// Timestamp of submission
    pub timestamp: i64,
    /// Bump seed
    pub bump: u8,
}

impl VrfResult {
    pub const MAX_PROOF_LEN: usize = 256;
    pub const SIZE: usize = 
        8 +                                    // discriminator
        4 + GameState::MAX_GAME_ID_LEN +      // game_id
        1 +                                    // round
        32 +                                   // random_value
        4 + Self::MAX_PROOF_LEN +             // proof vec
        1 +                                    // drawn_number
        1 +                                    // used
        8 +                                    // timestamp
        1;                                     // bump
}

/// Game states
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum GameStatus {
    Created,
    Joining,
    NumberSelection,
    Playing,
    Distributing,
    Completed,
    Cancelled,
}

/// Number range for the game
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct NumberRange {
    pub min: u8,
    pub max: u8,
}

/// Reason for game cancellation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum CancelReason {
    InsufficientPlayers,
    PaymentDeadlineExpired,
    OracleFailure,
    EmergencyCancel,
}

/// Player list account (separate to handle dynamic sizing)
#[account]
pub struct PlayerList {
    /// Game ID this list belongs to
    pub game_id: String,
    /// List of players
    pub players: Vec<Player>,
    /// Bump seed
    pub bump: u8,
}

impl PlayerList {
    pub const SIZE: usize = 
        8 +                                    // discriminator
        4 + GameState::MAX_GAME_ID_LEN +      // game_id
        4 + (Player::SIZE * GameState::MAX_PLAYERS) + // players vector
        1;                                     // bump
}

// Events
#[event]
pub struct GameCreatedEvent {
    pub game_id: String,
    pub authority: Pubkey,
    pub entry_fee: u64,
    pub max_players: u8,
    pub timestamp: i64,
}

#[event]
pub struct PlayerJoinedEvent {
    pub game_id: String,
    pub player: Pubkey,
    pub telegram_id: String,
    pub timestamp: i64,
}

#[event]
pub struct GameCompletedEvent {
    pub game_id: String,
    pub winners: Vec<Pubkey>,
    pub prize_pool: u64,
    pub treasury_fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct PrizeClaimedEvent {
    pub game_id: String,
    pub winner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct GameCancelledEvent {
    pub game_id: String,
    pub reason: String,
    pub previous_state: GameStatus,
    pub player_count: u8,
    pub total_refund_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryInitializedEvent {
    pub authority: Pubkey,
    pub treasury_token_account: Pubkey,
    pub fee_percentage: u8,
    pub timestamp: i64,
}

#[event]
pub struct NumberSelectedEvent {
    pub game_id: String,
    pub player: Pubkey,
    pub number: u8,
    pub timestamp: i64,
}

#[event]
pub struct AllNumbersSelectedEvent {
    pub game_id: String,
    pub total_players: u8,
    pub timestamp: i64,
}

#[event]
pub struct VrfSubmittedEvent {
    pub game_id: String,
    pub round: u8,
    pub drawn_number: u8,
    pub timestamp: i64,
}

#[event]
pub struct EliminationProcessedEvent {
    pub game_id: String,
    pub round: u8,
    pub drawn_number: u8,
    pub eliminated_players: Vec<Pubkey>,
    pub remaining_players: u8,
    pub timestamp: i64,
}

#[event]
pub struct GameReadyToCompleteEvent {
    pub game_id: String,
    pub winner_count: u8,
    pub timestamp: i64,
}

#[event]
pub struct AllPrizesClaimedEvent {
    pub game_id: String,
    pub timestamp: i64,
}

#[event]
pub struct RefundProcessedEvent {
    pub game_id: String,
    pub player: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct AllRefundsProcessedEvent {
    pub game_id: String,
    pub total_refunded: u64,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryWithdrawalEvent {
    pub authority: Pubkey,
    pub amount: u64,
    pub remaining_balance: u64,
    pub total_collected: u64,
    pub timestamp: i64,
}