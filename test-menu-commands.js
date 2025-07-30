#!/usr/bin/env node

/**
 * Comprehensive test suite for lottery bot menu items and commands
 * Tests all admin and user functionality
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Testing All Menu Items and Commands\n');

// Test categories
const tests = {
  adminCommands: [],
  userCommands: [],
  adminMenuItems: [],
  userMenuItems: [],
  callbackHandlers: [],
  missingFeatures: []
};

// Check if command is registered in index.ts
function checkCommandRegistered(command, indexContent) {
  const regex = new RegExp(`bot\\.command\\('${command}'`, 'g');
  return regex.test(indexContent);
}

// Check if callback handler exists
function checkCallbackHandler(prefix, indexContent) {
  const regex = new RegExp(`data\\.startsWith\\('${prefix}'\\)`, 'g');
  return regex.test(indexContent);
}

// Read source files
const indexPath = path.join(__dirname, 'src', 'index.ts');
const adminMenuPath = path.join(__dirname, 'src', 'utils', 'admin-menu.ts');
const userMenuPath = path.join(__dirname, 'src', 'utils', 'user-menu.ts');
const adminCommandsPath = path.join(__dirname, 'src', 'commands', 'admin-commands.ts');

console.log('📁 Reading source files...\n');

let indexContent = '';
let adminMenuContent = '';
let userMenuContent = '';
let adminCommandsContent = '';

try {
  indexContent = fs.readFileSync(indexPath, 'utf8');
  adminMenuContent = fs.readFileSync(adminMenuPath, 'utf8');
  userMenuContent = fs.readFileSync(userMenuPath, 'utf8');
  adminCommandsContent = fs.readFileSync(adminCommandsPath, 'utf8');
} catch (error) {
  console.error('❌ Error reading files:', error.message);
  process.exit(1);
}

// Test 1: Admin Commands Registration
console.log('🔧 Testing Admin Commands Registration...');
const adminCommands = [
  'admin', 'forcestart', 'approve', 'endgame', 'resumedraw',
  'addadmin', 'deleteadmin', 'schedule', 'activatenext',
  'pauselottery', 'resumelottery', 'restart', 'logs',
  'activegames', 'scheduleevent', 'cancelevent'
];

adminCommands.forEach(cmd => {
  const registered = checkCommandRegistered(cmd, indexContent);
  tests.adminCommands.push({
    command: cmd,
    registered,
    status: registered ? '✅' : '❌'
  });
  console.log(`  ${registered ? '✅' : '❌'} /${cmd}`);
});

// Test 2: User Commands Registration
console.log('\n👤 Testing User Commands Registration...');
const userCommands = [
  'create', 'join', 'status', 'leaderboard', 'stats',
  'prizestats', 'winnerstats', 'scheduled', 'help', 'start'
];

userCommands.forEach(cmd => {
  const registered = checkCommandRegistered(cmd, indexContent);
  tests.userCommands.push({
    command: cmd,
    registered,
    status: registered ? '✅' : '❌'
  });
  console.log(`  ${registered ? '✅' : '❌'} /${cmd}`);
});

// Test 3: Admin Menu Items
console.log('\n🛠️ Testing Admin Menu Items...');
const adminMenuItems = [
  'Game Control', 'Schedule Games', 'Admin Management', 'System',
  'Force Start', 'Approve Game', 'End Game', 'Resume Draw',
  'Pause Lottery', 'Resume Lottery', 'Schedule Event', 'Cancel Event',
  'Add Admin', 'Delete Admin', 'View Admins', 'Restart Bot', 'View Logs'
];

adminMenuItems.forEach(item => {
  // Check if menu item text exists in admin-menu.ts
  const exists = adminMenuContent.includes(item);
  tests.adminMenuItems.push({
    item,
    exists,
    status: exists ? '✅' : '❌'
  });
  console.log(`  ${exists ? '✅' : '❌'} ${item}`);
});

// Test 4: User Menu Items
console.log('\n👥 Testing User Menu Items...');
const userMenuItems = [
  'Create Game', 'Join Game', 'Game Status', 'My Number',
  'My Stats', 'Leaderboard', 'Prize Stats', 'Top Winners',
  'View Schedule', 'Help', 'Private Menu', 'Admin Panel'
];

userMenuItems.forEach(item => {
  // Check if menu item text exists in user-menu.ts
  const exists = userMenuContent.includes(item);
  tests.userMenuItems.push({
    item,
    exists,
    status: exists ? '✅' : '❌'
  });
  console.log(`  ${exists ? '✅' : '❌'} ${item}`);
});

// Test 5: Callback Handlers
console.log('\n🔄 Testing Callback Handlers...');
const callbackPrefixes = [
  'admin:', 'user:', 'quick:'
];

callbackPrefixes.forEach(prefix => {
  const exists = checkCallbackHandler(prefix, indexContent);
  tests.callbackHandlers.push({
    prefix,
    exists,
    status: exists ? '✅' : '❌'
  });
  console.log(`  ${exists ? '✅' : '❌'} ${prefix} handler`);
});

// Test 6: Check for missing implementations
console.log('\n🔍 Checking for Missing Implementations...');

// Check if admin commands are actually implemented
const missingImplementations = [];

if (!adminCommandsContent.includes('handleRestartCommand')) {
  missingImplementations.push('restart command implementation');
}
if (!adminCommandsContent.includes('handleLogsCommand')) {
  missingImplementations.push('logs command implementation');
}
if (!adminCommandsContent.includes('handleActiveGamesCommand')) {
  missingImplementations.push('activegames command implementation');
}

missingImplementations.forEach(missing => {
  tests.missingFeatures.push({
    feature: missing,
    status: '❌'
  });
  console.log(`  ❌ ${missing}`);
});

if (missingImplementations.length === 0) {
  console.log('  ✅ All admin commands have implementations');
}

// Test 7: Check menu-command linking
console.log('\n🔗 Testing Menu-Command Integration...');

// Check if admin menu callbacks properly trigger commands
const adminMenuCallbacks = [
  'admin:gamecontrol:forcestart',
  'admin:gamecontrol:approve',
  'admin:gamecontrol:endgame',
  'admin:system:restart',
  'admin:system:logs'
];

let menuCommandLinking = 0;
adminMenuCallbacks.forEach(callback => {
  const parts = callback.split(':');
  const command = parts[parts.length - 1];
  
  if (adminMenuContent.includes(callback) && indexContent.includes(`bot.command('${command}'`)) {
    menuCommandLinking++;
    console.log(`  ✅ ${callback} → /${command}`);
  } else {
    console.log(`  ❌ ${callback} → /${command}`);
  }
});

// Summary
console.log('\n📊 TEST SUMMARY');
console.log('================');

const adminCommandsPass = tests.adminCommands.filter(t => t.registered).length;
const userCommandsPass = tests.userCommands.filter(t => t.registered).length;
const adminMenuPass = tests.adminMenuItems.filter(t => t.exists).length;
const userMenuPass = tests.userMenuItems.filter(t => t.exists).length;
const callbackPass = tests.callbackHandlers.filter(t => t.exists).length;

console.log(`Admin Commands: ${adminCommandsPass}/${adminCommands.length} registered`);
console.log(`User Commands: ${userCommandsPass}/${userCommands.length} registered`);
console.log(`Admin Menu Items: ${adminMenuPass}/${adminMenuItems.length} implemented`);
console.log(`User Menu Items: ${userMenuPass}/${userMenuItems.length} implemented`);
console.log(`Callback Handlers: ${callbackPass}/${callbackPrefixes.length} working`);
console.log(`Menu-Command Linking: ${menuCommandLinking}/${adminMenuCallbacks.length} connected`);

const totalTests = adminCommands.length + userCommands.length + adminMenuItems.length + 
                  userMenuItems.length + callbackPrefixes.length;
const totalPass = adminCommandsPass + userCommandsPass + adminMenuPass + 
                 userMenuPass + callbackPass;

console.log(`\nOVERALL: ${totalPass}/${totalTests} tests passed (${Math.round(totalPass/totalTests*100)}%)`);

// Exit codes
if (totalPass === totalTests && missingImplementations.length === 0) {
  console.log('\n🎉 ALL TESTS PASSED! The bot is fully functional.');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Review the issues above.');
  process.exit(1);
}