use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, errors::*};

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    #[account(
        mut,
        constraint = authority.key() == treasury_state.authority @ LotteryError::Unauthorized
    )]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury_state.bump
    )]
    pub treasury_state: Account<'info, TreasuryState>,
    
    /// Treasury token account
    #[account(
        mut,
        constraint = treasury_token_account.key() == treasury_state.treasury_token_account
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    /// Destination token account (owned by authority)
    #[account(
        mut,
        constraint = destination_token_account.owner == authority.key(),
        constraint = destination_token_account.mint == treasury_token_account.mint
    )]
    pub destination_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<WithdrawTreasury>,
    amount: Option<u64>, // None means withdraw all
) -> Result<()> {
    let treasury_state = &mut ctx.accounts.treasury_state;
    let clock = &ctx.accounts.clock;
    
    // Determine withdrawal amount
    let withdrawal_amount = if let Some(amt) = amount {
        // Validate requested amount
        require!(
            amt <= treasury_state.pending_withdrawal,
            LotteryError::InsufficientTreasuryBalance
        );
        amt
    } else {
        // Withdraw all pending
        treasury_state.pending_withdrawal
    };
    
    // Ensure there's something to withdraw
    require!(
        withdrawal_amount > 0,
        LotteryError::NoFundsToWithdraw
    );
    
    // Transfer from treasury to destination
    let seeds = &[
        b"treasury".as_ref(),
        &[treasury_state.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.treasury_token_account.to_account_info(),
        to: ctx.accounts.destination_token_account.to_account_info(),
        authority: treasury_state.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    
    token::transfer(cpi_ctx, withdrawal_amount)?;
    
    // Update treasury state
    treasury_state.pending_withdrawal = treasury_state.pending_withdrawal
        .checked_sub(withdrawal_amount)
        .ok_or(LotteryError::ArithmeticOverflow)?;
    
    // Emit event
    emit!(TreasuryWithdrawalEvent {
        authority: ctx.accounts.authority.key(),
        amount: withdrawal_amount,
        remaining_balance: treasury_state.pending_withdrawal,
        total_collected: treasury_state.total_collected,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}