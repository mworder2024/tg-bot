import express from 'express';
import { Pool } from 'pg';
import { Server } from 'socket.io';

const router = express.Router();

// Get your existing database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Get active lotteries
router.get('/lottery/active', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, COUNT(t.id) as player_count 
      FROM games g
      LEFT JOIN tickets t ON g.id = t.game_id
      WHERE g.status = 'active'
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `);
    
    res.json({ lotteries: result.rows });
  } catch (error) {
    console.error('Error fetching active lotteries:', error);
    res.status(500).json({ error: 'Failed to fetch lotteries' });
  }
});

// Join lottery
router.post('/lottery/join', async (req, res) => {
  const { gameId, walletAddress, numbers } = req.body;
  
  try {
    // Check if game is active
    const gameCheck = await pool.query(
      'SELECT * FROM games WHERE id = $1 AND status = $2',
      [gameId, 'active']
    );
    
    if (gameCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Game not active' });
    }
    
    // Check if already joined
    const existingTicket = await pool.query(
      'SELECT * FROM tickets WHERE game_id = $1 AND wallet_address = $2',
      [gameId, walletAddress]
    );
    
    if (existingTicket.rows.length > 0) {
      return res.status(400).json({ error: 'Already joined this lottery' });
    }
    
    // Create ticket
    const ticket = await pool.query(
      'INSERT INTO tickets (game_id, wallet_address, numbers, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [gameId, walletAddress, numbers]
    );
    
    // Emit to Socket.io for real-time update
    const io = req.app.get('io');
    io.emit('lottery_update', { 
      type: 'player_joined', 
      gameId, 
      walletAddress,
      playerCount: gameCheck.rows[0].player_count + 1
    });
    
    res.json({ ticket: ticket.rows[0] });
  } catch (error) {
    console.error('Error joining lottery:', error);
    res.status(500).json({ error: 'Failed to join lottery' });
  }
});

// Get user's tickets
router.get('/lottery/tickets', async (req, res) => {
  const { wallet } = req.query;
  
  try {
    const result = await pool.query(`
      SELECT t.*, g.status as game_status, g.type as game_type
      FROM tickets t
      JOIN games g ON t.game_id = g.id
      WHERE t.wallet_address = $1
      ORDER BY t.created_at DESC
      LIMIT 20
    `, [wallet]);
    
    res.json({ tickets: result.rows });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Get lottery results
router.get('/lottery/results', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, 
        array_agg(DISTINCT w.wallet_address) as winners,
        array_agg(DISTINCT w.prize_amount) as prizes
      FROM games g
      LEFT JOIN winners w ON g.id = w.game_id
      WHERE g.status = 'completed'
      GROUP BY g.id
      ORDER BY g.completed_at DESC
      LIMIT 10
    `);
    
    res.json({ results: result.rows });
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

export default router;