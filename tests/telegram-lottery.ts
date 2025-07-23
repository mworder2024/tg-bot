import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TelegramLottery } from "../target/types/telegram_lottery";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";

describe("telegram-lottery", () => {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TelegramLottery as Program<TelegramLottery>;
  
  // Test accounts
  let treasuryAuthority: Keypair;
  let gameAuthority: Keypair;
  let vrfOracle: Keypair;
  let player1: Keypair;
  let player2: Keypair;
  let player3: Keypair;
  
  // Token mint
  let tokenMint: PublicKey;
  let mintAuthority: Keypair;
  
  // PDAs
  let treasuryPDA: PublicKey;
  let treasuryBump: number;
  let treasuryTokenAccount: PublicKey;
  
  // Test data
  const gameId = "test-game-001";
  const entryFee = new BN(1_000_000); // 1 MWOR (6 decimals)
  const maxPlayers = 3;
  const winnerCount = 1;
  const paymentDeadlineMinutes = 60;
  const feePercentage = 10; // 10%

  before(async () => {
    // Initialize test accounts
    treasuryAuthority = Keypair.generate();
    gameAuthority = Keypair.generate();
    vrfOracle = Keypair.generate();
    player1 = Keypair.generate();
    player2 = Keypair.generate();
    player3 = Keypair.generate();
    mintAuthority = Keypair.generate();
    
    // Airdrop SOL to test accounts
    const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;
    await Promise.all([
      provider.connection.requestAirdrop(treasuryAuthority.publicKey, airdropAmount),
      provider.connection.requestAirdrop(gameAuthority.publicKey, airdropAmount),
      provider.connection.requestAirdrop(vrfOracle.publicKey, airdropAmount),
      provider.connection.requestAirdrop(player1.publicKey, airdropAmount),
      provider.connection.requestAirdrop(player2.publicKey, airdropAmount),
      provider.connection.requestAirdrop(player3.publicKey, airdropAmount),
      provider.connection.requestAirdrop(mintAuthority.publicKey, airdropAmount),
    ]);
    
    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create token mint (MWOR)
    tokenMint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6 // 6 decimals
    );
    
    // Find treasury PDA
    [treasuryPDA, treasuryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );
    
    // Get treasury token account
    treasuryTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      treasuryPDA,
      true // allowOwnerOffCurve for PDA
    );
  });

  describe("Initialize", () => {
    it("Initializes the lottery program", async () => {
      await program.methods
        .initialize(treasuryAuthority.publicKey, feePercentage)
        .accounts({
          authority: gameAuthority.publicKey,
          treasuryState: treasuryPDA,
          treasuryTokenAccount,
          tokenMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([gameAuthority])
        .rpc();
      
      // Verify treasury state
      const treasuryState = await program.account.treasuryState.fetch(treasuryPDA);
      assert.equal(treasuryState.authority.toBase58(), treasuryAuthority.publicKey.toBase58());
      assert.equal(treasuryState.feePercentage, feePercentage);
      assert.equal(treasuryState.totalCollected.toNumber(), 0);
      assert.equal(treasuryState.pendingWithdrawal.toNumber(), 0);
    });
  });

  describe("Create Game", () => {
    let gamePDA: PublicKey;
    let playerListPDA: PublicKey;
    let escrowPDA: PublicKey;
    
    before(async () => {
      // Find game PDAs
      [gamePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), Buffer.from(gameId)],
        program.programId
      );
      
      [playerListPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("players"), Buffer.from(gameId)],
        program.programId
      );
      
      [escrowPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), Buffer.from(gameId)],
        program.programId
      );
    });
    
    it("Creates a new lottery game", async () => {
      await program.methods
        .createGame(gameId, entryFee, maxPlayers, winnerCount, paymentDeadlineMinutes)
        .accounts({
          authority: gameAuthority.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
          treasuryState: treasuryPDA,
          tokenMint,
          escrowAccount: escrowPDA,
          vrfOracle: vrfOracle.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([gameAuthority])
        .rpc();
      
      // Verify game state
      const gameState = await program.account.gameState.fetch(gamePDA);
      assert.equal(gameState.gameId, gameId);
      assert.equal(gameState.authority.toBase58(), gameAuthority.publicKey.toBase58());
      assert.equal(gameState.entryFee.toNumber(), entryFee.toNumber());
      assert.equal(gameState.maxPlayers, maxPlayers);
      assert.equal(gameState.winnerCount, winnerCount);
      assert.equal(gameState.state.joining !== undefined, true);
      assert.equal(gameState.prizePool.toNumber(), 0);
      
      // Verify player list
      const playerList = await program.account.playerList.fetch(playerListPDA);
      assert.equal(playerList.gameId, gameId);
      assert.equal(playerList.players.length, 0);
    });
  });

  describe("Join Game", () => {
    let gamePDA: PublicKey;
    let playerListPDA: PublicKey;
    let escrowPDA: PublicKey;
    let player1TokenAccount: PublicKey;
    let player2TokenAccount: PublicKey;
    let player3TokenAccount: PublicKey;
    
    before(async () => {
      // Find PDAs
      [gamePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), Buffer.from(gameId)],
        program.programId
      );
      
      [playerListPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("players"), Buffer.from(gameId)],
        program.programId
      );
      
      [escrowPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), Buffer.from(gameId)],
        program.programId
      );
      
      // Create player token accounts and mint tokens
      player1TokenAccount = await createAccount(
        provider.connection,
        player1,
        tokenMint,
        player1.publicKey
      );
      
      player2TokenAccount = await createAccount(
        provider.connection,
        player2,
        tokenMint,
        player2.publicKey
      );
      
      player3TokenAccount = await createAccount(
        provider.connection,
        player3,
        tokenMint,
        player3.publicKey
      );
      
      // Mint tokens to players (10 MWOR each)
      const mintAmount = 10_000_000; // 10 MWOR
      await Promise.all([
        mintTo(
          provider.connection,
          mintAuthority,
          tokenMint,
          player1TokenAccount,
          mintAuthority.publicKey,
          mintAmount
        ),
        mintTo(
          provider.connection,
          mintAuthority,
          tokenMint,
          player2TokenAccount,
          mintAuthority.publicKey,
          mintAmount
        ),
        mintTo(
          provider.connection,
          mintAuthority,
          tokenMint,
          player3TokenAccount,
          mintAuthority.publicKey,
          mintAmount
        ),
      ]);
    });
    
    it("Player 1 joins the game", async () => {
      await program.methods
        .joinGame(gameId, "player1_telegram_id")
        .accounts({
          player: player1.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
          playerTokenAccount: player1TokenAccount,
          escrowAccount: escrowPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([player1])
        .rpc();
      
      // Verify player was added
      const playerList = await program.account.playerList.fetch(playerListPDA);
      assert.equal(playerList.players.length, 1);
      assert.equal(playerList.players[0].wallet.toBase58(), player1.publicKey.toBase58());
      assert.equal(playerList.players[0].telegramId, "player1_telegram_id");
      
      // Verify game state updated
      const gameState = await program.account.gameState.fetch(gamePDA);
      assert.equal(gameState.prizePool.toNumber(), entryFee.toNumber());
      
      // Verify escrow received funds
      const escrowAccount = await getAccount(provider.connection, escrowPDA);
      assert.equal(escrowAccount.amount.toString(), entryFee.toString());
    });
    
    it("Player 2 joins the game", async () => {
      await program.methods
        .joinGame(gameId, "player2_telegram_id")
        .accounts({
          player: player2.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
          playerTokenAccount: player2TokenAccount,
          escrowAccount: escrowPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([player2])
        .rpc();
      
      const playerList = await program.account.playerList.fetch(playerListPDA);
      assert.equal(playerList.players.length, 2);
    });
    
    it("Player 3 joins the game (game becomes full)", async () => {
      await program.methods
        .joinGame(gameId, "player3_telegram_id")
        .accounts({
          player: player3.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
          playerTokenAccount: player3TokenAccount,
          escrowAccount: escrowPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([player3])
        .rpc();
      
      const playerList = await program.account.playerList.fetch(playerListPDA);
      assert.equal(playerList.players.length, 3);
      
      // Game should transition to NumberSelection state
      const gameState = await program.account.gameState.fetch(gamePDA);
      assert.equal(gameState.state.numberSelection !== undefined, true);
      assert.equal(gameState.prizePool.toNumber(), entryFee.toNumber() * 3);
    });
  });

  describe("Select Numbers", () => {
    let gamePDA: PublicKey;
    let playerListPDA: PublicKey;
    
    before(async () => {
      [gamePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), Buffer.from(gameId)],
        program.programId
      );
      
      [playerListPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("players"), Buffer.from(gameId)],
        program.programId
      );
    });
    
    it("Player 1 selects number 1", async () => {
      await program.methods
        .selectNumber(gameId, 1)
        .accounts({
          player: player1.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
        })
        .signers([player1])
        .rpc();
      
      const playerList = await program.account.playerList.fetch(playerListPDA);
      const player1Data = playerList.players.find(p => 
        p.wallet.toBase58() === player1.publicKey.toBase58()
      );
      assert.equal(player1Data.selectedNumber, 1);
    });
    
    it("Player 2 selects number 2", async () => {
      await program.methods
        .selectNumber(gameId, 2)
        .accounts({
          player: player2.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
        })
        .signers([player2])
        .rpc();
    });
    
    it("Player 3 selects number 3", async () => {
      await program.methods
        .selectNumber(gameId, 3)
        .accounts({
          player: player3.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
        })
        .signers([player3])
        .rpc();
      
      // All numbers selected - ready for VRF
      const playerList = await program.account.playerList.fetch(playerListPDA);
      assert.equal(playerList.players.every(p => p.selectedNumber !== null), true);
    });
    
    it("Fails when trying to select already taken number", async () => {
      try {
        await program.methods
          .selectNumber(gameId, 1) // Already taken by player1
          .accounts({
            player: player2.publicKey,
            gameState: gamePDA,
            playerList: playerListPDA,
          })
          .signers([player2])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "NumberAlreadyTaken");
      }
    });
  });

  describe("VRF and Elimination", () => {
    let gamePDA: PublicKey;
    let playerListPDA: PublicKey;
    let vrfPDA: PublicKey;
    const round = 1;
    
    before(async () => {
      [gamePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), Buffer.from(gameId)],
        program.programId
      );
      
      [playerListPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("players"), Buffer.from(gameId)],
        program.programId
      );
      
      [vrfPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vrf"), Buffer.from(gameId), Buffer.from([round])],
        program.programId
      );
      
      // Manually update game state to Playing (normally done by authority)
      // In production, this would be a separate instruction
    });
    
    it("VRF oracle submits random result", async () => {
      const randomValue = new Uint8Array(32);
      randomValue[0] = 1; // Will result in number 2 being drawn
      const proof = new Uint8Array(64); // Simplified proof
      
      await program.methods
        .submitVrf(gameId, round, Array.from(randomValue), Array.from(proof))
        .accounts({
          vrfOracle: vrfOracle.publicKey,
          gameState: gamePDA,
          vrfResult: vrfPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([vrfOracle])
        .rpc();
      
      const vrfResult = await program.account.vrfResult.fetch(vrfPDA);
      assert.equal(vrfResult.round, round);
      assert.equal(vrfResult.used, false);
      assert.equal(vrfResult.drawnNumber, 2); // Based on our random value
    });
    
    it("Process elimination round", async () => {
      await program.methods
        .processElimination(gameId, round)
        .accounts({
          authority: gameAuthority.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
          vrfResult: vrfPDA,
        })
        .signers([gameAuthority])
        .rpc();
      
      // Verify player 2 was eliminated
      const playerList = await program.account.playerList.fetch(playerListPDA);
      const player2Data = playerList.players.find(p => 
        p.wallet.toBase58() === player2.publicKey.toBase58()
      );
      assert.equal(player2Data.eliminatedRound, round);
      
      // Verify VRF marked as used
      const vrfResult = await program.account.vrfResult.fetch(vrfPDA);
      assert.equal(vrfResult.used, true);
    });
  });

  describe("Complete Game and Claim Prizes", () => {
    let gamePDA: PublicKey;
    let playerListPDA: PublicKey;
    let escrowPDA: PublicKey;
    
    before(async () => {
      [gamePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), Buffer.from(gameId)],
        program.programId
      );
      
      [playerListPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("players"), Buffer.from(gameId)],
        program.programId
      );
      
      [escrowPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), Buffer.from(gameId)],
        program.programId
      );
    });
    
    it("Completes the game", async () => {
      const treasuryBalanceBefore = await getAccount(
        provider.connection, 
        treasuryTokenAccount
      );
      
      await program.methods
        .completeGame(gameId)
        .accounts({
          authority: gameAuthority.publicKey,
          gameState: gamePDA,
          playerList: playerListPDA,
          treasuryState: treasuryPDA,
          escrowAccount: escrowPDA,
          treasuryTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([gameAuthority])
        .rpc();
      
      // Verify game state
      const gameState = await program.account.gameState.fetch(gamePDA);
      assert.equal(gameState.state.distributing !== undefined, true);
      
      // Verify treasury received fee
      const treasuryBalanceAfter = await getAccount(
        provider.connection, 
        treasuryTokenAccount
      );
      const expectedFee = entryFee.toNumber() * 3 * feePercentage / 100;
      assert.equal(
        treasuryBalanceAfter.amount - treasuryBalanceBefore.amount,
        expectedFee
      );
      
      // Verify winners marked
      const playerList = await program.account.playerList.fetch(playerListPDA);
      const winners = playerList.players.filter(p => p.isWinner);
      assert.equal(winners.length, winnerCount);
    });
    
    it("Winner claims prize", async () => {
      const playerList = await program.account.playerList.fetch(playerListPDA);
      const winner = playerList.players.find(p => p.isWinner);
      const winnerTokenAccount = winner.wallet.toBase58() === player1.publicKey.toBase58() 
        ? player1TokenAccount 
        : player3TokenAccount;
      const winnerKeypair = winner.wallet.toBase58() === player1.publicKey.toBase58()
        ? player1
        : player3;
      
      const balanceBefore = await getAccount(provider.connection, winnerTokenAccount);
      
      await program.methods
        .claimPrize(gameId)
        .accounts({
          winner: winner.wallet,
          gameState: gamePDA,
          playerList: playerListPDA,
          escrowAccount: escrowPDA,
          winnerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerKeypair])
        .rpc();
      
      // Verify prize received
      const balanceAfter = await getAccount(provider.connection, winnerTokenAccount);
      const prizeAmount = winner.prizeAmount;
      assert.equal(
        balanceAfter.amount - balanceBefore.amount,
        prizeAmount
      );
      
      // Verify prize marked as claimed
      const updatedPlayerList = await program.account.playerList.fetch(playerListPDA);
      const updatedWinner = updatedPlayerList.players.find(p => 
        p.wallet.toBase58() === winner.wallet.toBase58()
      );
      assert.equal(updatedWinner.prizeClaimed, true);
    });
  });

  describe("Error Cases", () => {
    const errorGameId = "error-game-001";
    let gamePDA: PublicKey;
    let playerListPDA: PublicKey;
    
    before(async () => {
      [gamePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), Buffer.from(errorGameId)],
        program.programId
      );
      
      [playerListPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("players"), Buffer.from(errorGameId)],
        program.programId
      );
    });
    
    it("Fails to create game with invalid parameters", async () => {
      try {
        await program.methods
          .createGame(errorGameId, new BN(0), maxPlayers, winnerCount, paymentDeadlineMinutes)
          .accounts({
            authority: gameAuthority.publicKey,
            gameState: gamePDA,
            playerList: playerListPDA,
            treasuryState: treasuryPDA,
            tokenMint,
            escrowAccount: escrowPDA,
            vrfOracle: vrfOracle.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([gameAuthority])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "InvalidEntryFee");
      }
    });
    
    it("Fails when unauthorized account tries to complete game", async () => {
      try {
        await program.methods
          .completeGame(gameId)
          .accounts({
            authority: player1.publicKey, // Wrong authority
            gameState: gamePDA,
            playerList: playerListPDA,
            treasuryState: treasuryPDA,
            escrowAccount: escrowPDA,
            treasuryTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([player1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });
  });
});