#!/usr/bin/env tsx

/**
 * Wallet Generation Script for Telegram Lottery Bot
 * 
 * This script generates secure bot and treasury wallets for the paid raffle system.
 * Run this script once during initial setup to create your wallet configuration.
 * 
 * Usage: npm run generate-wallets
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';
import * as dotenv from 'dotenv';

// Load existing environment variables
dotenv.config();

interface WalletConfig {
  botWalletPrivateKey: string;
  treasuryWalletPrivateKey: string;
  botWalletPublicKey: string;
  treasuryWalletPublicKey: string;
  encryptionKey: string;
}

/**
 * Generate a random encryption key
 */
function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Encrypt private key using AES-256
 */
function encryptPrivateKey(privateKey: Uint8Array, encryptionKey: string): string {
  const cipher = crypto.createCipher('aes256', encryptionKey);
  const base58Key = bs58.encode(privateKey);
  let encrypted = cipher.update(base58Key, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

/**
 * Generate bot and treasury wallets
 */
function generateWallets(): WalletConfig {
  console.log('🔑 Generating new wallets...');
  
  // Generate encryption key
  const encryptionKey = generateEncryptionKey();
  console.log('✅ Encryption key generated');
  
  // Generate bot wallet
  const botKeypair = Keypair.generate();
  const encryptedBotKey = encryptPrivateKey(botKeypair.secretKey, encryptionKey);
  console.log('✅ Bot wallet generated');
  console.log(`   Public Key: ${botKeypair.publicKey.toString()}`);
  
  // Generate treasury wallet
  const treasuryKeypair = Keypair.generate();
  const encryptedTreasuryKey = encryptPrivateKey(treasuryKeypair.secretKey, encryptionKey);
  console.log('✅ Treasury wallet generated');
  console.log(`   Public Key: ${treasuryKeypair.publicKey.toString()}`);
  
  return {
    botWalletPrivateKey: encryptedBotKey,
    treasuryWalletPrivateKey: encryptedTreasuryKey,
    botWalletPublicKey: botKeypair.publicKey.toString(),
    treasuryWalletPublicKey: treasuryKeypair.publicKey.toString(),
    encryptionKey
  };
}

/**
 * Update .env file with new wallet configuration
 */
function updateEnvFile(config: WalletConfig): void {
  const envPath = path.join(process.cwd(), '.env');
  const envExamplePath = path.join(process.cwd(), '.env.example');
  
  // Read existing .env file or create from example
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log('📝 Updating existing .env file...');
  } else if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, 'utf8');
    console.log('📝 Creating .env file from .env.example...');
  } else {
    throw new Error('.env.example file not found. Please ensure it exists in the project root.');
  }
  
  // Update or add wallet configuration
  const updates = [
    { key: 'BOT_WALLET_PRIVATE_KEY', value: config.botWalletPrivateKey },
    { key: 'TREASURY_WALLET_PRIVATE_KEY', value: config.treasuryWalletPrivateKey },
    { key: 'WALLET_ENCRYPTION_KEY', value: config.encryptionKey }
  ];
  
  updates.forEach(({ key, value }) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (envContent.match(regex)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  });
  
  // Write updated .env file
  fs.writeFileSync(envPath, envContent);
  console.log('✅ .env file updated');
}

/**
 * Create wallet backup file
 */
function createWalletBackup(config: WalletConfig): void {
  const backupDir = path.join(process.cwd(), 'wallet-backup');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `wallet-config-${timestamp}.json`);
  
  const backupData = {
    timestamp: new Date().toISOString(),
    description: 'Telegram Lottery Bot Wallet Configuration Backup',
    warning: 'This file contains encrypted private keys. Keep it secure and never share it.',
    botWallet: {
      publicKey: config.botWalletPublicKey,
      encryptedPrivateKey: config.botWalletPrivateKey
    },
    treasuryWallet: {
      publicKey: config.treasuryWalletPublicKey,
      encryptedPrivateKey: config.treasuryWalletPrivateKey
    },
    encryptionKey: config.encryptionKey
  };
  
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  console.log(`💾 Wallet backup created: ${backupPath}`);
}

/**
 * Display security instructions
 */
function displaySecurityInstructions(config: WalletConfig): void {
  console.log('\n' + '='.repeat(80));
  console.log('🔐 IMPORTANT SECURITY INFORMATION');
  console.log('='.repeat(80));
  
  console.log('\n📍 WALLET ADDRESSES (Safe to share):');
  console.log(`   Bot Wallet:      ${config.botWalletPublicKey}`);
  console.log(`   Treasury Wallet: ${config.treasuryWalletPublicKey}`);
  
  console.log('\n⚠️  CRITICAL SECURITY NOTES:');
  console.log('   1. Your private keys are encrypted in the .env file');
  console.log('   2. Keep the WALLET_ENCRYPTION_KEY secret and secure');
  console.log('   3. Backup the wallet-backup/ folder in a secure location');
  console.log('   4. Never commit .env file to version control');
  console.log('   5. Fund the bot wallet with SOL for transaction fees');
  console.log('   6. Both wallets need SOL for gas fees');
  
  console.log('\n💰 FUNDING INSTRUCTIONS:');
  console.log('   1. Send SOL to the bot wallet for transaction fees (~0.1 SOL recommended)');
  console.log('   2. Send SOL to the treasury wallet for future transactions (~0.05 SOL)');
  console.log('   3. Bot wallet will receive MWOR payments from users');
  console.log('   4. Treasury wallet will receive 10% system fees');
  
  console.log('\n🚨 EMERGENCY RECOVERY:');
  console.log('   - If you lose the .env file, use the backup in wallet-backup/');
  console.log('   - You need both the encrypted private key AND encryption key');
  console.log('   - Contact support if you lose access to both');
  
  console.log('\n✅ NEXT STEPS:');
  console.log('   1. Fund both wallets with SOL');
  console.log('   2. Update MWOR_TOKEN_MINT in .env with the actual MWOR token address');
  console.log('   3. Set ENABLE_PAID_GAMES=true when ready to enable paid features');
  console.log('   4. Test on devnet first before using mainnet');
  
  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('🎲 Telegram Lottery Bot - Wallet Generator');
    console.log('==========================================\n');
    
    // Check if wallets already exist
    if (process.env.BOT_WALLET_PRIVATE_KEY && process.env.TREASURY_WALLET_PRIVATE_KEY) {
      console.log('⚠️  Wallets already exist in .env file');
      console.log('If you want to generate new wallets, clear the existing values first.');
      console.log('WARNING: Generating new wallets will make your old wallets inaccessible!');
      
      // Add confirmation prompt here if needed
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        readline.question('Do you want to generate NEW wallets? (yes/no): ', resolve);
      });
      
      readline.close();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('Operation cancelled. Existing wallets preserved.');
        return;
      }
      
      console.log('⚠️  Generating new wallets will overwrite existing configuration!');
    }
    
    // Generate wallets
    const config = generateWallets();
    
    // Update .env file
    updateEnvFile(config);
    
    // Create backup
    createWalletBackup(config);
    
    // Display instructions
    displaySecurityInstructions(config);
    
    console.log('🎉 Wallet generation completed successfully!');
    
  } catch (error) {
    console.error('❌ Error generating wallets:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

export { generateWallets, updateEnvFile, createWalletBackup };