import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createLotteryClient } from "../src/blockchain/lottery-sdk";
import { readFileSync } from "fs";
import dotenv from "dotenv";

// Load mainnet configuration
dotenv.config({ path: ".env.mainnet" });

async function testMainnetDeployment() {
  console.log("🧪 Testing Mainnet Deployment...\n");

  try {
    // Load deployment info
    const deploymentInfo = JSON.parse(
      readFileSync("./deployments/mainnet.json", "utf-8")
    );

    console.log("📋 Deployment Info:");
    console.log(`- Program ID: ${deploymentInfo.programId}`);
    console.log(`- Treasury PDA: ${deploymentInfo.treasuryPDA}`);
    console.log(`- Network: ${deploymentInfo.network}`);
    console.log(`- Token Mint: ${deploymentInfo.tokenMint}`);

    // Connect to mainnet
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
      "confirmed"
    );

    // Load test wallet (should have some SOL)
    const walletPath = process.env.TEST_WALLET_PATH || process.env.MAINNET_WALLET_PATH;
    const wallet = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(readFileSync(walletPath!, "utf-8")))
    );

    console.log(`\n💳 Test Wallet: ${wallet.publicKey.toBase58()}`);
    
    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      console.error("❌ Insufficient balance for testing. Need at least 0.1 SOL");
      return;
    }

    // Create lottery client
    console.log("\n🔗 Connecting to lottery program...");
    const client = await createLotteryClient(
      connection,
      deploymentInfo.programId,
      wallet,
      deploymentInfo.tokenMint,
      deploymentInfo.vrfOracle || wallet.publicKey.toBase58()
    );

    // Test 1: Create a small test game
    console.log("\n📝 Test 1: Creating test game...");
    const gameId = `mainnet-test-${Date.now()}`;
    
    try {
      // Using SOL as test token (0.001 SOL entry fee)
      const gameConfig = {
        gameId,
        entryFee: 0.001, // 0.001 SOL
        maxPlayers: 3,
        winnerCount: 1,
        paymentDeadlineMinutes: 30,
      };

      console.log("Game config:", gameConfig);
      
      const gameState = await client.createGame(gameConfig);
      console.log("✅ Game created successfully!");
      console.log(`- Game PDA: ${client.pdaHelper.getGamePDA(gameId)[0].toBase58()}`);
      console.log(`- Escrow PDA: ${client.pdaHelper.getEscrowPDA(gameId)[0].toBase58()}`);
      console.log(`- Entry Fee: ${gameState.entryFee.toNumber() / LAMPORTS_PER_SOL} SOL`);

      // Test 2: Fetch game state
      console.log("\n📝 Test 2: Fetching game state...");
      const fetchedGame = await client.getGame(gameId);
      if (fetchedGame) {
        console.log("✅ Game state fetched successfully!");
        console.log(`- Status: ${Object.keys(fetchedGame.state)[0]}`);
        console.log(`- Max Players: ${fetchedGame.maxPlayers}`);
        console.log(`- Prize Pool: ${fetchedGame.prizePool.toNumber() / LAMPORTS_PER_SOL} SOL`);
      }

      // Test 3: Get treasury state
      console.log("\n📝 Test 3: Checking treasury state...");
      const treasuryPDA = new PublicKey(deploymentInfo.treasuryPDA);
      const treasuryState = await client.program.account.treasuryState.fetch(treasuryPDA);
      console.log("✅ Treasury state:");
      console.log(`- Authority: ${treasuryState.authority.toBase58()}`);
      console.log(`- Fee Percentage: ${treasuryState.feePercentage}%`);
      console.log(`- Total Collected: ${treasuryState.totalCollected.toNumber() / LAMPORTS_PER_SOL} SOL`);

      // Display URLs
      console.log("\n🔗 Useful Links:");
      console.log(`- Game Account: https://explorer.solana.com/address/${client.pdaHelper.getGamePDA(gameId)[0].toBase58()}`);
      console.log(`- Escrow Account: https://explorer.solana.com/address/${client.pdaHelper.getEscrowPDA(gameId)[0].toBase58()}`);
      console.log(`- Program: https://explorer.solana.com/address/${deploymentInfo.programId}`);

      console.log("\n✅ All tests passed!");
      console.log("\n⚠️  IMPORTANT: This test game is now live on mainnet!");
      console.log("You can join it by sending 0.001 SOL to the escrow address.");

    } catch (error: any) {
      console.error("❌ Test failed:", error.message);
      if (error.logs) {
        console.error("Transaction logs:", error.logs);
      }
    }

  } catch (error: any) {
    console.error("❌ Error:", error.message);
  }
}

// Run tests
testMainnetDeployment()
  .then(() => {
    console.log("\n✨ Testing complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });