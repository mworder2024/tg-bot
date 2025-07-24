use anchor_lang::prelude::*;
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        constraint = authority.key() == game_state.authority @ LotteryError::Unauthorized
    )]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state != GameStatus::Completed 
            && game_state.state != GameStatus::Cancelled 
            && game_state.state != GameStatus::Distributing @ LotteryError::CannotCancelGame
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        seeds = [b"players", game_id.as_bytes()],
        bump = player_list.bump
    )]
    pub player_list: Account<'info, PlayerList>,
    
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<CancelGame>, 
    game_id: String,
    reason: String,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let player_list = &ctx.accounts.player_list;
    let clock = &ctx.accounts.clock;
    
    // Validate reason length
    require!(
        reason.len() <= 200,
        LotteryError::ReasonTooLong
    );
    
    // Additional checks based on game state
    match game_state.state {
        GameStatus::Created | GameStatus::Joining => {
            // Can cancel if no players joined yet or payment deadline passed
            if !player_list.players.is_empty() {
                require!(
                    clock.unix_timestamp > game_state.payment_deadline,
                    LotteryError::CannotCancelActiveGame
                );
            }
        },
        GameStatus::NumberSelection => {
            // Can cancel if number selection timeout (e.g., 24 hours after start)
            let selection_timeout = game_state.started_at.unwrap_or(0) + (24 * 60 * 60);
            require!(
                clock.unix_timestamp > selection_timeout,
                LotteryError::CannotCancelActiveGame
            );
        },
        GameStatus::Playing => {
            // Can only cancel if VRF oracle fails or other critical issue
            // This would typically require additional validation
            msg!("Cancelling active game due to: {}", reason);
        },
        _ => return Err(LotteryError::CannotCancelGame.into()),
    }
    
    // Calculate total funds to refund
    let total_funds = game_state.entry_fee * player_list.players.len() as u64;
    
    // Update game state to cancelled
    let previous_state = game_state.state.clone();
    game_state.state = GameStatus::Cancelled;
    game_state.completed_at = Some(clock.unix_timestamp);
    
    // Emit cancellation event
    emit!(GameCancelledEvent {
        game_id,
        reason,
        previous_state,
        player_count: player_list.players.len() as u8,
        total_refund_amount: total_funds,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}