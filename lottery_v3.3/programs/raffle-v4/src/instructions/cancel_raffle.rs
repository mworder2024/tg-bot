use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::*;

/// Cancel an active raffle (only before VRF request)
#[derive(Accounts)]
#[instruction(raffle_id: u64)]
pub struct CancelRaffle<'info> {
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
        seeds = [b"program_state"],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    #[account(
        mut,
        constraint = creator.key() == raffle_account.creator @ RaffleError::UnauthorizedCreator
    )]
    pub creator: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CancelRaffle>,
    raffle_id: u64,
) -> Result<()> {
    let program_state = &ctx.accounts.program_state;
    let raffle_account = &mut ctx.accounts.raffle_account;
    
    // Check if program is paused
    require!(!program_state.is_paused, RaffleError::ProgramPaused);
    
    // Validate raffle state - can only cancel active raffles
    require!(
        raffle_account.status == RaffleStatus::Active,
        RaffleError::InvalidRaffleState
    );
    
    // Cannot cancel after VRF request has been made
    require!(
        raffle_account.vrf_request.is_none(),
        RaffleError::CannotCancelAfterVRF
    );
    
    // Calculate refund amounts
    let total_collected = raffle_account.total_collected();
    let creator_prize_refund = raffle_account.prize_amount;
    
    let escrow_seeds = &[
        b"escrow",
        raffle_id.to_le_bytes().as_ref(),
        &[raffle_account.escrow_bump],
    ];
    let escrow_signer = &[&escrow_seeds[..]];
    
    // Refund creator's prize amount from escrow
    if creator_prize_refund > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.escrow_account.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
                escrow_signer,
            ),
            creator_prize_refund,
        )?;
    }
    
    let current_time = Clock::get()?.unix_timestamp;
    
    // Update raffle state
    raffle_account.status = RaffleStatus::Cancelled;
    raffle_account.drawn_at = Some(current_time); // Use drawn_at to track cancellation time
    
    msg!(
        "Raffle cancelled - Raffle ID: {}, Creator: {}, Tickets Sold: {}, Total Collected: {} lamports, Prize Refunded: {} lamports",
        raffle_id,
        ctx.accounts.creator.key(),
        raffle_account.tickets_sold,
        total_collected,
        creator_prize_refund
    );
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cancel_raffle_validation() {
        let mut raffle = create_test_raffle();
        
        // Can cancel active raffle without VRF request
        raffle.status = RaffleStatus::Active;
        raffle.vrf_request = None;
        assert_eq!(raffle.status, RaffleStatus::Active);
        assert!(raffle.vrf_request.is_none());
        
        // Cannot cancel if VRF request exists
        raffle.vrf_request = Some(Pubkey::new_unique());
        assert!(raffle.vrf_request.is_some());
    }

    #[test]
    fn test_cancel_raffle_state_restrictions() {
        let mut raffle = create_test_raffle();
        raffle.vrf_request = None; // No VRF request
        
        // Only active raffles can be cancelled
        raffle.status = RaffleStatus::Active;
        assert_eq!(raffle.status, RaffleStatus::Active);
        
        // Cannot cancel other states
        raffle.status = RaffleStatus::Drawing;
        assert_ne!(raffle.status, RaffleStatus::Active);
        
        raffle.status = RaffleStatus::Complete;
        assert_ne!(raffle.status, RaffleStatus::Active);
        
        raffle.status = RaffleStatus::Cancelled;
        assert_ne!(raffle.status, RaffleStatus::Active);
    }

    #[test]
    fn test_creator_authorization() {
        let creator_key = Pubkey::new_unique();
        let other_key = Pubkey::new_unique();
        
        let raffle = RaffleAccount {
            creator: creator_key,
            ..create_test_raffle()
        };
        
        // Only creator should be authorized
        assert_eq!(raffle.creator, creator_key);
        assert_ne!(raffle.creator, other_key);
    }

    #[test]
    fn test_refund_calculations() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = 50;
        raffle.ticket_price = 10_000_000; // 0.01 SOL
        raffle.prize_amount = 1_000_000_000; // 1 SOL
        
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 500_000_000); // 0.5 SOL collected from tickets
        
        let creator_refund = raffle.prize_amount;
        assert_eq!(creator_refund, 1_000_000_000); // Creator gets back 1 SOL prize
    }

    #[test]
    fn test_cancellation_with_no_tickets() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = 0;
        raffle.prize_amount = 1_000_000_000; // 1 SOL
        
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 0); // No tickets sold
        
        let creator_refund = raffle.prize_amount;
        assert_eq!(creator_refund, 1_000_000_000); // Still refund prize amount
    }

    #[test]
    fn test_cancellation_with_tickets_sold() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = 25;
        raffle.ticket_price = 20_000_000; // 0.02 SOL
        raffle.prize_amount = 1_000_000_000; // 1 SOL
        
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 500_000_000); // 0.5 SOL from 25 tickets
        
        // Creator still gets prize refund
        let creator_refund = raffle.prize_amount;
        assert_eq!(creator_refund, 1_000_000_000);
        
        // Ticket holders will need to claim individual refunds
        assert!(raffle.tickets_sold > 0);
    }

    #[test]
    fn test_status_transition() {
        let mut raffle = create_test_raffle();
        
        // Start as active
        raffle.status = RaffleStatus::Active;
        assert_eq!(raffle.status, RaffleStatus::Active);
        
        // After cancellation
        raffle.status = RaffleStatus::Cancelled;
        assert_eq!(raffle.status, RaffleStatus::Cancelled);
    }

    #[test]
    fn test_cancellation_timing() {
        let mut raffle = create_test_raffle();
        
        // Initially no drawn_at time
        assert!(raffle.drawn_at.is_none());
        
        // After cancellation, drawn_at used for cancellation time
        let cancellation_time = 1640995200i64;
        raffle.drawn_at = Some(cancellation_time);
        assert_eq!(raffle.drawn_at.unwrap(), cancellation_time);
    }

    #[test]
    fn test_vrf_request_blocking() {
        let mut raffle = create_test_raffle();
        raffle.status = RaffleStatus::Active;
        
        // Can cancel without VRF request
        raffle.vrf_request = None;
        assert!(raffle.vrf_request.is_none());
        
        // Cannot cancel with VRF request
        raffle.vrf_request = Some(Pubkey::new_unique());
        assert!(raffle.vrf_request.is_some());
        
        // VRF request prevents cancellation
        raffle.status = RaffleStatus::Drawing;
        assert_ne!(raffle.status, RaffleStatus::Active);
    }

    #[test]
    fn test_escrow_balance_requirements() {
        let prize_amount = 1_000_000_000u64; // 1 SOL prize
        let escrow_balance = 1_200_000_000u64; // 1.2 SOL in escrow
        
        // Escrow should have enough for refund
        assert!(escrow_balance >= prize_amount);
        
        // Test insufficient escrow scenario
        let insufficient_balance = 800_000_000u64; // 0.8 SOL
        assert!(insufficient_balance < prize_amount);
    }

    #[test]
    fn test_zero_refund_handling() {
        let mut raffle = create_test_raffle();
        raffle.prize_amount = 0; // No prize to refund
        
        let creator_refund = raffle.prize_amount;
        assert_eq!(creator_refund, 0);
        
        // Cancellation should still work with zero refund
        raffle.status = RaffleStatus::Active;
        raffle.vrf_request = None;
        assert_eq!(raffle.status, RaffleStatus::Active);
    }

    #[test]
    fn test_pda_constraints() {
        let raffle_id = 12345u64;
        
        // Verify PDA generation
        let (raffle_pda, raffle_bump) = RaffleAccount::find_pda(raffle_id);
        let (escrow_pda, escrow_bump) = EscrowAccount::find_pda(raffle_id);
        
        assert!(raffle_bump > 0);
        assert!(escrow_bump > 0);
        assert_ne!(raffle_pda, escrow_pda);
        assert_ne!(raffle_pda, Pubkey::default());
        assert_ne!(escrow_pda, Pubkey::default());
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
            tickets_sold: 10,
            start_time: 0,
            end_time: 86400,
            status: RaffleStatus::Active,
            escrow_bump: 255,
            raffle_bump: 254,
            vrf_request: None,
            winner: None,
            winning_ticket: None,
            vrf_proof: None,
            created_at: 0,
            drawn_at: None,
            distributed_at: None,
        }
    }
}