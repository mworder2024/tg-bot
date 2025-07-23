import { GameManager, DrawAnimations } from '../src/game/index.js';
import type { DrawSystemConfig } from '../src/types/index.js';

// Test configuration
const testConfig: DrawSystemConfig = {
  minPlayers: 2,
  maxWinners: 1,
  drawAnimation: {
    duration: 3000,
    countdownSeconds: 3,
    displayDuration: 2000
  },
  autoDrawInterval: 5000
};

async function runDrawSystemTest() {
  console.log('🧪 Testing Draw System...\n');

  // Create game manager
  const gameManager = new GameManager(testConfig);
  
  // Create a new game
  const gameId = 'test-game-1';
  const game = gameManager.createGame(gameId, 2); // 2 winners
  
  console.log(`✅ Created game: ${gameId}`);

  // Add players
  const players = [
    { id: 'player1', username: 'Alice' },
    { id: 'player2', username: 'Bob' },
    { id: 'player3', username: 'Charlie' },
    { id: 'player4', username: 'Diana' },
    { id: 'player5', username: 'Eve' },
    { id: 'player6', username: 'Frank' }
  ];

  for (const player of players) {
    const ticketNumber = gameManager.addPlayer(gameId, player.id, player.username);
    console.log(`✅ Added ${player.username} with ticket #${ticketNumber}`);
  }

  console.log('\n📊 Game Status:');
  console.log(`Total Players: ${game.players.size}`);
  console.log(`Winners Needed: ${game.winnerCount}`);

  // Test manual draw
  console.log('\n🎲 Executing manual draw...');
  
  try {
    // Use a fixed seed for reproducible testing
    const drawResult = await gameManager.executeDraw(gameId, 'test-seed-123');
    
    console.log('\n' + DrawAnimations.getDrawResultMessage(drawResult));
    
    // Verify the draw
    const isValid = gameManager.verifyDraw(gameId, drawResult.drawNumber);
    console.log(`\n🔐 Draw verification: ${isValid ? '✅ VALID' : '❌ INVALID'}`);

    // Show statistics
    const stats = gameManager.getGameStatistics(gameId);
    console.log('\n' + DrawAnimations.getStatisticsMessage(stats));

    // Test draw with animation
    console.log('\n🎬 Testing draw with animation...');
    
    await gameManager.executeDrawWithAnimation(
      gameId,
      (seconds) => {
        console.log(DrawAnimations.getCountdownMessage(seconds));
      },
      (result) => {
        console.log('\n' + DrawAnimations.getDrawResultMessage(result));
      },
      'test-seed-456'
    );

    // Continue drawing until we have winners
    console.log('\n🔄 Continuing draws until winners are determined...');
    
    while (game.isActive) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay
      
      const result = await gameManager.executeDraw(gameId);
      console.log(`\nDraw #${result.drawNumber}: Number ${result.drawnValue} → ${result.eliminatedPlayers.length} eliminated`);
      
      if (result.remainingPlayers.length <= game.winnerCount) {
        console.log('\n' + DrawAnimations.getWinnerMessage(game.winners || []));
        break;
      }
    }

    // Show final statistics and history
    const finalStats = gameManager.getGameStatistics(gameId);
    console.log('\n' + DrawAnimations.getStatisticsMessage(finalStats));

    const history = gameManager.getDrawHistory(gameId);
    console.log('\n' + DrawAnimations.getDrawHistoryMessage(history));

  } catch (error) {
    console.error('❌ Error during test:', error);
  } finally {
    // Cleanup
    gameManager.cleanup();
    console.log('\n✅ Test completed and cleaned up');
  }
}

// Run the test
runDrawSystemTest().catch(console.error);