use anchor_lang::prelude::*;
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String, round: u8)]
pub struct SubmitVrf<'info> {
    #[account(
        mut,
        constraint = vrf_oracle.key() == game_state.vrf_oracle @ LotteryError::Unauthorized
    )]
    pub vrf_oracle: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::Playing @ LotteryError::InvalidGameState
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        init,
        payer = vrf_oracle,
        space = VrfResult::SIZE,
        seeds = [b"vrf", game_id.as_bytes(), &[round]],
        bump
    )]
    pub vrf_result: Account<'info, VrfResult>,
    
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<SubmitVrf>,
    game_id: String,
    round: u8,
    random_value: [u8; 32],
    proof: Vec<u8>,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let vrf_result = &mut ctx.accounts.vrf_result;
    let clock = &ctx.accounts.clock;
    
    // Validate round number
    require!(
        round == game_state.current_round + 1,
        LotteryError::InvalidRound
    );
    
    // Validate proof length (simplified - in production would verify actual VRF proof)
    require!(
        proof.len() >= 64 && proof.len() <= 256,
        LotteryError::InvalidVrfProof
    );
    
    // Initialize VRF result
    vrf_result.game_id = game_id.clone();
    vrf_result.round = round;
    vrf_result.random_value = random_value;
    vrf_result.proof = proof;
    vrf_result.timestamp = clock.unix_timestamp;
    vrf_result.used = false;
    vrf_result.bump = *ctx.bumps.get("vrf_result").unwrap();
    
    // Generate drawn number from random value
    // Use first 8 bytes of random value to generate number within range
    let random_u64 = u64::from_le_bytes(random_value[..8].try_into().unwrap());
    let range = (game_state.number_range.max - game_state.number_range.min + 1) as u64;
    let drawn_number = (random_u64 % range) as u8 + game_state.number_range.min;
    
    vrf_result.drawn_number = drawn_number;
    
    // Update game state
    game_state.current_round = round;
    game_state.drawn_numbers.push(drawn_number);
    
    // Emit event
    emit!(VrfSubmittedEvent {
        game_id,
        round,
        drawn_number,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}