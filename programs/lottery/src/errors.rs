use anchor_lang::prelude::*;

#[error_code]
pub enum LotteryError {
    #[msg("Game ID too long")]
    GameIdTooLong,
    
    #[msg("Game is full")]
    GameFull,
    
    #[msg("Game has already started")]
    GameAlreadyStarted,
    
    #[msg("Invalid game state for this operation")]
    InvalidGameState,
    
    #[msg("Payment deadline has expired")]
    PaymentDeadlineExpired,
    
    #[msg("Player already joined this game")]
    PlayerAlreadyJoined,
    
    #[msg("Player not found in game")]
    PlayerNotFound,
    
    #[msg("Number already selected by another player")]
    NumberAlreadySelected,
    
    #[msg("Number out of valid range")]
    NumberOutOfRange,
    
    #[msg("Player has already selected a number")]
    PlayerAlreadySelectedNumber,
    
    #[msg("Not authorized to perform this action")]
    Unauthorized,
    
    #[msg("Insufficient prize pool for distribution")]
    InsufficientPrizePool,
    
    #[msg("VRF verification failed")]
    VrfVerificationFailed,
    
    #[msg("VRF result already submitted for this round")]
    VrfAlreadySubmitted,
    
    #[msg("Invalid VRF oracle")]
    InvalidVrfOracle,
    
    #[msg("No winners found")]
    NoWinnersFound,
    
    #[msg("Prize already claimed")]
    PrizeAlreadyClaimed,
    
    #[msg("Player is not a winner")]
    NotAWinner,
    
    #[msg("Game not cancelled")]
    GameNotCancelled,
    
    #[msg("Refund already processed")]
    RefundAlreadyProcessed,
    
    #[msg("Invalid treasury authority")]
    InvalidTreasuryAuthority,
    
    #[msg("Insufficient treasury balance")]
    InsufficientTreasuryBalance,
    
    #[msg("Invalid fee percentage")]
    InvalidFeePercentage,
    
    #[msg("Game not ready for elimination")]
    GameNotReadyForElimination,
    
    #[msg("All players already eliminated")]
    AllPlayersEliminated,
    
    #[msg("Invalid round number")]
    InvalidRoundNumber,
    
    #[msg("Minimum players not met")]
    MinimumPlayersNotMet,
    
    #[msg("Invalid entry fee amount")]
    InvalidEntryFee,
    
    #[msg("Invalid winner count")]
    InvalidWinnerCount,
    
    #[msg("Token transfer failed")]
    TokenTransferFailed,
    
    #[msg("Escrow account mismatch")]
    EscrowAccountMismatch,
    
    #[msg("Invalid token mint")]
    InvalidTokenMint,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    
    #[msg("Invalid cancel reason")]
    InvalidCancelReason,
    
    #[msg("Treasury not initialized")]
    TreasuryNotInitialized,
    
    #[msg("Player not in game")]
    PlayerNotInGame,
    
    #[msg("Number already selected by player")]
    NumberAlreadySelected,
    
    #[msg("Player has been eliminated")]
    PlayerEliminated,
    
    #[msg("Number already taken by another player")]
    NumberAlreadyTaken,
    
    #[msg("Invalid round")]
    InvalidRound,
    
    #[msg("Invalid VRF proof")]
    InvalidVrfProof,
    
    #[msg("VRF result already used")]
    VrfAlreadyUsed,
    
    #[msg("No prize to claim")]
    NoPrizeToCliam,
    
    #[msg("Cannot cancel game in current state")]
    CannotCancelGame,
    
    #[msg("Reason too long")]
    ReasonTooLong,
    
    #[msg("Cannot cancel active game without valid reason")]
    CannotCancelActiveGame,
    
    #[msg("No funds to withdraw")]
    NoFundsToWithdraw,
    
    #[msg("VRF request already pending")]
    VrfRequestAlreadyPending,
    
    #[msg("No VRF request pending")]
    NoVrfRequestPending,
    
    #[msg("VRF not fulfilled")]
    VrfNotFulfilled,
    
    #[msg("Invalid ORAO VRF program")]
    InvalidOraoVrfProgram,
}