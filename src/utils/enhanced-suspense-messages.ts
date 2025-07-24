/**
 * Enhanced suspense messages with more humor and targeted jabs
 */
import { escapeUsername } from './markdown-escape';
import { leaderboard } from '../leaderboard';

// Early game messages when many players remain
export const EARLY_GAME_MESSAGES = [
  "🎪 Welcome to the Hunger Games, Telegram edition!",
  "🍿 Grab your popcorn, the elimination show begins!",
  "😈 Time to separate the lucky from the... well, let's find out!",
  "🎯 So many targets, so little time!",
  "💀 The reaper sharpens his scythe...",
  "🎰 House always wins... except for a lucky few!",
  "🎭 Comedy hour starts now - watch them fall!",
  "🔥 The furnace is warming up...",
  "😂 Get ready to spam F in the chat!",
  "🎪 Step right up to see dreams crushed in real time!",
  "🎲 RNGesus taketh away...",
  "💸 Your lottery ticket is about to become toilet paper!",
  "🎯 Target-rich environment detected!",
  "😱 Buckle up, it's gonna be a bumpy ride!",
  "🎪 The circus is in town and YOU are the entertainment!"
];

// Mid-game messages as field narrows
export const MID_GAME_MESSAGES = [
  "🔥 Half the field gone... feeling lucky, punk?",
  "😰 Starting to sweat yet? You should be!",
  "🎯 The targets are getting bigger...",
  "💀 The pile of bodies grows...",
  "🎪 Intermission is over, back to the carnage!",
  "😈 Darwin's lottery continues...",
  "🎲 Lady Luck is getting pickier...",
  "💔 Broken dreams counter: Still counting!",
  "🎭 From comedy to tragedy in 3... 2... 1...",
  "🔮 I see dead people... and they're in this chat!",
  "😂 The group chat watching like: 👁️👄👁️",
  "🎰 Odds getting worse by the second!",
  "⚰️ Coffin salesmen loving this game!",
  "🎪 Main event starting - who's the clown now?",
  "💸 Money slipping through fingers like sand..."
];

// Enhanced bubble messages with more variety
export const ENHANCED_BUBBLE_MESSAGES = [
  "💭 So close to glory... so close to shame!",
  "😰 This is where boys become men, and men become losers!",
  "🎯 The bubble - where dreams go to die spectacularly!",
  "💸 Can you smell the money? Because you're about to lose it!",
  "😱 Clinched buttcheeks detected in the chat!",
  "🔥 The heat is on! Time to see who melts!",
  "💔 Heartbreak hotel has vacancies... who's checking in?",
  "🎲 The dice are loaded... against YOU!",
  "😅 Nervous laughter won't save you now!",
  "🏃 No running from fate when you're THIS close!",
  "💫 Shooting stars? More like falling stars!",
  "🎪 The greatest show on Earth: watching dreams die!",
  "😬 Dental bills incoming from all this teeth grinding!",
  "🎭 To bubble or not to bubble, that is the question!",
  "⚡ Zeus himself couldn't save you now!",
  "🌊 Tsunami of tears incoming in 3... 2... 1...",
  "🎰 The house is about to collect!",
  "🏆 So close you can taste it... tastes like defeat!",
  "😤 Hold that breath... you'll need it for crying!",
  "🎯 The bullseye on your back just got bigger!",
  "💀 Death row inmates have better odds!",
  "🔮 Crystal ball says: YOU'RE COOKED!",
  "🎪 Welcome to the bubble - population: YOU!",
  "😰 Sweating more than a sinner in church!",
  "🎢 The rollercoaster is about to drop!",
  "🍿 The audience is ready for your elimination!",
  "🎭 Shakespeare couldn't write a better tragedy!",
  "💣 The bomb is ticking... who's holding it?",
  "🎪 Ladies and gentlemen, prepare for heartbreak!",
  "😈 The devil's waiting with your participation trophy!"
];

// Elimination messages based on player count eliminated
export const ELIMINATION_ROASTS = {
  single: [
    "💀 {{player}} has been DESTROYED! Press F to pay respects!",
    "😂 {{player}} just got sent to the shadow realm!",
    "🎪 {{player}} has left the circus! 🤡",
    "⚰️ RIP {{player}} - They came, they saw, they lost!",
    "🔥 {{player}} just got COOKED! Well done!",
    "💸 {{player}}'s wallet remains heavy... with disappointment!",
    "🎯 HEADSHOT! {{player}} is down!",
    "😈 {{player}} has been sacrificed to RNGesus!",
    "🎭 Exit stage left: {{player}}! *sad trombone*",
    "💔 {{player}} fought bravely, died hilariously!",
    "🌊 {{player}} has been washed away!",
    "🎰 {{player}} crapped out! Better luck never!",
    "🚪 {{player}} has been shown the door! Don't let it hit you!",
    "📉 {{player}}'s hopes and dreams: LIQUIDATED!",
    "🎪 {{player}} wasn't the main character after all!"
  ],
  multiple: [
    "💀 MASSACRE! {{count}} souls have been claimed: {{players}}",
    "🔥 MULTI-KILL! {{players}} have been OBLITERATED!",
    "😂 {{count}} clowns eliminated from the circus: {{players}}",
    "⚰️ Mass grave required for: {{players}}",
    "🎯 COMBO! {{players}} got rekt in unison!",
    "💸 Poverty party! Welcome {{players}} to the broke club!",
    "🎪 {{count}} dreams crushed simultaneously! RIP {{players}}",
    "😈 Satan's shopping list: {{players}} ✓",
    "🌊 Tsunami of failure claims {{players}}!",
    "🎭 Group therapy session needed for: {{players}}"
  ]
};

// Special roasts for players with low win rates
export const LOW_WIN_RATE_ROASTS = [
  "💀 {{player}} eliminated! (Win rate: {{rate}}% - Shocking, I know! 🙄)",
  "😂 {{player}} maintains their perfect losing streak! ({{rate}}% win rate)",
  "🎪 {{player}} - Professional loser strikes again! ({{rate}}% success rate)",
  "📉 {{player}} keeping that win rate nice and low at {{rate}}%!",
  "🏆 {{player}} eliminated! Participation trophy merchant ({{rate}}% wins)",
  "💸 {{player}} - Donating to winners since forever! ({{rate}}% win rate)",
  "🎯 {{player}} hit their usual target: ELIMINATION! ({{rate}}% wins)",
  "😈 {{player}} stays true to form - LOSING! ({{rate}}% win rate)",
  "🔥 {{player}} - Consistency is key! Consistently losing! ({{rate}}%)",
  "🎭 {{player}} playing their favorite role: The Loser! ({{rate}}% wins)"
];

// Special messages for @memeworldorder
export const MEMEWORLDORDER_ROASTS = [
  "🚨🚨🚨 BREAKING: @memeworldorder HAS BEEN ELIMINATED! 🚨🚨🚨",
  "👑 THE KING HAS FALLEN! @memeworldorder is OUT! Point and laugh!",
  "😂😂😂 @memeworldorder BTFO! This is not a drill!",
  "🎪 BIGGEST CLOWN ALERT: @memeworldorder just got REKT!",
  "💀 @memeworldorder ELIMINATION PARTY! 🎉🎊🎈 Everyone celebrate!",
  "🔥 HOLY SHIT! @memeworldorder actually lost! Screenshot this!",
  "😈 Christmas came early! @memeworldorder is GONE!",
  "🏆 And the 'Overconfident Loser' award goes to... @memeworldorder!",
  "📸 CAUGHT IN 4K: @memeworldorder taking the L!",
  "🎭 Plot twist of the century: @memeworldorder ELIMINATED!"
];

// Progress messages with humor
export const PROGRESS_MESSAGES = [
  "📊 Body count so far: {{eliminated}} | Still breathing: {{remaining}}",
  "🎯 {{eliminated}} dreams crushed | {{remaining}} still delusional",
  "💀 Graveyard population: {{eliminated}} | Soon-to-join: {{remaining}}",
  "🔥 {{eliminated}} cooked | {{remaining}} still on the menu",
  "😂 Losers: {{eliminated}} | Future losers: {{remaining}}",
  "🎪 {{eliminated}} clowns down | {{remaining}} still in makeup",
  "⚰️ {{eliminated}} in coffins | {{remaining}} measuring for size",
  "💸 {{eliminated}} broke | {{remaining}} about to be",
  "🎭 Act {{act}}: {{eliminated}} tragedies | {{remaining}} pending",
  "🎰 House collected from {{eliminated}} | {{remaining}} still betting"
];

// Countdown messages with more variety
export const ENHANCED_COUNTDOWN_SEQUENCES = [
  ["🎯 Moment of truth approaching...", "3️⃣ Say your prayers!", "2️⃣ Kiss your ass goodbye!", "1️⃣ IT'S OVER!"],
  ["💀 Death comes for thee...", "THREE... 💀", "TWO... 💀💀", "ONE... 💀💀💀"],
  ["🎲 Rolling the dice of doom...", "3️⃣ 🎲", "2️⃣ 🎲🎲", "1️⃣ 🎲🎲🎲"],
  ["⚡ Lightning about to strike...", "3! ⚡", "2! ⚡⚡", "1! ⚡⚡⚡"],
  ["🔥 Elimination sequence initiated...", "🔴🔴🔴", "🔴🔴", "🔴"],
  ["💔 Heartbreak incoming...", "3... 💔", "2... 💔💔", "1... 💔💔💔"],
  ["🎪 GRAND FINALE...", "🎯 3 🎯", "🎯 2 🎯", "🎯 1 🎯"],
  ["😱 BRACE FOR IMPACT...", "T-3 😱", "T-2 😱😱", "T-1 😱😱😱"],
  ["🏆 Final judgment...", "|||", "||", "|"],
  ["🎭 The final act...", "🎭🎭🎭", "🎭🎭", "🎭"],
  ["☠️ Execution time...", "3️⃣☠️", "2️⃣☠️☠️", "1️⃣☠️☠️☠️"],
  ["🎰 JACKPOT OR BUST...", "🎰🎰🎰", "🎰🎰", "🎰"],
  ["🌪️ Tornado of doom...", "3 🌪️", "2 🌪️🌪️", "1 🌪️🌪️🌪️"],
  ["💣 BOMB DROPPING...", "💣3💣", "💣2💣", "💣1💣"],
  ["🗡️ Sword of Damocles...", "THREE ⚔️", "TWO ⚔️⚔️", "ONE ⚔️⚔️⚔️"]
];

/**
 * Get a game phase message based on progress
 */
export function getGamePhaseMessage(remainingPlayers: number, totalPlayers: number): string {
  const percentRemaining = (remainingPlayers / totalPlayers) * 100;
  
  if (percentRemaining > 75) {
    return EARLY_GAME_MESSAGES[Math.floor(Math.random() * EARLY_GAME_MESSAGES.length)];
  } else if (percentRemaining > 30) {
    return MID_GAME_MESSAGES[Math.floor(Math.random() * MID_GAME_MESSAGES.length)];
  } else {
    return ENHANCED_BUBBLE_MESSAGES[Math.floor(Math.random() * ENHANCED_BUBBLE_MESSAGES.length)];
  }
}

/**
 * Generate elimination message with targeted humor
 */
export async function generateEliminationMessage(
  eliminated: string[],
  chatId: string
): Promise<string> {
  if (eliminated.length === 0) return '';
  
  // Check for @memeworldorder
  const memeWorldOrderEliminated = eliminated.some(
    player => player.toLowerCase().includes('memeworldorder')
  );
  
  if (memeWorldOrderEliminated) {
    return MEMEWORLDORDER_ROASTS[Math.floor(Math.random() * MEMEWORLDORDER_ROASTS.length)];
  }
  
  // For single eliminations, check win rate for targeted roasts
  if (eliminated.length === 1) {
    // We need to get the user ID, not username - skip stats check for now
    // TODO: Update to use user ID lookup
    const playerStats = null; // await leaderboard.getPlayerStats(userId);
    if (playerStats && playerStats.gamesEntered > 5) {
      const winRate = (playerStats.gamesWon / playerStats.gamesEntered) * 100;
      
      // Roast players with < 20% win rate
      if (winRate < 20) {
        const roast = LOW_WIN_RATE_ROASTS[Math.floor(Math.random() * LOW_WIN_RATE_ROASTS.length)];
        return roast
          .replace('{{player}}', escapeUsername(eliminated[0]))
          .replace('{{rate}}', winRate.toFixed(1));
      }
    }
    
    // Regular single elimination
    const roast = ELIMINATION_ROASTS.single[Math.floor(Math.random() * ELIMINATION_ROASTS.single.length)];
    return roast.replace('{{player}}', escapeUsername(eliminated[0]));
  }
  
  // Multiple eliminations
  const roast = ELIMINATION_ROASTS.multiple[Math.floor(Math.random() * ELIMINATION_ROASTS.multiple.length)];
  const escapedPlayers = eliminated.map(p => escapeUsername(p)).join(', ');
  return roast
    .replace('{{count}}', eliminated.length.toString())
    .replace(/{{players}}/g, escapedPlayers);
}

/**
 * Get enhanced countdown sequence
 */
export function getEnhancedCountdownSequence(): string[] {
  return ENHANCED_COUNTDOWN_SEQUENCES[Math.floor(Math.random() * ENHANCED_COUNTDOWN_SEQUENCES.length)];
}

/**
 * Generate progress message with humor
 */
export function generateProgressMessage(
  eliminated: number,
  remaining: number,
  drawNumber: number
): string {
  const message = PROGRESS_MESSAGES[Math.floor(Math.random() * PROGRESS_MESSAGES.length)];
  return message
    .replace('{{eliminated}}', eliminated.toString())
    .replace('{{remaining}}', remaining.toString())
    .replace('{{act}}', Math.ceil(drawNumber / 5).toString());
}

/**
 * Get pre-elimination taunt
 */
export function getPreEliminationTaunt(remainingPlayers: number): string {
  const taunts = [
    `🎯 ${remainingPlayers} targets acquired... Who's first?`,
    `😈 Eeny, meeny, miny... YOU'RE OUT!`,
    `🎪 ${remainingPlayers} clowns in the circus... Time to thin the herd!`,
    `💀 The reaper needs ${remainingPlayers > 10 ? 'volunteers' : 'victims'}...`,
    `🎲 ${remainingPlayers} players, infinite ways to lose!`,
    `🔥 ${remainingPlayers} marshmallows ready for roasting!`,
    `😂 Get ready to spam F for our fallen comrades!`,
    `🎭 ${remainingPlayers} actors, but not everyone's the star!`,
    `💸 ${remainingPlayers} wallets about to get lighter!`,
    `⚡ Thunder god choosing from ${remainingPlayers} mortals...`
  ];
  
  return taunts[Math.floor(Math.random() * taunts.length)];
}