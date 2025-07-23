/**
 * Platform-specific wallet adapters for multi-platform support
 */

import { PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { WalletAdapter } from '@solana/wallet-adapter-base';

/**
 * Telegram Mini App Wallet Adapter
 * Uses server-side wallet management for Telegram users
 */
export class TelegramWalletAdapter {
  private serverEndpoint: string;
  private userId: string;
  private _publicKey: PublicKey | null = null;

  constructor(serverEndpoint: string, userId: string) {
    this.serverEndpoint = serverEndpoint;
    this.userId = userId;
  }

  async connect(): Promise<void> {
    // Request wallet info from server
    const response = await fetch(`${this.serverEndpoint}/api/v1/wallet/telegram/${this.userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to connect Telegram wallet');
    }

    const data = await response.json();
    this._publicKey = new PublicKey(data.publicKey);
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this._publicKey) {
      throw new Error('Wallet not connected');
    }

    // Send transaction to server for signing
    const response = await fetch(`${this.serverEndpoint}/api/v1/wallet/telegram/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: this.userId,
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to sign transaction');
    }

    const data = await response.json();
    const signedTx = Transaction.from(Buffer.from(data.signedTransaction, 'base64'));
    return signedTx;
  }

  async signAllTransactions(transactions: Transaction[]): Promise<Transaction[]> {
    // Sign each transaction individually
    return Promise.all(transactions.map(tx => this.signTransaction(tx)));
  }

  disconnect(): void {
    this._publicKey = null;
  }
}

/**
 * Discord Bot Wallet Adapter
 * Handles wallet interactions through Discord bot commands
 */
export class DiscordWalletAdapter {
  private botEndpoint: string;
  private discordUserId: string;
  private _publicKey: PublicKey | null = null;
  private sessionToken: string | null = null;

  constructor(botEndpoint: string, discordUserId: string) {
    this.botEndpoint = botEndpoint;
    this.discordUserId = discordUserId;
  }

  async connect(): Promise<void> {
    // Initialize Discord wallet session
    const response = await fetch(`${this.botEndpoint}/api/v1/wallet/discord/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        discordUserId: this.discordUserId,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create Discord wallet session');
    }

    const data = await response.json();
    this.sessionToken = data.sessionToken;
    this._publicKey = new PublicKey(data.publicKey);
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this.sessionToken || !this._publicKey) {
      throw new Error('Wallet session not active');
    }

    // Request user approval through Discord DM
    const approvalResponse = await fetch(`${this.botEndpoint}/api/v1/wallet/discord/request-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.sessionToken}`,
      },
      body: JSON.stringify({
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
        description: 'Sign lottery transaction',
      }),
    });

    if (!approvalResponse.ok) {
      throw new Error('Failed to request transaction signature');
    }

    const { requestId } = await approvalResponse.json();

    // Poll for user approval (with timeout)
    const signedTx = await this.waitForApproval(requestId);
    return signedTx;
  }

  private async waitForApproval(requestId: string, timeout = 60000): Promise<Transaction> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const response = await fetch(
        `${this.botEndpoint}/api/v1/wallet/discord/signature-status/${requestId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.sessionToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to check signature status');
      }

      const data = await response.json();

      if (data.status === 'approved' && data.signedTransaction) {
        return Transaction.from(Buffer.from(data.signedTransaction, 'base64'));
      } else if (data.status === 'rejected') {
        throw new Error('Transaction rejected by user');
      }

      // Wait 2 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Transaction approval timeout');
  }

  async signAllTransactions(transactions: Transaction[]): Promise<Transaction[]> {
    // Sign each transaction individually with user approval
    return Promise.all(transactions.map(tx => this.signTransaction(tx)));
  }

  disconnect(): void {
    this._publicKey = null;
    this.sessionToken = null;
  }
}

/**
 * Mobile Deep Link Wallet Adapter
 * Handles wallet interactions through mobile app deep links
 */
export class MobileDeepLinkAdapter {
  private _publicKey: PublicKey | null = null;
  private walletScheme: string;
  private returnUrl: string;
  private pendingTransactions: Map<string, (tx: Transaction) => void> = new Map();

  constructor(walletScheme: string, returnUrl: string) {
    this.walletScheme = walletScheme;
    this.returnUrl = returnUrl;

    // Listen for deep link returns
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleDeepLinkReturn.bind(this));
    }
  }

  async connect(): Promise<void> {
    // Generate connection request
    const requestId = this.generateRequestId();
    const connectUrl = `${this.walletScheme}://connect?` +
      `return_url=${encodeURIComponent(this.returnUrl)}&` +
      `request_id=${requestId}`;

    // Open wallet app
    window.location.href = connectUrl;

    // Wait for connection response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Wallet connection timeout'));
      }, 30000);

      const checkConnection = () => {
        const publicKey = localStorage.getItem(`wallet_pubkey_${requestId}`);
        if (publicKey) {
          clearTimeout(timeout);
          this._publicKey = new PublicKey(publicKey);
          localStorage.removeItem(`wallet_pubkey_${requestId}`);
          resolve();
        } else {
          setTimeout(checkConnection, 500);
        }
      };

      checkConnection();
    });
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this._publicKey) {
      throw new Error('Wallet not connected');
    }

    const requestId = this.generateRequestId();
    const txBase64 = transaction.serialize({ requireAllSignatures: false }).toString('base64');

    // Store transaction resolver
    return new Promise((resolve, reject) => {
      this.pendingTransactions.set(requestId, resolve);

      // Create signing URL
      const signUrl = `${this.walletScheme}://sign?` +
        `transaction=${encodeURIComponent(txBase64)}&` +
        `return_url=${encodeURIComponent(this.returnUrl)}&` +
        `request_id=${requestId}`;

      // Open wallet app for signing
      window.location.href = signUrl;

      // Timeout after 60 seconds
      setTimeout(() => {
        this.pendingTransactions.delete(requestId);
        reject(new Error('Transaction signing timeout'));
      }, 60000);
    });
  }

  private handleDeepLinkReturn(event: MessageEvent): void {
    if (event.data?.type === 'wallet_response') {
      const { requestId, signedTransaction } = event.data;
      const resolver = this.pendingTransactions.get(requestId);

      if (resolver && signedTransaction) {
        const tx = Transaction.from(Buffer.from(signedTransaction, 'base64'));
        resolver(tx);
        this.pendingTransactions.delete(requestId);
      }
    }
  }

  async signAllTransactions(transactions: Transaction[]): Promise<Transaction[]> {
    // Mobile wallets typically don't support batch signing
    return Promise.all(transactions.map(tx => this.signTransaction(tx)));
  }

  disconnect(): void {
    this._publicKey = null;
    this.pendingTransactions.clear();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Platform adapter factory
 */
export function createPlatformAdapter(
  platform: string,
  config: any
): TelegramWalletAdapter | DiscordWalletAdapter | MobileDeepLinkAdapter | null {
  switch (platform) {
    case 'telegram':
      return new TelegramWalletAdapter(config.serverEndpoint, config.userId);
    
    case 'discord':
      return new DiscordWalletAdapter(config.botEndpoint, config.discordUserId);
    
    case 'mobile':
      return new MobileDeepLinkAdapter(config.walletScheme, config.returnUrl);
    
    default:
      // For web platform, use standard Solana wallet adapters
      return null;
  }
}