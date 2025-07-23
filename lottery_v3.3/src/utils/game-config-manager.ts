import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

export interface GameConfig {
  speedMode: 'fast' | 'normal' | 'slow';
  suspenseEnabled: boolean;
  defaultMaxPlayers: number;
  defaultStartMinutes: number;
  defaultNumberMultiplier: number;
  minPlayersToStart: number;
  messageSettings: {
    showJoinBuffer: boolean;
    bufferWindowMs: number;
    showCountdowns: boolean;
    showSuspenseMessages: boolean;
  };
  speedSettings: {
    fast: SpeedProfile;
    normal: SpeedProfile;
    slow: SpeedProfile;
  };
}

export interface SpeedProfile {
  earlyGame: { delay: number; numbersPerDraw: number; threshold: number };
  midGame: { delay: number; numbersPerDraw: number; threshold: number };
  lateGame: { delay: number; numbersPerDraw: number; threshold: number };
  finalGame: { delay: number; numbersPerDraw: number; threshold: number };
  bubble: { delay: number; threshold: number };
}

/**
 * Manages game configuration settings
 */
export class GameConfigManager {
  private config: GameConfig;
  private configPath: string;

  constructor() {
    this.configPath = path.join(process.cwd(), 'data', 'game-config.json');
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file or create default
   */
  private loadConfig(): GameConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error('Failed to load game config:', error);
    }

    // Return default config
    return this.getDefaultConfig();
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): GameConfig {
    return {
      speedMode: 'normal',
      suspenseEnabled: true,
      defaultMaxPlayers: 50,
      defaultStartMinutes: 5,
      defaultNumberMultiplier: 2,
      minPlayersToStart: 2,
      messageSettings: {
        showJoinBuffer: true,
        bufferWindowMs: 3000,
        showCountdowns: true,
        showSuspenseMessages: true
      },
      speedSettings: {
        fast: {
          earlyGame: { delay: 3000, numbersPerDraw: 4, threshold: 20 },
          midGame: { delay: 4000, numbersPerDraw: 3, threshold: 10 },
          lateGame: { delay: 6000, numbersPerDraw: 1, threshold: 5 },
          finalGame: { delay: 10000, numbersPerDraw: 1, threshold: 3 },
          bubble: { delay: 15000, threshold: 1 }
        },
        normal: {
          earlyGame: { delay: 6000, numbersPerDraw: 3, threshold: 20 },
          midGame: { delay: 8000, numbersPerDraw: 2, threshold: 10 },
          lateGame: { delay: 12000, numbersPerDraw: 1, threshold: 5 },
          finalGame: { delay: 18000, numbersPerDraw: 1, threshold: 3 },
          bubble: { delay: 25000, threshold: 1 }
        },
        slow: {
          earlyGame: { delay: 10000, numbersPerDraw: 2, threshold: 20 },
          midGame: { delay: 15000, numbersPerDraw: 1, threshold: 10 },
          lateGame: { delay: 20000, numbersPerDraw: 1, threshold: 5 },
          finalGame: { delay: 25000, numbersPerDraw: 1, threshold: 3 },
          bubble: { delay: 35000, threshold: 1 }
        }
      }
    };
  }

  /**
   * Save configuration to file
   */
  private saveConfig(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      logger.info('Game config saved');
    } catch (error) {
      logger.error('Failed to save game config:', error);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): GameConfig {
    return { ...this.config };
  }

  /**
   * Set speed mode
   */
  setSpeedMode(mode: 'fast' | 'normal' | 'slow'): void {
    this.config.speedMode = mode;
    this.saveConfig();
    logger.info(`Speed mode set to: ${mode}`);
  }

  /**
   * Toggle suspense messages
   */
  toggleSuspense(): boolean {
    this.config.suspenseEnabled = !this.config.suspenseEnabled;
    this.saveConfig();
    logger.info(`Suspense messages: ${this.config.suspenseEnabled ? 'enabled' : 'disabled'}`);
    return this.config.suspenseEnabled;
  }

  /**
   * Toggle message settings
   */
  toggleMessageSetting(setting: 'showJoinBuffer' | 'showCountdowns'): boolean {
    this.config.messageSettings[setting] = !this.config.messageSettings[setting];
    this.saveConfig();
    return this.config.messageSettings[setting];
  }

  /**
   * Update default game settings
   */
  updateDefaults(settings: Partial<{
    maxPlayers: number;
    startMinutes: number;
    numberMultiplier: number;
    minPlayers: number;
  }>): void {
    if (settings.maxPlayers !== undefined) {
      this.config.defaultMaxPlayers = settings.maxPlayers;
    }
    if (settings.startMinutes !== undefined) {
      this.config.defaultStartMinutes = settings.startMinutes;
    }
    if (settings.numberMultiplier !== undefined) {
      this.config.defaultNumberMultiplier = settings.numberMultiplier;
    }
    if (settings.minPlayers !== undefined) {
      this.config.minPlayersToStart = settings.minPlayers;
    }
    this.saveConfig();
  }

  /**
   * Update message settings
   */
  updateMessageSettings(settings: Partial<GameConfig['messageSettings']>): void {
    this.config.messageSettings = {
      ...this.config.messageSettings,
      ...settings
    };
    this.saveConfig();
  }

  /**
   * Get speed configuration for current mode and player count
   */
  getSpeedConfig(remainingPlayers: number, targetSurvivors: number): {
    drawDelay: number;
    numbersPerDraw: number;
    showPlayerList: boolean;
    suspenseMessages: boolean;
  } {
    const profile = this.config.speedSettings[this.config.speedMode];
    const toEliminate = remainingPlayers - targetSurvivors;

    // Determine which phase we're in
    if (toEliminate <= profile.bubble.threshold) {
      return {
        drawDelay: profile.bubble.delay,
        numbersPerDraw: 1,
        showPlayerList: true,
        suspenseMessages: this.config.suspenseEnabled
      };
    } else if (toEliminate <= profile.finalGame.threshold) {
      return {
        drawDelay: profile.finalGame.delay,
        numbersPerDraw: profile.finalGame.numbersPerDraw,
        showPlayerList: true,
        suspenseMessages: this.config.suspenseEnabled && toEliminate <= 3
      };
    } else if (remainingPlayers < profile.lateGame.threshold) {
      return {
        drawDelay: profile.lateGame.delay,
        numbersPerDraw: profile.lateGame.numbersPerDraw,
        showPlayerList: true,
        suspenseMessages: false
      };
    } else if (remainingPlayers < profile.midGame.threshold) {
      return {
        drawDelay: profile.midGame.delay,
        numbersPerDraw: profile.midGame.numbersPerDraw,
        showPlayerList: false,
        suspenseMessages: false
      };
    } else {
      return {
        drawDelay: profile.earlyGame.delay,
        numbersPerDraw: profile.earlyGame.numbersPerDraw,
        showPlayerList: false,
        suspenseMessages: false
      };
    }
  }

  /**
   * Export configuration as string
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import configuration from string
   */
  importConfig(configString: string): boolean {
    try {
      const newConfig = JSON.parse(configString);
      // Validate structure
      if (newConfig.speedMode && newConfig.speedSettings) {
        this.config = newConfig;
        this.saveConfig();
        return true;
      }
    } catch (error) {
      logger.error('Failed to import config:', error);
    }
    return false;
  }
}

export const gameConfigManager = new GameConfigManager();