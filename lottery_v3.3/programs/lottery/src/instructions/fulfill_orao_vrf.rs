use anchor_lang::prelude::*;
use orao_solana_vrf::state::Randomness;
use orao_solana_vrf::{RANDOMNESS_ACCOUNT_SEED};
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String, round: u8)]
pub struct FulfillOraoVrf<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::Playing @ LotteryError::InvalidGameState,
        constraint = game_state.vrf_request_pending == true @ LotteryError::NoVrfRequestPending,
        constraint = game_state.pending_round == round @ LotteryError::InvalidRound
    )]
    pub game_state: Account<'info, GameState>,
    
    /// The randomness account from ORAO VRF
    #[account(
        seeds = [
            RANDOMNESS_ACCOUNT_SEED.as_ref(),
            &game_state.key().to_bytes()
        ],
        bump,
        seeds::program = orao_vrf_program.key()
    )]
    pub randomness: Account<'info, Randomness>,
    
    #[account(
        init,
        payer = authority,
        space = VrfResult::SIZE,
        seeds = [b"vrf", game_id.as_bytes(), &[round]],
        bump
    )]
    pub vrf_result: Account<'info, VrfResult>,
    
    /// ORAO VRF program for PDA validation
    /// CHECK: Only used for PDA validation
    pub orao_vrf_program: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<FulfillOraoVrf>,
    game_id: String,
    round: u8,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let vrf_result = &mut ctx.accounts.vrf_result;
    let randomness = &ctx.accounts.randomness;
    let clock = &ctx.accounts.clock;
    
    // Verify the randomness has been fulfilled
    require!(
        randomness.fulfilled(),
        LotteryError::VrfNotFulfilled
    );
    
    // Get the random value from ORAO
    let random_value = randomness.get_value().ok_or(LotteryError::VrfNotFulfilled)?;
    
    // Initialize VRF result
    vrf_result.game_id = game_id.clone();
    vrf_result.round = round;
    vrf_result.random_value = random_value;
    vrf_result.proof = vec![]; // ORAO handles proof verification internally
    vrf_result.timestamp = clock.unix_timestamp;
    vrf_result.used = false;
    vrf_result.bump = *ctx.bumps.get("vrf_result").unwrap();
    
    // Generate drawn number from random value
    let random_u64 = u64::from_le_bytes(random_value[..8].try_into().unwrap());
    let range = (game_state.number_range.max - game_state.number_range.min + 1) as u64;
    let drawn_number = (random_u64 % range) as u8 + game_state.number_range.min;
    
    vrf_result.drawn_number = drawn_number;
    
    // Update game state
    game_state.current_round = round;
    game_state.drawn_numbers.push(drawn_number);
    game_state.vrf_request_pending = false;
    game_state.pending_round = 0;
    
    // Emit event
    emit!(VrfFulfilledEvent {
        game_id,
        round,
        drawn_number,
        random_value,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

#[event]
pub struct VrfFulfilledEvent {
    pub game_id: String,
    pub round: u8,
    pub drawn_number: u8,
    pub random_value: [u8; 32],
    pub timestamp: i64,
}