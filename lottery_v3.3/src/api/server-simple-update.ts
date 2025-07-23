// Add these lines to your existing server.ts file:

// 1. Import the simple lottery routes
import simpleLotteryRoutes from './routes/simple-lottery';

// 2. After your other middleware setup, add:
app.use(express.static('public'));  // Serve the HTML file

// 3. Add the API routes
app.use('/api', simpleLotteryRoutes);

// 4. Make Socket.io accessible to routes
app.set('io', io);

// That's it! Your existing Socket.io setup will work automatically