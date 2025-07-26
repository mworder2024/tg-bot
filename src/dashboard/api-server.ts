import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { metricsCollector } from '../monitoring/prometheus-metrics';
import { logger } from '../utils/logger';
import { gameScheduler } from '../utils/game-scheduler';
import { eventScheduler } from '../utils/event-scheduler';
import { groupManager } from '../utils/group-manager';
import { leaderboard } from '../leaderboard';
import config from '../config';

export interface LotteryGame {
  gameId: string;
  chatId: string;
  chatName?: string;
  state: 'WAITING' | 'NUMBER_SELECTION' | 'DRAWING' | 'PAUSED' | 'FINISHED';
  players: Map<string, any>;
  maxPlayers: number;
  survivors: number;
  startTime: Date;
  endTime?: Date;
  isSpecialEvent: boolean;
  eventPrize?: number;
  eventName?: string;
  createdBy: string;
  winnerCount: number;
  currentPrize?: number;
}

export class DashboardAPI {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private port: number;
  private adminTokens = new Set<string>();
  
  // Store active games and their data
  private activeGames = new Map<string, LotteryGame>();
  private gameHistory: LotteryGame[] = [];
  private connectionStats = {
    totalConnections: 0,
    activeConnections: 0,
    lastUpdate: new Date()
  };

  constructor(port: number = 3001) {
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupAdminTokens();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public/dashboard'));
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`API ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
      });
      next();
    });

    // Admin authentication middleware
    this.app.use('/api/admin', (req, res, next) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token || !this.adminTokens.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });
  }

  private setupAdminTokens() {
    // Add admin token from validated config
    const adminToken = config.dashboard.adminToken;
    this.adminTokens.add(adminToken);
    logger.info(`Dashboard admin token set: ${adminToken.substring(0, 8)}...`);
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await metricsCollector.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        logger.error('Error serving metrics:', error);
        res.status(500).send('Error retrieving metrics');
      }
    });

    // Dashboard overview
    this.app.get('/api/overview', (req, res) => {
      res.json({
        activeGames: Array.from(this.activeGames.values()).map(game => ({
          ...game,
          players: Array.from(game.players.entries()).map(([id, player]) => ({
            id,
            username: player.username,
            eliminated: player.eliminated,
            number: player.number
          }))
        })),
        totalGames: this.gameHistory.length,
        totalPlayers: this.gameHistory.reduce((sum, game) => sum + game.players.size, 0),
        connectionStats: this.connectionStats,
        systemStats: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage()
        }
      });
    });

    // Games management
    this.app.get('/api/games', (req, res) => {
      const { status, chatId, limit = 50 } = req.query;
      let games = Array.from(this.activeGames.values());
      
      if (status) {
        games = games.filter(game => game.state === status);
      }
      if (chatId) {
        games = games.filter(game => game.chatId === chatId);
      }
      
      games = games.slice(0, Number(limit));
      
      res.json({
        games: games.map(game => ({
          ...game,
          playersCount: game.players.size,
          players: Array.from(game.players.entries()).map(([id, player]) => ({
            id,
            username: player.username,
            eliminated: player.eliminated,
            number: player.number
          }))
        })),
        total: games.length
      });
    });

    // Game details
    this.app.get('/api/games/:gameId', (req, res) => {
      const game = this.activeGames.get(req.params.gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      res.json({
        ...game,
        players: Array.from(game.players.entries()).map(([id, player]) => ({
          id,
          username: player.username,
          eliminated: player.eliminated,
          number: player.number,
          joinedAt: player.joinedAt
        }))
      });
    });

    // Admin endpoints
    
    // Create game
    this.app.post('/api/admin/games', async (req, res) => {
      try {
        const { chatId, maxPlayers, survivors, isSpecialEvent, eventPrize, eventName } = req.body;
        
        // Validate input
        if (!chatId) {
          return res.status(400).json({ error: 'Chat ID is required' });
        }

        // Check if group exists
        const isEnabled = await groupManager.isGroupEnabled(chatId);
        if (!isEnabled) {
          return res.status(400).json({ error: 'Group not configured or not found' });
        }

        // Create game config
        const gameConfig = {
          maxPlayers: maxPlayers || 50,
          survivors: survivors || 3,
          isSpecialEvent: isSpecialEvent || false,
          eventPrize: eventPrize || 0,
          eventName: eventName || '',
          createdBy: 'dashboard-admin',
          survivorsOverride: true
        };

        // This would need to be integrated with your bot's game creation system
        const gameId = `DASH-${Date.now()}`;
        
        res.json({
          success: true,
          gameId,
          message: 'Game creation initiated',
          config: gameConfig
        });

        // Emit to WebSocket clients
        this.io.emit('gameCreated', { gameId, chatId, config: gameConfig });
        
      } catch (error) {
        logger.error('Error creating game:', error);
        res.status(500).json({ error: 'Failed to create game' });
      }
    });

    // End game
    this.app.post('/api/admin/games/:gameId/end', (req, res) => {
      const game = this.activeGames.get(req.params.gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      try {
        // End the game
        game.state = 'FINISHED';
        game.endTime = new Date();
        
        // Move to history
        this.gameHistory.push(game);
        this.activeGames.delete(req.params.gameId);

        res.json({ success: true, message: 'Game ended successfully' });
        
        // Emit to WebSocket clients
        this.io.emit('gameEnded', { gameId: req.params.gameId });
        
      } catch (error) {
        logger.error('Error ending game:', error);
        res.status(500).json({ error: 'Failed to end game' });
      }
    });

    // Pause/Resume game
    this.app.post('/api/admin/games/:gameId/pause', (req, res) => {
      const game = this.activeGames.get(req.params.gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      try {
        if (game.state === 'PAUSED') {
          game.state = 'DRAWING'; // Resume
          res.json({ success: true, message: 'Game resumed' });
        } else {
          game.state = 'PAUSED';
          res.json({ success: true, message: 'Game paused' });
        }

        // Emit to WebSocket clients
        this.io.emit('gameStateChanged', { 
          gameId: req.params.gameId, 
          state: game.state 
        });
        
      } catch (error) {
        logger.error('Error pausing/resuming game:', error);
        res.status(500).json({ error: 'Failed to pause/resume game' });
      }
    });

    // Schedule management
    this.app.get('/api/admin/schedules', (req, res) => {
      try {
        const schedules = gameScheduler.getAllSchedules();
        
        // Get all scheduled events from the event scheduler
        const allEvents = eventScheduler.getAllEventsForAllChats();

        res.json({
          recurringSchedules: schedules,
          scheduledEvents: allEvents
        });
      } catch (error) {
        logger.error('Error getting schedules:', error);
        res.status(500).json({ error: 'Failed to get schedules' });
      }
    });

    // Create scheduled event
    this.app.post('/api/admin/schedules/events', (req, res) => {
      try {
        const { chatId, scheduledTime, eventName, eventPrize, maxPlayers, survivors } = req.body;
        
        const result = eventScheduler.scheduleEvent(
          chatId,
          new Date(scheduledTime),
          eventName,
          eventPrize,
          maxPlayers || 50,
          survivors || 3,
          5, // start minutes
          'dashboard-admin'
        );

        if ('error' in result) {
          return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, event: result });
        
        // Emit to WebSocket clients
        this.io.emit('eventScheduled', result);
        
      } catch (error) {
        logger.error('Error scheduling event:', error);
        res.status(500).json({ error: 'Failed to schedule event' });
      }
    });

    // Cancel scheduled event
    this.app.delete('/api/admin/schedules/events/:eventId', (req, res) => {
      try {
        const { eventId } = req.params;
        
        const success = eventScheduler.cancelEvent(eventId);
        
        if (success) {
          res.json({ success: true, message: 'Event cancelled successfully' });
          
          // Emit to WebSocket clients
          this.io.emit('eventCancelled', { eventId });
        } else {
          res.status(404).json({ error: 'Event not found or already executed' });
        }
        
      } catch (error) {
        logger.error('Error cancelling event:', error);
        res.status(500).json({ error: 'Failed to cancel event' });
      }
    });

    // Groups management
    this.app.get('/api/admin/groups', async (req, res) => {
      try {
        const groups = await groupManager.getGroups();
        res.json({ groups });
      } catch (error) {
        logger.error('Error getting groups:', error);
        res.status(500).json({ error: 'Failed to get groups' });
      }
    });

    // Analytics endpoints
    this.app.get('/api/analytics/games', (req, res) => {
      const { period = '24h', chatId } = req.query;
      
      try {
        // Calculate time range
        const now = new Date();
        const hours = period === '24h' ? 24 : period === '7d' ? 168 : period === '30d' ? 720 : 24;
        const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
        
        let games = this.gameHistory.filter(game => 
          game.endTime && game.endTime >= since
        );
        
        if (chatId) {
          games = games.filter(game => game.chatId === chatId);
        }

        const analytics = {
          totalGames: games.length,
          totalPlayers: games.reduce((sum, game) => sum + game.players.size, 0),
          totalPrizes: games.reduce((sum, game) => sum + (game.currentPrize || 0), 0),
          averagePlayersPerGame: games.length > 0 ? Math.round(games.reduce((sum, game) => sum + game.players.size, 0) / games.length) : 0,
          gamesByHour: this.getGamesByHour(games, hours),
          gamesByState: this.getGamesByState(games),
          topChats: this.getTopChats(games)
        };

        res.json(analytics);
      } catch (error) {
        logger.error('Error getting analytics:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
      }
    });

    // Leaderboard
    this.app.get('/api/leaderboard', (req, res) => {
      try {
        const { limit = 20, chatId } = req.query;
        const topPlayers = leaderboard.getLeaderboard(Number(limit));
        const totalGames = leaderboard.getTotalGames();
        
        res.json({
          players: topPlayers,
          totalGames,
          lastUpdated: new Date().toISOString()
        });
      } catch (error) {
        logger.error('Error getting leaderboard:', error);
        res.status(500).json({ error: 'Failed to get leaderboard' });
      }
    });

    // System logs endpoint
    this.app.get('/api/admin/logs', (req, res) => {
      const { level = 'info', limit = 100 } = req.query;
      
      // This would integrate with your logging system
      // For now, return mock data
      res.json({
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: 'Dashboard API started',
            service: 'dashboard'
          }
        ],
        total: 1
      });
    });
  }

  private setupWebSocket() {
    this.io.on('connection', (socket) => {
      this.connectionStats.activeConnections++;
      this.connectionStats.totalConnections++;
      this.connectionStats.lastUpdate = new Date();
      
      logger.info(`Dashboard client connected: ${socket.id}`);

      // Send initial data
      socket.emit('overview', {
        activeGames: Array.from(this.activeGames.values()),
        connectionStats: this.connectionStats
      });

      socket.on('disconnect', () => {
        this.connectionStats.activeConnections--;
        this.connectionStats.lastUpdate = new Date();
        logger.info(`Dashboard client disconnected: ${socket.id}`);
      });

      // Handle admin authentication for WebSocket
      socket.on('authenticate', (token) => {
        if (this.adminTokens.has(token)) {
          socket.join('admin');
          socket.emit('authenticated', true);
          logger.info('Dashboard admin authenticated successfully');
        } else {
          socket.emit('authenticated', false);
          logger.warn('Dashboard authentication failed - invalid token');
        }
      });

      // Handle real-time updates subscription
      socket.on('subscribe', (channels) => {
        if (Array.isArray(channels)) {
          channels.forEach(channel => {
            socket.join(channel);
          });
        }
      });
    });

    // Periodic updates
    setInterval(() => {
      this.io.emit('systemStats', {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        activeGames: this.activeGames.size,
        timestamp: new Date().toISOString()
      });
    }, 10000); // Every 10 seconds
  }

  // Utility methods for analytics
  private getGamesByHour(games: LotteryGame[], hours: number): number[] {
    const hourlyData = new Array(Math.min(hours, 24)).fill(0);
    const now = new Date();
    
    games.forEach(game => {
      if (game.endTime) {
        const hoursAgo = Math.floor((now.getTime() - game.endTime.getTime()) / (1000 * 60 * 60));
        if (hoursAgo >= 0 && hoursAgo < hourlyData.length) {
          hourlyData[hourlyData.length - 1 - hoursAgo]++;
        }
      }
    });
    
    return hourlyData;
  }

  private getGamesByState(games: LotteryGame[]): Record<string, number> {
    const stateCount: Record<string, number> = {};
    games.forEach(game => {
      stateCount[game.state] = (stateCount[game.state] || 0) + 1;
    });
    return stateCount;
  }

  private getTopChats(games: LotteryGame[]): Array<{chatId: string, count: number}> {
    const chatCount: Record<string, number> = {};
    games.forEach(game => {
      chatCount[game.chatId] = (chatCount[game.chatId] || 0) + 1;
    });
    
    return Object.entries(chatCount)
      .map(([chatId, count]) => ({ chatId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  // Public methods for integration with bot
  public updateGame(gameId: string, gameData: Partial<LotteryGame>) {
    const existingGame = this.activeGames.get(gameId);
    if (existingGame) {
      Object.assign(existingGame, gameData);
    } else {
      this.activeGames.set(gameId, gameData as LotteryGame);
    }
    
    // Emit update to connected clients
    this.io.emit('gameUpdated', { gameId, data: gameData });
  }

  public removeGame(gameId: string) {
    const game = this.activeGames.get(gameId);
    if (game) {
      this.gameHistory.push(game);
      this.activeGames.delete(gameId);
      this.io.emit('gameRemoved', { gameId });
    }
  }

  public addGame(gameData: LotteryGame) {
    this.activeGames.set(gameData.gameId, gameData);
    this.io.emit('gameAdded', gameData);
  }

  public broadcastMessage(event: string, data: any) {
    this.io.emit(event, data);
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        logger.info(`Dashboard API server running on port ${this.port}`);
        logger.info(`WebSocket server ready for real-time updates`);
        logger.info(`Metrics available at http://localhost:${this.port}/metrics`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('Dashboard API server stopped');
        resolve();
      });
    });
  }
}

export const dashboardAPI = new DashboardAPI(Number(process.env.DASHBOARD_PORT) || 3001);