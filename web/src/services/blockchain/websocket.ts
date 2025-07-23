/**
 * WebSocket service for real-time blockchain events
 * Handles automatic reconnection and event distribution
 */

import { EventEmitter } from 'events';

export interface BlockchainWebSocketConfig {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export interface BlockchainWSMessage {
  type: 'game_created' | 'player_joined' | 'game_completed' | 'transaction_update' | 'blockchain_stats' | 'error';
  payload: any;
  timestamp: number;
}

export class BlockchainWebSocket extends EventEmitter {
  private config: BlockchainWebSocketConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private messageQueue: BlockchainWSMessage[] = [];

  constructor(config: BlockchainWebSocketConfig) {
    super();
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      ...config
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.cleanup();

    try {
      this.ws = new WebSocket(this.config.url);
      this.setupEventHandlers();
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.handleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    this.emit('disconnected');
  }

  /**
   * Send message to server
   */
  send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for sending when connected
      this.messageQueue.push({
        type: 'error',
        payload: message,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Subscribe to specific game events
   */
  subscribeToGame(gameId: string): void {
    this.send({
      action: 'subscribe',
      type: 'game',
      gameId
    });
  }

  /**
   * Unsubscribe from game events
   */
  unsubscribeFromGame(gameId: string): void {
    this.send({
      action: 'unsubscribe',
      type: 'game',
      gameId
    });
  }

  /**
   * Subscribe to transaction updates
   */
  subscribeToTransaction(signature: string): void {
    this.send({
      action: 'subscribe',
      type: 'transaction',
      signature
    });
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.emit('connected');

      // Start heartbeat
      this.startHeartbeat();

      // Send queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          this.send(message);
        }
      }

      // Send initial subscription requests
      this.send({
        action: 'subscribe',
        type: 'blockchain_stats'
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const message: BlockchainWSMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      this.isConnecting = false;
      this.stopHeartbeat();
      
      if (this.shouldReconnect) {
        this.handleReconnect();
      }
    };
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: BlockchainWSMessage): void {
    // Emit specific event based on message type
    this.emit(message.type, message.payload);

    // Also emit generic message event
    this.emit('message', message);

    // Handle specific message types
    switch (message.type) {
      case 'game_created':
        console.log('New game created:', message.payload.gameId);
        break;

      case 'player_joined':
        console.log('Player joined game:', message.payload.gameId, message.payload.player);
        break;

      case 'game_completed':
        console.log('Game completed:', message.payload.gameId);
        break;

      case 'transaction_update':
        console.log('Transaction update:', message.payload.signature, message.payload.status);
        break;

      case 'blockchain_stats':
        // Periodic blockchain statistics
        break;

      case 'error':
        console.error('Server error:', message.payload);
        break;
    }
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      console.error('Max reconnection attempts reached');
      this.emit('max_reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval! * Math.pow(1.5, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get connection state
   */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get current reconnect attempts
   */
  get currentReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}

// Singleton instance
let wsInstance: BlockchainWebSocket | null = null;

/**
 * Get or create WebSocket instance
 */
export function getBlockchainWebSocket(config?: BlockchainWebSocketConfig): BlockchainWebSocket {
  if (!wsInstance && config) {
    wsInstance = new BlockchainWebSocket(config);
  }
  
  if (!wsInstance) {
    throw new Error('BlockchainWebSocket not initialized');
  }
  
  return wsInstance;
}

/**
 * React hook for WebSocket connection
 */
import { useEffect, useState, useCallback } from 'react';

export function useBlockchainWebSocket(config?: BlockchainWebSocketConfig) {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const ws = getBlockchainWebSocket(config);

    // Setup event handlers
    const handleConnected = () => {
      setConnected(true);
      setReconnecting(false);
      setError(null);
    };

    const handleDisconnected = () => {
      setConnected(false);
    };

    const handleReconnecting = () => {
      setReconnecting(true);
    };

    const handleError = (err: Error) => {
      setError(err);
    };

    ws.on('connected', handleConnected);
    ws.on('disconnected', handleDisconnected);
    ws.on('reconnecting', handleReconnecting);
    ws.on('error', handleError);

    // Connect
    ws.connect();

    // Cleanup
    return () => {
      ws.off('connected', handleConnected);
      ws.off('disconnected', handleDisconnected);
      ws.off('reconnecting', handleReconnecting);
      ws.off('error', handleError);
    };
  }, []);

  const subscribe = useCallback((event: string, handler: (data: any) => void) => {
    const ws = getBlockchainWebSocket();
    ws.on(event, handler);
    
    return () => {
      ws.off(event, handler);
    };
  }, []);

  const subscribeToGame = useCallback((gameId: string) => {
    const ws = getBlockchainWebSocket();
    ws.subscribeToGame(gameId);
  }, []);

  const subscribeToTransaction = useCallback((signature: string) => {
    const ws = getBlockchainWebSocket();
    ws.subscribeToTransaction(signature);
  }, []);

  return {
    connected,
    reconnecting,
    error,
    subscribe,
    subscribeToGame,
    subscribeToTransaction
  };
}