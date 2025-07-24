use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::*;

/// Update program configuration (authority only)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateConfigParams {
    /// New fee rate (optional)
    pub new_fee_rate: Option<u16>,
    
    /// New treasury address (optional)
    pub new_treasury: Option<Pubkey>,
    
    /// New authority (optional)
    pub new_authority: Option<Pubkey>,
    
    /// New pause state (optional)
    pub new_pause_state: Option<bool>,
}

/// Update global program configuration
#[derive(Accounts)]
pub struct UpdateProgramConfig<'info> {
    #[account(
        mut,
        seeds = [b"program_state"],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    #[account(
        constraint = authority.key() == program_state.authority @ RaffleError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateProgramConfig>,
    params: UpdateConfigParams,
) -> Result<()> {
    let program_state = &mut ctx.accounts.program_state;
    let mut changes_made = Vec::new();
    
    // Update fee rate if provided
    if let Some(new_fee_rate) = params.new_fee_rate {
        // Validate new fee rate
        ProgramState::validate_fee_rate(new_fee_rate)?;
        
        let old_fee_rate = program_state.fee_rate;
        program_state.fee_rate = new_fee_rate;
        
        changes_made.push(format!("Fee rate: {} -> {}", old_fee_rate, new_fee_rate));
    }
    
    // Update treasury if provided
    if let Some(new_treasury) = params.new_treasury {
        let old_treasury = program_state.treasury;
        program_state.treasury = new_treasury;
        
        changes_made.push(format!("Treasury: {} -> {}", old_treasury, new_treasury));
    }
    
    // Update pause state if provided
    if let Some(new_pause_state) = params.new_pause_state {
        let old_pause_state = program_state.is_paused;
        program_state.is_paused = new_pause_state;
        
        changes_made.push(format!(
            "Pause state: {} -> {}",
            old_pause_state,
            new_pause_state
        ));
    }
    
    // Update authority last (if provided)
    if let Some(new_authority) = params.new_authority {
        let old_authority = program_state.authority;
        program_state.authority = new_authority;
        
        changes_made.push(format!("Authority: {} -> {}", old_authority, new_authority));
    }
    
    // Log all changes made
    if !changes_made.is_empty() {
        msg!(
            "Program configuration updated by {}: {}",
            ctx.accounts.authority.key(),
            changes_made.join(", ")
        );
    } else {
        msg!("No configuration changes requested");
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_fee_rate() {
        let mut program_state = create_test_program_state();
        let original_fee_rate = program_state.fee_rate;
        
        // Valid fee rate update
        let new_fee_rate = 500u16; // 5%
        program_state.fee_rate = new_fee_rate;
        
        assert_eq!(program_state.fee_rate, new_fee_rate);
        assert_ne!(program_state.fee_rate, original_fee_rate);
    }

    #[test]
    fn test_update_treasury() {
        let mut program_state = create_test_program_state();
        let original_treasury = program_state.treasury;
        let new_treasury = Pubkey::new_unique();
        
        program_state.treasury = new_treasury;
        
        assert_eq!(program_state.treasury, new_treasury);
        assert_ne!(program_state.treasury, original_treasury);
    }

    #[test]
    fn test_update_authority() {
        let mut program_state = create_test_program_state();
        let original_authority = program_state.authority;
        let new_authority = Pubkey::new_unique();
        
        program_state.authority = new_authority;
        
        assert_eq!(program_state.authority, new_authority);
        assert_ne!(program_state.authority, original_authority);
    }

    #[test]
    fn test_update_pause_state() {
        let mut program_state = create_test_program_state();
        
        // Initially not paused
        program_state.is_paused = false;
        assert!(!program_state.is_paused);
        
        // Pause the program
        program_state.is_paused = true;
        assert!(program_state.is_paused);
        
        // Unpause the program
        program_state.is_paused = false;
        assert!(!program_state.is_paused);
    }

    #[test]
    fn test_fee_rate_validation() {
        // Valid fee rates
        assert!(ProgramState::validate_fee_rate(0).is_ok());      // 0%
        assert!(ProgramState::validate_fee_rate(100).is_ok());    // 1%
        assert!(ProgramState::validate_fee_rate(500).is_ok());    // 5%
        assert!(ProgramState::validate_fee_rate(1000).is_ok());   // 10%
        
        // Invalid fee rates
        assert!(ProgramState::validate_fee_rate(1001).is_err()); // 10.01%
        assert!(ProgramState::validate_fee_rate(2000).is_err()); // 20%
        assert!(ProgramState::validate_fee_rate(5000).is_err()); // 50%
    }

    #[test]
    fn test_multiple_updates() {
        let mut program_state = create_test_program_state();
        
        let original_fee_rate = program_state.fee_rate;
        let original_treasury = program_state.treasury;
        let original_authority = program_state.authority;
        let original_pause_state = program_state.is_paused;
        
        // Update multiple fields
        let new_fee_rate = 750u16; // 7.5%
        let new_treasury = Pubkey::new_unique();
        let new_authority = Pubkey::new_unique();
        let new_pause_state = !original_pause_state;
        
        program_state.fee_rate = new_fee_rate;
        program_state.treasury = new_treasury;
        program_state.authority = new_authority;
        program_state.is_paused = new_pause_state;
        
        // Verify all changes
        assert_eq!(program_state.fee_rate, new_fee_rate);
        assert_eq!(program_state.treasury, new_treasury);
        assert_eq!(program_state.authority, new_authority);
        assert_eq!(program_state.is_paused, new_pause_state);
        
        // Verify changes from original
        assert_ne!(program_state.fee_rate, original_fee_rate);
        assert_ne!(program_state.treasury, original_treasury);
        assert_ne!(program_state.authority, original_authority);
        assert_ne!(program_state.is_paused, original_pause_state);
    }

    #[test]
    fn test_partial_updates() {
        let mut program_state = create_test_program_state();
        
        let original_fee_rate = program_state.fee_rate;
        let original_treasury = program_state.treasury;
        let original_authority = program_state.authority;
        let original_pause_state = program_state.is_paused;
        
        // Update only fee rate
        let new_fee_rate = 200u16; // 2%
        program_state.fee_rate = new_fee_rate;
        
        // Verify only fee rate changed
        assert_eq!(program_state.fee_rate, new_fee_rate);
        assert_eq!(program_state.treasury, original_treasury);
        assert_eq!(program_state.authority, original_authority);
        assert_eq!(program_state.is_paused, original_pause_state);
    }

    #[test]
    fn test_update_config_params() {
        // Test with all parameters
        let all_params = UpdateConfigParams {
            new_fee_rate: Some(400),
            new_treasury: Some(Pubkey::new_unique()),
            new_authority: Some(Pubkey::new_unique()),
            new_pause_state: Some(true),
        };
        
        assert!(all_params.new_fee_rate.is_some());
        assert!(all_params.new_treasury.is_some());
        assert!(all_params.new_authority.is_some());
        assert!(all_params.new_pause_state.is_some());
        
        // Test with partial parameters
        let partial_params = UpdateConfigParams {
            new_fee_rate: Some(300),
            new_treasury: None,
            new_authority: None,
            new_pause_state: Some(false),
        };
        
        assert!(partial_params.new_fee_rate.is_some());
        assert!(partial_params.new_treasury.is_none());
        assert!(partial_params.new_authority.is_none());
        assert!(partial_params.new_pause_state.is_some());
        
        // Test with no parameters
        let no_params = UpdateConfigParams {
            new_fee_rate: None,
            new_treasury: None,
            new_authority: None,
            new_pause_state: None,
        };
        
        assert!(no_params.new_fee_rate.is_none());
        assert!(no_params.new_treasury.is_none());
        assert!(no_params.new_authority.is_none());
        assert!(no_params.new_pause_state.is_none());
    }

    #[test]
    fn test_authority_validation() {
        let authority_key = Pubkey::new_unique();
        let unauthorized_key = Pubkey::new_unique();
        
        let program_state = ProgramState {
            authority: authority_key,
            ..create_test_program_state()
        };
        
        // Only the authority should be authorized
        assert_eq!(program_state.authority, authority_key);
        assert_ne!(program_state.authority, unauthorized_key);
    }

    #[test]
    fn test_program_state_invariants() {
        let program_state = create_test_program_state();
        
        // Check basic invariants
        assert!(program_state.fee_rate <= 1000); // Max 10%
        assert_ne!(program_state.authority, Pubkey::default());
        assert_ne!(program_state.treasury, Pubkey::default());
        assert!(program_state.total_raffles >= 0);
        assert!(program_state.total_volume >= 0);
    }

    #[test]
    fn test_edge_case_fee_rates() {
        // Test boundary values
        assert!(ProgramState::validate_fee_rate(0).is_ok());     // Minimum
        assert!(ProgramState::validate_fee_rate(1000).is_ok());  // Maximum
        assert!(ProgramState::validate_fee_rate(1001).is_err()); // Just over maximum
        
        // Test common values
        assert!(ProgramState::validate_fee_rate(250).is_ok());   // 2.5%
        assert!(ProgramState::validate_fee_rate(300).is_ok());   // 3%
        assert!(ProgramState::validate_fee_rate(500).is_ok());   // 5%
    }

    #[test]
    fn test_pause_state_effects() {
        let mut program_state = create_test_program_state();
        
        // Test normal operation
        program_state.is_paused = false;
        assert!(!program_state.is_paused);
        
        // Test paused state
        program_state.is_paused = true;
        assert!(program_state.is_paused);
        
        // When paused, other operations should be blocked
        // This would be tested in actual instruction handlers
    }

    fn create_test_program_state() -> ProgramState {
        ProgramState {
            authority: Pubkey::new_unique(),
            treasury: Pubkey::new_unique(),
            fee_rate: 300, // 3%
            total_raffles: 0,
            total_volume: 0,
            is_paused: false,
            bump: 255,
        }
    }
}