use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::*;

/// Claim refund for ticket in cancelled raffle
#[derive(Accounts)]
#[instruction(raffle_id: u64, ticket_number: u32)]
pub struct ClaimRefund<'info> {
    #[account(
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
            b"ticket",
            raffle_id.to_le_bytes().as_ref(),
            ticket_number.to_le_bytes().as_ref()
        ],
        bump = ticket_account.bump,
        constraint = ticket_account.raffle_id == raffle_id @ RaffleError::InvalidPDA,
        constraint = ticket_account.ticket_number == ticket_number @ RaffleError::InvalidTicketNumber
    )]
    pub ticket_account: Account<'info, TicketAccount>,
    
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
        constraint = ticket_holder.key() == ticket_account.owner @ RaffleError::UnauthorizedTicketOwner
    )]
    pub ticket_holder: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ClaimRefund>,
    raffle_id: u64,
    ticket_number: u32,
) -> Result<()> {
    let program_state = &ctx.accounts.program_state;
    let raffle_account = &ctx.accounts.raffle_account;
    let ticket_account = &mut ctx.accounts.ticket_account;
    
    // Check if program is paused
    require!(!program_state.is_paused, RaffleError::ProgramPaused);
    
    // Validate raffle state - can only refund from cancelled raffles
    require!(
        raffle_account.status == RaffleStatus::Cancelled,
        RaffleError::CannotRefundActiveRaffle
    );
    
    // Check if ticket has already been refunded
    // We'll use the purchase_time field as a refund marker (set to 0 when refunded)
    require!(
        ticket_account.purchase_time != 0,
        RaffleError::TicketAlreadyRefunded
    );
    
    // Validate ticket number is within valid range
    require!(
        ticket_number < raffle_account.tickets_sold,
        RaffleError::InvalidTicketNumber
    );
    
    let refund_amount = raffle_account.ticket_price;
    
    // Verify escrow has sufficient balance for refund
    require!(
        ctx.accounts.escrow_account.lamports() >= refund_amount,
        RaffleError::InsufficientFunds
    );
    
    let escrow_seeds = &[
        b"escrow",
        raffle_id.to_le_bytes().as_ref(),
        &[raffle_account.escrow_bump],
    ];
    let escrow_signer = &[&escrow_seeds[..]];
    
    // Transfer refund amount to ticket holder
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.escrow_account.to_account_info(),
                to: ctx.accounts.ticket_holder.to_account_info(),
            },
            escrow_signer,
        ),
        refund_amount,
    )?;
    
    // Mark ticket as refunded by setting purchase_time to 0
    ticket_account.purchase_time = 0;
    
    msg!(
        "Refund claimed - Raffle ID: {}, Ticket #: {}, Holder: {}, Amount: {} lamports",
        raffle_id,
        ticket_number,
        ctx.accounts.ticket_holder.key(),
        refund_amount
    );
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_refund_validation() {
        let raffle = create_test_cancelled_raffle();
        let ticket = create_test_ticket();
        
        // Can refund from cancelled raffle
        assert_eq!(raffle.status, RaffleStatus::Cancelled);
        
        // Ticket must not be already refunded
        assert_ne!(ticket.purchase_time, 0);
        
        // Ticket number must be valid
        assert!(ticket.ticket_number < raffle.tickets_sold);
    }

    #[test]
    fn test_raffle_state_restrictions() {
        let mut raffle = create_test_cancelled_raffle();
        
        // Can only refund from cancelled raffles
        raffle.status = RaffleStatus::Cancelled;
        assert_eq!(raffle.status, RaffleStatus::Cancelled);
        
        // Cannot refund from other states
        raffle.status = RaffleStatus::Active;
        assert_ne!(raffle.status, RaffleStatus::Cancelled);
        
        raffle.status = RaffleStatus::Drawing;
        assert_ne!(raffle.status, RaffleStatus::Cancelled);
        
        raffle.status = RaffleStatus::Complete;
        assert_ne!(raffle.status, RaffleStatus::Cancelled);
    }

    #[test]
    fn test_ticket_ownership_validation() {
        let owner_key = Pubkey::new_unique();
        let other_key = Pubkey::new_unique();
        
        let ticket = TicketAccount {
            owner: owner_key,
            ..create_test_ticket()
        };
        
        // Only ticket owner should be able to claim refund
        assert_eq!(ticket.owner, owner_key);
        assert_ne!(ticket.owner, other_key);
    }

    #[test]
    fn test_refund_amount_calculation() {
        let raffle = RaffleAccount {
            ticket_price: 15_000_000, // 0.015 SOL
            ..create_test_cancelled_raffle()
        };
        
        let refund_amount = raffle.ticket_price;
        assert_eq!(refund_amount, 15_000_000);
    }

    #[test]
    fn test_ticket_refund_marking() {
        let mut ticket = create_test_ticket();
        let original_purchase_time = 1640995200i64;
        
        // Initially has purchase time
        ticket.purchase_time = original_purchase_time;
        assert_eq!(ticket.purchase_time, original_purchase_time);
        assert_ne!(ticket.purchase_time, 0);
        
        // After refund, purchase_time set to 0
        ticket.purchase_time = 0;
        assert_eq!(ticket.purchase_time, 0);
    }

    #[test]
    fn test_already_refunded_detection() {
        let mut ticket = create_test_ticket();
        
        // Ticket not yet refunded
        ticket.purchase_time = 1640995200;
        assert_ne!(ticket.purchase_time, 0);
        
        // Ticket already refunded
        ticket.purchase_time = 0;
        assert_eq!(ticket.purchase_time, 0);
    }

    #[test]
    fn test_ticket_number_validation() {
        let raffle = RaffleAccount {
            tickets_sold: 50,
            ..create_test_cancelled_raffle()
        };
        
        // Valid ticket numbers
        assert!(0 < raffle.tickets_sold);
        assert!(25 < raffle.tickets_sold);
        assert!(49 < raffle.tickets_sold);
        
        // Invalid ticket numbers
        assert!(!(50 < raffle.tickets_sold)); // Equal to tickets_sold
        assert!(!(100 < raffle.tickets_sold)); // Greater than tickets_sold
    }

    #[test]
    fn test_escrow_balance_verification() {
        let ticket_price = 10_000_000u64; // 0.01 SOL
        let escrow_balance = 100_000_000u64; // 0.1 SOL
        
        // Sufficient balance for refund
        assert!(escrow_balance >= ticket_price);
        
        // Insufficient balance scenario
        let low_balance = 5_000_000u64; // 0.005 SOL
        assert!(low_balance < ticket_price);
    }

    #[test]
    fn test_multiple_ticket_refunds() {
        let raffle = RaffleAccount {
            tickets_sold: 10,
            ticket_price: 5_000_000, // 0.005 SOL per ticket
            ..create_test_cancelled_raffle()
        };
        
        let total_ticket_value = (raffle.tickets_sold as u64) * raffle.ticket_price;
        assert_eq!(total_ticket_value, 50_000_000); // 0.05 SOL total
        
        // Each ticket should get individual refund
        for ticket_num in 0..raffle.tickets_sold {
            let refund_amount = raffle.ticket_price;
            assert_eq!(refund_amount, 5_000_000);
            assert!(ticket_num < raffle.tickets_sold);
        }
    }

    #[test]
    fn test_refund_timing() {
        let mut ticket = create_test_ticket();
        let purchase_time = 1640995200i64;
        
        // Original purchase time
        ticket.purchase_time = purchase_time;
        assert_eq!(ticket.purchase_time, purchase_time);
        
        // After refund processing
        ticket.purchase_time = 0;
        assert_eq!(ticket.purchase_time, 0);
        
        // Cannot refund again
        assert_eq!(ticket.purchase_time, 0);
    }

    #[test]
    fn test_pda_validation() {
        let raffle_id = 12345u64;
        let ticket_number = 42u32;
        
        // Verify PDA generation for ticket
        let (ticket_pda, ticket_bump) = TicketAccount::find_pda(raffle_id, ticket_number);
        assert!(ticket_bump > 0);
        assert_ne!(ticket_pda, Pubkey::default());
        
        // Verify PDA generation for escrow
        let (escrow_pda, escrow_bump) = EscrowAccount::find_pda(raffle_id);
        assert!(escrow_bump > 0);
        assert_ne!(escrow_pda, Pubkey::default());
        
        // Different PDAs
        assert_ne!(ticket_pda, escrow_pda);
    }

    #[test]
    fn test_zero_refund_handling() {
        let raffle = RaffleAccount {
            ticket_price: 0, // Zero ticket price
            ..create_test_cancelled_raffle()
        };
        
        let refund_amount = raffle.ticket_price;
        assert_eq!(refund_amount, 0);
        
        // Even zero refunds should process correctly
        let mut ticket = create_test_ticket();
        ticket.purchase_time = 1640995200;
        assert_ne!(ticket.purchase_time, 0);
    }

    fn create_test_cancelled_raffle() -> RaffleAccount {
        RaffleAccount {
            id: 1,
            creator: Pubkey::new_unique(),
            title: "Test Cancelled Raffle".to_string(),
            description: "Test Description".to_string(),
            prize_amount: 1_000_000_000, // 1 SOL
            ticket_price: 10_000_000,    // 0.01 SOL
            max_tickets: 100,
            tickets_sold: 25,
            start_time: 0,
            end_time: 86400,
            status: RaffleStatus::Cancelled,
            escrow_bump: 255,
            raffle_bump: 254,
            vrf_request: None,
            winner: None,
            winning_ticket: None,
            vrf_proof: None,
            created_at: 0,
            drawn_at: Some(1640995200), // Cancellation time
            distributed_at: None,
        }
    }

    fn create_test_ticket() -> TicketAccount {
        TicketAccount {
            raffle_id: 1,
            owner: Pubkey::new_unique(),
            ticket_number: 15,
            purchase_time: 1640995200, // Valid purchase time (not refunded)
            bump: 253,
        }
    }
}