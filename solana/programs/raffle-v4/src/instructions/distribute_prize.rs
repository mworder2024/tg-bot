use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::*;

/// Distribute prize to winner and collect platform fee
#[derive(Accounts)]
#[instruction(raffle_id: u64)]
pub struct DistributePrize<'info> {
    #[account(
        mut,
        seeds = [
            b"raffle",
            raffle_id.to_le_bytes().as_ref()
        ],
        bump = raffle_account.raffle_bump,
        constraint = raffle_account.id == raffle_id @ RaffleError::InvalidPDA
    )]
    pub raffle_account: Account<'info, RaffleAccount>,
    
    #[account(
        mut,
        seeds = [
            b"escrow",
            raffle_id.to_le_bytes().as_ref()
        ],
        bump = raffle_account.escrow_bump,
        constraint = escrow_account.raffle_id == raffle_id @ RaffleError::InvalidPDA
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    
    #[account(
        mut,
        seeds = [b"program_state"],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    /// CHECK: Winner account - validated against raffle winner
    #[account(
        mut,
        constraint = winner.key() == raffle_account.winner.unwrap() @ RaffleError::UnauthorizedTicketOwner
    )]
    pub winner: AccountInfo<'info>,
    
    /// CHECK: Treasury account for fee collection
    #[account(
        mut,
        constraint = treasury.key() == program_state.treasury @ RaffleError::UnauthorizedAuthority
    )]
    pub treasury: AccountInfo<'info>,
    
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<DistributePrize>,
    raffle_id: u64,
) -> Result<()> {
    let program_state = &mut ctx.accounts.program_state;
    let raffle_account = &mut ctx.accounts.raffle_account;
    let escrow_account = &ctx.accounts.escrow_account;
    
    // Check if program is paused
    require!(!program_state.is_paused, RaffleError::ProgramPaused);
    
    // Validate raffle state
    require!(
        raffle_account.status == RaffleStatus::Complete,
        RaffleError::InvalidRaffleState
    );
    
    // Check if winner has been selected
    require!(
        raffle_account.winner.is_some(),
        RaffleError::WinnerNotSelected
    );
    
    // Check if prize hasn't been distributed yet
    require!(
        raffle_account.can_distribute_prize(),
        RaffleError::PrizeAlreadyDistributed
    );
    
    // Calculate amounts
    let total_collected = raffle_account.total_collected();
    let platform_fee = raffle_account.calculate_fee(program_state.fee_rate);
    let winner_amount = raffle_account.calculate_winner_amount(program_state.fee_rate);
    
    // Verify escrow has sufficient balance
    let escrow_balance = ctx.accounts.escrow_account.lamports();
    let required_balance = total_collected;
    
    require!(
        escrow_balance >= required_balance,
        RaffleError::InsufficientFunds
    );
    
    let escrow_seeds = &[
        b"escrow",
        raffle_id.to_le_bytes().as_ref(),
        &[raffle_account.escrow_bump],
    ];
    let escrow_signer = &[&escrow_seeds[..]];
    
    // Transfer winner amount to winner
    if winner_amount > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.escrow_account.to_account_info(),
                    to: ctx.accounts.winner.to_account_info(),
                },
                escrow_signer,
            ),
            winner_amount,
        )?;
    }
    
    // Transfer platform fee to treasury
    if platform_fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.escrow_account.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
                escrow_signer,
            ),
            platform_fee,
        )?;
    }
    
    let current_time = Clock::get()?.unix_timestamp;
    
    // Update raffle state
    raffle_account.distributed_at = Some(current_time);
    
    // Update program state statistics
    program_state.total_volume = program_state.total_volume
        .checked_add(total_collected)
        .ok_or(RaffleError::ArithmeticOverflow)?;
    
    msg!(
        "Prize distributed - Raffle ID: {}, Winner: {}, Amount: {} lamports, Fee: {} lamports, Total Volume: {}",
        raffle_id,
        ctx.accounts.winner.key(),
        winner_amount,
        platform_fee,
        program_state.total_volume
    );
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prize_distribution_calculations() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = 100;
        raffle.ticket_price = 10_000_000; // 0.01 SOL per ticket
        
        let fee_rate = 300; // 3%
        
        // Calculate amounts
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 1_000_000_000); // 1 SOL total
        
        let platform_fee = raffle.calculate_fee(fee_rate);
        assert_eq!(platform_fee, 30_000_000); // 0.03 SOL fee
        
        let winner_amount = raffle.calculate_winner_amount(fee_rate);
        assert_eq!(winner_amount, 970_000_000); // 0.97 SOL to winner
        
        // Verify amounts add up
        assert_eq!(winner_amount + platform_fee, total_collected);
    }

    #[test]
    fn test_can_distribute_prize() {
        let mut raffle = create_test_raffle();
        
        // Initially cannot distribute (no winner)
        raffle.status = RaffleStatus::Complete;
        raffle.winner = None;
        raffle.distributed_at = None;
        assert!(!raffle.can_distribute_prize());
        
        // Can distribute after winner selected
        raffle.winner = Some(Pubkey::new_unique());
        assert!(raffle.can_distribute_prize());
        
        // Cannot distribute after already distributed
        raffle.distributed_at = Some(1640995200);
        assert!(!raffle.can_distribute_prize());
    }

    #[test]
    fn test_distribution_state_validation() {
        let mut raffle = create_test_raffle();
        
        // Must be Complete status
        raffle.status = RaffleStatus::Active;
        raffle.winner = Some(Pubkey::new_unique());
        raffle.distributed_at = None;
        assert!(!raffle.can_distribute_prize());
        
        raffle.status = RaffleStatus::Drawing;
        assert!(!raffle.can_distribute_prize());
        
        raffle.status = RaffleStatus::Cancelled;
        assert!(!raffle.can_distribute_prize());
        
        raffle.status = RaffleStatus::Complete;
        assert!(raffle.can_distribute_prize());
    }

    #[test]
    fn test_fee_rate_calculations() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = 1000;
        raffle.ticket_price = 1_000_000; // 0.001 SOL per ticket
        
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 1_000_000_000); // 1 SOL total
        
        // Test different fee rates
        let fee_0 = raffle.calculate_fee(0); // 0%
        assert_eq!(fee_0, 0);
        
        let fee_100 = raffle.calculate_fee(100); // 1%
        assert_eq!(fee_100, 10_000_000); // 0.01 SOL
        
        let fee_500 = raffle.calculate_fee(500); // 5%
        assert_eq!(fee_500, 50_000_000); // 0.05 SOL
        
        let fee_1000 = raffle.calculate_fee(1000); // 10%
        assert_eq!(fee_1000, 100_000_000); // 0.1 SOL
    }

    #[test]
    fn test_winner_amount_calculations() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = 200;
        raffle.ticket_price = 5_000_000; // 0.005 SOL per ticket
        
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 1_000_000_000); // 1 SOL total
        
        // Test different fee rates
        let winner_0 = raffle.calculate_winner_amount(0); // 0% fee
        assert_eq!(winner_0, 1_000_000_000); // Full amount
        
        let winner_250 = raffle.calculate_winner_amount(250); // 2.5% fee
        assert_eq!(winner_250, 975_000_000); // 0.975 SOL
        
        let winner_500 = raffle.calculate_winner_amount(500); // 5% fee
        assert_eq!(winner_500, 950_000_000); // 0.95 SOL
        
        let winner_1000 = raffle.calculate_winner_amount(1000); // 10% fee
        assert_eq!(winner_1000, 900_000_000); // 0.9 SOL
    }

    #[test]
    fn test_zero_amounts_handling() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = 0;
        raffle.ticket_price = 10_000_000;
        
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 0);
        
        let platform_fee = raffle.calculate_fee(300);
        assert_eq!(platform_fee, 0);
        
        let winner_amount = raffle.calculate_winner_amount(300);
        assert_eq!(winner_amount, 0);
    }

    #[test]
    fn test_distribution_timing() {
        let mut raffle = create_test_raffle();
        
        // Initially no distribution time
        assert!(raffle.distributed_at.is_none());
        
        // After distribution
        let distribution_time = 1640995200i64;
        raffle.distributed_at = Some(distribution_time);
        assert_eq!(raffle.distributed_at.unwrap(), distribution_time);
    }

    #[test]
    fn test_volume_tracking() {
        let total_volume = 5_000_000_000u64; // 5 SOL existing volume
        let new_raffle_volume = 1_000_000_000u64; // 1 SOL new raffle
        
        let updated_volume = total_volume
            .checked_add(new_raffle_volume)
            .unwrap();
        
        assert_eq!(updated_volume, 6_000_000_000); // 6 SOL total
    }

    #[test]
    fn test_escrow_balance_validation() {
        let raffle_total = 1_000_000_000u64; // 1 SOL collected
        let escrow_balance = 800_000_000u64; // 0.8 SOL in escrow (insufficient)
        
        // Should detect insufficient escrow balance
        assert!(escrow_balance < raffle_total);
        
        let sufficient_balance = 1_200_000_000u64; // 1.2 SOL in escrow
        assert!(sufficient_balance >= raffle_total);
    }

    #[test]
    fn test_pda_validation() {
        let raffle_id = 12345u64;
        
        // Test escrow PDA
        let (escrow_pda, escrow_bump) = EscrowAccount::find_pda(raffle_id);
        assert!(escrow_bump > 0);
        assert_ne!(escrow_pda, Pubkey::default());
        
        // Test raffle PDA
        let (raffle_pda, raffle_bump) = RaffleAccount::find_pda(raffle_id);
        assert!(raffle_bump > 0);
        assert_ne!(raffle_pda, Pubkey::default());
        
        // PDAs should be different
        assert_ne!(escrow_pda, raffle_pda);
    }

    fn create_test_raffle() -> RaffleAccount {
        RaffleAccount {
            id: 1,
            creator: Pubkey::new_unique(),
            title: "Test Raffle".to_string(),
            description: "Test Description".to_string(),
            prize_amount: 1_000_000_000, // 1 SOL
            ticket_price: 10_000_000,    // 0.01 SOL
            max_tickets: 100,
            tickets_sold: 50,
            start_time: 0,
            end_time: 86400,
            status: RaffleStatus::Complete,
            escrow_bump: 255,
            raffle_bump: 254,
            vrf_request: Some(Pubkey::new_unique()),
            winner: Some(Pubkey::new_unique()),
            winning_ticket: Some(25),
            vrf_proof: Some([1u8; 64]),
            created_at: 0,
            drawn_at: Some(1640995200),
            distributed_at: None,
        }
    }
}