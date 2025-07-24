# Solana Program Testing Guide

## Overview

The Telegram Lottery Bot Solana program includes comprehensive test coverage for all functionality. The tests are organized into multiple suites covering different aspects of the program.

## Test Structure

```
tests/
├── telegram-lottery.ts          # Main test suite
├── integration/
│   └── full-game-flow.test.ts  # Complete game lifecycle tests
├── edge-cases/
│   ├── cancellation.test.ts    # Game cancellation scenarios
│   └── security.test.ts        # Security and authorization tests
└── utils/
    └── test-helpers.ts         # Shared test utilities
```

## Running Tests

### Prerequisites

1. Install dependencies:
```bash
npm install
```

2. Start local Solana test validator:
```bash
solana-test-validator
```

3. Build the program:
```bash
npm run build:program
```

### Run All Tests

```bash
npm run test:solana
```

### Run Specific Test Suite

```bash
# Main tests only
anchor test tests/telegram-lottery.ts

# Integration tests
anchor test tests/integration/full-game-flow.test.ts

# Edge case tests
anchor test tests/edge-cases/cancellation.test.ts
anchor test tests/edge-cases/security.test.ts
```

## Test Coverage

### 1. Main Test Suite (`telegram-lottery.ts`)

- **Initialize**: Program initialization with treasury setup
- **Create Game**: Game creation with proper PDAs
- **Join Game**: Player joining and token transfers
- **Select Numbers**: Number selection mechanics
- **VRF and Elimination**: Random number submission and player elimination
- **Complete Game**: Game completion and prize distribution
- **Claim Prizes**: Winner prize claiming
- **Error Cases**: Invalid parameters and authorization

### 2. Integration Tests

#### Full Game Flow (`full-game-flow.test.ts`)
- Complete game lifecycle from creation to prize claiming
- Multiple elimination rounds
- Treasury fee collection
- All players claiming prizes
- Treasury withdrawal

### 3. Edge Case Tests

#### Cancellation Tests (`cancellation.test.ts`)
- Cancel due to payment deadline expiration
- Cancel during number selection timeout
- Refund processing for cancelled games
- Double refund prevention
- Refund validation

#### Security Tests (`security.test.ts`)
- Authority verification for all admin functions
- Double spending prevention
- PDA and account validation
- Input validation
- Token account security

## Test Utilities

The `test-helpers.ts` file provides reusable utilities:

- `setupTestAccounts()`: Create and fund test accounts
- `setupPlayerTokenAccounts()`: Create token accounts and mint tokens
- `getGamePDAs()`: Calculate game-related PDAs
- `createCompleteGame()`: Set up a full game scenario
- `processVrfElimination()`: Process VRF and elimination round

## Test Data

Default test configuration:
- Entry Fee: 1 MWOR (1,000,000 lamports)
- Max Players: 3-4 (varies by test)
- Winner Count: 1-2 (varies by test)
- Fee Percentage: 10%
- Token Decimals: 6

## Common Test Patterns

### 1. Setting Up a Game
```typescript
const pdas = testHelper.getGamePDAs(gameId);
await testHelper.createCompleteGame(
  gameId,
  accounts,
  playerTokenAccounts,
  {
    entryFee,
    maxPlayers,
    winnerCount,
    paymentDeadlineMinutes,
  }
);
```

### 2. Processing Elimination
```typescript
await testHelper.processVrfElimination(
  gameId,
  round,
  drawnNumber,
  accounts,
  pdas
);
```

### 3. Verifying Token Transfers
```typescript
const balanceBefore = await getAccount(connection, tokenAccount);
// ... perform action ...
const balanceAfter = await getAccount(connection, tokenAccount);
assert.equal(
  Number(balanceAfter.amount - balanceBefore.amount),
  expectedAmount
);
```

## Debugging Tests

### Enable Detailed Logs
```bash
RUST_LOG=solana_runtime::system_instruction_processor=trace,solana_runtime::message_processor=trace,solana_bpf_loader=debug,solana_rbpf=debug anchor test
```

### View Transaction Logs
```typescript
try {
  await program.methods.someInstruction().rpc();
} catch (err) {
  console.log("Transaction logs:", err.logs);
}
```

### Common Issues

1. **Account Not Found**: Ensure PDAs are calculated correctly
2. **Insufficient Balance**: Check airdrops completed
3. **Unauthorized**: Verify correct signer for instruction
4. **Invalid State**: Check game state transitions

## Test Environment

- **Framework**: Anchor Test Framework
- **Assertion Library**: Chai
- **Test Runner**: Mocha
- **Token Program**: SPL Token
- **Network**: Local test validator

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Tests clean up after themselves
3. **Assertions**: Verify all state changes
4. **Error Testing**: Test both success and failure cases
5. **Real Scenarios**: Test realistic game flows

## Continuous Integration

For CI/CD pipelines:

```yaml
- name: Run Solana Tests
  run: |
    solana-test-validator &
    sleep 5
    npm run test:solana
```

## Coverage Report

To generate a coverage report (requires additional setup):
```bash
anchor test -- --coverage
```

## Next Steps

1. Add stress tests for maximum players
2. Test concurrent operations
3. Add performance benchmarks
4. Test upgrade scenarios
5. Add fuzz testing for edge cases