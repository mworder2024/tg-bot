import { Context } from 'telegraf';

interface HelpTopic {
  title: string;
  description: string;
  usage: string[];
  examples: string[];
  notes?: string[];
  adminOnly?: boolean;
}

const helpTopics: Record<string, HelpTopic> = {
  schedule: {
    title: 'Schedule Recurring Lottery Games',
    description: 'Set up automatic recurring lottery games that run at specified intervals. Perfect for keeping your community engaged with regular gameplay.',
    usage: [
      '/schedule <interval> <survivors> [options]',
      '/schedule cancel - Cancel current schedule',
      '/schedule pause - Pause scheduled games',
      '/schedule resume - Resume scheduled games',
      '/schedule - View current schedule'
    ],
    examples: [
      '/schedule 12h 1 - Run lottery every 12 hours with 1 survivor',
      '/schedule 4h 3 --max 50 - Every 4 hours, 3 survivors, max 50 players',
      '/schedule 30m 1 --max 20 --start 10 - Every 30 min, 1 survivor, max 20 players, 10 min start delay',
      '/schedule 6h 2 --start 15 - Every 6 hours, 2 survivors, 15 minute warning',
      '/schedule 1h 1 --max 10 - Hourly quick games, 10 players max'
    ],
    notes: [
      'Interval format: Use "m" for minutes (30m), "h" for hours (4h)',
      'Minimum interval: 5 minutes',
      'Maximum interval: 24 hours',
      'Start delay: 1-30 minutes (time before game starts)',
      'Survivors must be less than half of max players',
      'Scheduled games run automatically even when no admins are online',
      'Only one schedule per chat allowed',
      'Uses standard prize pools (10K-50K tokens)',
      'For custom prizes, use /scheduleevent instead'
    ],
    adminOnly: true
  },
  
  scheduleevent: {
    title: 'Schedule One-Time Event Lottery',
    description: 'Schedule a special one-time lottery event with custom prize pools. Perfect for special occasions, promotions, or community celebrations.',
    usage: [
      '/scheduleevent <time> <prize> "<name>"',
      '/scheduleevent - Show help and examples',
      '/cancelevent <eventId> - Cancel scheduled event'
    ],
    examples: [
      '/scheduleevent 12h 100000 "Mega Weekend" - In 12 hours, 100K prize',
      '/scheduleevent 6h30m 50000 "Evening Special" - In 6.5 hours, 50K prize',
      '/scheduleevent 1d 200000 "Daily Grand Prize" - Tomorrow, 200K prize',
      '/scheduleevent 2d12h 150000 "Weekend Bonanza" - In 2.5 days, 150K prize',
      '/scheduleevent 20:00 75000 "Prime Time" - Today at 8 PM, 75K prize',
      '/scheduleevent 15:30 100000 "Afternoon Delight" - Today at 3:30 PM, 100K prize'
    ],
    notes: [
      'Time formats: 30m, 2h, 12h, 1d, 2d12h, or specific times like 15:30, 9:00am',
      'Minimum scheduling: 5 minutes in advance',
      'Maximum scheduling: 7 days in advance',
      'Prize range: 1,000 to 1,000,000 tokens',
      'Event names limited to 50 characters',
      'Options: --max <n>, --survivors <n>, --start <m>',
      'Use /scheduled to view all upcoming events',
      'Event IDs shown to admins for cancellation'
    ],
    adminOnly: true
  },
  
  create: {
    title: 'Create Lottery Games',
    description: 'Start a new lottery game with various options and configurations.',
    usage: [
      '/create - Create standard lottery',
      '/create --max <number> - Set max players',
      '/create --event <prize> "<name>" - Create special event',
      '/create --start <minutes> - Set start delay',
      '/create --survivors <number> - Set survivor count'
    ],
    examples: [
      '/create - Standard game with default settings',
      '/create --max 20 - Limit to 20 players',
      '/create --event 100000 "Mega Weekend Event" - Special event with 100k tokens',
      '/create --event 50000 "Friday Night Special" --max 30',
      '/create --start 10 --survivors 3 - 10 min start, 3 survivors',
      '/create --max 50 --survivors 5 - Large game with 5 winners'
    ],
    notes: [
      'Event prizes: 1,000 to 1,000,000 tokens',
      'Max players: 2-100 (default 50)',
      'Start delay: 1-30 minutes (default 5)',
      'Survivors auto-calculated based on player count if not specified',
      'Event names limited to 50 characters',
      'Only one active game per chat allowed'
    ]
  },
  
  join: {
    title: 'Join Lottery Games',
    description: 'Join an active lottery game to compete for prizes.',
    usage: [
      '/join - Join the current lottery',
      'Click "Join Game" button in game announcement'
    ],
    examples: [
      '/join - Join if registration is open',
      'Use inline button for easier access'
    ],
    notes: [
      'Can only join during WAITING phase',
      'One entry per player per game',
      'Cannot join after game starts',
      'Free to play - no entry fee'
    ]
  },
  
  scheduled: {
    title: 'View Scheduled Games',
    description: 'Check when the next automatic lottery will run.',
    usage: [
      '/scheduled - View schedule info'
    ],
    examples: [
      '/scheduled - See next game time and settings'
    ],
    notes: [
      'Shows time until next game',
      'Displays schedule configuration',
      'Available to all users',
      'Updates in real-time'
    ]
  },
  
  stats: {
    title: 'Player Statistics',
    description: 'View your lottery performance and achievements.',
    usage: [
      '/stats - View your stats',
      '/stats @username - View another player\'s stats'
    ],
    examples: [
      '/stats - See your wins and participation',
      '/stats @friend - Check friend\'s performance'
    ],
    notes: [
      'Tracks games played, won, and tokens earned',
      'Shows win rate percentage',
      'Includes achievement badges',
      'Stats persist across all games'
    ]
  },
  
  leaderboard: {
    title: 'Global Leaderboard',
    description: 'See top lottery players ranked by performance.',
    usage: [
      '/leaderboard - View top 10 players',
      '/lb - Shortcut command'
    ],
    examples: [
      '/leaderboard - See global rankings',
      '/lb - Quick leaderboard access'
    ],
    notes: [
      'Ranked by total wins',
      'Shows win rate for each player',
      'Updates after each game',
      'Global across all chats'
    ]
  },
  
  mynumber: {
    title: 'Check Your Number',
    description: 'View your assigned number in the current lottery.',
    usage: [
      '/mynumber - Show your lottery number'
    ],
    examples: [
      '/mynumber - See your number and status'
    ],
    notes: [
      'Only works during active games',
      'Shows elimination status',
      'Private message to avoid revealing strategy'
    ]
  },
  
  activegames: {
    title: 'Active Games Status',
    description: 'View all currently running lottery games.',
    usage: [
      '/activegames - List all active games'
    ],
    examples: [
      '/activegames - See games across all groups'
    ],
    notes: [
      'Shows game phase and player count',
      'Displays time until next draw',
      'Updates every few seconds',
      'Admin command'
    ],
    adminOnly: true
  },
  
  endgame: {
    title: 'Force End Game',
    description: 'Immediately end the current lottery game.',
    usage: [
      '/endgame - End active game',
      '/endgame confirm - Skip confirmation'
    ],
    examples: [
      '/endgame - End with confirmation prompt',
      '/endgame confirm - Instant termination'
    ],
    notes: [
      'Refunds all players',
      'No winners declared',
      'Use for stuck or problematic games',
      'Cannot be undone'
    ],
    adminOnly: true
  },
  
  forcestart: {
    title: 'Force Start Game',
    description: 'Skip waiting period and start game immediately.',
    usage: [
      '/forcestart - Start game now'
    ],
    examples: [
      '/forcestart - Begin with current players'
    ],
    notes: [
      'Requires at least 2 players',
      'Skips remaining wait time',
      'Useful for testing or quick games',
      'Cannot add players after force start'
    ],
    adminOnly: true
  }
};

export async function handleHelpCommand(ctx: Context, isAdmin: boolean): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(' ').slice(1);
  
  // Check for specific help topic
  if (args.length > 0) {
    const topicParam = args[0].replace('--', '').toLowerCase();
    const topic = helpTopics[topicParam];
    
    if (topic) {
      // Check admin permission
      if (topic.adminOnly && !isAdmin) {
        await ctx.reply('❌ This help topic is for admins only.');
        return;
      }
      
      let message = `📚 **${topic.title}**\n\n`;
      message += `${topic.description}\n\n`;
      
      message += `**📝 Usage:**\n`;
      topic.usage.forEach(usage => {
        message += `• \`${usage}\`\n`;
      });
      
      message += `\n**💡 Examples:**\n`;
      topic.examples.forEach(example => {
        message += `• \`${example}\`\n`;
      });
      
      if (topic.notes && topic.notes.length > 0) {
        message += `\n**📌 Important Notes:**\n`;
        topic.notes.forEach(note => {
          message += `• ${note}\n`;
        });
      }
      
      message += `\n➡️ Use \`/help\` to see all available topics`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }
  }
  
  // Show main help menu
  let message = '🎲 **SURVIVAL LOTTERY BOT**\n\n';
  
  message += '🎯 **HOW TO PLAY:**\n';
  message += '• Join or create a lottery game\n';
  message += '• Each player gets a unique number\n';
  message += '• Numbers are drawn randomly\n';
  message += '• If your number is drawn, you\'re eliminated!\n';
  message += '• Last survivor(s) win prizes!\n\n';
  
  message += '💰 **PRIZES:**\n';
  message += 'Winners split 10,000-50,000 tokens!\n';
  message += 'Special events can have custom prizes up to 1,000,000 tokens!\n\n';
  
  message += '📚 **DETAILED HELP TOPICS:**\n';
  message += '• `/help --create` - Creating games & events\n';
  message += '• `/help --join` - Joining games\n';
  message += '• `/help --stats` - Player statistics\n';
  message += '• `/help --leaderboard` - Rankings\n';
  message += '• `/help --scheduled` - Viewing schedules\n';
  message += '• `/help --mynumber` - Check your number\n';
  
  if (isAdmin) {
    message += '\n👑 **ADMIN HELP TOPICS:**\n';
    message += '• `/help --schedule` - Recurring game schedules\n';
    message += '• `/help --scheduleevent` - One-time event scheduling\n';
    message += '• `/help --activegames` - Monitor all games\n';
    message += '• `/help --endgame` - Force end games\n';
    message += '• `/help --forcestart` - Skip wait time\n';
  }
  
  message += '\n🎮 **QUICK START:**\n';
  message += 'Type `/start` to open the interactive menu\n';
  message += 'Type `/create` to start a new game\n';
  message += 'Type `/join` to join an active game\n\n';
  
  message += '💡 **TIP:** Add topic name after /help for detailed info!\n';
  message += 'Example: `/help --schedule` for scheduling help';
  
  await ctx.reply(message, { parse_mode: 'Markdown' });
}

// Answer the user's question about scheduling
export function getSchedulingInstructions(): string {
  return `
📅 **How to Schedule a Lottery for 12 Hours with 100,000 Tokens**

There are two ways to achieve this:

**Option 1: Create a Special Event (Recommended)**
\`\`\`
/create --event 100000 "12 Hour Special" --start 720
\`\`\`
This creates a special event that starts in 720 minutes (12 hours) with a 100,000 token prize.

**Option 2: Schedule Recurring Games**
\`\`\`
/schedule 12h 1
\`\`\`
This creates recurring games every 12 hours with 1 survivor. However, scheduled games use standard prize pools (10,000-50,000 tokens), not custom amounts.

**For a One-Time Event with Custom Prize:**
The best approach is Option 1 using the \`--start\` parameter with minutes:
- 12 hours = 720 minutes
- Maximum start delay is 30 minutes through /schedule
- For longer delays, consider setting a reminder and creating the event closer to the desired time

**Note:** The \`--start\` parameter in /create is limited to 30 minutes. For a true 12-hour delay, you would need to create the event closer to when you want it to run.
`;
}