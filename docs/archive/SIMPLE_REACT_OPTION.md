# 🎨 Optional: Simple React Version (If you want it prettier)

If you want a nicer UI, here's a minimal React setup:

## Quick Setup (10 minutes)

```bash
# In your lottery_v3.3 directory
npx create-react-app web --template typescript
cd web
npm install socket.io-client @solana/web3.js axios
```

## Single Component App

Replace `web/src/App.tsx` with:

```tsx
import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:3000/api';
const socket = io('http://localhost:3000');

function App() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [lotteries, setLotteries] = useState<any[]>([]);
  const [myTickets, setMyTickets] = useState<any[]>([]);

  // Connect wallet
  const connectWallet = async () => {
    try {
      const resp = await (window as any).solana.connect();
      setWallet(resp.publicKey.toString());
    } catch (err) {
      alert('Please install Phantom wallet');
    }
  };

  // Load lotteries
  const loadLotteries = async () => {
    const { data } = await axios.get(`${API_URL}/lottery/active`);
    setLotteries(data.lotteries);
  };

  // Join lottery
  const joinLottery = async (gameId: string) => {
    const numbers = prompt('Enter 6 numbers (1-49) separated by commas:');
    if (!numbers) return;

    try {
      await axios.post(`${API_URL}/lottery/join`, {
        gameId,
        walletAddress: wallet,
        numbers: numbers.split(',').map(n => parseInt(n.trim()))
      });
      alert('Joined successfully!');
      loadLotteries();
    } catch (err) {
      alert('Error joining lottery');
    }
  };

  useEffect(() => {
    loadLotteries();
    
    // Socket listeners
    socket.on('lottery_update', loadLotteries);
    socket.on('draw_result', (data) => {
      alert(`🎉 Winners: ${data.winners.join(', ')}`);
      loadLotteries();
    });

    return () => {
      socket.off('lottery_update');
      socket.off('draw_result');
    };
  }, []);

  return (
    <div className="App">
      <header>
        <h1>🎲 Lottery Game</h1>
        {!wallet ? (
          <button onClick={connectWallet}>Connect Wallet</button>
        ) : (
          <p>Connected: {wallet.slice(0, 4)}...{wallet.slice(-4)}</p>
        )}
      </header>

      <main>
        <h2>Active Lotteries</h2>
        <div className="lottery-grid">
          {lotteries.map(lottery => (
            <div key={lottery.id} className="lottery-card">
              <h3>{lottery.type || 'Instant'} Lottery</h3>
              <p>Players: {lottery.player_count}</p>
              <p>Draw: {new Date(lottery.draw_time).toLocaleString()}</p>
              {wallet && lottery.status === 'active' && (
                <button onClick={() => joinLottery(lottery.id)}>
                  Join Lottery
                </button>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
```

## Simple Styling

`web/src/App.css`:
```css
.App {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 40px;
}

.lottery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.lottery-card {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

button {
  background: #512da8;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

button:hover {
  background: #311b92;
}
```

## Update package.json proxy

In `web/package.json`, add:
```json
"proxy": "http://localhost:3000"
```

## Run It
```bash
# Terminal 1: Your API
npm run dev:api

# Terminal 2: React app
cd web && npm start

# Opens at http://localhost:3001
```

## That's it! 
You now have a nice React UI that talks to your existing API. Total setup time: ~30 minutes.