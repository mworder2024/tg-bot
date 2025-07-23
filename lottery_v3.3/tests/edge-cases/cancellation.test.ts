import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TelegramLottery } from "../../target/types/telegram_lottery";
import { assert } from "chai";
import { BN } from "bn.js";
import { TestHelper, TestAccounts } from "../utils/test-helpers";
import { getAccount } from "@solana/spl-token";

describe("Game Cancellation and Refunds", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TelegramLottery as Program<TelegramLottery>;
  const testHelper = new TestHelper(provider.connection, program);

  let accounts: TestAccounts;
  let playerTokenAccounts: PublicKey[];

  const entryFee = new BN(1_000_000); // 1 MWOR
  const maxPlayers = 3;
  const winnerCount = 1;
  const paymentDeadlineMinutes = 1; // Short deadline for testing
  const feePercentage = 10;

  before(async () => {
    // Setup test accounts
    accounts = await testHelper.setupTestAccounts(maxPlayers);
    
    // Setup player token accounts
    playerTokenAccounts = await testHelper.setupPlayerTokenAccounts(
      accounts.players,
      accounts.tokenMint,
      accounts.mintAuthority
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

  describe("Cancel due to payment deadline", () => {
    const gameId = "cancel-deadline-001";
    let pdas: GamePDAs;

    it("Creates game with short payment deadline", async () => {
      pdas = testHelper.getGamePDAs(gameId);
      const { treasuryPDA } = testHelper.getTreasuryPDAs();

      await program.methods
        .createGame(
          gameId,
          entryFee,
          maxPlayers,
          winnerCount,
          paymentDeadlineMinutes
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
    });

    it("One player joins before deadline", async () => {
      await program.methods
        .joinGame(gameId, "player1_telegram")
        .accounts({
          player: accounts.players[0].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          playerTokenAccount: playerTokenAccounts[0],
          escrowAccount: pdas.escrowPDA,
        })
        .signers([accounts.players[0]])
        .rpc();

      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      assert.equal(playerList.players.length, 1);
    });

    it("Waits for payment deadline to expire", async () => {
      // Wait for deadline to pass (1 minute + buffer)
      await new Promise(resolve => setTimeout(resolve, 65000));
    });

    it("Cancels game after deadline expires", async () => {
      await program.methods
        .cancelGame(gameId, "Payment deadline expired - insufficient players")
        .accounts({
          authority: accounts.gameAuthority.publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
        })
        .signers([accounts.gameAuthority])
        .rpc();

      const gameState = await program.account.gameState.fetch(pdas.gamePDA);
      assert.equal(gameState.state.cancelled !== undefined, true);
    });

    it("Player requests refund", async () => {
      const balanceBefore = await getAccount(
        provider.connection,
        playerTokenAccounts[0]
      );

      await program.methods
        .requestRefund(gameId)
        .accounts({
          player: accounts.players[0].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          escrowAccount: pdas.escrowPDA,
          playerTokenAccount: playerTokenAccounts[0],
        })
        .signers([accounts.players[0]])
        .rpc();

      // Verify refund received
      const balanceAfter = await getAccount(
        provider.connection,
        playerTokenAccounts[0]
      );
      assert.equal(
        Number(balanceAfter.amount - balanceBefore.amount),
        entryFee.toNumber()
      );

      // Verify refund marked as processed
      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      assert.equal(playerList.players[0].prizeClaimed, true); // Reused for refund tracking
    });
  });

  describe("Cancel during number selection timeout", () => {
    const gameId = "cancel-selection-001";
    let pdas: GamePDAs;

    before(async () => {
      pdas = testHelper.getGamePDAs(gameId);
      const { treasuryPDA } = testHelper.getTreasuryPDAs();

      // Create game with normal deadline
      await program.methods
        .createGame(
          gameId,
          entryFee,
          2, // Only 2 players for faster setup
          1,
          60 // Normal deadline
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

      // Both players join
      for (let i = 0; i < 2; i++) {
        await program.methods
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

      // Only player 1 selects number
      await program.methods
        .selectNumber(gameId, 1)
        .accounts({
          player: accounts.players[0].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
        })
        .signers([accounts.players[0]])
        .rpc();
    });

    it("Cannot cancel during active number selection", async () => {
      try {
        await program.methods
          .cancelGame(gameId, "Trying to cancel active game")
          .accounts({
            authority: accounts.gameAuthority.publicKey,
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
          })
          .signers([accounts.gameAuthority])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "CannotCancelActiveGame");
      }
    });

    // Note: In a real implementation, you would wait 24 hours for selection timeout
    // For testing, you might add a special test-only instruction to advance time
  });

  describe("Refund validation", () => {
    const gameId = "refund-validation-001";
    let pdas: GamePDAs;

    it("Cannot request refund for non-cancelled game", async () => {
      pdas = testHelper.getGamePDAs(gameId);
      const { treasuryPDA } = testHelper.getTreasuryPDAs();

      // Create and setup a normal game
      await program.methods
        .createGame(gameId, entryFee, 2, 1, 60)
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

      // Player joins
      await program.methods
        .joinGame(gameId, "player1_telegram")
        .accounts({
          player: accounts.players[0].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          playerTokenAccount: playerTokenAccounts[0],
          escrowAccount: pdas.escrowPDA,
        })
        .signers([accounts.players[0]])
        .rpc();

      // Try to request refund without cancellation
      try {
        await program.methods
          .requestRefund(gameId)
          .accounts({
            player: accounts.players[0].publicKey,
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
            escrowAccount: pdas.escrowPDA,
            playerTokenAccount: playerTokenAccounts[0],
          })
          .signers([accounts.players[0]])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "GameNotCancelled");
      }
    });

    it("Cannot request refund twice", async () => {
      // First cancel the game
      await new Promise(resolve => setTimeout(resolve, 65000)); // Wait for deadline
      
      await program.methods
        .cancelGame(gameId, "Deadline expired")
        .accounts({
          authority: accounts.gameAuthority.publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
        })
        .signers([accounts.gameAuthority])
        .rpc();

      // First refund succeeds
      await program.methods
        .requestRefund(gameId)
        .accounts({
          player: accounts.players[0].publicKey,
          gameState: pdas.gamePDA,
          playerList: pdas.playerListPDA,
          escrowAccount: pdas.escrowPDA,
          playerTokenAccount: playerTokenAccounts[0],
        })
        .signers([accounts.players[0]])
        .rpc();

      // Second refund should fail
      try {
        await program.methods
          .requestRefund(gameId)
          .accounts({
            player: accounts.players[0].publicKey,
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
            escrowAccount: pdas.escrowPDA,
            playerTokenAccount: playerTokenAccounts[0],
          })
          .signers([accounts.players[0]])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "RefundAlreadyProcessed");
      }
    });
  });
});