use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct RequestRefund<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::Cancelled @ LotteryError::GameNotCancelled
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
    
    /// Player's token account
    #[account(
        mut,
        constraint = player_token_account.owner == player.key(),
        constraint = player_token_account.mint == game_state.token_mint
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(ctx: Context<RequestRefund>, game_id: String) -> Result<()> {
    let game_state = &ctx.accounts.game_state;
    let player_list = &mut ctx.accounts.player_list;
    let clock = &ctx.accounts.clock;
    
    // Find the player in the list
    let player = player_list.players
        .iter_mut()
        .find(|p| p.wallet == ctx.accounts.player.key())
        .ok_or(LotteryError::PlayerNotInGame)?;
    
    // Check if refund already processed
    require!(
        !player.prize_claimed, // Using prize_claimed flag for refund tracking
        LotteryError::RefundAlreadyProcessed
    );
    
    // For cancelled games, all players get full refund
    let refund_amount = game_state.entry_fee;
    
    // Transfer refund from escrow to player
    let seeds = &[
        b"game".as_ref(),
        game_id.as_bytes(),
        &[game_state.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.escrow_account.to_account_info(),
        to: ctx.accounts.player_token_account.to_account_info(),
        authority: game_state.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    
    token::transfer(cpi_ctx, refund_amount)?;
    
    // Mark refund as processed
    player.prize_claimed = true; // Reusing flag for refund tracking
    
    // Track total refunds processed
    let refunds_processed = player_list.players
        .iter()
        .filter(|p| p.prize_claimed)
        .count();
    
    // Emit event
    emit!(RefundProcessedEvent {
        game_id: game_id.clone(),
        player: ctx.accounts.player.key(),
        amount: refund_amount,
        timestamp: clock.unix_timestamp,
    });
    
    // If all refunds processed, emit completion event
    if refunds_processed == player_list.players.len() {
        emit!(AllRefundsProcessedEvent {
            game_id,
            total_refunded: refund_amount * player_list.players.len() as u64,
            timestamp: clock.unix_timestamp,
        });
    }
    
    Ok(())
}