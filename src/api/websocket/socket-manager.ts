import { Server as SocketIOServer, Socket } from 'socket.io';
import { Connection, PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { logger } from '../../utils/logger';
import { AuthenticatedUser } from '../middleware/auth.middleware';

interface SocketData {
  userId?: string;
  walletAddress?: string;
  isAdmin?: boolean;
  joinedRooms: Set<string>;
  lastActivity: Date;
}

interface AuthenticatedSocket extends Socket {
  data: SocketData;
  user?: AuthenticatedUser;
}

interface RaffleUpdate {
  raffleId: string;
  type: 'created' | 'ticket_purchased' | 'drawing_started' | 'winner_selected' | 'prize_distributed' | 'cancelled';
  data: any;
  timestamp: string;
}

interface SystemNotification {
  type: 'maintenance' | 'alert' | 'announcement';
  message: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: string;
}

export class SocketManager {
  private io: SocketIOServer;
  private db: Pool;
  private solanaConnection: Connection;
  private authenticatedSockets: Map<string, AuthenticatedSocket> = new Map();
  private roomSubscriptions: Map<string, Set<string>> = new Map(); // roomId -> Set of socketIds
  private raffleSubscriptions: Map<string, Set<string>> = new Map(); // raffleId -> Set of socketIds

  constructor(io: SocketIOServer, db: Pool, solanaConnection: Connection) {
    this.io = io;
    this.db = db;
    this.solanaConnection = solanaConnection;
    this.setupSocketHandlers();
    this.setupBlockchainListeners();
    this.startHeartbeat();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      // Initialize socket data
      socket.data = {
        joinedRooms: new Set(),
        lastActivity: new Date(),
      };

      logger.info('WebSocket client connected', { 
        socketId: socket.id,
        ip: socket.handshake.address,
      });

      // Authentication handler
      socket.on('auth', async (data: { token: string }) => {
        await this.authenticateSocket(socket, data.token);
      });

      // Room management handlers
      socket.on('join:raffle', (data: { raffleId: string }) => {
        this.joinRaffleRoom(socket, data.raffleId);
      });

      socket.on('leave:raffle', (data: { raffleId: string }) => {
        this.leaveRaffleRoom(socket, data.raffleId);
      });

      socket.on('join:user', () => {
        this.joinUserRoom(socket);
      });

      socket.on('join:admin', () => {
        this.joinAdminRoom(socket);
      });

      // Heartbeat handler
      socket.on('ping', () => {
        socket.data.lastActivity = new Date();
        socket.emit('pong', { timestamp: new Date().toISOString() });
      });

      // Raffle interaction handlers
      socket.on('raffle:subscribe', (data: { raffleId: string }) => {
        this.subscribeToRaffle(socket, data.raffleId);
      });

      socket.on('raffle:unsubscribe', (data: { raffleId: string }) => {
        this.unsubscribeFromRaffle(socket, data.raffleId);
      });

      // Disconnect handler
      socket.on('disconnect', (reason) => {
        this.handleDisconnect(socket, reason);
      });

      // Error handler
      socket.on('error', (error) => {
        logger.error('WebSocket error', {
          socketId: socket.id,
          userId: socket.data.userId,
          error: error.message,
        });
      });
    });
  }

  private async authenticateSocket(socket: AuthenticatedSocket, token: string): Promise<void> {
    try {
      if (!token) {
        socket.emit('auth:error', { message: 'Token required' });
        return;
      }

      // Verify JWT token
      const jwtSecret = process.env.JWT_SECRET!;
      const decoded = jwt.verify(token, jwtSecret) as any;

      // Fetch user from database
      const userQuery = `
        SELECT id, wallet_address, username, is_admin, created_at, last_active
        FROM users 
        WHERE id = $1 AND wallet_address = $2
      `;

      const userResult = await this.db.query(userQuery, [decoded.userId, decoded.walletAddress]);

      if (userResult.rows.length === 0) {
        socket.emit('auth:error', { message: 'User not found' });
        return;
      }

      const user = userResult.rows[0];

      // Update socket data
      socket.data.userId = user.id;
      socket.data.walletAddress = user.wallet_address;
      socket.data.isAdmin = user.is_admin;
      socket.user = {
        id: user.id,
        walletAddress: user.wallet_address,
        username: user.username,
        isAdmin: user.is_admin,
        createdAt: user.created_at,
        lastActive: user.last_active,
      } as AuthenticatedUser;

      // Store authenticated socket
      this.authenticatedSockets.set(socket.id, socket);

      // Join user-specific room
      socket.join(`user:${user.id}`);
      socket.data.joinedRooms.add(`user:${user.id}`);

      // Update last active
      await this.db.query(
        'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      socket.emit('auth:success', {
        userId: user.id,
        walletAddress: user.wallet_address,
        isAdmin: user.is_admin,
      });

      logger.info('Socket authenticated', {
        socketId: socket.id,
        userId: user.id,
        walletAddress: user.wallet_address,
      });
    } catch (error) {
      logger.error('Socket authentication error', {
        socketId: socket.id,
        error: error.message,
      });
      socket.emit('auth:error', { message: 'Authentication failed' });
    }
  }

  private joinRaffleRoom(socket: AuthenticatedSocket, raffleId: string): void {
    if (!this.isSocketAuthenticated(socket)) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const roomId = `raffle:${raffleId}`;
    socket.join(roomId);
    socket.data.joinedRooms.add(roomId);

    // Track room subscription
    if (!this.roomSubscriptions.has(roomId)) {
      this.roomSubscriptions.set(roomId, new Set());
    }
    this.roomSubscriptions.get(roomId)!.add(socket.id);

    socket.emit('raffle:joined', { raffleId });
    
    logger.debug('Socket joined raffle room', {
      socketId: socket.id,
      userId: socket.data.userId,
      raffleId,
    });
  }

  private leaveRaffleRoom(socket: AuthenticatedSocket, raffleId: string): void {
    const roomId = `raffle:${raffleId}`;
    socket.leave(roomId);
    socket.data.joinedRooms.delete(roomId);

    // Remove from room subscription
    const subscribers = this.roomSubscriptions.get(roomId);
    if (subscribers) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.roomSubscriptions.delete(roomId);
      }
    }

    socket.emit('raffle:left', { raffleId });
  }

  private joinUserRoom(socket: AuthenticatedSocket): void {
    if (!this.isSocketAuthenticated(socket)) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const roomId = `user:${socket.data.userId}`;
    socket.join(roomId);
    socket.data.joinedRooms.add(roomId);
    socket.emit('user:joined');
  }

  private joinAdminRoom(socket: AuthenticatedSocket): void {
    if (!this.isSocketAuthenticated(socket) || !socket.data.isAdmin) {
      socket.emit('error', { message: 'Admin access required' });
      return;
    }

    const roomId = 'admin';
    socket.join(roomId);
    socket.data.joinedRooms.add(roomId);
    socket.emit('admin:joined');
  }

  private subscribeToRaffle(socket: AuthenticatedSocket, raffleId: string): void {
    if (!this.isSocketAuthenticated(socket)) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    if (!this.raffleSubscriptions.has(raffleId)) {
      this.raffleSubscriptions.set(raffleId, new Set());
    }
    this.raffleSubscriptions.get(raffleId)!.add(socket.id);

    socket.emit('raffle:subscribed', { raffleId });
  }

  private unsubscribeFromRaffle(socket: AuthenticatedSocket, raffleId: string): void {
    const subscribers = this.raffleSubscriptions.get(raffleId);
    if (subscribers) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.raffleSubscriptions.delete(raffleId);
      }
    }

    socket.emit('raffle:unsubscribed', { raffleId });
  }

  private handleDisconnect(socket: AuthenticatedSocket, reason: string): void {
    logger.info('WebSocket client disconnected', {
      socketId: socket.id,
      userId: socket.data.userId,
      reason,
    });

    // Clean up subscriptions
    this.authenticatedSockets.delete(socket.id);

    // Remove from room subscriptions
    for (const [roomId, subscribers] of this.roomSubscriptions.entries()) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.roomSubscriptions.delete(roomId);
      }
    }

    // Remove from raffle subscriptions
    for (const [raffleId, subscribers] of this.raffleSubscriptions.entries()) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.raffleSubscriptions.delete(raffleId);
      }
    }
  }

  private isSocketAuthenticated(socket: AuthenticatedSocket): boolean {
    return !!(socket.data.userId && socket.data.walletAddress);
  }

  private setupBlockchainListeners(): void {
    // Monitor program account changes
    // This will be implemented based on the actual program structure
    logger.info('Blockchain listeners setup (placeholder)');
  }

  private startHeartbeat(): void {
    setInterval(() => {
      const now = new Date();
      const timeout = 5 * 60 * 1000; // 5 minutes

      for (const [socketId, socket] of this.authenticatedSockets.entries()) {
        const timeSinceActivity = now.getTime() - socket.data.lastActivity.getTime();
        
        if (timeSinceActivity > timeout) {
          logger.warn('Disconnecting inactive socket', {
            socketId,
            userId: socket.data.userId,
            lastActivity: socket.data.lastActivity,
          });
          socket.disconnect(true);
        }
      }
    }, 60 * 1000); // Check every minute
  }

  // Public methods for emitting events

  public emitRaffleUpdate(update: RaffleUpdate): void {
    const roomId = `raffle:${update.raffleId}`;
    this.io.to(roomId).emit('raffle:update', update);

    logger.debug('Raffle update emitted', {
      raffleId: update.raffleId,
      type: update.type,
      subscribers: this.roomSubscriptions.get(roomId)?.size || 0,
    });
  }

  public emitUserNotification(userId: string, notification: any): void {
    this.io.to(`user:${userId}`).emit('user:notification', notification);
  }

  public emitSystemNotification(notification: SystemNotification): void {
    this.io.emit('system:notification', notification);
  }

  public emitAdminAlert(alert: any): void {
    this.io.to('admin').emit('admin:alert', alert);
  }

  public getConnectedUsers(): number {
    return this.authenticatedSockets.size;
  }

  public getRoomSubscribers(roomId: string): number {
    return this.roomSubscriptions.get(roomId)?.size || 0;
  }

  public getRaffleSubscribers(raffleId: string): number {
    return this.raffleSubscriptions.get(raffleId)?.size || 0;
  }
}

// Export setup function
export function setupWebSocket(
  io: SocketIOServer,
  db: Pool,
  solanaConnection: Connection
): SocketManager {
  return new SocketManager(io, db, solanaConnection);
}