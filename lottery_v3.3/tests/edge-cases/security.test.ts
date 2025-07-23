import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TelegramLottery } from "../../target/types/telegram_lottery";
import { assert } from "chai";
import { BN } from "bn.js";
import { TestHelper, TestAccounts } from "../utils/test-helpers";
import { Keypair } from "@solana/web3.js";

describe("Security and Authorization Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TelegramLottery as Program<TelegramLottery>;
  const testHelper = new TestHelper(provider.connection, program);

  let accounts: TestAccounts;
  let playerTokenAccounts: PublicKey[];
  let maliciousUser: Keypair;
  let maliciousTokenAccount: PublicKey;

  const gameId = "security-test-001";
  const entryFee = new BN(1_000_000);
  const maxPlayers = 3;
  const winnerCount = 1;
  const paymentDeadlineMinutes = 60;
  const feePercentage = 10;

  before(async () => {
    // Setup test accounts
    accounts = await testHelper.setupTestAccounts(maxPlayers);
    maliciousUser = Keypair.generate();
    
    // Airdrop to malicious user
    await provider.connection.requestAirdrop(
      maliciousUser.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await testHelper.confirmTransactions([]);

    // Setup player token accounts
    playerTokenAccounts = await testHelper.setupPlayerTokenAccounts(
      accounts.players,
      accounts.tokenMint,
      accounts.mintAuthority
    );

    // Create token account for malicious user
    maliciousTokenAccount = await createAccount(
      provider.connection,
      maliciousUser,
      accounts.tokenMint,
      maliciousUser.publicKey
    );

    // Initialize the lottery program
    const { treasuryPDA } = testHelper.getTreasuryPDAs();
    const treasuryTokenAccount = await getAssociatedTokenAddress(
      accounts.tokenMint,
      treasuryPDA,
      true
    );

    await program.methods
      .initialize(accounts.treasuryAuthority.publicKey, feePercentage)
      .accounts({
        authority: accounts.gameAuthority.publicKey,
        treasuryState: treasuryPDA,
        treasuryTokenAccount,
        tokenMint: accounts.tokenMint,
      })
      .signers([accounts.gameAuthority])
      .rpc();
  });

  describe("Authority Checks", () => {
    let pdas: GamePDAs;

    before(async () => {
      pdas = testHelper.getGamePDAs(gameId);
      const { treasuryPDA } = testHelper.getTreasuryPDAs();

      // Create a game
      await program.methods
        .createGame(gameId, entryFee, maxPlayers, winnerCount, paymentDeadlineMinutes)
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
    });

    it("Prevents unauthorized game completion", async () => {
      const { treasuryPDA } = testHelper.getTreasuryPDAs();
      const treasuryTokenAccount = await getAssociatedTokenAddress(
        accounts.tokenMint,
        treasuryPDA,
        true
      );

      try {
        await program.methods
          .completeGame(gameId)
          .accounts({
            authority: maliciousUser.publicKey, // Wrong authority
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
            treasuryState: treasuryPDA,
            escrowAccount: pdas.escrowPDA,
            treasuryTokenAccount,
          })
          .signers([maliciousUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });

    it("Prevents unauthorized game cancellation", async () => {
      try {
        await program.methods
          .cancelGame(gameId, "Malicious cancellation")
          .accounts({
            authority: maliciousUser.publicKey, // Wrong authority
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
          })
          .signers([maliciousUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });

    it("Prevents unauthorized VRF submission", async () => {
      const vrfPDA = testHelper.getVrfPDA(gameId, 1);
      const randomValue = new Uint8Array(32);
      const proof = new Uint8Array(64);

      try {
        await program.methods
          .submitVrf(gameId, 1, Array.from(randomValue), Array.from(proof))
          .accounts({
            vrfOracle: maliciousUser.publicKey, // Wrong oracle
            gameState: pdas.gamePDA,
            vrfResult: vrfPDA,
          })
          .signers([maliciousUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });

    it("Prevents unauthorized treasury withdrawal", async () => {
      const { treasuryPDA } = testHelper.getTreasuryPDAs();
      const treasuryTokenAccount = await getAssociatedTokenAddress(
        accounts.tokenMint,
        treasuryPDA,
        true
      );

      try {
        await program.methods
          .withdrawTreasury(null)
          .accounts({
            authority: maliciousUser.publicKey, // Wrong authority
            treasuryState: treasuryPDA,
            treasuryTokenAccount,
            destinationTokenAccount: maliciousTokenAccount,
          })
          .signers([maliciousUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });
  });

  describe("Double Spending Prevention", () => {
    const gameId2 = "security-test-002";
    let pdas: GamePDAs;

    before(async () => {
      pdas = testHelper.getGamePDAs(gameId2);
      
      // Create and fully setup a game
      await testHelper.createCompleteGame(
        gameId2,
        accounts,
        playerTokenAccounts,
        {
          entryFee,
          maxPlayers: 2,
          winnerCount: 1,
          paymentDeadlineMinutes,
        }
      );

      // Process game to completion
      await testHelper.processVrfElimination(gameId2, 1, 2, accounts, pdas);
      
      const { treasuryPDA } = testHelper.getTreasuryPDAs();
      const treasuryTokenAccount = await getAssociatedTokenAddress(
        accounts.tokenMint,
        treasuryPDA,
        true
      );

      await program.methods
        .completeGame(gameId2)
        .accounts({
          authority: accounts.gameAuthority.publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          treasuryState: treasuryPDA,
          escrowAccount: pdas.escrowPDA,
          treasuryTokenAccount,
        })
        .signers([accounts.gameAuthority])
        .rpc();
    });

    it("Prevents double prize claiming", async () => {
      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      const winner = playerList.players.find(p => p.isWinner);
      const winnerIndex = playerList.players.findIndex(p => 
        p.wallet.toBase58() === winner.wallet.toBase58()
      );
      const winnerKeypair = accounts.players[winnerIndex];
      const winnerTokenAccount = playerTokenAccounts[winnerIndex];

      // First claim should succeed
      await program.methods
        .claimPrize(gameId2)
        .accounts({
          winner: winner.wallet,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          escrowAccount: pdas.escrowPDA,
          winnerTokenAccount,
        })
        .signers([winnerKeypair])
        .rpc();

      // Second claim should fail
      try {
        await program.methods
          .claimPrize(gameId2)
          .accounts({
            winner: winner.wallet,
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
            escrowAccount: pdas.escrowPDA,
            winnerTokenAccount,
          })
          .signers([winnerKeypair])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "PrizeAlreadyClaimed");
      }
    });

    it("Prevents non-winner from claiming prize", async () => {
      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      const loser = playerList.players.find(p => !p.isWinner);
      const loserIndex = playerList.players.findIndex(p => 
        p.wallet.toBase58() === loser.wallet.toBase58()
      );
      const loserKeypair = accounts.players[loserIndex];
      const loserTokenAccount = playerTokenAccounts[loserIndex];

      try {
        await program.methods
          .claimPrize(gameId2)
          .accounts({
            winner: loser.wallet,
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
            escrowAccount: pdas.escrowPDA,
            winnerTokenAccount: loserTokenAccount,
          })
          .signers([loserKeypair])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "NotAWinner");
      }
    });
  });

  describe("PDA and Account Validation", () => {
    const gameId3 = "security-test-003";
    let pdas: GamePDAs;
    let fakePdas: GamePDAs;

    before(async () => {
      pdas = testHelper.getGamePDAs(gameId3);
      fakePdas = testHelper.getGamePDAs("fake-game");
      
      const { treasuryPDA } = testHelper.getTreasuryPDAs();

      // Create a real game
      await program.methods
        .createGame(gameId3, entryFee, maxPlayers, winnerCount, paymentDeadlineMinutes)
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
    });

    it("Prevents using wrong escrow account", async () => {
      try {
        await program.methods
          .joinGame(gameId3, "player1_telegram")
          .accounts({
            player: accounts.players[0].publicKey,
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
            playerTokenAccount: playerTokenAccounts[0],
            escrowAccount: fakePdas.escrowPDA, // Wrong escrow
          })
          .signers([accounts.players[0]])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "EscrowAccountMismatch");
      }
    });

    it("Prevents tampering with game state", async () => {
      // Join with correct accounts
      await program.methods
        .joinGame(gameId3, "player1_telegram")
        .accounts({
          player: accounts.players[0].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          playerTokenAccount: playerTokenAccounts[0],
          escrowAccount: pdas.escrowPDA,
        })
        .signers([accounts.players[0]])
        .rpc();

      // Try to select number with wrong game state
      try {
        await program.methods
          .selectNumber("fake-game", 1) // Wrong game ID
          .accounts({
            player: accounts.players[0].publicKey,
            gameState: fakePdas.gamePDA, // This PDA won't exist
            playerList: fakePdas.playerListPDA,
          })
          .signers([accounts.players[0]])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        // Should fail because account doesn't exist
        assert.ok(err);
      }
    });
  });

  describe("Input Validation", () => {
    it("Prevents creating game with invalid parameters", async () => {
      const badGameId = "x".repeat(20); // Too long
      const pdas = testHelper.getGamePDAs(badGameId);
      const { treasuryPDA } = testHelper.getTreasuryPDAs();

      try {
        await program.methods
          .createGame(badGameId, entryFee, maxPlayers, winnerCount, paymentDeadlineMinutes)
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
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "GameIdTooLong");
      }
    });

    it("Prevents selecting invalid numbers", async () => {
      const gameState = await program.account.gameState.fetch(
        testHelper.getGamePDAs(gameId).gamePDA
      );
      const invalidNumber = gameState.numberRange.max + 1;

      try {
        await program.methods
          .selectNumber(gameId, invalidNumber)
          .accounts({
            player: accounts.players[1].publicKey,
            gameState: testHelper.getGamePDAs(gameId).gamePDA,
            playerList: testHelper.getGamePDAs(gameId).playerListPDA,
          })
          .signers([accounts.players[1]])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "NumberOutOfRange");
      }
    });
  });
});