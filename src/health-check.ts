import express from 'express';

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.ENVIRONMENT || 'not set',
    bot_token_exists: !!process.env.BOT_TOKEN,
    bot_token_length: process.env.BOT_TOKEN?.length || 0,
    node_env: process.env.NODE_ENV || 'not set',
    timestamp: new Date().toISOString()
  });
});

app.get('/debug', (req, res) => {
  const envVars = Object.keys(process.env)
    .filter(key => !key.includes('TOKEN') && !key.includes('SECRET'))
    .sort();
  
  res.json({
    environment: process.env.ENVIRONMENT,
    has_bot_token: !!process.env.BOT_TOKEN,
    env_vars: envVars
  });
});

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

export default app;