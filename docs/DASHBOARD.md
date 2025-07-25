# Lottery Bot Dashboard

## Overview

The Lottery Bot Dashboard provides real-time monitoring of all lottery games, including special events. It displays active games, player statistics, prize pools, and game states across all chats.

## Features

- **Real-time Updates**: WebSocket connection for live game updates
- **Game Monitoring**: View all active games across different chats
- **Special Events**: Highlighted display for special event lotteries
- **Player Tracking**: See all players in each game
- **Statistics**: Total active games, players, prize pools
- **Game States**: Monitor WAITING, DRAWING, FINISHED, and PAUSED games
- **Authentication**: Token-based access control

## Setup

### 1. Configure Environment Variables

Add these to your `.env` file:

```env
DASHBOARD_PORT=3000
DASHBOARD_AUTH_TOKEN=your_secure_token_here
```

### 2. Start the Bot

The dashboard starts automatically when you run the bot:

```bash
npm run dev
```

### 3. Access the Dashboard

Open your browser and navigate to:

```
http://localhost:3000
```

You'll be prompted for the auth token on first access.

## Dashboard Interface

### Header
- Connection status indicator
- Refresh button for manual updates

### Statistics Overview
- **Active Games**: Total number of ongoing games
- **Total Players**: Combined player count across all games
- **Prize Pool**: Total prizes across all active games
- **Special Events**: Number of special event games

### Game States Distribution
Shows count of games in each state:
- WAITING: Games accepting players
- DRAWING: Games in progress
- FINISHED: Completed games
- PAUSED: Temporarily halted games

### Active Games List
For each chat with active games:
- Chat ID
- Game details:
  - Game ID and type (regular/special event)
  - Current state with color coding
  - Prize amount
  - Player count (current/max)
  - Winner count
  - Eliminated/Active players
  - Creation time
  - Expandable player list

## API Endpoints

The dashboard exposes these REST API endpoints:

### GET /api/games
Returns all game data including statistics.

**Headers:**
```
Authorization: Bearer YOUR_AUTH_TOKEN
```

**Response:**
```json
{
  "games": {
    "chatId": [{
      "gameId": "ABC123",
      "state": "WAITING",
      "players": { "count": 5, "max": 50 },
      ...
    }]
  },
  "stats": {
    "totalActiveGames": 3,
    "totalPlayers": 45,
    ...
  }
}
```

### GET /api/games/:chatId
Returns games for a specific chat.

### GET /api/stats
Returns only statistics without game details.

### GET /health
Health check endpoint.

## WebSocket Events

### Client → Server
- `connection`: Establishes WebSocket connection

### Server → Client
- `gameUpdate`: Sent whenever game state changes
- `connect`: Connection established
- `disconnect`: Connection lost

## Security

1. **Authentication Token**: Required for all API access
2. **CORS**: Configured for security
3. **No Sensitive Data**: Dashboard doesn't expose private player data

## Customization

### Styling
The dashboard uses Tailwind CSS for styling. Custom styles are in `/dashboard/public/style.css`.

### Real-time Updates
Update frequency is controlled by the bot's game save operations. Each game state change triggers a dashboard update.

## Troubleshooting

### Dashboard Not Loading
1. Check if bot is running
2. Verify dashboard port is not in use
3. Check console for errors

### Authentication Failed
1. Verify auth token in `.env` matches browser token
2. Clear browser localStorage and re-enter token

### No Real-time Updates
1. Check WebSocket connection in browser console
2. Verify bot is saving game states
3. Check for network/firewall issues

## Development

### Adding New Features

1. **Backend**: Update `formatGameDataForDashboard` in `dashboard/server.ts`
2. **Frontend**: Modify `dashboard/views/dashboard.html`
3. **API**: Add new endpoints in `setupRoutes()` method

### Testing
Access the dashboard while running test games to verify:
- Game creation appears immediately
- Player joins update in real-time
- State changes reflect correctly
- Special events show distinct styling

## Performance

The dashboard is designed to handle:
- Up to 100 concurrent games
- 1000+ total players
- Updates every 1-2 seconds
- Minimal server resource usage

## Future Enhancements

- [ ] Historical game data
- [ ] Player statistics and rankings
- [ ] Export game data to CSV/JSON
- [ ] Mobile responsive improvements
- [ ] Dark/light theme toggle
- [ ] Game management controls
- [ ] Alerts for specific events
- [ ] Multi-language support