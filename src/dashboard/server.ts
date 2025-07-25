import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { logger } from '../index';

export class DashboardServer {
  private app: express.Application;
  private server: http.Server;
  private io: Server;
  private port: number;
  private gameDataCallback: () => any;
  private authToken: string;

  constructor(port: number = 3000, authToken: string = '') {
    this.port = port;
    this.authToken = authToken || process.env.DASHBOARD_AUTH_TOKEN || 'admin123';
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // Basic auth middleware
    this.app.use('/api', (req, res, next) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token !== this.authToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });
  }

  private setupRoutes() {
    // Dashboard HTML
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
    });

    // API Routes
    this.app.get('/api/games', (req, res) => {
      if (this.gameDataCallback) {
        const data = this.gameDataCallback();
        res.json(data);
      } else {
        res.json({ games: {}, stats: {} });
      }
    });

    this.app.get('/api/games/:chatId', (req, res) => {
      if (this.gameDataCallback) {
        const data = this.gameDataCallback();
        const chatGames = data.games[req.params.chatId] || [];
        res.json({ games: chatGames });
      } else {
        res.json({ games: [] });
      }
    });

    this.app.get('/api/stats', (req, res) => {
      if (this.gameDataCallback) {
        const data = this.gameDataCallback();
        res.json(data.stats || {});
      } else {
        res.json({});
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date() });
    });
  }

  private setupWebSocket() {
    this.io.on('connection', (socket) => {
      logger.info('Dashboard client connected');

      // Send initial data
      if (this.gameDataCallback) {
        const data = this.gameDataCallback();
        socket.emit('gameUpdate', data);
      }

      socket.on('disconnect', () => {
        logger.info('Dashboard client disconnected');
      });
    });
  }

  public setGameDataCallback(callback: () => any) {
    this.gameDataCallback = callback;
  }

  public updateGames(data: any) {
    this.io.emit('gameUpdate', data);
  }

  public start() {
    this.server.listen(this.port, () => {
      logger.info(`🌐 Dashboard server running on http://localhost:${this.port}`);
      logger.info(`🔑 Auth token: ${this.authToken.substring(0, 4)}...`);
    });
  }

  public stop() {
    this.server.close();
  }
}

// Helper to format game data for dashboard
export function formatGameDataForDashboard(gameStates: Map<string, any>) {
  const formattedData: any = {
    games: {},
    stats: {
      totalActiveGames: 0,
      totalPlayers: 0,
      totalPrizePool: 0,
      gamesByType: {
        regular: 0,
        special: 0
      },
      gamesByState: {
        WAITING: 0,
        DRAWING: 0,
        FINISHED: 0,
        PAUSED: 0
      }
    }
  };

  // Process each chat
  for (const [chatId, chatGames] of gameStates.entries()) {
    if (chatGames instanceof Map) {
      formattedData.games[chatId] = [];
      
      for (const [gameId, game] of chatGames.entries()) {
        // Format game data
        const gameData = {
          gameId: game.gameId,
          chatId: chatId,
          state: game.state,
          isSpecialEvent: game.isSpecialEvent || false,
          eventName: game.eventName || null,
          eventPrize: game.eventPrize || 0,
          players: {
            count: game.players.size,
            max: game.maxPlayers,
            list: Array.from(game.players.values()).map((p: any) => ({
              id: p.id,
              username: p.username,
              joinedAt: p.joinedAt
            }))
          },
          prize: game.prizeInfo || {},
          winnerCount: game.winnerCount,
          createdAt: game.createdAt,
          startedAt: game.startedAt,
          endedAt: game.endedAt,
          scheduledStartTime: game.scheduledStartTime,
          eliminatedCount: game.eliminated ? game.eliminated.size : 0,
          activePlayers: game.activePlayers ? game.activePlayers.size : game.players.size
        };

        formattedData.games[chatId].push(gameData);

        // Update stats
        if (game.state !== 'FINISHED') {
          formattedData.stats.totalActiveGames++;
          formattedData.stats.totalPlayers += game.players.size;
          
          if (game.prizeInfo?.totalPrize) {
            formattedData.stats.totalPrizePool += game.prizeInfo.totalPrize;
          } else if (game.eventPrize) {
            formattedData.stats.totalPrizePool += game.eventPrize;
          }
        }

        // Count by type
        if (game.isSpecialEvent) {
          formattedData.stats.gamesByType.special++;
        } else {
          formattedData.stats.gamesByType.regular++;
        }

        // Count by state
        if (formattedData.stats.gamesByState[game.state] !== undefined) {
          formattedData.stats.gamesByState[game.state]++;
        }
      }
    }
  }

  return formattedData;
}