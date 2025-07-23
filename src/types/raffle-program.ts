import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export interface RaffleAccount {
  authority: PublicKey;
  winner: PublicKey | null;
  participants: PublicKey[];
  numbers: Map<number, PublicKey>;
  drawnNumbers: number[];
  ticketPrice: BN;
  totalPrize: BN;
  state: RaffleState;
  maxParticipants: number;
  maxNumber: number;
  createdAt: BN;
  endedAt: BN | null;
}

export enum RaffleState {
  Active = 0,
  Drawing = 1,
  Completed = 2,
  Cancelled = 3,
}

export interface InitializeRaffleParams {
  ticketPrice: BN;
  maxParticipants: number;
  maxNumber: number;
}

export interface JoinRaffleParams {
  selectedNumber: number;
}

export interface DrawNumberParams {
  randomValue: number;
}

export interface RaffleProgram {
  initialize(params: InitializeRaffleParams): Promise<string>;
  joinRaffle(raffleId: string, params: JoinRaffleParams): Promise<string>;
  drawNumber(raffleId: string, params: DrawNumberParams): Promise<string>;
  claimPrize(raffleId: string): Promise<string>;
  cancelRaffle(raffleId: string): Promise<string>;
  getRaffle(raffleId: string): Promise<RaffleAccount | null>;
}

// Version 4 of the raffle program interface
export interface RaffleV4 extends RaffleProgram {
  version: 4;
  features: string[];
  supportedTokens: PublicKey[];
}