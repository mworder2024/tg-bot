use anchor_lang::prelude::*;

/// Custom error codes for the raffle program
#[error_code]
pub enum RaffleError {
    #[msg("Fee rate cannot exceed 10% (1000 basis points)")]
    InvalidFeeRate,
    
    #[msg("Raffle title cannot exceed 200 characters")]
    TitleTooLong,
    
    #[msg("Raffle description cannot exceed 1000 characters")]
    DescriptionTooLong,
    
    #[msg("Prize amount must be at least 0.1 SOL")]
    PrizeAmountTooSmall,
    
    #[msg("Ticket price must be at least 0.001 SOL")]
    TicketPriceTooSmall,
    
    #[msg("Max tickets must be between 1 and 10,000")]
    InvalidMaxTickets,
    
    #[msg("Duration must be between 1 hour and 30 days")]
    InvalidDuration,
    
    #[msg("Raffle has not ended yet")]
    RaffleNotEnded,
    
    #[msg("Raffle has already ended")]
    RaffleEnded,
    
    #[msg("Raffle is full - no more tickets available")]
    RaffleFull,
    
    #[msg("No tickets have been sold for this raffle")]
    NoTicketsSold,
    
    #[msg("Raffle is not in the correct state for this operation")]
    InvalidRaffleState,
    
    #[msg("VRF request has already been made for this raffle")]
    VRFAlreadyRequested,
    
    #[msg("VRF request has not been made for this raffle")]
    VRFNotRequested,
    
    #[msg("Winner has already been selected for this raffle")]
    WinnerAlreadySelected,
    
    #[msg("Winner has not been selected for this raffle")]
    WinnerNotSelected,
    
    #[msg("Prize has already been distributed")]
    PrizeAlreadyDistributed,
    
    #[msg("Ticket has already been refunded")]
    TicketAlreadyRefunded,
    
    #[msg("Only the raffle creator can perform this action")]
    UnauthorizedCreator,
    
    #[msg("Only the program authority can perform this action")]
    UnauthorizedAuthority,
    
    #[msg("Only the ticket owner can perform this action")]
    UnauthorizedTicketOwner,
    
    #[msg("Insufficient funds to create raffle")]
    InsufficientFunds,
    
    #[msg("Insufficient funds to purchase ticket")]
    InsufficientFundsForTicket,
    
    #[msg("Ticket number is invalid")]
    InvalidTicketNumber,
    
    #[msg("VRF proof verification failed")]
    InvalidVRFProof,
    
    #[msg("Program is currently paused")]
    ProgramPaused,
    
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
    
    #[msg("Arithmetic underflow occurred")]
    ArithmeticUnderflow,
    
    #[msg("Invalid timestamp provided")]
    InvalidTimestamp,
    
    #[msg("Raffle ID already exists")]
    RaffleIdExists,
    
    #[msg("Maximum user ticket limit exceeded")]
    UserTicketLimitExceeded,
    
    #[msg("Cannot cancel raffle after VRF request")]
    CannotCancelAfterVRF,
    
    #[msg("Cannot refund from active raffle")]
    CannotRefundActiveRaffle,
    
    #[msg("VRF oracle account mismatch")]
    VRFOracleMismatch,
    
    #[msg("Invalid PDA derivation")]
    InvalidPDA,
    
    #[msg("Account data size mismatch")]
    AccountSizeMismatch,
    
    #[msg("Raffle creator cannot purchase own tickets")]
    CreatorCannotPurchase,
}

/// Helper trait for checked arithmetic operations
pub trait CheckedArithmetic<T> {
    fn checked_add_error(self, other: T) -> Result<T>;
    fn checked_sub_error(self, other: T) -> Result<T>;
    fn checked_mul_error(self, other: T) -> Result<T>;
    fn checked_div_error(self, other: T) -> Result<T>;
}

impl CheckedArithmetic<u64> for u64 {
    fn checked_add_error(self, other: u64) -> Result<u64> {
        self.checked_add(other)
            .ok_or(RaffleError::ArithmeticOverflow.into())
    }
    
    fn checked_sub_error(self, other: u64) -> Result<u64> {
        self.checked_sub(other)
            .ok_or(RaffleError::ArithmeticUnderflow.into())
    }
    
    fn checked_mul_error(self, other: u64) -> Result<u64> {
        self.checked_mul(other)
            .ok_or(RaffleError::ArithmeticOverflow.into())
    }
    
    fn checked_div_error(self, other: u64) -> Result<u64> {
        self.checked_div(other)
            .ok_or(RaffleError::ArithmeticUnderflow.into())
    }
}

impl CheckedArithmetic<u32> for u32 {
    fn checked_add_error(self, other: u32) -> Result<u32> {
        self.checked_add(other)
            .ok_or(RaffleError::ArithmeticOverflow.into())
    }
    
    fn checked_sub_error(self, other: u32) -> Result<u32> {
        self.checked_sub(other)
            .ok_or(RaffleError::ArithmeticUnderflow.into())
    }
    
    fn checked_mul_error(self, other: u32) -> Result<u32> {
        self.checked_mul(other)
            .ok_or(RaffleError::ArithmeticOverflow.into())
    }
    
    fn checked_div_error(self, other: u32) -> Result<u32> {
        self.checked_div(other)
            .ok_or(RaffleError::ArithmeticUnderflow.into())
    }
}

impl CheckedArithmetic<i64> for i64 {
    fn checked_add_error(self, other: i64) -> Result<i64> {
        self.checked_add(other)
            .ok_or(RaffleError::ArithmeticOverflow.into())
    }
    
    fn checked_sub_error(self, other: i64) -> Result<i64> {
        self.checked_sub(other)
            .ok_or(RaffleError::ArithmeticUnderflow.into())
    }
    
    fn checked_mul_error(self, other: i64) -> Result<i64> {
        self.checked_mul(other)
            .ok_or(RaffleError::ArithmeticOverflow.into())
    }
    
    fn checked_div_error(self, other: i64) -> Result<i64> {
        self.checked_div(other)
            .ok_or(RaffleError::ArithmeticUnderflow.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_checked_arithmetic_u64() {
        // Test addition
        assert!(5u64.checked_add_error(3).is_ok());
        assert_eq!(5u64.checked_add_error(3).unwrap(), 8);
        assert!(u64::MAX.checked_add_error(1).is_err());
        
        // Test subtraction
        assert!(10u64.checked_sub_error(3).is_ok());
        assert_eq!(10u64.checked_sub_error(3).unwrap(), 7);
        assert!(3u64.checked_sub_error(10).is_err());
        
        // Test multiplication
        assert!(5u64.checked_mul_error(3).is_ok());
        assert_eq!(5u64.checked_mul_error(3).unwrap(), 15);
        assert!(u64::MAX.checked_mul_error(2).is_err());
        
        // Test division
        assert!(10u64.checked_div_error(2).is_ok());
        assert_eq!(10u64.checked_div_error(2).unwrap(), 5);
        assert!(10u64.checked_div_error(0).is_err());
    }

    #[test]
    fn test_checked_arithmetic_u32() {
        // Test addition
        assert!(5u32.checked_add_error(3).is_ok());
        assert_eq!(5u32.checked_add_error(3).unwrap(), 8);
        assert!(u32::MAX.checked_add_error(1).is_err());
        
        // Test subtraction
        assert!(10u32.checked_sub_error(3).is_ok());
        assert_eq!(10u32.checked_sub_error(3).unwrap(), 7);
        assert!(3u32.checked_sub_error(10).is_err());
    }

    #[test]
    fn test_error_codes() {
        // Test that error codes are properly defined
        let error = RaffleError::InvalidFeeRate;
        assert_eq!(error.to_string(), "Fee rate cannot exceed 10% (1000 basis points)");
        
        let error = RaffleError::RaffleFull;
        assert_eq!(error.to_string(), "Raffle is full - no more tickets available");
    }
}