import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bs58 from 'bs58';

export interface WalletInfo {
  publicKey: string;
  solBalance: number;
  mworBalance: number;
  lastUpdated: Date;
}

export interface SecureWalletData {
  encryptedPrivateKey: string;
  publicKey: string;
  salt: string;
  iv: string;
}

class BotWalletManager {
  private walletPath: string;
  private connection: Connection;
  private keypair: Keypair | null = null;
  private readonly MWOR_TOKEN_MINT = new PublicKey('11111111111111111111111111111112'); // Placeholder - replace with actual MWOR token mint
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-cbc';

  constructor() {
    this.walletPath = path.join(__dirname, '../config/bot-wallet.json');
    // Use environment variable or default to devnet
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.ensureDirectoriesExist();
  }

  private ensureDirectoriesExist(): void {
    const dir = path.dirname(this.walletPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Generate encryption key from bot token (deterministic but secure)
   */
  private getEncryptionKey(): Buffer {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      throw new Error('BOT_TOKEN not found in environment variables');
    }
    
    // Use the bot token to create a deterministic encryption key
    return crypto.pbkdf2Sync(botToken, 'solana-wallet-salt', 100000, 32, 'sha256');
  }

  /**
   * Encrypt private key using bot token as encryption key
   */
  private encryptPrivateKey(privateKey: Uint8Array): { encryptedData: string; iv: string; salt: string } {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const salt = crypto.randomBytes(32).toString('hex');
    
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv);
    let encrypted = cipher.update(Buffer.from(privateKey), undefined, 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encryptedData: encrypted,
      iv: iv.toString('hex'),
      salt
    };
  }

  /**
   * Decrypt private key using bot token as encryption key
   */
  private decryptPrivateKey(encryptedData: string, ivHex: string): Uint8Array {
    const key = this.getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, key, iv);
    
    let decrypted = decipher.update(encryptedData, 'hex');
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return new Uint8Array(decrypted);
  }

  /**
   * Initialize or load bot wallet
   */
  async initializeWallet(): Promise<void> {
    try {
      if (fs.existsSync(this.walletPath)) {
        // Load existing wallet
        await this.loadWallet();
        console.log('📱 Bot wallet loaded successfully');
      } else {
        // Generate new wallet
        await this.generateNewWallet();
        console.log('📱 New bot wallet generated and saved');
      }
    } catch (error) {
      console.error('❌ Error initializing bot wallet:', error);
      throw error;
    }
  }

  /**
   * Generate a new Solana wallet for the bot
   */
  private async generateNewWallet(): Promise<void> {
    this.keypair = Keypair.generate();
    await this.saveWallet();
  }

  /**
   * Save wallet to encrypted file
   */
  private async saveWallet(): Promise<void> {
    if (!this.keypair) {
      throw new Error('No keypair to save');
    }

    const encrypted = this.encryptPrivateKey(this.keypair.secretKey);
    
    const walletData: SecureWalletData = {
      encryptedPrivateKey: encrypted.encryptedData,
      publicKey: this.keypair.publicKey.toBase58(),
      salt: encrypted.salt,
      iv: encrypted.iv
    };

    fs.writeFileSync(this.walletPath, JSON.stringify(walletData, null, 2));
  }

  /**
   * Load wallet from encrypted file
   */
  private async loadWallet(): Promise<void> {
    const data = fs.readFileSync(this.walletPath, 'utf8');
    const walletData: SecureWalletData = JSON.parse(data);
    
    const privateKeyBytes = this.decryptPrivateKey(walletData.encryptedPrivateKey, walletData.iv);
    this.keypair = Keypair.fromSecretKey(privateKeyBytes);
    
    // Verify the public key matches
    if (this.keypair.publicKey.toBase58() !== walletData.publicKey) {
      throw new Error('Wallet decryption failed - public key mismatch');
    }
  }

  /**
   * Get bot's public key
   */
  getPublicKey(): string {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }
    return this.keypair.publicKey.toBase58();
  }

  /**
   * Get bot's private key (SUPER ADMIN ONLY)
   */
  getPrivateKey(): string {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }
    return bs58.encode(this.keypair.secretKey);
  }

  /**
   * Get SOL balance
   */
  async getSolBalance(): Promise<number> {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    try {
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error fetching SOL balance:', error);
      return 0;
    }
  }

  /**
   * Get MWOR token balance
   */
  async getMworBalance(): Promise<number> {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    try {
      // Get associated token account for MWOR
      const associatedTokenAccount = await getAssociatedTokenAddress(
        this.MWOR_TOKEN_MINT,
        this.keypair.publicKey
      );

      // Get account info
      const accountInfo = await getAccount(this.connection, associatedTokenAccount);
      
      // Convert to human readable (assuming 6 decimals for MWOR)
      return Number(accountInfo.amount) / Math.pow(10, 6);
    } catch (error) {
      // Token account might not exist yet
      console.log('MWOR token account not found or error:', error);
      return 0;
    }
  }

  /**
   * Get complete wallet information
   */
  async getWalletInfo(): Promise<WalletInfo> {
    const [solBalance, mworBalance] = await Promise.all([
      this.getSolBalance(),
      this.getMworBalance()
    ]);

    return {
      publicKey: this.getPublicKey(),
      solBalance,
      mworBalance,
      lastUpdated: new Date()
    };
  }

  /**
   * Get wallet info with cached balances (for quick display)
   */
  async getWalletInfoCached(): Promise<WalletInfo> {
    try {
      return await this.getWalletInfo();
    } catch (error) {
      console.error('Error fetching wallet info:', error);
      return {
        publicKey: this.getPublicKey(),
        solBalance: 0,
        mworBalance: 0,
        lastUpdated: new Date()
      };
    }
  }

  /**
   * Check if wallet is initialized
   */
  isInitialized(): boolean {
    return this.keypair !== null;
  }

  /**
   * Get connection for external use
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get keypair for transaction signing (internal use only)
   */
  getKeypair(): Keypair | null {
    return this.keypair;
  }

  /**
   * Format balance for display
   */
  static formatBalance(balance: number, decimals: number = 4): string {
    if (balance === 0) return '0';
    if (balance < 0.0001) return '< 0.0001';
    return balance.toFixed(decimals);
  }

  /**
   * Validate if a string is a valid Solana address
   */
  static isValidSolanaAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
}

export const botWalletManager = new BotWalletManager();