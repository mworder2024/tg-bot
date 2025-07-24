use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::{state::*, errors::*};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = TreasuryState::SIZE,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury_state: Account<'info, TreasuryState>,
    
    /// Treasury token account for MWOR
    #[account(
        init,
        payer = authority,
        associated_token::mint = token_mint,
        associated_token::authority = treasury_state,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    /// MWOR token mint
    pub token_mint: Account<'info, Mint>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<Initialize>,
    treasury_authority: Pubkey,
    fee_percentage: u8,
) -> Result<()> {
    // Validate fee percentage
    require!(
        fee_percentage > 0 && fee_percentage <= 50,
        LotteryError::InvalidFeePercentage
    );
    
    let treasury_state = &mut ctx.accounts.treasury_state;
    
    // Initialize treasury state
    treasury_state.authority = treasury_authority;
    treasury_state.treasury_token_account = ctx.accounts.treasury_token_account.key();
    treasury_state.fee_percentage = fee_percentage;
    treasury_state.total_collected = 0;
    treasury_state.pending_withdrawal = 0;
    treasury_state.bump = *ctx.bumps.get("treasury_state").unwrap();
    
    // Emit initialization event
    emit!(TreasuryInitializedEvent {
        authority: treasury_authority,
        treasury_token_account: ctx.accounts.treasury_token_account.key(),
        fee_percentage,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}