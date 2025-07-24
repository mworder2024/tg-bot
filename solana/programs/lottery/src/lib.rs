use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("11111111111111111111111111111111"); // Replace with actual program ID

pub mod state;
pub mod errors;
pub mod instructions;
pub mod utils;

use state::*;
use errors::*;
use instructions::*;

#[program]
pub mod telegram_lottery {
    use super::*;

    /// Initialize the lottery program with treasury configuration
    pub fn initialize(
        ctx: Context<Initialize>,
        treasury_authority: Pubkey,
        fee_percentage: u8,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, treasury_authority, fee_percentage)
    }

    /// Create a new lottery game
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: String,
        entry_fee: u64,
        max_players: u8,
        winner_count: u8,
        payment_deadline_minutes: u16,
    ) -> Result<()> {
        instructions::create_game::handler(
            ctx,
            game_id,
            entry_fee,
            max_players,
            winner_count,
            payment_deadline_minutes,
        )
    }

    /// Join a game and pay entry fee
    pub fn join_game(
        ctx: Context<JoinGame>,
        game_id: String,
        telegram_id: String,
    ) -> Result<()> {
        instructions::join_game::handler(ctx, game_id, telegram_id)
    }

    /// Select a number for the game
    pub fn select_number(
        ctx: Context<SelectNumber>,
        game_id: String,
        number: u8,
    ) -> Result<()> {
        instructions::select_number::handler(ctx, game_id, number)
    }

    /// Submit VRF result (oracle only - legacy method)
    pub fn submit_vrf(
        ctx: Context<SubmitVrf>,
        game_id: String,
        round: u8,
        random_value: [u8; 32],
        proof: Vec<u8>,
    ) -> Result<()> {
        instructions::submit_vrf::handler(ctx, game_id, round, random_value, proof)
    }
    
    /// Request randomness from ORAO VRF
    pub fn request_orao_vrf(
        ctx: Context<RequestOraoVrf>,
        game_id: String,
        round: u8,
    ) -> Result<()> {
        instructions::request_orao_vrf::handler(ctx, game_id, round)
    }
    
    /// Fulfill ORAO VRF request and process the randomness
    pub fn fulfill_orao_vrf(
        ctx: Context<FulfillOraoVrf>,
        game_id: String,
        round: u8,
    ) -> Result<()> {
        instructions::fulfill_orao_vrf::handler(ctx, game_id, round)
    }

    /// Process elimination round based on VRF result
    pub fn process_elimination(
        ctx: Context<ProcessElimination>,
        game_id: String,
        round: u8,
    ) -> Result<()> {
        instructions::process_elimination::handler(ctx, game_id, round)
    }

    /// Complete the game and distribute prizes
    pub fn complete_game(ctx: Context<CompleteGame>, game_id: String) -> Result<()> {
        instructions::complete_game::handler(ctx, game_id)
    }

    /// Claim prize as a winner
    pub fn claim_prize(ctx: Context<ClaimPrize>, game_id: String) -> Result<()> {
        instructions::claim_prize::handler(ctx, game_id)
    }

    /// Request refund for cancelled game
    pub fn request_refund(ctx: Context<RequestRefund>, game_id: String) -> Result<()> {
        instructions::request_refund::handler(ctx, game_id)
    }

    /// Cancel game if conditions not met
    pub fn cancel_game(
        ctx: Context<CancelGame>,
        game_id: String,
        reason: String,
    ) -> Result<()> {
        instructions::cancel_game::handler(ctx, game_id, reason)
    }

    /// Withdraw treasury fees
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: Option<u64>) -> Result<()> {
        instructions::withdraw_treasury::handler(ctx, amount)
    }
}

// Re-export for external use
pub use state::{GameState, GameStatus, Player, TreasuryState, VrfResult};
pub use errors::LotteryError;