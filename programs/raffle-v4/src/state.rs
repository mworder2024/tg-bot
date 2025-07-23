use anchor_lang::prelude::*;

/// Global program state configuration
#[account]
pub struct ProgramState {
    /// Program authority (admin)
    pub authority: Pubkey,
    
    /// Treasury wallet for fee collection
    pub treasury: Pubkey,
    
    /// Platform fee rate in basis points (e.g., 100 = 1%)
    pub fee_rate: u16,
    
    /// Total number of raffles created
    pub total_raffles: u64,
    
    /// Total volume processed (in lamports)
    pub total_volume: u64,
    
    /// Whether the program is paused
    pub is_paused: bool,
    
    /// PDA bump seed
    pub bump: u8,
}

impl ProgramState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // treasury  
        2 + // fee_rate
        8 + // total_raffles
        8 + // total_volume
        1 + // is_paused
        1; // bump

    /// Find the program state PDA
    pub fn find_pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"program_state"], &crate::ID)
    }

    /// Validate fee rate is within acceptable bounds
    pub fn validate_fee_rate(fee_rate: u16) -> Result<()> {
        require!(fee_rate <= 1000, crate::error::RaffleError::InvalidFeeRate);
        Ok(())
    }
}

/// Individual raffle account
#[account]
pub struct RaffleAccount {
    /// Unique raffle identifier
    pub id: u64,
    
    /// Raffle creator's wallet
    pub creator: Pubkey,
    
    /// Raffle title (max 200 characters)
    pub title: String,
    
    /// Raffle description (max 1000 characters)
    pub description: String,
    
    /// Prize amount in lamports
    pub prize_amount: u64,
    
    /// Price per ticket in lamports
    pub ticket_price: u64,
    
    /// Maximum number of tickets
    pub max_tickets: u32,
    
    /// Current number of tickets sold
    pub tickets_sold: u32,
    
    /// Raffle start timestamp
    pub start_time: i64,
    
    /// Raffle end timestamp
    pub end_time: i64,
    
    /// Current raffle status
    pub status: RaffleStatus,
    
    /// Escrow account PDA bump
    pub escrow_bump: u8,
    
    /// Raffle account PDA bump
    pub raffle_bump: u8,
    
    /// VRF request account (if drawing)
    pub vrf_request: Option<Pubkey>,
    
    /// Winner's wallet (if determined)
    pub winner: Option<Pubkey>,
    
    /// Winning ticket number
    pub winning_ticket: Option<u32>,
    
    /// VRF proof for verification
    pub vrf_proof: Option<[u8; 64]>,
    
    /// Creation timestamp
    pub created_at: i64,
    
    /// Draw completion timestamp
    pub drawn_at: Option<i64>,
    
    /// Prize distribution timestamp
    pub distributed_at: Option<i64>,
}

impl RaffleAccount {
    pub const MAX_TITLE_LEN: usize = 200;
    pub const MAX_DESCRIPTION_LEN: usize = 1000;
    
    pub const LEN: usize = 8 + // discriminator
        8 + // id
        32 + // creator
        4 + Self::MAX_TITLE_LEN + // title (String)
        4 + Self::MAX_DESCRIPTION_LEN + // description (String)
        8 + // prize_amount
        8 + // ticket_price
        4 + // max_tickets
        4 + // tickets_sold
        8 + // start_time
        8 + // end_time
        1 + // status
        1 + // escrow_bump
        1 + // raffle_bump
        1 + 32 + // vrf_request (Option<Pubkey>)
        1 + 32 + // winner (Option<Pubkey>)
        1 + 4 + // winning_ticket (Option<u32>)
        1 + 64 + // vrf_proof (Option<[u8; 64]>)
        8 + // created_at
        1 + 8 + // drawn_at (Option<i64>)
        1 + 8; // distributed_at (Option<i64>)

    /// Find the raffle account PDA
    pub fn find_pda(raffle_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"raffle", raffle_id.to_le_bytes().as_ref()],
            &crate::ID,
        )
    }

    /// Check if raffle has ended
    pub fn has_ended(&self, current_time: i64) -> bool {
        current_time >= self.end_time || self.tickets_sold >= self.max_tickets
    }

    /// Check if raffle can be drawn
    pub fn can_be_drawn(&self, current_time: i64) -> bool {
        self.status == RaffleStatus::Active
            && self.has_ended(current_time)
            && self.tickets_sold > 0
    }

    /// Check if prize can be distributed
    pub fn can_distribute_prize(&self) -> bool {
        self.status == RaffleStatus::Complete
            && self.winner.is_some()
            && self.distributed_at.is_none()
    }

    /// Calculate total collected amount
    pub fn total_collected(&self) -> u64 {
        (self.tickets_sold as u64) * self.ticket_price
    }

    /// Calculate platform fee
    pub fn calculate_fee(&self, fee_rate: u16) -> u64 {
        (self.total_collected() * fee_rate as u64) / 10000
    }

    /// Calculate winner prize amount
    pub fn calculate_winner_amount(&self, fee_rate: u16) -> u64 {
        self.total_collected() - self.calculate_fee(fee_rate)
    }

    /// Validate raffle parameters
    pub fn validate_params(params: &crate::instructions::CreateRaffleParams) -> Result<()> {
        // Validate title length
        require!(
            params.title.len() <= Self::MAX_TITLE_LEN,
            crate::error::RaffleError::TitleTooLong
        );

        // Validate description length
        require!(
            params.description.len() <= Self::MAX_DESCRIPTION_LEN,
            crate::error::RaffleError::DescriptionTooLong
        );

        // Validate prize amount (minimum 0.1 SOL)
        require!(
            params.prize_amount >= 100_000_000,
            crate::error::RaffleError::PrizeAmountTooSmall
        );

        // Validate ticket price (minimum 0.001 SOL)
        require!(
            params.ticket_price >= 1_000_000,
            crate::error::RaffleError::TicketPriceTooSmall
        );

        // Validate max tickets
        require!(
            params.max_tickets > 0 && params.max_tickets <= 10_000,
            crate::error::RaffleError::InvalidMaxTickets
        );

        // Validate duration (1 hour to 30 days)
        require!(
            params.duration >= 3600 && params.duration <= 2_592_000,
            crate::error::RaffleError::InvalidDuration
        );

        Ok(())
    }
}

/// Ticket account for individual raffle entries
#[account]
pub struct TicketAccount {
    /// Associated raffle ID
    pub raffle_id: u64,
    
    /// Ticket owner's wallet
    pub owner: Pubkey,
    
    /// Sequential ticket number
    pub ticket_number: u32,
    
    /// Purchase timestamp
    pub purchase_time: i64,
    
    /// PDA bump seed
    pub bump: u8,
}

impl TicketAccount {
    pub const LEN: usize = 8 + // discriminator
        8 + // raffle_id
        32 + // owner
        4 + // ticket_number
        8 + // purchase_time
        1; // bump

    /// Find the ticket account PDA
    pub fn find_pda(raffle_id: u64, ticket_number: u32) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                b"ticket",
                raffle_id.to_le_bytes().as_ref(),
                ticket_number.to_le_bytes().as_ref(),
            ],
            &crate::ID,
        )
    }
}

/// Escrow account to hold raffle funds
#[account]
pub struct EscrowAccount {
    /// Associated raffle ID
    pub raffle_id: u64,
    
    /// PDA bump seed
    pub bump: u8,
}

impl EscrowAccount {
    pub const LEN: usize = 8 + // discriminator
        8 + // raffle_id
        1; // bump

    /// Find the escrow account PDA
    pub fn find_pda(raffle_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"escrow", raffle_id.to_le_bytes().as_ref()],
            &crate::ID,
        )
    }
}

/// Possible raffle states
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RaffleStatus {
    /// Raffle is active and accepting tickets
    Active,
    
    /// Raffle is in drawing process (VRF requested)
    Drawing,
    
    /// Raffle is complete with winner selected
    Complete,
    
    /// Raffle has been cancelled (refunds available)
    Cancelled,
}

impl Default for RaffleStatus {
    fn default() -> Self {
        RaffleStatus::Active
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_program_state_pda() {
        let (pda, bump) = ProgramState::find_pda();
        assert!(bump > 0);
        assert_ne!(pda, Pubkey::default());
    }

    #[test]
    fn test_validate_fee_rate() {
        // Valid fee rates
        assert!(ProgramState::validate_fee_rate(0).is_ok());
        assert!(ProgramState::validate_fee_rate(100).is_ok());
        assert!(ProgramState::validate_fee_rate(1000).is_ok());
        
        // Invalid fee rates
        assert!(ProgramState::validate_fee_rate(1001).is_err());
        assert!(ProgramState::validate_fee_rate(5000).is_err());
    }

    #[test]
    fn test_raffle_account_pda() {
        let raffle_id = 12345u64;
        let (pda, bump) = RaffleAccount::find_pda(raffle_id);
        assert!(bump > 0);
        assert_ne!(pda, Pubkey::default());
    }

    #[test]
    fn test_ticket_account_pda() {
        let raffle_id = 12345u64;
        let ticket_number = 42u32;
        let (pda, bump) = TicketAccount::find_pda(raffle_id, ticket_number);
        assert!(bump > 0);
        assert_ne!(pda, Pubkey::default());
    }

    #[test]
    fn test_escrow_account_pda() {
        let raffle_id = 12345u64;
        let (pda, bump) = EscrowAccount::find_pda(raffle_id);
        assert!(bump > 0);
        assert_ne!(pda, Pubkey::default());
    }

    #[test]
    fn test_raffle_has_ended() {
        let mut raffle = create_test_raffle();
        let current_time = 1000i64;
        
        // Not ended if before end time and not full
        raffle.end_time = 2000;
        raffle.tickets_sold = 5;
        raffle.max_tickets = 10;
        assert!(!raffle.has_ended(current_time));
        
        // Ended if after end time
        raffle.end_time = 500;
        assert!(raffle.has_ended(current_time));
        
        // Ended if full
        raffle.end_time = 2000;
        raffle.tickets_sold = 10;
        assert!(raffle.has_ended(current_time));
    }

    #[test]
    fn test_calculate_amounts() {
        let mut raffle = create_test_raffle();
        raffle.ticket_price = 1_000_000; // 0.001 SOL
        raffle.tickets_sold = 100;
        
        let fee_rate = 300; // 3%
        
        let total_collected = raffle.total_collected();
        assert_eq!(total_collected, 100_000_000); // 0.1 SOL
        
        let fee = raffle.calculate_fee(fee_rate);
        assert_eq!(fee, 3_000_000); // 0.003 SOL
        
        let winner_amount = raffle.calculate_winner_amount(fee_rate);
        assert_eq!(winner_amount, 97_000_000); // 0.097 SOL
    }

    fn create_test_raffle() -> RaffleAccount {
        RaffleAccount {
            id: 1,
            creator: Pubkey::default(),
            title: "Test Raffle".to_string(),
            description: "Test Description".to_string(),
            prize_amount: 1_000_000_000,
            ticket_price: 10_000_000,
            max_tickets: 100,
            tickets_sold: 0,
            start_time: 0,
            end_time: 1000,
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