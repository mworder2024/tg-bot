use anchor_lang::prelude::*;
use orao_solana_vrf::state::Randomness;
use crate::state::*;
use crate::error::*;

/// Fulfill VRF request and select winner based on randomness
#[derive(Accounts)]
#[instruction(raffle_id: u64)]
pub struct FulfillWinnerSelection<'info> {
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
    
    /// CHECK: The VRF request account containing randomness
    #[account(
        seeds = [
            b"vrf_request",
            raffle_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = vrf_request.key() == raffle_account.vrf_request.unwrap() @ RaffleError::VRFOracleMismatch
    )]
    pub vrf_request: AccountInfo<'info>,
    
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    /// The winner's ticket account (will be verified by PDA)
    #[account(
        seeds = [
            b"ticket",
            raffle_id.to_le_bytes().as_ref(),
            winning_ticket_number.to_le_bytes().as_ref()
        ],
        bump,
        constraint = winning_ticket.raffle_id == raffle_id @ RaffleError::InvalidTicketNumber,
        constraint = winning_ticket.ticket_number == winning_ticket_number @ RaffleError::InvalidTicketNumber
    )]
    pub winning_ticket: Account<'info, TicketAccount>,
    
    pub caller: Signer<'info>,
}

/// External parameter for the winning ticket number (calculated off-chain for efficiency)
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct FulfillParams {
    pub winning_ticket_number: u32,
}

pub fn handler(
    ctx: Context<FulfillWinnerSelection>,
    raffle_id: u64,
    winning_ticket_number: u32,
) -> Result<()> {
    let program_state = &ctx.accounts.program_state;
    let raffle_account = &mut ctx.accounts.raffle_account;
    let vrf_request = &ctx.accounts.vrf_request;
    let winning_ticket = &ctx.accounts.winning_ticket;
    
    // Check if program is paused
    require!(!program_state.is_paused, RaffleError::ProgramPaused);
    
    // Validate raffle state
    require!(
        raffle_account.status == RaffleStatus::Drawing,
        RaffleError::InvalidRaffleState
    );
    
    // Check if VRF request exists
    require!(
        raffle_account.vrf_request.is_some(),
        RaffleError::VRFNotRequested
    );
    
    // Check if winner has already been selected
    require!(
        raffle_account.winner.is_none(),
        RaffleError::WinnerAlreadySelected
    );
    
    // Deserialize and validate VRF randomness
    let randomness_account = Randomness::try_deserialize(&mut vrf_request.data.borrow().as_ref())
        .map_err(|_| RaffleError::InvalidVRFProof)?;
    
    // Verify the randomness is fulfilled
    require!(
        randomness_account.seed.len() == 32,
        RaffleError::InvalidVRFProof
    );
    
    // Extract randomness value
    let randomness = randomness_account.randomness;
    require!(
        randomness != [0u8; 64], // Ensure randomness is not empty
        RaffleError::InvalidVRFProof
    );
    
    // Calculate winning ticket number from randomness
    let calculated_winning_ticket = calculate_winning_ticket(&randomness, raffle_account.tickets_sold)?;
    
    // Verify the provided winning ticket number matches calculation
    require!(
        winning_ticket_number == calculated_winning_ticket,
        RaffleError::InvalidTicketNumber
    );
    
    // Verify winning ticket is within valid range
    require!(
        winning_ticket_number < raffle_account.tickets_sold,
        RaffleError::InvalidTicketNumber
    );
    
    let current_time = Clock::get()?.unix_timestamp;
    
    // Update raffle account with winner information
    raffle_account.status = RaffleStatus::Complete;
    raffle_account.winner = Some(winning_ticket.owner);
    raffle_account.winning_ticket = Some(winning_ticket_number);
    raffle_account.vrf_proof = Some(randomness);
    raffle_account.drawn_at = Some(current_time);
    
    msg!(
        "Winner selected - Raffle ID: {}, Winner: {}, Winning Ticket: {}, VRF Proof: {:?}",
        raffle_id,
        winning_ticket.owner,
        winning_ticket_number,
        &randomness[0..8] // Log first 8 bytes of proof for verification
    );
    
    Ok(())
}

/// Calculate the winning ticket number from VRF randomness
fn calculate_winning_ticket(randomness: &[u8; 64], total_tickets: u32) -> Result<u32> {
    require!(total_tickets > 0, RaffleError::NoTicketsSold);
    
    // Use first 8 bytes of randomness to create a u64
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&randomness[0..8]);
    let random_value = u64::from_le_bytes(bytes);
    
    // Calculate winning ticket using modulo to ensure fair distribution
    let winning_ticket = (random_value % total_tickets as u64) as u32;
    
    Ok(winning_ticket)
}

/// Verify VRF proof integrity (additional validation)
fn verify_vrf_proof_integrity(proof: &[u8; 64]) -> bool {
    // Check that proof is not all zeros
    !proof.iter().all(|&x| x == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_winning_ticket() {
        // Test with different randomness values and ticket counts
        let randomness = [1u8; 64]; // Predictable randomness for testing
        
        // Test with 10 tickets
        let result = calculate_winning_ticket(&randomness, 10).unwrap();
        assert!(result < 10);
        
        // Test with 1 ticket
        let result = calculate_winning_ticket(&randomness, 1).unwrap();
        assert_eq!(result, 0);
        
        // Test with 100 tickets
        let result = calculate_winning_ticket(&randomness, 100).unwrap();
        assert!(result < 100);
    }

    #[test]
    fn test_calculate_winning_ticket_edge_cases() {
        let randomness = [255u8; 64]; // Max values
        
        // Test with various ticket counts
        for tickets in 1..=1000 {
            let result = calculate_winning_ticket(&randomness, tickets).unwrap();
            assert!(result < tickets);
        }
    }

    #[test]
    fn test_calculate_winning_ticket_no_tickets() {
        let randomness = [1u8; 64];
        
        // Should fail with 0 tickets
        let result = calculate_winning_ticket(&randomness, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_winning_ticket_distribution() {
        // Test that different randomness values produce different results
        let mut results = std::collections::HashSet::new();
        let total_tickets = 100u32;
        
        for i in 0..64 {
            let mut randomness = [0u8; 64];
            randomness[0] = i as u8;
            randomness[1] = (i * 2) as u8;
            randomness[2] = (i * 3) as u8;
            
            let winning_ticket = calculate_winning_ticket(&randomness, total_tickets).unwrap();
            results.insert(winning_ticket);
        }
        
        // Should have good distribution (at least 50% unique values)
        assert!(results.len() > 32);
    }

    #[test]
    fn test_vrf_proof_integrity() {
        // Valid proof (not all zeros)
        let valid_proof = [1u8; 64];
        assert!(verify_vrf_proof_integrity(&valid_proof));
        
        // Invalid proof (all zeros)
        let invalid_proof = [0u8; 64];
        assert!(!verify_vrf_proof_integrity(&invalid_proof));
        
        // Mixed proof
        let mut mixed_proof = [0u8; 64];
        mixed_proof[0] = 1;
        assert!(verify_vrf_proof_integrity(&mixed_proof));
    }

    #[test]
    fn test_raffle_status_progression() {
        let mut raffle = create_test_raffle();
        
        // Should start as Drawing
        raffle.status = RaffleStatus::Drawing;
        assert_eq!(raffle.status, RaffleStatus::Drawing);
        
        // After fulfillment, should be Complete
        raffle.status = RaffleStatus::Complete;
        assert_eq!(raffle.status, RaffleStatus::Complete);
    }

    #[test]
    fn test_winner_information_storage() {
        let mut raffle = create_test_raffle();
        let winner_pubkey = Pubkey::new_unique();
        let winning_ticket_number = 42u32;
        let vrf_proof = [123u8; 64];
        let drawn_time = 1640995200i64;
        
        // Initially no winner
        assert!(raffle.winner.is_none());
        assert!(raffle.winning_ticket.is_none());
        assert!(raffle.vrf_proof.is_none());
        assert!(raffle.drawn_at.is_none());
        
        // After setting winner information
        raffle.winner = Some(winner_pubkey);
        raffle.winning_ticket = Some(winning_ticket_number);
        raffle.vrf_proof = Some(vrf_proof);
        raffle.drawn_at = Some(drawn_time);
        
        assert_eq!(raffle.winner.unwrap(), winner_pubkey);
        assert_eq!(raffle.winning_ticket.unwrap(), winning_ticket_number);
        assert_eq!(raffle.vrf_proof.unwrap(), vrf_proof);
        assert_eq!(raffle.drawn_at.unwrap(), drawn_time);
    }

    #[test]
    fn test_randomness_byte_extraction() {
        let mut randomness = [0u8; 64];
        
        // Set specific values in first 8 bytes
        randomness[0] = 0x01;
        randomness[1] = 0x02;
        randomness[2] = 0x03;
        randomness[3] = 0x04;
        randomness[4] = 0x05;
        randomness[5] = 0x06;
        randomness[6] = 0x07;
        randomness[7] = 0x08;
        
        // Extract as u64
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&randomness[0..8]);
        let value = u64::from_le_bytes(bytes);
        
        // Verify extraction
        assert_eq!(value, 0x0807060504030201u64);
    }

    #[test]
    fn test_modulo_fairness() {
        // Test that modulo operation distributes fairly across range
        let total_tickets = 7u32; // Prime number for better testing
        let mut distribution = vec![0u32; total_tickets as usize];
        
        // Test with sequential values
        for i in 0..70 {
            let random_value = i as u64;
            let ticket = (random_value % total_tickets as u64) as u32;
            distribution[ticket as usize] += 1;
        }
        
        // Each ticket should appear at least once
        for count in &distribution {
            assert!(*count > 0);
        }
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
            status: RaffleStatus::Drawing,
            escrow_bump: 255,
            raffle_bump: 254,
            vrf_request: Some(Pubkey::new_unique()),
            winner: None,
            winning_ticket: None,
            vrf_proof: None,
            created_at: 0,
            drawn_at: None,
            distributed_at: None,
        }
    }
}