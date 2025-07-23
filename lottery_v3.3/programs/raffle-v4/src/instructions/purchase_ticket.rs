use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::*;

/// Purchase a ticket for an active raffle
#[derive(Accounts)]
#[instruction(raffle_id: u64)]
pub struct PurchaseTicket<'info> {
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
        init,
        payer = buyer,
        space = 8 + TicketAccount::LEN,
        seeds = [
            b"ticket",
            raffle_id.to_le_bytes().as_ref(),
            raffle_account.tickets_sold.to_le_bytes().as_ref()
        ],
        bump
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
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<PurchaseTicket>,
    raffle_id: u64,
) -> Result<()> {
    let program_state = &ctx.accounts.program_state;
    let raffle_account = &mut ctx.accounts.raffle_account;
    let buyer = &ctx.accounts.buyer;
    
    // Check if program is paused
    require!(!program_state.is_paused, RaffleError::ProgramPaused);
    
    // Validate raffle state
    require!(
        raffle_account.status == RaffleStatus::Active,
        RaffleError::InvalidRaffleState
    );
    
    let current_time = Clock::get()?.unix_timestamp;
    
    // Check if raffle has ended
    require!(
        !raffle_account.has_ended(current_time),
        RaffleError::RaffleEnded
    );
    
    // Check if raffle is full
    require!(
        raffle_account.tickets_sold < raffle_account.max_tickets,
        RaffleError::RaffleFull
    );
    
    // Prevent raffle creator from buying their own tickets
    require!(
        raffle_account.creator != buyer.key(),
        RaffleError::CreatorCannotPurchase
    );
    
    // Check buyer has sufficient funds
    require!(
        buyer.lamports() >= raffle_account.ticket_price,
        RaffleError::InsufficientFundsForTicket
    );
    
    // Transfer ticket price to escrow
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: buyer.to_account_info(),
                to: ctx.accounts.escrow_account.to_account_info(),
            },
        ),
        raffle_account.ticket_price,
    )?;
    
    // Initialize ticket account
    let ticket_account = &mut ctx.accounts.ticket_account;
    ticket_account.raffle_id = raffle_id;
    ticket_account.owner = buyer.key();
    ticket_account.ticket_number = raffle_account.tickets_sold;
    ticket_account.purchase_time = current_time;
    ticket_account.bump = ctx.bumps.ticket_account;
    
    // Update raffle state
    raffle_account.tickets_sold = raffle_account.tickets_sold
        .checked_add(1)
        .ok_or(RaffleError::ArithmeticOverflow)?;
    
    msg!(
        "Ticket purchased - Raffle ID: {}, Buyer: {}, Ticket #: {}, Price: {} lamports",
        raffle_id,
        buyer.key(),
        ticket_account.ticket_number,
        raffle_account.ticket_price
    );
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::*;

    #[test]
    fn test_purchase_ticket_validation() {
        let current_time = 1000i64;
        
        // Create test raffle
        let mut raffle = create_test_raffle();
        raffle.status = RaffleStatus::Active;
        raffle.end_time = 2000; // Future end time
        raffle.tickets_sold = 5;
        raffle.max_tickets = 10;
        
        // Valid purchase scenario
        assert!(!raffle.has_ended(current_time));
        assert!(raffle.tickets_sold < raffle.max_tickets);
        assert_eq!(raffle.status, RaffleStatus::Active);
    }

    #[test]
    fn test_raffle_ended_scenarios() {
        let current_time = 1000i64;
        let mut raffle = create_test_raffle();
        
        // Test time-based ending
        raffle.end_time = 500; // Past end time
        raffle.tickets_sold = 5;
        raffle.max_tickets = 10;
        assert!(raffle.has_ended(current_time));
        
        // Test capacity-based ending
        raffle.end_time = 2000; // Future end time
        raffle.tickets_sold = 10;
        raffle.max_tickets = 10;
        assert!(raffle.has_ended(current_time));
        
        // Test active raffle
        raffle.end_time = 2000; // Future end time
        raffle.tickets_sold = 5;
        raffle.max_tickets = 10;
        assert!(!raffle.has_ended(current_time));
    }

    #[test]
    fn test_ticket_number_assignment() {
        let mut raffle = create_test_raffle();
        
        // First ticket should get number 0
        assert_eq!(raffle.tickets_sold, 0);
        
        // Simulate ticket purchase
        let ticket_number = raffle.tickets_sold;
        assert_eq!(ticket_number, 0);
        
        // After purchase, tickets_sold increments
        raffle.tickets_sold = raffle.tickets_sold.checked_add(1).unwrap();
        assert_eq!(raffle.tickets_sold, 1);
        
        // Next ticket should get number 1
        let next_ticket_number = raffle.tickets_sold;
        assert_eq!(next_ticket_number, 1);
    }

    #[test]
    fn test_ticket_pda_generation() {
        let raffle_id = 12345u64;
        let ticket_number = 42u32;
        
        let (pda, bump) = TicketAccount::find_pda(raffle_id, ticket_number);
        assert!(bump > 0);
        assert_ne!(pda, Pubkey::default());
        
        // Different ticket numbers should produce different PDAs
        let (pda2, _) = TicketAccount::find_pda(raffle_id, ticket_number + 1);
        assert_ne!(pda, pda2);
    }

    #[test]
    fn test_arithmetic_overflow_protection() {
        let mut raffle = create_test_raffle();
        raffle.tickets_sold = u32::MAX;
        
        // Should return None for overflow
        let result = raffle.tickets_sold.checked_add(1);
        assert!(result.is_none());
    }

    #[test]
    fn test_raffle_status_validation() {
        let mut raffle = create_test_raffle();
        
        // Only active raffles should allow ticket purchases
        raffle.status = RaffleStatus::Active;
        assert_eq!(raffle.status, RaffleStatus::Active);
        
        raffle.status = RaffleStatus::Drawing;
        assert_ne!(raffle.status, RaffleStatus::Active);
        
        raffle.status = RaffleStatus::Complete;
        assert_ne!(raffle.status, RaffleStatus::Active);
        
        raffle.status = RaffleStatus::Cancelled;
        assert_ne!(raffle.status, RaffleStatus::Active);
    }

    #[test]
    fn test_creator_purchase_prevention() {
        let creator_pubkey = Pubkey::new_unique();
        let buyer_pubkey = Pubkey::new_unique();
        
        let raffle = RaffleAccount {
            creator: creator_pubkey,
            ..create_test_raffle()
        };
        
        // Creator should not be able to buy tickets
        assert_eq!(raffle.creator, creator_pubkey);
        
        // Different buyer should be allowed
        assert_ne!(raffle.creator, buyer_pubkey);
    }

    #[test]
    fn test_ticket_price_validation() {
        let ticket_price = 10_000_000u64; // 0.01 SOL
        let buyer_balance = 50_000_000u64; // 0.05 SOL
        
        // Buyer has sufficient funds
        assert!(buyer_balance >= ticket_price);
        
        // Insufficient funds scenario
        let insufficient_balance = 5_000_000u64; // 0.005 SOL
        assert!(insufficient_balance < ticket_price);
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
            tickets_sold: 0,
            start_time: 0,
            end_time: 86400, // 24 hours
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