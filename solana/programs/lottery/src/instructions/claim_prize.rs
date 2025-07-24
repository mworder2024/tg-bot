use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::Distributing @ LotteryError::InvalidGameState
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"players", game_id.as_bytes()],
        bump = player_list.bump
    )]
    pub player_list: Account<'info, PlayerList>,
    
    /// Escrow token account
    #[account(
        mut,
        seeds = [b"escrow", game_id.as_bytes()],
        bump,
        constraint = escrow_account.key() == game_state.escrow_account @ LotteryError::EscrowAccountMismatch
    )]
    pub escrow_account: Account<'info, TokenAccount>,
    
    /// Winner's token account
    #[account(
        mut,
        constraint = winner_token_account.owner == winner.key(),
        constraint = winner_token_account.mint == game_state.token_mint
    )]
    pub winner_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(ctx: Context<ClaimPrize>, game_id: String) -> Result<()> {
    let game_state = &ctx.accounts.game_state;
    let player_list = &mut ctx.accounts.player_list;
    let clock = &ctx.accounts.clock;
    
    // Find the winner in the player list
    let player = player_list.players
        .iter_mut()
        .find(|p| p.wallet == ctx.accounts.winner.key())
        .ok_or(LotteryError::PlayerNotInGame)?;
    
    // Verify player is a winner
    require!(
        player.is_winner,
        LotteryError::NotAWinner
    );
    
    // Check if prize already claimed
    require!(
        !player.prize_claimed,
        LotteryError::PrizeAlreadyClaimed
    );
    
    // Get prize amount
    let prize_amount = player.prize_amount;
    require!(
        prize_amount > 0,
        LotteryError::NoPrizeToCliam
    );
    
    // Transfer prize from escrow to winner
    let seeds = &[
        b"game".as_ref(),
        game_id.as_bytes(),
        &[game_state.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.escrow_account.to_account_info(),
        to: ctx.accounts.winner_token_account.to_account_info(),
        authority: game_state.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    
    token::transfer(cpi_ctx, prize_amount)?;
    
    // Mark prize as claimed
    player.prize_claimed = true;
    
    // Check if all prizes have been claimed
    let unclaimed_prizes = player_list.players
        .iter()
        .filter(|p| p.is_winner && !p.prize_claimed)
        .count();
    
    // Emit event
    emit!(PrizeClaimedEvent {
        game_id: game_id.clone(),
        winner: ctx.accounts.winner.key(),
        amount: prize_amount,
        timestamp: clock.unix_timestamp,
    });
    
    // If all prizes claimed, game can be closed
    if unclaimed_prizes == 0 {
        emit!(AllPrizesClaimedEvent {
            game_id,
            timestamp: clock.unix_timestamp,
        });
    }
    
    Ok(())
}