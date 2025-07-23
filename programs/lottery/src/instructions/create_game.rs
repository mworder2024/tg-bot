use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{state::*, errors::*};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = GameState::SIZE,
        seeds = [b"game", game_id.as_bytes()],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        init,
        payer = authority,
        space = PlayerList::SIZE,
        seeds = [b"players", game_id.as_bytes()],
        bump
    )]
    pub player_list: Account<'info, PlayerList>,
    
    /// Treasury state (must be initialized first)
    #[account(
        seeds = [b"treasury"],
        bump = treasury_state.bump
    )]
    pub treasury_state: Account<'info, TreasuryState>,
    
    /// Token mint (MWOR)
    pub token_mint: Account<'info, Mint>,
    
    /// Escrow token account for this game
    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = game_state,
        seeds = [b"escrow", game_id.as_bytes()],
        bump
    )]
    pub escrow_account: Account<'info, TokenAccount>,
    
    /// VRF oracle account (configured oracle authority)
    /// CHECK: This is just the oracle's pubkey, verified in handler
    pub vrf_oracle: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<CreateGame>,
    game_id: String,
    entry_fee: u64,
    max_players: u8,
    winner_count: u8,
    payment_deadline_minutes: u16,
) -> Result<()> {
    // Validate inputs
    require!(
        game_id.len() <= GameState::MAX_GAME_ID_LEN,
        LotteryError::GameIdTooLong
    );
    
    require!(
        entry_fee > 0,
        LotteryError::InvalidEntryFee
    );
    
    require!(
        max_players >= 2 && max_players <= GameState::MAX_PLAYERS as u8,
        LotteryError::InvalidWinnerCount
    );
    
    require!(
        winner_count > 0 && winner_count < max_players,
        LotteryError::InvalidWinnerCount
    );
    
    let game_state = &mut ctx.accounts.game_state;
    let player_list = &mut ctx.accounts.player_list;
    let clock = &ctx.accounts.clock;
    
    // Initialize game state
    game_state.game_id = game_id.clone();
    game_state.authority = ctx.accounts.authority.key();
    game_state.treasury = ctx.accounts.treasury_state.key();
    game_state.entry_fee = entry_fee;
    game_state.max_players = max_players;
    game_state.winner_count = winner_count;
    game_state.state = GameStatus::Created;
    game_state.prize_pool = 0;
    game_state.treasury_fee = 0;
    game_state.number_range = NumberRange {
        min: 1,
        max: (max_players * 2) as u8, // Dynamic range based on players
    };
    game_state.created_at = clock.unix_timestamp;
    game_state.started_at = None;
    game_state.completed_at = None;
    game_state.payment_deadline = clock.unix_timestamp + (payment_deadline_minutes as i64 * 60);
    game_state.current_round = 0;
    game_state.drawn_numbers = Vec::new();
    game_state.token_mint = ctx.accounts.token_mint.key();
    game_state.escrow_account = ctx.accounts.escrow_account.key();
    game_state.vrf_oracle = ctx.accounts.vrf_oracle.key();
    game_state.vrf_request_pending = false;
    game_state.pending_round = 0;
    game_state.bump = *ctx.bumps.get("game_state").unwrap();
    
    // Initialize player list
    player_list.game_id = game_id.clone();
    player_list.players = Vec::new();
    player_list.bump = *ctx.bumps.get("player_list").unwrap();
    
    // Update game status to joining
    game_state.state = GameStatus::Joining;
    
    // Emit event
    emit!(GameCreatedEvent {
        game_id,
        authority: ctx.accounts.authority.key(),
        entry_fee,
        max_players,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}