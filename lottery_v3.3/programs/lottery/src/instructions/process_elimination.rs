use anchor_lang::prelude::*;
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String, round: u8)]
pub struct ProcessElimination<'info> {
    #[account(
        mut,
        constraint = authority.key() == game_state.authority @ LotteryError::Unauthorized
    )]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::Playing @ LotteryError::InvalidGameState
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"players", game_id.as_bytes()],
        bump = player_list.bump
    )]
    pub player_list: Account<'info, PlayerList>,
    
    #[account(
        mut,
        seeds = [b"vrf", game_id.as_bytes(), &[round]],
        bump = vrf_result.bump,
        constraint = !vrf_result.used @ LotteryError::VrfAlreadyUsed
    )]
    pub vrf_result: Account<'info, VrfResult>,
    
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<ProcessElimination>,
    game_id: String,
    round: u8,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let player_list = &mut ctx.accounts.player_list;
    let vrf_result = &mut ctx.accounts.vrf_result;
    let clock = &ctx.accounts.clock;
    
    // Validate round matches VRF result
    require!(
        round == vrf_result.round && round == game_state.current_round,
        LotteryError::InvalidRound
    );
    
    // Get the drawn number from VRF result
    let drawn_number = vrf_result.drawn_number;
    
    // Mark VRF result as used
    vrf_result.used = true;
    
    // Track eliminated players for event
    let mut eliminated_players = Vec::new();
    
    // Process eliminations
    for player in player_list.players.iter_mut() {
        // Skip already eliminated players
        if player.eliminated_round.is_some() {
            continue;
        }
        
        // Check if player's number matches the drawn number
        if let Some(player_number) = player.selected_number {
            if player_number == drawn_number {
                player.eliminated_round = Some(round);
                eliminated_players.push(player.wallet);
            }
        }
    }
    
    // Count remaining active players
    let remaining_players = player_list.players
        .iter()
        .filter(|p| p.eliminated_round.is_none())
        .count();
    
    // Check if game should end
    let should_complete = remaining_players <= game_state.winner_count as usize;
    
    // Emit elimination event
    emit!(EliminationProcessedEvent {
        game_id: game_id.clone(),
        round,
        drawn_number,
        eliminated_players: eliminated_players.clone(),
        remaining_players: remaining_players as u8,
        timestamp: clock.unix_timestamp,
    });
    
    // If we've reached the target number of winners, the game is ready to complete
    if should_complete {
        // Game state will be updated by complete_game instruction
        emit!(GameReadyToCompleteEvent {
            game_id,
            winner_count: remaining_players as u8,
            timestamp: clock.unix_timestamp,
        });
    }
    
    Ok(())
}