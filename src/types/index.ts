import { Context } from 'telegraf';
import { Update } from 'telegraf/types';

export interface VRFResult {
  value: string;
  proof: string;
  seed: string;
  timestamp: number;
}

export interface Player {
  id: string;
  username: string;
  selectedNumber?: number;
  isEliminated: boolean;
  joinedAt: Date;
}

export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
  numberRange: { min: number; max: number };
  winnerCount: number;
  selectionTimeout: number;
  joinTimeout: number;
}

export interface LotteryGame {
  id: string;
  players: Map<string, Player>;
  winners: Map<string, Player>;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  state: 'WAITING' | 'NUMBER_SELECTION' | 'DRAWING' | 'FINISHED';
  config: GameConfig;
  playerNumbers: Map<string, Set<number>>;
  activePlayers: Set<string>;
  drawHistory: DrawResult[];
}

export interface DrawResult {
  number: number;
  vrfProof: string;
  eliminatedPlayers: Player[];
  remainingPlayers: number;
  timestamp: Date;
}

export interface NumberRange {
  min: number;
  max: number;
}

export interface NumberSelectionOptions {
  pageSize?: number;
  maxSelections?: number;
}

export interface BotContext extends Context<Update> {
  gameManager?: any;
}

export interface Participant {
  userId: string;
  username: string;
  selectedNumber?: number;
}

export interface Lottery {
  id: string;
  creatorId: string;
  participants: Participant[];
  winnerCount: number;
  isActive: boolean;
  createdAt: Date;
  numberRange: { min: number; max: number };
}

export interface LotteryService {
  createLottery(creatorId: string, winnerCount: number): Lottery;
  joinLottery(lotteryId: string, participant: Participant): void;
  drawWinner(lotteryId: string): { winner: Participant; vrf: VRFResult } | null;
  getLottery(lotteryId: string): Lottery | undefined;
  getActiveLotteries(): Lottery[];
  getUserLotteries(userId: string): Lottery[];
}

export enum GameStatus {
  WAITING = 'WAITING',
  NUMBER_SELECTION = 'NUMBER_SELECTION',
  DRAWING = 'DRAWING',
  FINISHED = 'FINISHED'
}