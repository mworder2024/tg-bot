use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use error::*;
use instructions::*;
use state::*;

declare_id!("RaffLEv4HuBv4phYZ7n3RCqEGmEhyPUX9HKE8nGhLfHJKE");

/// Raffle v4 Program - Decentralized VRF-based raffles with escrow PDAs
#[program]
pub mod raffle_v4 {
    use super::*;

    /// Initialize the program with global configuration
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `fee_rate` - Platform fee rate in basis points (e.g., 100 = 1%)
    /// * `treasury` - Treasury wallet for collecting fees
    /// 
    /// # Errors
    /// Returns `RaffleError::InvalidFeeRate` if fee_rate > 1000 (10%)
    pub fn initialize_program(
        ctx: Context<InitializeProgram>,
        fee_rate: u16,
        treasury: Pubkey,
    ) -> Result<()> {
        instructions::initialize_program::handler(ctx, fee_rate, treasury)
    }

    /// Create a new raffle with specified parameters
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `params` - Raffle creation parameters
    /// 
    /// # Returns
    /// The created raffle account
    pub fn create_raffle(
        ctx: Context<CreateRaffle>,
        params: CreateRaffleParams,
    ) -> Result<()> {
        instructions::create_raffle::handler(ctx, params)
    }

    /// Purchase a ticket for the specified raffle
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `raffle_id` - ID of the raffle to purchase ticket for
    /// 
    /// # Returns
    /// The created ticket account
    pub fn purchase_ticket(
        ctx: Context<PurchaseTicket>,
        raffle_id: u64,
    ) -> Result<()> {
        instructions::purchase_ticket::handler(ctx, raffle_id)
    }

    /// Request VRF-based winner selection for a raffle
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `raffle_id` - ID of the raffle to select winner for
    /// 
    /// # Requirements
    /// - Raffle must be in Active state
    /// - Raffle must have ended (current time > end_time) OR be full
    /// - At least one ticket must be sold
    pub fn request_winner_selection(
        ctx: Context<RequestWinnerSelection>,
        raffle_id: u64,
    ) -> Result<()> {
        instructions::request_winner_selection::handler(ctx, raffle_id)
    }

    /// Fulfill VRF request and determine the winner
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `raffle_id` - ID of the raffle
    /// * `winning_ticket_number` - The calculated winning ticket number
    /// 
    /// # Note
    /// This instruction is called after VRF randomness is available
    pub fn fulfill_winner_selection(
        ctx: Context<FulfillWinnerSelection>,
        raffle_id: u64,
        winning_ticket_number: u32,
    ) -> Result<()> {
        instructions::fulfill_winner_selection::handler(ctx, raffle_id, winning_ticket_number)
    }

    /// Distribute prize to the winner and fees to treasury
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `raffle_id` - ID of the raffle
    /// 
    /// # Requirements
    /// - Raffle must be in Complete state
    /// - Winner must be determined
    /// - Prize must not have been distributed yet
    pub fn distribute_prize(
        ctx: Context<DistributePrize>,
        raffle_id: u64,
    ) -> Result<()> {
        instructions::distribute_prize::handler(ctx, raffle_id)
    }

    /// Cancel a raffle and enable refunds
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `raffle_id` - ID of the raffle to cancel
    /// 
    /// # Requirements
    /// - Only raffle creator can cancel
    /// - Raffle must be in Active state
    /// - Can only cancel before VRF is requested
    pub fn cancel_raffle(
        ctx: Context<CancelRaffle>,
        raffle_id: u64,
    ) -> Result<()> {
        instructions::cancel_raffle::handler(ctx, raffle_id)
    }

    /// Claim refund for a ticket from a cancelled raffle
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `raffle_id` - ID of the cancelled raffle
    /// * `ticket_number` - Number of the ticket to refund
    /// 
    /// # Requirements
    /// - Raffle must be in Cancelled state
    /// - Caller must own the ticket
    /// - Ticket must not have been refunded yet
    pub fn claim_refund(
        ctx: Context<ClaimRefund>,
        raffle_id: u64,
        ticket_number: u32,
    ) -> Result<()> {
        instructions::claim_refund::handler(ctx, raffle_id, ticket_number)
    }

    /// Update program configuration (admin only)
    /// 
    /// # Arguments
    /// * `ctx` - Program context with accounts
    /// * `params` - Configuration update parameters
    /// 
    /// # Requirements
    /// - Only program authority can update configuration
    pub fn update_program_config(
        ctx: Context<UpdateProgramConfig>,
        params: UpdateConfigParams,
    ) -> Result<()> {
        instructions::update_program_config::handler(ctx, params)
    }
}