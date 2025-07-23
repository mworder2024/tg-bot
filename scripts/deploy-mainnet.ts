import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

// MAINNET Configuration
const MAINNET_CONFIG = {
  network: "mainnet-beta" as const,
  rpcUrl: process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com",
  commitment: "confirmed" as const,
  
  // IMPORTANT: Update these with actual mainnet values
  tokenMint: process.env.MWOR_TOKEN_MINT_MAINNET || "So11111111111111111111111111111111111111112", // Using SOL for initial test
  treasuryAuthority: process.env.TREASURY_AUTHORITY_MAINNET || "",
  vrfOracle: process.env.VRF_ORACLE_MAINNET || "",
  feePercentage: 10, // 10% treasury fee
};

async function main() {
  console.log("🚀 Deploying to Solana Mainnet...\n");
  
  // Safety check
  console.log("⚠️  MAINNET DEPLOYMENT WARNING ⚠️");
  console.log("This will deploy to mainnet and cost real SOL.");
  console.log("Configuration:");
  console.log(`- Network: ${MAINNET_CONFIG.network}`);
  console.log(`- RPC: ${MAINNET_CONFIG.rpcUrl}`);
  console.log(`- Token Mint: ${MAINNET_CONFIG.tokenMint}`);
  console.log("\nPress Ctrl+C to cancel, or wait 5 seconds to continue...");
  
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    // Load wallet
    const walletPath = process.env.MAINNET_WALLET_PATH || join(homedir(), ".config/solana/id.json");
    if (!existsSync(walletPath)) {
      throw new Error(`Wallet not found at ${walletPath}`);
    }
    
    const walletKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(readFileSync(walletPath, "utf-8")))
    );
    console.log("✅ Wallet loaded:", walletKeypair.publicKey.toBase58());

    // Check wallet balance
    const connection = new Connection(MAINNET_CONFIG.rpcUrl, MAINNET_CONFIG.commitment);
    const balance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`💰 Wallet balance: ${balance / 1e9} SOL`);
    
    if (balance < 2e9) { // 2 SOL minimum
      throw new Error("Insufficient balance. Need at least 2 SOL for deployment and rent.");
    }

    // Build program
    console.log("\n📦 Building program...");
    execSync("anchor build", { stdio: "inherit" });
    
    // Get program size
    const programPath = "./target/deploy/telegram_lottery.so";
    const programData = readFileSync(programPath);
    const programSize = programData.length;
    console.log(`Program size: ${(programSize / 1024).toFixed(2)} KB`);
    
    // Calculate rent
    const rentExemption = await connection.getMinimumBalanceForRentExemption(programSize);
    console.log(`Rent exemption required: ${rentExemption / 1e9} SOL`);

    // Deploy program
    console.log("\n🚢 Deploying program to mainnet...");
    const deployCmd = `solana program deploy ${programPath} --url ${MAINNET_CONFIG.rpcUrl} --keypair ${walletPath}`;
    
    try {
      const output = execSync(deployCmd, { encoding: "utf-8" });
      console.log(output);
      
      // Extract program ID from output
      const programIdMatch = output.match(/Program Id: (\w+)/);
      if (!programIdMatch) {
        throw new Error("Failed to extract program ID from deployment output");
      }
      
      const programId = new PublicKey(programIdMatch[1]);
      console.log(`\n✅ Program deployed successfully!`);
      console.log(`📍 Program ID: ${programId.toBase58()}`);
      
      // Create provider
      const provider = new AnchorProvider(
        connection,
        {
          publicKey: walletKeypair.publicKey,
          signTransaction: async (tx) => {
            tx.partialSign(walletKeypair);
            return tx;
          },
          signAllTransactions: async (txs) => {
            txs.forEach(tx => tx.partialSign(walletKeypair));
            return txs;
          },
        },
        { commitment: MAINNET_CONFIG.commitment }
      );

      anchor.setProvider(provider);

      // Load IDL and create program
      const idl = JSON.parse(readFileSync("./target/idl/telegram_lottery.json", "utf-8"));
      const program = new Program(idl, programId, provider);

      // Initialize program
      console.log("\n🏗️ Initializing program...");
      
      const [treasuryPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury")],
        programId
      );
      
      const treasuryAuthority = MAINNET_CONFIG.treasuryAuthority 
        ? new PublicKey(MAINNET_CONFIG.treasuryAuthority)
        : walletKeypair.publicKey;

      try {
        const tx = await program.methods
          .initialize(treasuryAuthority, MAINNET_CONFIG.feePercentage)
          .accounts({
            authority: walletKeypair.publicKey,
            tokenMint: new PublicKey(MAINNET_CONFIG.tokenMint),
          })
          .rpc();
        
        console.log("✅ Program initialized!");
        console.log("Transaction:", tx);
        console.log("Treasury PDA:", treasuryPDA.toBase58());
      } catch (err: any) {
        if (err.toString().includes("already in use")) {
          console.log("ℹ️ Program already initialized");
        } else {
          throw err;
        }
      }

      // Save deployment info
      const deploymentInfo = {
        network: MAINNET_CONFIG.network,
        programId: programId.toBase58(),
        treasuryPDA: treasuryPDA.toBase58(),
        tokenMint: MAINNET_CONFIG.tokenMint,
        treasuryAuthority: treasuryAuthority.toBase58(),
        vrfOracle: MAINNET_CONFIG.vrfOracle || walletKeypair.publicKey.toBase58(),
        deployedAt: new Date().toISOString(),
        deployedBy: walletKeypair.publicKey.toBase58(),
        programSize: `${(programSize / 1024).toFixed(2)} KB`,
        rentCost: `${rentExemption / 1e9} SOL`,
      };

      // Create deployments directory if it doesn't exist
      if (!existsSync("./deployments")) {
        mkdirSync("./deployments");
      }

      // Save deployment info
      const deploymentPath = "./deployments/mainnet.json";
      writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
      console.log(`\n💾 Deployment info saved to ${deploymentPath}`);

      // Create mainnet env file
      const mainnetEnv = `# Mainnet Configuration
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=${MAINNET_CONFIG.rpcUrl}
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
SOLANA_PROGRAM_ID=${programId.toBase58()}
SOLANA_TREASURY_PDA=${treasuryPDA.toBase58()}
MWOR_TOKEN_MINT=${MAINNET_CONFIG.tokenMint}
VRF_ORACLE_PUBKEY=${MAINNET_CONFIG.vrfOracle || walletKeypair.publicKey.toBase58()}
TREASURY_AUTHORITY=${treasuryAuthority.toBase58()}
`;

      writeFileSync(".env.mainnet", mainnetEnv);
      console.log("💾 Mainnet configuration saved to .env.mainnet");

      // Display summary
      console.log("\n📊 DEPLOYMENT SUMMARY");
      console.log("====================");
      console.log(`Network: ${MAINNET_CONFIG.network}`);
      console.log(`Program ID: ${programId.toBase58()}`);
      console.log(`Treasury PDA: ${treasuryPDA.toBase58()}`);
      console.log(`View on Explorer: https://explorer.solana.com/address/${programId.toBase58()}`);
      console.log(`\nTotal Cost: ~${((rentExemption + 0.01e9) / 1e9).toFixed(3)} SOL`);
      
      console.log("\n✅ Mainnet deployment complete!");
      console.log("\n📝 Next steps:");
      console.log("1. Update your bot to use .env.mainnet configuration");
      console.log("2. Test with small amounts first");
      console.log("3. Monitor transactions on Solana Explorer");
      console.log("4. Set up proper RPC endpoint for production");

    } catch (deployError: any) {
      console.error("❌ Deployment failed:", deployError.message);
      throw deployError;
    }

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

// Run deployment
main()
  .then(() => {
    console.log("\n✨ Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });