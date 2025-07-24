use anchor_lang::prelude::*;
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct SelectNumber<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::NumberSelection @ LotteryError::InvalidGameState
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"players", game_id.as_bytes()],
        bump = player_list.bump
    )]
    pub player_list: Account<'info, PlayerList>,
    
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<SelectNumber>,
    game_id: String,
    number: u8,
) -> Result<()> {
    let game_state = &ctx.accounts.game_state;
    let player_list = &mut ctx.accounts.player_list;
    let clock = &ctx.accounts.clock;
    
    // Validate number is within allowed range
    require!(
        number >= game_state.number_range.min && number <= game_state.number_range.max,
        LotteryError::NumberOutOfRange
    );
    
    // Find the player in the list
    let player = player_list.players
        .iter_mut()
        .find(|p| p.wallet == ctx.accounts.player.key())
        .ok_or(LotteryError::PlayerNotInGame)?;
    
    // Check if player already selected a number
    require!(
        player.selected_number.is_none(),
        LotteryError::NumberAlreadySelected
    );
    
    // Check if player is eliminated
    require!(
        player.eliminated_round.is_none(),
        LotteryError::PlayerEliminated
    );
    
    // Check if number is already taken by another player
    let number_taken = player_list.players
        .iter()
        .any(|p| p.selected_number == Some(number) && p.wallet != ctx.accounts.player.key());
    
    require!(
        !number_taken,
        LotteryError::NumberAlreadyTaken
    );
    
    // Assign the number to the player
    player.selected_number = Some(number);
    
    // Check if all active players have selected numbers
    let active_players = player_list.players
        .iter()
        .filter(|p| p.eliminated_round.is_none())
        .count();
    
    let players_with_numbers = player_list.players
        .iter()
        .filter(|p| p.eliminated_round.is_none() && p.selected_number.is_some())
        .count();
    
    // Emit event
    emit!(NumberSelectedEvent {
        game_id: game_id.clone(),
        player: ctx.accounts.player.key(),
        number,
        timestamp: clock.unix_timestamp,
    });
    
    // If all active players have selected numbers, we can transition to playing state
    if players_with_numbers == active_players {
        // Note: State transition should be done by authority through a separate instruction
        // This ensures proper VRF setup before starting eliminations
        emit!(AllNumbersSelectedEvent {
            game_id,
            total_players: active_players as u8,
            timestamp: clock.unix_timestamp,
        });
    }
    
    Ok(())
}