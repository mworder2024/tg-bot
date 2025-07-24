use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct CompleteGame<'info> {
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
        seeds = [b"treasury"],
        bump = treasury_state.bump
    )]
    pub treasury_state: Account<'info, TreasuryState>,
    
    /// Escrow token account
    #[account(
        mut,
        seeds = [b"escrow", game_id.as_bytes()],
        bump,
        constraint = escrow_account.key() == game_state.escrow_account @ LotteryError::EscrowAccountMismatch
    )]
    pub escrow_account: Account<'info, TokenAccount>,
    
    /// Treasury token account
    #[account(
        mut,
        constraint = treasury_token_account.key() == treasury_state.treasury_token_account
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(ctx: Context<CompleteGame>, game_id: String) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let player_list = &mut ctx.accounts.player_list;
    let treasury_state = &mut ctx.accounts.treasury_state;
    let clock = &ctx.accounts.clock;
    
    // Count winners (players not eliminated)
    let winners: Vec<&mut Player> = player_list.players
        .iter_mut()
        .filter(|p| p.eliminated_round.is_none())
        .collect();
    
    require!(
        !winners.is_empty(),
        LotteryError::NoWinnersFound
    );
    
    // Ensure we have the expected number of winners or all remaining if less
    let actual_winner_count = winners.len().min(game_state.winner_count as usize);
    
    // Calculate prize distribution
    let total_prize_pool = game_state.prize_pool;
    let treasury_fee = game_state.treasury_fee;
    
    // Distributable amount (90% of total)
    let distributable_amount = total_prize_pool
        .checked_sub(treasury_fee)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    // Prize per winner
    let prize_per_winner = distributable_amount
        .checked_div(actual_winner_count as u64)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    // Mark winners and set prize amounts
    for (i, winner) in winners.iter_mut().enumerate() {
        if i < actual_winner_count {
            winner.is_winner = true;
            winner.prize_amount = prize_per_winner;
        }
    }
    
    // Transfer treasury fee
    let seeds = &[
        b"game".as_ref(),
        game_id.as_bytes(),
        &[game_state.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.escrow_account.to_account_info(),
        to: ctx.accounts.treasury_token_account.to_account_info(),
        authority: game_state.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    
    token::transfer(cpi_ctx, treasury_fee)?;
    
    // Update treasury state
    treasury_state.total_collected = treasury_state.total_collected
        .checked_add(treasury_fee)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    treasury_state.pending_withdrawal = treasury_state.pending_withdrawal
        .checked_add(treasury_fee)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    // Update game state
    game_state.state = GameStatus::Distributing;
    game_state.completed_at = Some(clock.unix_timestamp);
    
    // Collect winner addresses for event
    let winner_addresses: Vec<Pubkey> = player_list.players
        .iter()
        .filter(|p| p.is_winner)
        .map(|p| p.wallet)
        .collect();
    
    // Emit event
    emit!(GameCompletedEvent {
        game_id,
        winners: winner_addresses,
        prize_pool: total_prize_pool,
        treasury_fee,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}