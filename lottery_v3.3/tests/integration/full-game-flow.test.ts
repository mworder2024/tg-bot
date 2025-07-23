import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TelegramLottery } from "../../target/types/telegram_lottery";
import { assert } from "chai";
import { BN } from "bn.js";
import { TestHelper, TestAccounts, GamePDAs } from "../utils/test-helpers";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";

describe("Full Game Flow Integration Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TelegramLottery as Program<TelegramLottery>;
  const testHelper = new TestHelper(provider.connection, program);

  let accounts: TestAccounts;
  let playerTokenAccounts: PublicKey[];
  let treasuryTokenAccount: PublicKey;

  const gameId = "integration-test-001";
  const entryFee = new BN(1_000_000); // 1 MWOR
  const maxPlayers = 4;
  const winnerCount = 2;
  const paymentDeadlineMinutes = 60;
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

    // Get treasury PDAs
    const { treasuryPDA } = testHelper.getTreasuryPDAs();
    treasuryTokenAccount = await getAssociatedTokenAddress(
      accounts.tokenMint,
      treasuryPDA,
      true
    );

    // Initialize the lottery program
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

  describe("Complete Game Lifecycle", () => {
    let pdas: GamePDAs;

    it("Creates and runs a complete game", async () => {
      // Create and setup game
      pdas = await testHelper.createCompleteGame(
        gameId,
        accounts,
        playerTokenAccounts,
        {
          entryFee,
          maxPlayers,
          winnerCount,
          paymentDeadlineMinutes,
        }
      );

      // Verify all players joined and selected numbers
      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      assert.equal(playerList.players.length, maxPlayers);
      assert.equal(
        playerList.players.every(p => p.selectedNumber !== null),
        true
      );
    });

    it("Processes multiple elimination rounds", async () => {
      // Round 1: Eliminate player with number 2
      await testHelper.processVrfElimination(
        gameId,
        1,
        2,
        accounts,
        pdas
      );

      // Round 2: Eliminate player with number 4
      await testHelper.processVrfElimination(
        gameId,
        2,
        4,
        accounts,
        pdas
      );

      // Verify eliminations
      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      const eliminatedPlayers = playerList.players.filter(p => p.eliminatedRound !== null);
      assert.equal(eliminatedPlayers.length, 2);
      
      // Verify correct players were eliminated
      const player2 = playerList.players.find(p => p.selectedNumber === 2);
      const player4 = playerList.players.find(p => p.selectedNumber === 4);
      assert.equal(player2.eliminatedRound, 1);
      assert.equal(player4.eliminatedRound, 2);
    });

    it("Completes the game and distributes prizes", async () => {
      const { treasuryPDA } = testHelper.getTreasuryPDAs();
      
      // Get treasury balance before
      const treasuryBalanceBefore = await getAccount(
        provider.connection,
        treasuryTokenAccount
      );

      // Complete the game
      await program.methods
        .completeGame(gameId)
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

      // Verify game state
      const gameState = await program.account.gameState.fetch(pdas.gamePDA);
      assert.equal(gameState.state.distributing !== undefined, true);

      // Verify treasury received correct fee
      const treasuryBalanceAfter = await getAccount(
        provider.connection,
        treasuryTokenAccount
      );
      const expectedFee = entryFee.toNumber() * maxPlayers * feePercentage / 100;
      assert.equal(
        Number(treasuryBalanceAfter.amount - treasuryBalanceBefore.amount),
        expectedFee
      );

      // Verify winners
      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      const winners = playerList.players.filter(p => p.isWinner);
      assert.equal(winners.length, winnerCount);

      // Verify prize amounts
      const totalPrize = entryFee.toNumber() * maxPlayers;
      const distributableAmount = totalPrize - expectedFee;
      const prizePerWinner = distributableAmount / winnerCount;
      
      winners.forEach(winner => {
        assert.equal(winner.prizeAmount, prizePerWinner);
      });
    });

    it("Winners claim their prizes", async () => {
      const playerList = await program.account.playerList.fetch(pdas.playerListPDA);
      const winners = playerList.players.filter(p => p.isWinner);

      for (const winner of winners) {
        const winnerIndex = playerList.players.findIndex(p => 
          p.wallet.toBase58() === winner.wallet.toBase58()
        );
        const winnerKeypair = accounts.players[winnerIndex];
        const winnerTokenAccount = playerTokenAccounts[winnerIndex];

        const balanceBefore = await getAccount(
          provider.connection,
          winnerTokenAccount
        );

        // Claim prize
        await program.methods
          .claimPrize(gameId)
          .accounts({
            winner: winner.wallet,
            gameState: pdas.gamePDA,
            playerList: pdas.playerListPDA,
            escrowAccount: pdas.escrowPDA,
            winnerTokenAccount,
          })
          .signers([winnerKeypair])
          .rpc();

        // Verify prize received
        const balanceAfter = await getAccount(
          provider.connection,
          winnerTokenAccount
        );
        assert.equal(
          Number(balanceAfter.amount - balanceBefore.amount),
          winner.prizeAmount
        );
      }

      // Verify all prizes claimed
      const updatedPlayerList = await program.account.playerList.fetch(pdas.playerListPDA);
      const allClaimed = updatedPlayerList.players
        .filter(p => p.isWinner)
        .every(p => p.prizeClaimed);
      assert.equal(allClaimed, true);
    });

    it("Escrow account is empty after all prizes claimed", async () => {
      const escrowBalance = await getAccount(
        provider.connection,
        pdas.escrowPDA
      );
      assert.equal(escrowBalance.amount.toString(), "0");
    });
  });

  describe("Treasury Management", () => {
    it("Treasury authority can withdraw fees", async () => {
      const { treasuryPDA } = testHelper.getTreasuryPDAs();
      
      // Create destination account for treasury authority
      const destinationAccount = await createAccount(
        provider.connection,
        accounts.treasuryAuthority,
        accounts.tokenMint,
        accounts.treasuryAuthority.publicKey
      );

      const treasuryState = await program.account.treasuryState.fetch(treasuryPDA);
      const withdrawAmount = treasuryState.pendingWithdrawal;

      // Withdraw treasury funds
      await program.methods
        .withdrawTreasury(withdrawAmount)
        .accounts({
          authority: accounts.treasuryAuthority.publicKey,
          treasuryState: treasuryPDA,
          treasuryTokenAccount,
          destinationTokenAccount: destinationAccount,
        })
        .signers([accounts.treasuryAuthority])
        .rpc();

      // Verify withdrawal
      const destinationBalance = await getAccount(
        provider.connection,
        destinationAccount
      );
      assert.equal(destinationBalance.amount.toString(), withdrawAmount.toString());

      // Verify treasury state updated
      const updatedTreasuryState = await program.account.treasuryState.fetch(treasuryPDA);
      assert.equal(updatedTreasuryState.pendingWithdrawal.toNumber(), 0);
    });
  });
});