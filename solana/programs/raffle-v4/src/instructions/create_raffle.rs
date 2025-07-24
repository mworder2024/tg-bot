use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::*;

/// Parameters for creating a new raffle
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateRaffleParams {
    /// Unique raffle identifier
    pub raffle_id: u64,
    
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
    
    /// Duration in seconds from creation
    pub duration: i64,
}

/// Create a new raffle
#[derive(Accounts)]
#[instruction(params: CreateRaffleParams)]
pub struct CreateRaffle<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + RaffleAccount::LEN,
        seeds = [
            b"raffle",
            params.raffle_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub raffle_account: Account<'info, RaffleAccount>,
    
    #[account(
        init,
        payer = creator,
        space = 8 + EscrowAccount::LEN,
        seeds = [
            b"escrow",
            params.raffle_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    
    #[account(
        mut,
        seeds = [b"program_state"],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateRaffle>,
    params: CreateRaffleParams,
) -> Result<()> {
    let program_state = &ctx.accounts.program_state;
    
    // Check if program is paused
    require!(!program_state.is_paused, RaffleError::ProgramPaused);
    
    // Validate raffle parameters
    RaffleAccount::validate_params(&params)?;
    
    let current_time = Clock::get()?.unix_timestamp;
    let end_time = current_time.checked_add(params.duration)
        .ok_or(RaffleError::ArithmeticOverflow)?;
    
    // Calculate required funds (prize + platform fee + rent)
    let platform_fee = (params.prize_amount * program_state.fee_rate as u64) / 10000;
    let rent_exemption = Rent::get()?.minimum_balance(8 + EscrowAccount::LEN);
    let total_required = params.prize_amount
        .checked_add(platform_fee)
        .ok_or(RaffleError::ArithmeticOverflow)?
        .checked_add(rent_exemption)
        .ok_or(RaffleError::ArithmeticOverflow)?;
    
    // Check creator has sufficient funds
    require!(
        ctx.accounts.creator.lamports() >= total_required,
        RaffleError::InsufficientFunds
    );
    
    // Transfer prize amount to escrow
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.escrow_account.to_account_info(),
            },
        ),
        params.prize_amount,
    )?;
    
    // Initialize raffle account
    let raffle_account = &mut ctx.accounts.raffle_account;
    raffle_account.id = params.raffle_id;
    raffle_account.creator = ctx.accounts.creator.key();
    raffle_account.title = params.title;
    raffle_account.description = params.description;
    raffle_account.prize_amount = params.prize_amount;
    raffle_account.ticket_price = params.ticket_price;
    raffle_account.max_tickets = params.max_tickets;
    raffle_account.tickets_sold = 0;
    raffle_account.start_time = current_time;
    raffle_account.end_time = end_time;
    raffle_account.status = RaffleStatus::Active;
    raffle_account.escrow_bump = ctx.bumps.escrow_account;
    raffle_account.raffle_bump = ctx.bumps.raffle_account;
    raffle_account.vrf_request = None;
    raffle_account.winner = None;
    raffle_account.winning_ticket = None;
    raffle_account.vrf_proof = None;
    raffle_account.created_at = current_time;
    raffle_account.drawn_at = None;
    raffle_account.distributed_at = None;
    
    // Initialize escrow account
    let escrow_account = &mut ctx.accounts.escrow_account;
    escrow_account.raffle_id = params.raffle_id;
    escrow_account.bump = ctx.bumps.escrow_account;
    
    // Update program state
    let program_state = &mut ctx.accounts.program_state;
    program_state.total_raffles = program_state.total_raffles
        .checked_add(1)
        .ok_or(RaffleError::ArithmeticOverflow)?;
    
    msg!(
        "Raffle created - ID: {}, Creator: {}, Prize: {} lamports, Max Tickets: {}",
        params.raffle_id,
        ctx.accounts.creator.key(),
        params.prize_amount,
        params.max_tickets
    );
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_raffle_params_validation() {
        // Valid parameters
        let valid_params = CreateRaffleParams {
            raffle_id: 1,
            title: "Test Raffle".to_string(),
            description: "A test raffle".to_string(),
            prize_amount: 1_000_000_000, // 1 SOL
            ticket_price: 10_000_000,    // 0.01 SOL
            max_tickets: 100,
            duration: 86400, // 24 hours
        };
        assert!(RaffleAccount::validate_params(&valid_params).is_ok());
        
        // Title too long
        let invalid_title = CreateRaffleParams {
            title: "x".repeat(201),
            ..valid_params.clone()
        };
        assert!(RaffleAccount::validate_params(&invalid_title).is_err());
        
        // Description too long
        let invalid_description = CreateRaffleParams {
            description: "x".repeat(1001),
            ..valid_params.clone()
        };
        assert!(RaffleAccount::validate_params(&invalid_description).is_err());
        
        // Prize amount too small
        let invalid_prize = CreateRaffleParams {
            prize_amount: 50_000_000, // 0.05 SOL (less than 0.1 SOL minimum)
            ..valid_params.clone()
        };
        assert!(RaffleAccount::validate_params(&invalid_prize).is_err());
        
        // Ticket price too small
        let invalid_ticket_price = CreateRaffleParams {
            ticket_price: 500_000, // 0.0005 SOL (less than 0.001 SOL minimum)
            ..valid_params.clone()
        };
        assert!(RaffleAccount::validate_params(&invalid_ticket_price).is_err());
        
        // Max tickets too high
        let invalid_max_tickets = CreateRaffleParams {
            max_tickets: 15_000, // More than 10,000 maximum
            ..valid_params.clone()
        };
        assert!(RaffleAccount::validate_params(&invalid_max_tickets).is_err());
        
        // Duration too short
        let invalid_duration_short = CreateRaffleParams {
            duration: 1800, // 30 minutes (less than 1 hour minimum)
            ..valid_params.clone()
        };
        assert!(RaffleAccount::validate_params(&invalid_duration_short).is_err());
        
        // Duration too long
        let invalid_duration_long = CreateRaffleParams {
            duration: 3_000_000, // More than 30 days
            ..valid_params.clone()
        };
        assert!(RaffleAccount::validate_params(&invalid_duration_long).is_err());
    }

    #[test]
    fn test_raffle_and_escrow_pda() {
        let raffle_id = 12345u64;
        
        // Test raffle PDA
        let (raffle_pda, raffle_bump) = RaffleAccount::find_pda(raffle_id);
        assert!(raffle_bump > 0);
        assert_ne!(raffle_pda, Pubkey::default());
        
        // Test escrow PDA
        let (escrow_pda, escrow_bump) = EscrowAccount::find_pda(raffle_id);
        assert!(escrow_bump > 0);
        assert_ne!(escrow_pda, Pubkey::default());
        
        // PDAs should be different
        assert_ne!(raffle_pda, escrow_pda);
    }

    #[test]
    fn test_calculate_required_funds() {
        let prize_amount = 1_000_000_000u64; // 1 SOL
        let fee_rate = 300u16; // 3%
        let rent_exemption = 2_039_280u64; // Typical rent exemption
        
        // Calculate platform fee
        let platform_fee = (prize_amount * fee_rate as u64) / 10000;
        assert_eq!(platform_fee, 30_000_000); // 0.03 SOL
        
        // Calculate total required
        let total_required = prize_amount + platform_fee + rent_exemption;
        assert_eq!(total_required, 1_032_039_280); // ~1.032 SOL
    }
}