/**
 * Escape special characters for Telegram Markdown
 */
export function escapeMarkdown(text: string): string {
  // Escape special markdown characters
  return text
    .replace(/\_/g, '\\_')  // Escape underscores
    .replace(/\*/g, '\\*')  // Escape asterisks
    .replace(/\[/g, '\\[')  // Escape square brackets
    .replace(/\]/g, '\\]')  // Escape square brackets
    .replace(/\(/g, '\\(')  // Escape parentheses
    .replace(/\)/g, '\\)')  // Escape parentheses
    .replace(/\~/g, '\\~')  // Escape tildes
    .replace(/\`/g, '\\`')  // Escape backticks
    .replace(/\>/g, '\\>')  // Escape greater than
    .replace(/\#/g, '\\#')  // Escape hash
    .replace(/\+/g, '\\+')  // Escape plus
    .replace(/\-/g, '\\-')  // Escape minus
    .replace(/\=/g, '\\=')  // Escape equals
    .replace(/\|/g, '\\|')  // Escape pipe
    .replace(/\{/g, '\\{')  // Escape curly braces
    .replace(/\}/g, '\\}')  // Escape curly braces
    .replace(/\./g, '\\.')  // Escape dots
    .replace(/\!/g, '\\!'); // Escape exclamation
}

/**
 * Escape username for safe Markdown display
 */
export function escapeUsername(username: string | undefined | null): string {
  // Handle undefined/null usernames
  if (!username) {
    return 'Unknown';
  }
  // More aggressive escaping for usernames
  return username.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}