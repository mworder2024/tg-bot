import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { 
  createMint, 
  createAccount,
  mintTo,
  getAccount,
  Account
} from "@solana/spl-token";
import { BN } from "bn.js";

export interface TestAccounts {
  treasuryAuthority: Keypair;
  gameAuthority: Keypair;
  vrfOracle: Keypair;
  players: Keypair[];
  tokenMint: PublicKey;
  mintAuthority: Keypair;
}

export interface GamePDAs {
  gamePDA: PublicKey;
  playerListPDA: PublicKey;
  escrowPDA: PublicKey;
}

export class TestHelper {
  constructor(
    public connection: Connection,
    public program: Program<any>
  ) {}

  /**
   * Create and fund test accounts
   */
  async setupTestAccounts(numPlayers: number = 3): Promise<TestAccounts> {
    const accounts: TestAccounts = {
      treasuryAuthority: Keypair.generate(),
      gameAuthority: Keypair.generate(),
      vrfOracle: Keypair.generate(),
      players: Array(numPlayers).fill(null).map(() => Keypair.generate()),
      tokenMint: PublicKey.default,
      mintAuthority: Keypair.generate(),
    };

    // Airdrop SOL to all accounts
    const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;
    const airdropPromises = [
      accounts.treasuryAuthority,
      accounts.gameAuthority,
      accounts.vrfOracle,
      accounts.mintAuthority,
      ...accounts.players,
    ].map(account => 
      this.connection.requestAirdrop(account.publicKey, airdropAmount)
    );

    await Promise.all(airdropPromises);
    await this.confirmTransactions(airdropPromises);

    // Create token mint
    accounts.tokenMint = await createMint(
      this.connection,
      accounts.mintAuthority,
      accounts.mintAuthority.publicKey,
      null,
      6 // 6 decimals for MWOR
    );

    return accounts;
  }

  /**
   * Create token accounts for players and mint tokens
   */
  async setupPlayerTokenAccounts(
    players: Keypair[],
    tokenMint: PublicKey,
    mintAuthority: Keypair,
    amountPerPlayer: number = 10_000_000 // 10 MWOR
  ): Promise<PublicKey[]> {
    const tokenAccounts: PublicKey[] = [];

    for (const player of players) {
      const tokenAccount = await createAccount(
        this.connection,
        player,
        tokenMint,
        player.publicKey
      );

      await mintTo(
        this.connection,
        mintAuthority,
        tokenMint,
        tokenAccount,
        mintAuthority.publicKey,
        amountPerPlayer
      );

      tokenAccounts.push(tokenAccount);
    }

    return tokenAccounts;
  }

  /**
   * Get PDAs for a game
   */
  getGamePDAs(gameId: string): GamePDAs {
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), Buffer.from(gameId)],
      this.program.programId
    );

    const [playerListPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("players"), Buffer.from(gameId)],
      this.program.programId
    );

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), Buffer.from(gameId)],
      this.program.programId
    );

    return { gamePDA, playerListPDA, escrowPDA };
  }

  /**
   * Get treasury PDAs
   */
  getTreasuryPDAs(): { treasuryPDA: PublicKey; treasuryBump: number } {
    const [treasuryPDA, treasuryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      this.program.programId
    );

    return { treasuryPDA, treasuryBump };
  }

  /**
   * Get VRF PDA
   */
  getVrfPDA(gameId: string, round: number): PublicKey {
    const [vrfPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vrf"), Buffer.from(gameId), Buffer.from([round])],
      this.program.programId
    );

    return vrfPDA;
  }

  /**
   * Wait for transactions to confirm
   */
  async confirmTransactions(signatures: any[]): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Generate random bytes for VRF
   */
  generateRandomBytes(targetNumber: number, min: number = 1, max: number = 6): Uint8Array {
    const randomValue = new Uint8Array(32);
    // Calculate value that will result in targetNumber
    const range = max - min + 1;
    const targetOffset = targetNumber - min;
    randomValue[0] = targetOffset;
    return randomValue;
  }

  /**
   * Verify token balance
   */
  async verifyTokenBalance(
    tokenAccount: PublicKey,
    expectedAmount: number
  ): Promise<boolean> {
    const account = await getAccount(this.connection, tokenAccount);
    return account.amount === BigInt(expectedAmount);
  }

  /**
   * Create a complete game scenario
   */
  async createCompleteGame(
    gameId: string,
    accounts: TestAccounts,
    playerTokenAccounts: PublicKey[],
    config: {
      entryFee: BN;
      maxPlayers: number;
      winnerCount: number;
      paymentDeadlineMinutes: number;
    }
  ): Promise<GamePDAs> {
    const pdas = this.getGamePDAs(gameId);
    const { treasuryPDA } = this.getTreasuryPDAs();

    // Create game
    await this.program.methods
      .createGame(
        gameId,
        config.entryFee,
        config.maxPlayers,
        config.winnerCount,
        config.paymentDeadlineMinutes
      )
      .accounts({
        authority: accounts.gameAuthority.publicKey,
        gameState: pdas.gamePDA,
        playerList: pdas.playerListPDA,
        treasuryState: treasuryPDA,
        tokenMint: accounts.tokenMint,
        escrowAccount: pdas.escrowPDA,
        vrfOracle: accounts.vrfOracle.publicKey,
      })
      .signers([accounts.gameAuthority])
      .rpc();

    // Join players
    for (let i = 0; i < accounts.players.length; i++) {
      await this.program.methods
        .joinGame(gameId, `player${i + 1}_telegram`)
        .accounts({
          player: accounts.players[i].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          playerTokenAccount: playerTokenAccounts[i],
          escrowAccount: pdas.escrowPDA,
        })
        .signers([accounts.players[i]])
        .rpc();
    }

    // Select numbers
    for (let i = 0; i < accounts.players.length; i++) {
      await this.program.methods
        .selectNumber(gameId, i + 1)
        .accounts({
          player: accounts.players[i].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
        })
        .signers([accounts.players[i]])
        .rpc();
    }

    return pdas;
  }

  /**
   * Process VRF and elimination
   */
  async processVrfElimination(
    gameId: string,
    round: number,
    drawnNumber: number,
    accounts: TestAccounts,
    pdas: GamePDAs
  ): Promise<void> {
    const vrfPDA = this.getVrfPDA(gameId, round);
    const randomValue = this.generateRandomBytes(drawnNumber);
    const proof = new Uint8Array(64); // Simplified proof

    // Submit VRF
    await this.program.methods
      .submitVrf(gameId, round, Array.from(randomValue), Array.from(proof))
      .accounts({
        vrfOracle: accounts.vrfOracle.publicKey,
        gameState: pdas.gamePDA,
        vrfResult: vrfPDA,
      })
      .signers([accounts.vrfOracle])
      .rpc();

    // Process elimination
    await this.program.methods
      .processElimination(gameId, round)
      .accounts({
        authority: accounts.gameAuthority.publicKey,
        gameState: pdas.gamePDA,
        playerList: pdas.playerListPDA,
        vrfResult: vrfPDA,
      })
      .signers([accounts.gameAuthority])
      .rpc();
  }
}