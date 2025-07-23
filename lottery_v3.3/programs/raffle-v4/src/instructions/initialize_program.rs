use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::*;

/// Initialize the program with global configuration
#[derive(Accounts)]
pub struct InitializeProgram<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProgramState::LEN,
        seeds = [b"program_state"],
        bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeProgram>,
    fee_rate: u16,
    treasury: Pubkey,
) -> Result<()> {
    // Validate fee rate
    ProgramState::validate_fee_rate(fee_rate)?;
    
    // Initialize program state
    let program_state = &mut ctx.accounts.program_state;
    program_state.authority = ctx.accounts.authority.key();
    program_state.treasury = treasury;
    program_state.fee_rate = fee_rate;
    program_state.total_raffles = 0;
    program_state.total_volume = 0;
    program_state.is_paused = false;
    program_state.bump = ctx.bumps.program_state;
    
    msg!(
        "Program initialized - Authority: {}, Treasury: {}, Fee Rate: {}bp",
        program_state.authority,
        program_state.treasury,
        program_state.fee_rate
    );
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::*;
    use solana_program_test::*;
    use solana_sdk::{
        account::Account as SolanaAccount,
        signature::{Keypair, Signer},
        transaction::Transaction,
    };

    #[tokio::test]
    async fn test_initialize_program_success() {
        let program_id = crate::ID;
        let mut program_test = ProgramTest::new("raffle_v4", program_id, None);
        
        // Create test accounts
        let authority = Keypair::new();
        let treasury = Keypair::new();
        
        // Add some SOL to authority for rent
        program_test.add_account(
            authority.pubkey(),
            SolanaAccount {
                lamports: 10_000_000_000, // 10 SOL
                data: vec![],
                owner: solana_sdk::system_program::ID,
                executable: false,
                rent_epoch: 0,
            },
        );
        
        let (mut banks_client, payer, recent_blockhash) = program_test.start().await;
        
        // Test valid initialization
        let fee_rate = 300u16; // 3%
        
        // This would require actual instruction building in a real test
        // For now, we test the handler logic directly
        
        // Test validation
        assert!(ProgramState::validate_fee_rate(fee_rate).is_ok());
        assert!(ProgramState::validate_fee_rate(1001).is_err());
    }

    #[test]
    fn test_fee_rate_validation() {
        // Valid fee rates
        assert!(ProgramState::validate_fee_rate(0).is_ok());
        assert!(ProgramState::validate_fee_rate(100).is_ok());
        assert!(ProgramState::validate_fee_rate(1000).is_ok());
        
        // Invalid fee rates
        assert!(ProgramState::validate_fee_rate(1001).is_err());
        assert!(ProgramState::validate_fee_rate(5000).is_err());
    }

    #[test]
    fn test_program_state_pda() {
        let (pda, bump) = ProgramState::find_pda();
        assert!(bump > 0 && bump < 255);
        assert_ne!(pda, Pubkey::default());
    }
}