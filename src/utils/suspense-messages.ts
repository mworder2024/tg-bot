/**
 * Suspense messages for the final moments of the game
 */
import { escapeUsername } from './markdown-escape';

export const BUBBLE_MESSAGES = [
  "💭 So close to the cutoff... I would hate to be eliminated when the prize is this close!",
  "😰 This is the dreaded bubble... surely I won't be eliminated now... surely...",
  "🎯 The tension is palpable... one wrong number and it's all over!",
  "💸 So close to the money, yet so far... who will survive?",
  "😱 This is where dreams are made or broken... the bubble is real!",
  "🔥 The heat is on! Being this close to winning makes elimination hurt even more...",
  "💔 To come this far and lose now would be devastating...",
  "🎲 Lady luck, please be kind... not when we're THIS close!",
  "😅 Nervous laughter fills the air... who's next?",
  "🏃 No escape now... someone's dream is about to end!",
  "💫 The universe is watching... will fate be cruel or kind?",
  "🎪 Welcome to the show's climax... where heroes fall!",
  "😬 Teeth clenched, hearts racing... this is the bubble!",
  "🎭 Comedy or tragedy? We're about to find out...",
  "⚡ Lightning is about to strike... but who will it hit?",
  "🌊 Riding the wave this far only to wipe out now? Please no!",
  "🎰 The slots are spinning... will you hit the jackpot or bust?",
  "🏆 So close you can taste victory... or is it defeat?",
  "😤 Hold your breath... someone's about to exhale in defeat!",
  "🎯 The target is shrinking... fewer places to hide!",
  "💀 The reaper is choosing... who gets to keep their dream alive?",
  "🔮 The crystal ball is cloudy... destiny uncertain!",
  "🎪 Step right up to the most thrilling moment of the show!",
  "😰 Sweaty palms, racing hearts... this is what we play for!"
];

export const FINAL_DRAW_MESSAGES = [
  "🎯 This is it... the FINAL elimination!",
  "💀 One more soul must fall before we crown our winners...",
  "🏆 The last number... who will miss glory by a single draw?",
  "😱 Heart rates spike as we approach the final cut...",
  "🎪 Ladies and gentlemen... the moment of truth!",
  "⚡ The final lightning bolt is about to strike...",
  "🎲 One last roll of the dice... who's it gonna be?",
  "💔 Someone's dream ends here... at the very last hurdle!",
  "🔥 The furnace claims one more before we celebrate!",
  "🎭 The final act... tragedy for one, triumph for the rest!"
];

export const COUNTDOWN_SEQUENCES = [
  ["🎯 Last number being drawn now....", "3️⃣....", "2️⃣....", "1️⃣...."],
  ["💀 The final elimination approaches....", "Three....", "Two....", "One...."],
  ["🎲 Fate makes its final choice in....", "3️⃣", "2️⃣", "1️⃣"],
  ["⚡ The last strike coming in....", "THREE!", "TWO!", "ONE!"],
  ["🔥 The final number drops in....", "🔴🔴🔴", "🔴🔴", "🔴"],
  ["💔 Hearts stop in....", "3... 💓", "2... 💓💓", "1... 💓💓💓"],
  ["🎪 The grand finale in....", "🎯 3 🎯", "🎯 2 🎯", "🎯 1 🎯"],
  ["😱 Brace yourselves....", "T-3", "T-2", "T-1"],
  ["🏆 The final cut in....", "|||", "||", "|"],
  ["🎭 Curtain falls in....", "🎭🎭🎭", "🎭🎭", "🎭"]
];

/**
 * Get a random bubble message
 */
export function getRandomBubbleMessage(): string {
  return BUBBLE_MESSAGES[Math.floor(Math.random() * BUBBLE_MESSAGES.length)];
}

/**
 * Get a random final draw message
 */
export function getRandomFinalDrawMessage(): string {
  return FINAL_DRAW_MESSAGES[Math.floor(Math.random() * FINAL_DRAW_MESSAGES.length)];
}

/**
 * Get a random countdown sequence
 */
export function getRandomCountdownSequence(): string[] {
  return COUNTDOWN_SEQUENCES[Math.floor(Math.random() * COUNTDOWN_SEQUENCES.length)];
}

/**
 * Generate a suspenseful prize update
 */
export function generatePrizeUpdate(
  remainingPlayers: number,
  targetSurvivors: number,
  totalPrize: number,
  currentPrizePerSurvivor: number
): string {
  const toEliminate = remainingPlayers - targetSurvivors;
  
  if (toEliminate === 1) {
    return `💰 **FINAL ELIMINATION!**\n\n` +
           `🏆 ${targetSurvivors} winners will each receive: **${currentPrizePerSurvivor.toLocaleString()} tokens**\n` +
           `💀 Just ONE more elimination needed!\n` +
           `😱 Who will miss out on the prize by a single draw?`;
  } else if (toEliminate === 2) {
    return `💸 **SO CLOSE!**\n\n` +
           `👥 ${remainingPlayers} players remaining\n` +
           `🎯 ${toEliminate} more eliminations until winners!\n` +
           `💰 Current prize per survivor: **${currentPrizePerSurvivor.toLocaleString()} tokens**\n` +
           `😰 The bubble is real!`;
  } else {
    return `📊 **Prize Pool Update**\n\n` +
           `👥 ${remainingPlayers} survivors\n` +
           `🎯 ${toEliminate} more eliminations needed\n` +
           `💰 Prize per winner: **${currentPrizePerSurvivor.toLocaleString()} tokens**\n` +
           `🔥 Keep surviving!`;
  }
}

/**
 * Generate player list with suspense
 */
export function generateSuspensefulPlayerList(
  players: Array<{username: string, number: number}>,
  targetSurvivors: number
): string {
  const toEliminate = players.length - targetSurvivors;
  
  let message = `👥 **${players.length} Warriors Remain!**\n\n`;
  
  if (toEliminate === 1) {
    message += `⚠️ ONE will fall, ${targetSurvivors} will triumph!\n\n`;
  } else if (toEliminate === 2) {
    message += `⚔️ Only ${toEliminate} more must fall!\n\n`;
  }
  
  message += `**Still Standing:**\n`;
  for (const player of players) {
    message += `• ${escapeUsername(player.username)} (#${player.number})\n`;
  }
  
  if (toEliminate <= 2) {
    message += `\n😰 *The tension is unbearable...*`;
  }
  
  return message;
}