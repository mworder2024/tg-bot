use anchor_lang::prelude::*;

/// Calculate the prize distribution for winners
pub fn calculate_prize_distribution(
    total_prize_pool: u64,
    treasury_fee: u64,
    winner_count: usize,
) -> Result<u64> {
    // Calculate distributable amount (total - treasury fee)
    let distributable = total_prize_pool
        .checked_sub(treasury_fee)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate prize per winner
    let prize_per_winner = distributable
        .checked_div(winner_count as u64)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    Ok(prize_per_winner)
}

/// Generate a number from random bytes within a range
pub fn generate_number_from_random(
    random_bytes: &[u8],
    min: u8,
    max: u8,
) -> u8 {
    // Use first 8 bytes to generate a u64
    let random_u64 = u64::from_le_bytes(
        random_bytes[..8]
            .try_into()
            .expect("slice with incorrect length")
    );
    
    // Calculate range
    let range = (max - min + 1) as u64;
    
    // Generate number within range
    (random_u64 % range) as u8 + min
}

/// Validate game configuration
pub fn validate_game_config(
    entry_fee: u64,
    max_players: u8,
    winner_count: u8,
) -> Result<()> {
    require!(
        entry_fee > 0,
        ProgramError::InvalidArgument
    );
    
    require!(
        max_players >= 2 && max_players <= 100,
        ProgramError::InvalidArgument
    );
    
    require!(
        winner_count > 0 && winner_count < max_players,
        ProgramError::InvalidArgument
    );
    
    Ok(())
}

/// Calculate treasury fee based on percentage
pub fn calculate_treasury_fee(amount: u64, fee_percentage: u8) -> Result<u64> {
    amount
        .checked_mul(fee_percentage as u64)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_prize_distribution() {
        let total = 1000;
        let fee = 100;
        let winners = 3;
        
        let prize = calculate_prize_distribution(total, fee, winners).unwrap();
        assert_eq!(prize, 300); // (1000 - 100) / 3 = 300
    }

    #[test]
    fn test_generate_number_from_random() {
        let random_bytes = [42u8; 32];
        let min = 1;
        let max = 10;
        
        let number = generate_number_from_random(&random_bytes, min, max);
        assert!(number >= min && number <= max);
    }

    #[test]
    fn test_calculate_treasury_fee() {
        let amount = 1000;
        let percentage = 10;
        
        let fee = calculate_treasury_fee(amount, percentage).unwrap();
        assert_eq!(fee, 100); // 10% of 1000 = 100
    }
}