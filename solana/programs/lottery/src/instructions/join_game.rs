use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"game", game_id.as_bytes()],
        bump = game_state.bump,
        constraint = game_state.state == GameStatus::Joining @ LotteryError::InvalidGameState
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"players", game_id.as_bytes()],
        bump = player_list.bump
    )]
    pub player_list: Account<'info, PlayerList>,
    
    /// Player's token account
    #[account(
        mut,
        constraint = player_token_account.owner == player.key(),
        constraint = player_token_account.mint == game_state.token_mint
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    
    /// Escrow token account
    #[account(
        mut,
        seeds = [b"escrow", game_id.as_bytes()],
        bump,
        constraint = escrow_account.key() == game_state.escrow_account @ LotteryError::EscrowAccountMismatch
    )]
    pub escrow_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<JoinGame>,
    game_id: String,
    telegram_id: String,
) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let player_list = &mut ctx.accounts.player_list;
    let clock = &ctx.accounts.clock;
    
    // Check payment deadline
    require!(
        clock.unix_timestamp <= game_state.payment_deadline,
        LotteryError::PaymentDeadlineExpired
    );
    
    // Check if game is full
    require!(
        player_list.players.len() < game_state.max_players as usize,
        LotteryError::GameFull
    );
    
    // Check if player already joined
    let player_exists = player_list.players
        .iter()
        .any(|p| p.wallet == ctx.accounts.player.key());
    
    require!(
        !player_exists,
        LotteryError::PlayerAlreadyJoined
    );
    
    // Transfer entry fee to escrow
    let cpi_accounts = Transfer {
        from: ctx.accounts.player_token_account.to_account_info(),
        to: ctx.accounts.escrow_account.to_account_info(),
        authority: ctx.accounts.player.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, game_state.entry_fee)?;
    
    // Add player to the game
    let new_player = Player {
        wallet: ctx.accounts.player.key(),
        telegram_id: telegram_id.clone(),
        selected_number: None,
        eliminated_round: None,
        is_winner: false,
        prize_claimed: false,
        prize_amount: 0,
        joined_at: clock.unix_timestamp,
    };
    
    player_list.players.push(new_player);
    
    // Update prize pool
    game_state.prize_pool = game_state.prize_pool
        .checked_add(game_state.entry_fee)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    // Calculate treasury fee (10%)
    let fee_amount = game_state.entry_fee
        .checked_div(10)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    game_state.treasury_fee = game_state.treasury_fee
        .checked_add(fee_amount)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    // Check if game should start (all players joined)
    if player_list.players.len() == game_state.max_players as usize {
        game_state.state = GameStatus::NumberSelection;
        game_state.started_at = Some(clock.unix_timestamp);
    }
    
    // Emit event
    emit!(PlayerJoinedEvent {
        game_id,
        player: ctx.accounts.player.key(),
        telegram_id,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}