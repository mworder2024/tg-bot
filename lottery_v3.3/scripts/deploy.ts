import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config();

interface DeploymentConfig {
  programId: string;
  tokenMint: string;
  vrfOracle: string;
  treasuryAuthority: string;
  feePercentage: number;
  network: "devnet" | "mainnet-beta" | "localnet";
}

async function main() {
  const network = process.env.SOLANA_NETWORK as DeploymentConfig["network"] || "devnet";
  console.log(`🚀 Deploying to ${network}...`);

  // Load wallet
  const walletPath = process.env.SOLANA_WALLET_PATH || join(homedir(), ".config/solana/id.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(walletPath, "utf-8")))
  );

  // Setup connection
  const connection = new Connection(
    network === "localnet" 
      ? "http://localhost:8899" 
      : clusterApiUrl(network),
    "confirmed"
  );

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
    { commitment: "confirmed" }
  );

  anchor.setProvider(provider);

  // Load program
  const idl = JSON.parse(
    readFileSync("./target/idl/telegram_lottery.json", "utf-8")
  );
  const programId = new PublicKey(idl.metadata.address);
  const program = new Program(idl, programId, provider);

  console.log("📦 Program ID:", programId.toBase58());

  // Configuration
  const config: DeploymentConfig = {
    programId: programId.toBase58(),
    tokenMint: process.env.MWOR_TOKEN_MINT || "So11111111111111111111111111111111111111112", // Use SOL for testing
    vrfOracle: process.env.VRF_ORACLE_PUBKEY || walletKeypair.publicKey.toBase58(),
    treasuryAuthority: process.env.TREASURY_AUTHORITY || walletKeypair.publicKey.toBase58(),
    feePercentage: parseInt(process.env.TREASURY_FEE_PERCENTAGE || "10"),
    network,
  };

  // Find PDAs
  const [treasuryPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    programId
  );

  console.log("🏛️ Treasury PDA:", treasuryPDA.toBase58());

  // Check if already initialized
  try {
    const treasuryState = await program.account.treasuryState.fetch(treasuryPDA);
    console.log("✅ Program already initialized");
    console.log("Treasury Authority:", treasuryState.authority.toBase58());
    console.log("Fee Percentage:", treasuryState.feePercentage, "%");
  } catch {
    console.log("📝 Initializing program...");
    
    // Initialize the program
    try {
      const tx = await program.methods
        .initialize(
          new PublicKey(config.treasuryAuthority),
          config.feePercentage
        )
        .accounts({
          authority: walletKeypair.publicKey,
          tokenMint: new PublicKey(config.tokenMint),
        })
        .rpc();

      console.log("✅ Program initialized!");
      console.log("Transaction:", tx);
    } catch (err) {
      console.error("❌ Failed to initialize:", err);
      throw err;
    }
  }

  // Save deployment configuration
  const deploymentInfo = {
    ...config,
    treasuryPDA: treasuryPDA.toBase58(),
    deployedAt: new Date().toISOString(),
    deployedBy: walletKeypair.publicKey.toBase58(),
  };

  const configPath = `./deployments/${network}.json`;
  writeFileSync(configPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("💾 Deployment config saved to:", configPath);

  // Update .env file
  updateEnvFile({
    SOLANA_PROGRAM_ID: programId.toBase58(),
    SOLANA_TREASURY_PDA: treasuryPDA.toBase58(),
    SOLANA_NETWORK: network,
    MWOR_TOKEN_MINT: config.tokenMint,
    VRF_ORACLE_PUBKEY: config.vrfOracle,
  });

  console.log("\n✅ Deployment complete!");
  console.log("\n📋 Next steps:");
  console.log("1. Update your bot configuration with the program ID");
  console.log("2. Ensure the VRF oracle is configured");
  console.log("3. Fund the bot wallet for transaction fees");
  console.log("4. Test with a small game first");
}

function updateEnvFile(updates: Record<string, string>) {
  const envPath = ".env";
  let envContent = "";

  try {
    envContent = readFileSync(envPath, "utf-8");
  } catch {
    // File doesn't exist, create it
  }

  // Parse existing env
  const envLines = envContent.split("\n");
  const envVars: Record<string, string> = {};

  envLines.forEach(line => {
    const [key, ...valueParts] = line.split("=");
    if (key && !key.startsWith("#")) {
      envVars[key.trim()] = valueParts.join("=").trim();
    }
  });

  // Update with new values
  Object.assign(envVars, updates);

  // Write back
  const newEnvContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  writeFileSync(envPath, newEnvContent);
  console.log("✅ Updated .env file");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
  });