// Simple standalone Express server for lottery web app
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection - using your existing database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/lottery'
});

// Simple routes - no GraphQL, no complexity
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get active lotteries
app.get('/api/lotteries', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        type, 
        status, 
        created_at,
        draw_time,
        entry_fee,
        prize_pool
      FROM games 
      WHERE status = 'active' OR status = 'open'
      ORDER BY created_at DESC
    `);
    
    // Get player counts
    for (let game of result.rows) {
      const countResult = await pool.query(
        'SELECT COUNT(*) FROM tickets WHERE game_id = $1',
        [game.id]
      );
      game.player_count = parseInt(countResult.rows[0].count);
    }
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.json([]); // Return empty array on error
  }
});

// Join lottery
app.post('/api/join', async (req, res) => {
  const { gameId, walletAddress, numbers } = req.body;
  
  try {
    // Check if already joined
    const existing = await pool.query(
      'SELECT id FROM tickets WHERE game_id = $1 AND wallet_address = $2',
      [gameId, walletAddress]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Already joined' });
    }
    
    // Create ticket
    await pool.query(
      'INSERT INTO tickets (game_id, wallet_address, numbers, created_at) VALUES ($1, $2, $3, NOW())',
      [gameId, walletAddress, numbers]
    );
    
    // Notify all clients
    io.emit('player_joined', { gameId, walletAddress });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error joining:', error);
    res.status(400).json({ error: 'Failed to join' });
  }
});

// Get my tickets
app.get('/api/my-tickets/:wallet', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.*,
        g.status as game_status,
        g.type as game_type,
        g.draw_time
      FROM tickets t
      JOIN games g ON t.game_id = g.id
      WHERE t.wallet_address = $1
      ORDER BY t.created_at DESC
      LIMIT 10
    `, [req.params.wallet]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.json([]);
  }
});

// Simple cron-like function for multi-lottery
async function checkAndCreateLotteries() {
  const now = new Date();
  const hour = now.getHours();
  
  // Daily lottery at 8 PM
  if (hour === 20) {
    const today = now.toISOString().split('T')[0];
    
    // Check if daily lottery exists
    const existing = await pool.query(
      `SELECT id FROM games WHERE type = 'daily' AND DATE(created_at) = $1`,
      [today]
    );
    
    if (existing.rows.length === 0) {
      // Create daily lottery
      const drawTime = new Date();
      drawTime.setHours(drawTime.getHours() + 24);
      
      await pool.query(
        `INSERT INTO games (type, status, draw_time, entry_fee, prize_pool) 
         VALUES ('daily', 'active', $1, 0.1, 0)`,
        [drawTime]
      );
      
      io.emit('lottery_created', { type: 'daily', drawTime });
      console.log('Created daily lottery');
    }
  }
  
  // Weekly lottery on Sundays at 9 PM
  if (now.getDay() === 0 && hour === 21) {
    const thisWeek = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;
    
    const existing = await pool.query(
      `SELECT id FROM games WHERE type = 'weekly' AND created_at > NOW() - INTERVAL '7 days'`
    );
    
    if (existing.rows.length === 0) {
      const drawTime = new Date();
      drawTime.setDate(drawTime.getDate() + 7);
      
      await pool.query(
        `INSERT INTO games (type, status, draw_time, entry_fee, prize_pool) 
         VALUES ('weekly', 'active', $1, 0.5, 0)`,
        [drawTime]
      );
      
      io.emit('lottery_created', { type: 'weekly', drawTime });
      console.log('Created weekly lottery');
    }
  }
}

// Check every hour
setInterval(checkAndCreateLotteries, 3600000);

// Socket connection
io.on('connection', (socket) => {
  console.log('Client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Simple lottery server running on port ${PORT}`);
  checkAndCreateLotteries(); // Check on startup
});