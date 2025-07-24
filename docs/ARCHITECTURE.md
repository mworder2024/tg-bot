# Draw System Documentation

## Overview

The Draw System implements a provably fair lottery mechanism using Verifiable Random Functions (VRF). It ensures transparency and fairness by generating cryptographically verifiable random numbers for each draw.

## Key Components

### 1. VRF (Verifiable Random Function)
- **Location**: `src/utils/vrf.ts`
- **Purpose**: Generates cryptographically secure random numbers with proof
- **Features**:
  - Deterministic randomness with optional seed
  - Verifiable proofs for each random generation
  - SHA-256 based implementation

### 2. DrawSystem
- **Location**: `src/game/DrawSystem.ts`
- **Purpose**: Core lottery draw logic
- **Features**:
  - Execute draws with VRF-based randomness
  - Animated countdown and result display
  - Automatic draw scheduling
  - Draw verification
  - Edge case handling (all players eliminated)

### 3. GameManager
- **Location**: `src/game/GameManager.ts`
- **Purpose**: Orchestrates lottery games
- **Features**:
  - Create and manage multiple concurrent games
  - Player registration with ticket assignment
  - Game state management
  - Statistics and history tracking

### 4. DrawAnimations
- **Location**: `src/game/DrawAnimations.ts`
- **Purpose**: UI formatting and animations
- **Features**:
  - Countdown messages with emojis
  - Draw result formatting
  - Winner announcements
  - Statistics display
  - History formatting

## How It Works

### Draw Process

1. **Random Number Generation**:
   - VRF generates a random number between 1 and the highest ticket number
   - Each generation includes a proof for verification

2. **Player Elimination**:
   - Players whose ticket number matches the drawn number are eliminated
   - Multiple players can be eliminated in a single draw

3. **Winner Determination**:
   - Game continues until remaining players ≤ winner count
   - Winners are the last remaining players

4. **Verification**:
   - Every draw can be verified using the VRF proof
   - Ensures no manipulation of results

### Edge Cases

- **No Elimination**: If drawn number matches no tickets, no players are eliminated
- **All Eliminated**: Game ends with no winners if all players are eliminated
- **Instant Win**: If starting players ≤ winner count, game ends immediately

## Usage Example

```typescript
import { GameManager } from './game/index.js';

// Configure draw system
const config = {
  minPlayers: 3,
  maxWinners: 1,
  drawAnimation: {
    duration: 5000,
    countdownSeconds: 5,
    displayDuration: 3000
  },
  autoDrawInterval: 30000 // 30 seconds
};

// Create game manager
const gameManager = new GameManager(config);

// Create a game
const game = gameManager.createGame('game-1', 1);

// Add players
gameManager.addPlayer('game-1', 'player1', 'Alice');
gameManager.addPlayer('game-1', 'player2', 'Bob');
gameManager.addPlayer('game-1', 'player3', 'Charlie');

// Execute draw
const result = await gameManager.executeDraw('game-1');

// Verify draw
const isValid = gameManager.verifyDraw('game-1', result.drawNumber);
```

## Telegram Bot Integration

See `src/bot-integration-example.ts` for a complete example of integrating the draw system with a Telegram bot using Telegraf.

### Available Commands

- `/startlottery` - Start a new lottery game
- `/join` - Join the current lottery
- `/draw` - Execute a single draw
- `/autodraw` - Enable automatic draws
- `/stopdraw` - Stop automatic draws
- `/stats` - Show game statistics
- `/history` - Show draw history
- `/verify <number>` - Verify a specific draw

## Security Features

1. **Cryptographic Randomness**: Uses Node.js crypto module for secure random generation
2. **Verifiable Results**: Every draw includes a proof that can be independently verified
3. **Immutable History**: Draw results cannot be modified after creation
4. **Transparent Process**: All players can verify the fairness of each draw

## Testing

Run the test suite:

```bash
npm run build
node dist/tests/DrawSystem.test.js
```

The test demonstrates:
- Game creation and player registration
- Manual and animated draws
- Draw verification
- Statistics tracking
- Winner determination