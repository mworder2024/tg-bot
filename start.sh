#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Start the bot
echo "🚀 Starting Telegram Lottery Bot..."
echo "📋 Environment: $ENVIRONMENT"
echo "🤖 Bot Token: ${BOT_TOKEN:0:10}..."

npm start