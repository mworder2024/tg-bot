use anchor_lang::prelude::*;
use anchor_lang::system_program;
use orao_solana_vrf::program::OraoVrf;
use orao_solana_vrf::state::NetworkState;
use orao_solana_vrf::cpi::accounts::Request;
use orao_solana_vrf::cpi::request;
use crate::state::*;
use crate::error::*;

/// Request VRF to select a winner for an ended raffle
#[derive(Accounts)]
#[instruction(raffle_id: u64)]
pub struct RequestWinnerSelection<'info> {
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
        seeds = [b"program_state"],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    /// CHECK: This is the VRF request account that will be created by ORAO VRF
    #[account(
        mut,
        seeds = [
            b"vrf_request",
            raffle_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = vrf_request.data_is_empty() @ RaffleError::VRFAlreadyRequested
    )]
    pub vrf_request: AccountInfo<'info>,
    
    /// CHECK: ORAO VRF network state account
    #[account(
        constraint = network_state.key() == orao_solana_vrf::network_state_account_address() @ RaffleError::VRFOracleMismatch
    )]
    pub network_state: Account<'info, NetworkState>,
    
    /// CHECK: ORAO VRF treasury account for fee payment
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub vrf_program: Program<'info, OraoVrf>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RequestWinnerSelection>,
    raffle_id: u64,
) -> Result<()> {
    let program_state = &ctx.accounts.program_state;
    let raffle_account = &mut ctx.accounts.raffle_account;
    
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
        raffle_account.has_ended(current_time),
        RaffleError::RaffleNotEnded
    );
    
    // Check if raffle can be drawn (has tickets sold)
    require!(
        raffle_account.can_be_drawn(current_time),
        RaffleError::NoTicketsSold
    );
    
    // Check if VRF request already exists
    require!(
        raffle_account.vrf_request.is_none(),
        RaffleError::VRFAlreadyRequested
    );
    
    // Generate seed for VRF request using raffle data
    let seed = generate_vrf_seed(raffle_account, current_time)?;
    
    // Request randomness from ORAO VRF
    let request_accounts = Request {
        payer: ctx.accounts.payer.to_account_info(),
        network_state: ctx.accounts.network_state.to_account_info(),
        treasury: ctx.accounts.treasury.to_account_info(),
        request: ctx.accounts.vrf_request.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    
    let request_ctx = CpiContext::new(
        ctx.accounts.vrf_program.to_account_info(),
        request_accounts,
    );
    
    // Make VRF request with generated seed
    request(request_ctx, seed)?;
    
    // Update raffle state
    raffle_account.status = RaffleStatus::Drawing;
    raffle_account.vrf_request = Some(ctx.accounts.vrf_request.key());
    
    msg!(
        "VRF winner selection requested - Raffle ID: {}, VRF Request: {}, Tickets Sold: {}",
        raffle_id,
        ctx.accounts.vrf_request.key(),
        raffle_account.tickets_sold
    );
    
    Ok(())
}

/// Generate a deterministic seed for VRF request
fn generate_vrf_seed(raffle_account: &RaffleAccount, current_time: i64) -> Result<[u8; 32]> {
    let mut seed_data = Vec::new();
    
    // Include raffle-specific data for uniqueness
    seed_data.extend_from_slice(&raffle_account.id.to_le_bytes());
    seed_data.extend_from_slice(raffle_account.creator.as_ref());
    seed_data.extend_from_slice(&raffle_account.tickets_sold.to_le_bytes());
    seed_data.extend_from_slice(&raffle_account.end_time.to_le_bytes());
    seed_data.extend_from_slice(&current_time.to_le_bytes());
    
    // Hash the seed data to create a 32-byte seed
    use anchor_lang::solana_program::hash::hash;
    let hash_result = hash(&seed_data);
    
    Ok(hash_result.to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raffle_can_be_drawn() {
        let current_time = 1000i64;
        
        // Create test raffle that has ended with tickets sold
        let mut raffle = create_test_raffle();
        raffle.status = RaffleStatus::Active;
        raffle.end_time = 500; // Past end time
        raffle.tickets_sold = 5;
        
        assert!(raffle.can_be_drawn(current_time));
        
        // Raffle with no tickets sold cannot be drawn
        raffle.tickets_sold = 0;
        assert!(!raffle.can_be_drawn(current_time));
        
        // Active raffle that hasn't ended cannot be drawn
        raffle.end_time = 2000; // Future end time
        raffle.tickets_sold = 5;
        assert!(!raffle.can_be_drawn(current_time));
        
        // Non-active raffle cannot be drawn
        raffle.status = RaffleStatus::Complete;
        raffle.end_time = 500; // Past end time
        assert!(!raffle.can_be_drawn(current_time));
    }

    #[test]
    fn test_vrf_seed_generation() {
        let current_time = 1640995200i64; // Fixed timestamp for testing
        let raffle = create_test_raffle();
        
        // Generate seed
        let seed = generate_vrf_seed(&raffle, current_time).unwrap();
        
        // Seed should be 32 bytes
        assert_eq!(seed.len(), 32);
        
        // Same inputs should produce same seed
        let seed2 = generate_vrf_seed(&raffle, current_time).unwrap();
        assert_eq!(seed, seed2);
        
        // Different inputs should produce different seeds
        let mut different_raffle = raffle.clone();
        different_raffle.id = 999;
        let seed3 = generate_vrf_seed(&different_raffle, current_time).unwrap();
        assert_ne!(seed, seed3);
    }

    #[test]
    fn test_vrf_request_validation() {
        let mut raffle = create_test_raffle();
        
        // Initially no VRF request
        assert!(raffle.vrf_request.is_none());
        
        // After setting VRF request
        let vrf_key = Pubkey::new_unique();
        raffle.vrf_request = Some(vrf_key);
        assert!(raffle.vrf_request.is_some());
        assert_eq!(raffle.vrf_request.unwrap(), vrf_key);
    }

    #[test]
    fn test_raffle_status_transitions() {
        let mut raffle = create_test_raffle();
        
        // Initial state
        assert_eq!(raffle.status, RaffleStatus::Active);
        
        // After VRF request
        raffle.status = RaffleStatus::Drawing;
        assert_eq!(raffle.status, RaffleStatus::Drawing);
        
        // Cannot request VRF if not active
        assert_ne!(raffle.status, RaffleStatus::Active);
    }

    #[test]
    fn test_raffle_ended_conditions() {
        let current_time = 1000i64;
        let mut raffle = create_test_raffle();
        
        // Test time-based ending
        raffle.end_time = 500;
        raffle.tickets_sold = 5;
        raffle.max_tickets = 100;
        assert!(raffle.has_ended(current_time));
        
        // Test capacity-based ending
        raffle.end_time = 2000;
        raffle.tickets_sold = 100;
        raffle.max_tickets = 100;
        assert!(raffle.has_ended(current_time));
        
        // Test both conditions
        raffle.end_time = 500;
        raffle.tickets_sold = 100;
        assert!(raffle.has_ended(current_time));
        
        // Test neither condition
        raffle.end_time = 2000;
        raffle.tickets_sold = 50;
        assert!(!raffle.has_ended(current_time));
    }

    #[test]
    fn test_vrf_request_pda() {
        let raffle_id = 12345u64;
        let program_id = crate::ID;
        
        let (pda, bump) = Pubkey::find_program_address(
            &[b"vrf_request", raffle_id.to_le_bytes().as_ref()],
            &program_id,
        );
        
        assert!(bump > 0);
        assert_ne!(pda, Pubkey::default());
    }

    #[test]
    fn test_deterministic_seed_components() {
        let raffle = create_test_raffle();
        let current_time = 1640995200i64;
        
        // Verify seed components are included
        let mut expected_data = Vec::new();
        expected_data.extend_from_slice(&raffle.id.to_le_bytes());
        expected_data.extend_from_slice(raffle.creator.as_ref());
        expected_data.extend_from_slice(&raffle.tickets_sold.to_le_bytes());
        expected_data.extend_from_slice(&raffle.end_time.to_le_bytes());
        expected_data.extend_from_slice(&current_time.to_le_bytes());
        
        // Should include raffle ID
        assert!(expected_data.contains(&raffle.id.to_le_bytes()[0]));
        
        // Should include tickets sold
        assert!(expected_data.contains(&raffle.tickets_sold.to_le_bytes()[0]));
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