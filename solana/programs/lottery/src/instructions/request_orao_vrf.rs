use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use orao_solana_vrf::cpi::accounts::Request;
use orao_solana_vrf::program::OraoVrf;
use orao_solana_vrf::state::NetworkState;
use orao_solana_vrf::{CONFIG_ACCOUNT_SEED, RANDOMNESS_ACCOUNT_SEED};
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String, round: u8)]
pub struct RequestOraoVrf<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::Playing @ LotteryError::InvalidGameState
    )]
    pub game_state: Account<'info, GameState>,
    
    /// ORAO Network state account
    #[account(
        seeds = [CONFIG_ACCOUNT_SEED.as_ref()],
        bump = network_state.bump,
        seeds::program = orao_vrf.key()
    )]
    pub network_state: Account<'info, NetworkState>,
    
    /// ORAO VRF Treasury account (receives payment)
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    
    /// The account that will store the generated randomness
    /// CHECK: This account is created and managed by ORAO VRF
    #[account(
        mut,
        seeds = [
            RANDOMNESS_ACCOUNT_SEED.as_ref(),
            &game_state.key().to_bytes()
        ],
        bump,
        seeds::program = orao_vrf.key()
    )]
    pub randomness: UncheckedAccount<'info>,
    
    /// ORAO VRF program
    pub orao_vrf: Program<'info, OraoVrf>,
    
    /// System program
    pub system_program: Program<'info, System>,
    
    /// Recent slothashes sysvar
    /// CHECK: Validated by ORAO VRF program
    #[account(address = sysvar::recent_blockhashes::ID)]
    pub recent_slothashes: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<RequestOraoVrf>,
    game_id: String,
    round: u8,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    
    // Validate round number
    require!(
        round == game_state.current_round + 1,
        LotteryError::InvalidRound
    );
    
    // Prepare the seed for ORAO VRF request
    // Using game_id and round to ensure unique randomness per round
    let seed = format!("{}-round-{}", game_id, round).as_bytes().to_vec();
    
    // Create CPI context for ORAO VRF request
    let cpi_program = ctx.accounts.orao_vrf.to_account_info();
    let cpi_accounts = Request {
        payer: ctx.accounts.player.to_account_info(),
        network_state: ctx.accounts.network_state.to_account_info(),
        treasury: ctx.accounts.treasury.to_account_info(),
        request: ctx.accounts.randomness.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    // Request randomness from ORAO VRF
    orao_solana_vrf::cpi::request(cpi_ctx, seed)?;
    
    // Update game state to indicate VRF request is pending
    game_state.vrf_request_pending = true;
    game_state.pending_round = round;
    
    // Emit event
    emit!(VrfRequestedEvent {
        game_id,
        round,
        randomness_account: ctx.accounts.randomness.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}

#[event]
pub struct VrfRequestedEvent {
    pub game_id: String,
    pub round: u8,
    pub randomness_account: Pubkey,
    pub timestamp: i64,
}