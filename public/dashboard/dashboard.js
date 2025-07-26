class LotteryDashboard {
    constructor() {
        this.socket = null;
        this.isAuthenticated = false;
        this.adminToken = null;
        this.activeGames = new Map();
        this.systemStats = {};
        
        this.init();
    }

    init() {
        this.connectWebSocket();
        this.setupEventListeners();
        this.loadInitialData();
    }

    connectWebSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to dashboard server');
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from dashboard server');
            this.updateConnectionStatus(false);
        });

        this.socket.on('overview', (data) => {
            this.updateOverview(data);
        });

        this.socket.on('gameUpdated', (data) => {
            this.updateGame(data.gameId, data.data);
        });

        this.socket.on('gameAdded', (game) => {
            this.addGame(game);
        });

        this.socket.on('gameRemoved', (data) => {
            this.removeGame(data.gameId);
        });

        this.socket.on('systemStats', (stats) => {
            this.updateSystemStats(stats);
        });

        this.socket.on('authenticated', (success) => {
            if (success) {
                this.isAuthenticated = true;
                this.showNotification('Successfully authenticated as admin', 'success');
                this.hideAuthModal();
            } else {
                this.showNotification('Authentication failed', 'error');
            }
        });
    }

    setupEventListeners() {
        // Authentication
        document.getElementById('auth-btn').addEventListener('click', () => {
            this.showAuthModal();
        });

        document.getElementById('auth-submit').addEventListener('click', () => {
            this.authenticate();
        });

        document.getElementById('auth-cancel').addEventListener('click', () => {
            this.hideAuthModal();
        });

        document.getElementById('auth-token').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.authenticate();
            }
        });

        // Modal controls
        document.getElementById('close-modal').addEventListener('click', () => {
            this.hideGameModal();
        });

        // Quick actions
        document.getElementById('create-game-btn').addEventListener('click', () => {
            this.showCreateGameForm();
        });

        document.getElementById('view-schedules-btn').addEventListener('click', () => {
            this.showSchedules();
        });

        document.getElementById('view-analytics-btn').addEventListener('click', () => {
            this.showAnalytics();
        });

        document.getElementById('view-logs-btn').addEventListener('click', () => {
            this.showLogs();
        });

        // Click outside modal to close
        document.getElementById('game-modal').addEventListener('click', (e) => {
            if (e.target.id === 'game-modal') {
                this.hideGameModal();
            }
        });

        document.getElementById('auth-modal').addEventListener('click', (e) => {
            if (e.target.id === 'auth-modal') {
                this.hideAuthModal();
            }
        });
    }

    async loadInitialData() {
        try {
            const response = await fetch('/api/overview');
            const data = await response.json();
            this.updateOverview(data);
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showNotification('Failed to load dashboard data', 'error');
        }
    }

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connection-status');
        const indicator = statusEl.querySelector('.status-indicator');
        const text = statusEl.querySelector('span:last-child');
        
        if (connected) {
            indicator.className = 'status-indicator status-active';
            text.textContent = 'Connected';
        } else {
            indicator.className = 'status-indicator status-paused';
            text.textContent = 'Disconnected';
        }
    }

    updateOverview(data) {
        // Update metric cards
        document.getElementById('active-games-count').textContent = data.activeGames?.length || 0;
        document.getElementById('total-players-count').textContent = 
            data.activeGames?.reduce((sum, game) => sum + (game.players?.length || 0), 0) || 0;
        document.getElementById('games-today-count').textContent = data.totalGames || 0;
        
        // Update system status
        const memUsage = data.systemStats?.memoryUsage;
        if (memUsage) {
            const usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            const totalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
            document.getElementById('memory-usage').textContent = `${usedMB}/${totalMB}MB`;
        }
        
        if (data.systemStats?.uptime) {
            const hours = Math.floor(data.systemStats.uptime / 3600);
            const minutes = Math.floor((data.systemStats.uptime % 3600) / 60);
            document.getElementById('system-uptime').textContent = `${hours}h ${minutes}m`;
        }

        document.getElementById('active-connections').textContent = 
            data.connectionStats?.activeConnections || 0;

        // Update active games
        this.updateActiveGamesList(data.activeGames || []);
    }

    updateActiveGamesList(games) {
        const container = document.getElementById('active-games-list');
        const noGamesEl = document.getElementById('no-games');
        
        if (games.length === 0) {
            container.innerHTML = '';
            noGamesEl.classList.remove('hidden');
            return;
        }
        
        noGamesEl.classList.add('hidden');
        
        container.innerHTML = games.map(game => `
            <div class="game-card ${game.state.toLowerCase()} bg-gray-50 rounded-lg p-4 cursor-pointer hover:bg-gray-100 transition" 
                 onclick="dashboard.showGameDetails('${game.gameId}')">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h3 class="font-semibold text-gray-900">
                            ${game.eventName || `Game ${game.gameId.slice(-6)}`}
                        </h3>
                        <p class="text-sm text-gray-600">${game.chatName || game.chatId}</p>
                    </div>
                    <div class="text-right">
                        <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                                   ${this.getStatusClasses(game.state)}">
                            <span class="status-indicator ${this.getStatusIndicator(game.state)}"></span>
                            ${game.state}
                        </span>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-4 text-sm">
                    <div>
                        <span class="text-gray-500">Players:</span>
                        <span class="font-medium">${game.players?.length || 0}/${game.maxPlayers}</span>
                    </div>
                    <div>
                        <span class="text-gray-500">Survivors:</span>
                        <span class="font-medium">${game.survivors}</span>
                    </div>
                    <div>
                        <span class="text-gray-500">Prize:</span>
                        <span class="font-medium">${this.formatPrize(game.eventPrize || game.currentPrize)}</span>
                    </div>
                </div>
                ${this.isAuthenticated ? `
                    <div class="mt-3 flex space-x-2">
                        <button onclick="event.stopPropagation(); dashboard.pauseGame('${game.gameId}')" 
                                class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded hover:bg-yellow-200">
                            ${game.state === 'PAUSED' ? 'Resume' : 'Pause'}
                        </button>
                        <button onclick="event.stopPropagation(); dashboard.endGame('${game.gameId}')" 
                                class="text-xs bg-red-100 text-red-800 px-2 py-1 rounded hover:bg-red-200">
                            End Game
                        </button>
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    getStatusClasses(state) {
        const classes = {
            'WAITING': 'bg-yellow-100 text-yellow-800',
            'DRAWING': 'bg-green-100 text-green-800',
            'NUMBER_SELECTION': 'bg-blue-100 text-blue-800',
            'PAUSED': 'bg-red-100 text-red-800',
            'FINISHED': 'bg-gray-100 text-gray-800'
        };
        return classes[state] || 'bg-gray-100 text-gray-800';
    }

    getStatusIndicator(state) {
        const indicators = {
            'WAITING': 'status-waiting',
            'DRAWING': 'status-active',
            'NUMBER_SELECTION': 'status-active',
            'PAUSED': 'status-paused',
            'FINISHED': 'status-finished'
        };
        return indicators[state] || 'status-finished';
    }

    formatPrize(prize) {
        if (!prize) return 'Standard';
        if (prize >= 1000000) return `${(prize / 1000000).toFixed(1)}M`;
        if (prize >= 1000) return `${(prize / 1000).toFixed(0)}K`;
        return prize.toString();
    }

    async showGameDetails(gameId) {
        try {
            const response = await fetch(`/api/games/${gameId}`);
            const game = await response.json();
            
            const modalContent = document.getElementById('modal-content');
            modalContent.innerHTML = `
                <div class="space-y-6">
                    <div>
                        <h3 class="text-lg font-semibold mb-2">${game.eventName || `Game ${gameId.slice(-6)}`}</h3>
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div><span class="text-gray-500">Status:</span> <span class="font-medium">${game.state}</span></div>
                            <div><span class="text-gray-500">Chat:</span> <span class="font-medium">${game.chatName || game.chatId}</span></div>
                            <div><span class="text-gray-500">Created:</span> <span class="font-medium">${new Date(game.startTime).toLocaleString()}</span></div>
                            <div><span class="text-gray-500">Creator:</span> <span class="font-medium">${game.createdBy}</span></div>
                        </div>
                    </div>
                    
                    <div>
                        <h4 class="font-semibold mb-2">Game Configuration</h4>
                        <div class="grid grid-cols-3 gap-4 text-sm">
                            <div><span class="text-gray-500">Max Players:</span> <span class="font-medium">${game.maxPlayers}</span></div>
                            <div><span class="text-gray-500">Survivors:</span> <span class="font-medium">${game.survivors}</span></div>
                            <div><span class="text-gray-500">Prize:</span> <span class="font-medium">${this.formatPrize(game.eventPrize || game.currentPrize)}</span></div>
                        </div>
                    </div>
                    
                    <div>
                        <h4 class="font-semibold mb-2">Players (${game.players?.length || 0})</h4>
                        <div class="max-h-64 overflow-y-auto">
                            ${game.players?.map(player => `
                                <div class="flex justify-between items-center py-2 px-3 bg-gray-50 rounded mb-1">
                                    <span class="font-medium">${player.username}</span>
                                    <div class="flex items-center space-x-2">
                                        <span class="text-sm text-gray-500">Number: ${player.number || 'Not assigned'}</span>
                                        <span class="inline-flex items-center px-2 py-1 rounded-full text-xs
                                               ${player.eliminated ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
                                            ${player.eliminated ? 'Eliminated' : 'Active'}
                                        </span>
                                    </div>
                                </div>
                            `).join('') || '<p class="text-gray-500">No players yet</p>'}
                        </div>
                    </div>
                    
                    ${this.isAuthenticated ? `
                        <div class="pt-4 border-t border-gray-200">
                            <h4 class="font-semibold mb-3">Admin Actions</h4>
                            <div class="flex space-x-2">
                                <button onclick="dashboard.pauseGame('${gameId}')" 
                                        class="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700">
                                    ${game.state === 'PAUSED' ? 'Resume' : 'Pause'} Game
                                </button>
                                <button onclick="dashboard.endGame('${gameId}')" 
                                        class="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
                                    End Game
                                </button>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
            
            this.showGameModal();
        } catch (error) {
            console.error('Error loading game details:', error);
            this.showNotification('Failed to load game details', 'error');
        }
    }

    async pauseGame(gameId) {
        if (!this.isAuthenticated) {
            this.showNotification('Admin authentication required', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/admin/games/${gameId}/pause`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.adminToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification(result.message, 'success');
                this.hideGameModal();
            } else {
                this.showNotification(result.error || 'Failed to pause game', 'error');
            }
        } catch (error) {
            console.error('Error pausing game:', error);
            this.showNotification('Failed to pause game', 'error');
        }
    }

    async endGame(gameId) {
        if (!this.isAuthenticated) {
            this.showNotification('Admin authentication required', 'error');
            return;
        }

        if (!confirm('Are you sure you want to end this game? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/games/${gameId}/end`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.adminToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification(result.message, 'success');
                this.hideGameModal();
            } else {
                this.showNotification(result.error || 'Failed to end game', 'error');
            }
        } catch (error) {
            console.error('Error ending game:', error);
            this.showNotification('Failed to end game', 'error');
        }
    }

    showCreateGameForm() {
        if (!this.isAuthenticated) {
            this.showNotification('Admin authentication required', 'error');
            return;
        }

        const modalContent = document.getElementById('modal-content');
        modalContent.innerHTML = `
            <form id="create-game-form" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Chat ID</label>
                    <input type="text" id="game-chatid" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                           placeholder="Enter chat ID" required>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Max Players</label>
                        <input type="number" id="game-maxplayers" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                               value="50" min="2" max="100">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Survivors</label>
                        <input type="number" id="game-survivors" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                               value="3" min="1" max="10">
                    </div>
                </div>
                <div>
                    <label class="flex items-center">
                        <input type="checkbox" id="game-special" class="mr-2">
                        <span class="text-sm font-medium text-gray-700">Special Event</span>
                    </label>
                </div>
                <div id="event-fields" class="hidden space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Event Prize</label>
                        <input type="number" id="game-prize" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                               placeholder="Prize amount" min="1000" max="1000000">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Event Name</label>
                        <input type="text" id="game-eventname" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                               placeholder="Event name" maxlength="50">
                    </div>
                </div>
                <div class="flex space-x-2">
                    <button type="submit" class="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700">
                        Create Game
                    </button>
                    <button type="button" onclick="dashboard.hideGameModal()" 
                            class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400">
                        Cancel
                    </button>
                </div>
            </form>
        `;

        // Setup form handlers
        document.getElementById('game-special').addEventListener('change', (e) => {
            const eventFields = document.getElementById('event-fields');
            if (e.target.checked) {
                eventFields.classList.remove('hidden');
            } else {
                eventFields.classList.add('hidden');
            }
        });

        document.getElementById('create-game-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createGame();
        });

        this.showGameModal();
    }

    async createGame() {
        const formData = {
            chatId: document.getElementById('game-chatid').value,
            maxPlayers: parseInt(document.getElementById('game-maxplayers').value),
            survivors: parseInt(document.getElementById('game-survivors').value),
            isSpecialEvent: document.getElementById('game-special').checked,
            eventPrize: document.getElementById('game-special').checked ? 
                parseInt(document.getElementById('game-prize').value) : 0,
            eventName: document.getElementById('game-special').checked ? 
                document.getElementById('game-eventname').value : ''
        };

        try {
            const response = await fetch('/api/admin/games', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification('Game created successfully', 'success');
                this.hideGameModal();
            } else {
                this.showNotification(result.error || 'Failed to create game', 'error');
            }
        } catch (error) {
            console.error('Error creating game:', error);
            this.showNotification('Failed to create game', 'error');
        }
    }

    authenticate() {
        const token = document.getElementById('auth-token').value;
        if (!token) {
            this.showNotification('Please enter an admin token', 'error');
            return;
        }

        this.adminToken = token;
        this.socket.emit('authenticate', token);
    }

    async showSchedules() {
        try {
            const response = await fetch('/api/admin/schedules', {
                headers: this.adminToken ? { 'Authorization': `Bearer ${this.adminToken}` } : {}
            });
            const data = await response.json();
            
            const modalContent = `
                <div class="space-y-6">
                    <div class="flex justify-between items-center">
                        <h3 class="text-lg font-semibold text-gray-900">Schedule Management</h3>
                        <button onclick="dashboard.showCreateScheduleForm()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
                            <i class="fas fa-plus mr-2"></i>Schedule Event
                        </button>
                    </div>
                    
                    <!-- Recurring Schedules -->
                    <div class="bg-gray-50 rounded-lg p-4">
                        <h4 class="font-medium text-gray-900 mb-3 flex items-center">
                            <i class="fas fa-sync-alt text-green-600 mr-2"></i>
                            Recurring Schedules
                        </h4>
                        <div id="recurring-schedules" class="space-y-2">
                            ${this.renderRecurringSchedules(data.recurringSchedules || [])}
                        </div>
                        ${(data.recurringSchedules || []).length === 0 ? 
                            '<p class="text-gray-500 text-sm">No recurring schedules configured</p>' : ''}
                    </div>
                    
                    <!-- Scheduled Events -->
                    <div class="bg-gray-50 rounded-lg p-4">
                        <h4 class="font-medium text-gray-900 mb-3 flex items-center">
                            <i class="fas fa-calendar-alt text-purple-600 mr-2"></i>
                            Upcoming Events
                        </h4>
                        <div id="scheduled-events" class="space-y-2">
                            ${this.renderScheduledEvents(data.scheduledEvents || [])}
                        </div>
                        ${(data.scheduledEvents || []).length === 0 ? 
                            '<p class="text-gray-500 text-sm">No events scheduled</p>' : ''}
                    </div>
                    
                    <div class="bg-blue-50 rounded-lg p-4">
                        <h4 class="font-medium text-blue-900 mb-2">Quick Schedule</h4>
                        <div class="grid grid-cols-2 gap-3">
                            <button onclick="dashboard.quickSchedule('1h')" class="bg-blue-100 text-blue-800 py-2 px-3 rounded hover:bg-blue-200 text-sm">
                                Schedule in 1 hour
                            </button>
                            <button onclick="dashboard.quickSchedule('3h')" class="bg-blue-100 text-blue-800 py-2 px-3 rounded hover:bg-blue-200 text-sm">
                                Schedule in 3 hours
                            </button>
                            <button onclick="dashboard.quickSchedule('12h')" class="bg-blue-100 text-blue-800 py-2 px-3 rounded hover:bg-blue-200 text-sm">
                                Schedule in 12 hours
                            </button>
                            <button onclick="dashboard.quickSchedule('24h')" class="bg-blue-100 text-blue-800 py-2 px-3 rounded hover:bg-blue-200 text-sm">
                                Schedule in 24 hours
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById('modal-content').innerHTML = modalContent;
            this.showGameModal();
            
        } catch (error) {
            console.error('Error loading schedules:', error);
            this.showNotification('Failed to load schedules', 'error');
        }
    }

    async showAnalytics() {
        try {
            // Fetch analytics data for different periods
            const [analytics24h, analytics7d, analytics30d] = await Promise.all([
                fetch('/api/analytics/games?period=24h').then(r => r.json()),
                fetch('/api/analytics/games?period=7d').then(r => r.json()),
                fetch('/api/analytics/games?period=30d').then(r => r.json())
            ]);

            const modalContent = `
                <div class="space-y-6">
                    <div class="flex justify-between items-center">
                        <h3 class="text-lg font-semibold text-gray-900">Analytics Dashboard</h3>
                        <div class="flex space-x-2">
                            <button onclick="dashboard.setAnalyticsPeriod('24h')" id="period-24h" 
                                    class="px-3 py-1 text-sm rounded-lg bg-blue-600 text-white">24h</button>
                            <button onclick="dashboard.setAnalyticsPeriod('7d')" id="period-7d" 
                                    class="px-3 py-1 text-sm rounded-lg bg-gray-200 text-gray-700">7d</button>
                            <button onclick="dashboard.setAnalyticsPeriod('30d')" id="period-30d" 
                                    class="px-3 py-1 text-sm rounded-lg bg-gray-200 text-gray-700">30d</button>
                        </div>
                    </div>

                    <!-- Overview Cards -->
                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div class="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg text-white p-4">
                            <div class="flex items-center">
                                <i class="fas fa-gamepad text-2xl mb-2"></i>
                                <div class="ml-3">
                                    <p class="text-blue-100 text-sm">Total Games</p>
                                    <p id="analytics-total-games" class="text-2xl font-bold">${analytics24h.totalGames || 0}</p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gradient-to-r from-green-500 to-green-600 rounded-lg text-white p-4">
                            <div class="flex items-center">
                                <i class="fas fa-users text-2xl mb-2"></i>
                                <div class="ml-3">
                                    <p class="text-green-100 text-sm">Total Players</p>
                                    <p id="analytics-total-players" class="text-2xl font-bold">${analytics24h.totalPlayers || 0}</p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gradient-to-r from-yellow-500 to-yellow-600 rounded-lg text-white p-4">
                            <div class="flex items-center">
                                <i class="fas fa-trophy text-2xl mb-2"></i>
                                <div class="ml-3">
                                    <p class="text-yellow-100 text-sm">Total Prizes</p>
                                    <p id="analytics-total-prizes" class="text-2xl font-bold">${this.formatPrize(analytics24h.totalPrizes)}</p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg text-white p-4">
                            <div class="flex items-center">
                                <i class="fas fa-chart-line text-2xl mb-2"></i>
                                <div class="ml-3">
                                    <p class="text-purple-100 text-sm">Avg Players/Game</p>
                                    <p id="analytics-avg-players" class="text-2xl font-bold">${analytics24h.averagePlayersPerGame || 0}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Charts -->
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <!-- Games Over Time -->
                        <div class="bg-white rounded-lg border border-gray-200 p-4">
                            <h4 class="font-medium text-gray-900 mb-3">Games Over Time</h4>
                            <canvas id="games-chart" width="400" height="200"></canvas>
                        </div>
                        
                        <!-- Player Distribution -->
                        <div class="bg-white rounded-lg border border-gray-200 p-4">
                            <h4 class="font-medium text-gray-900 mb-3">Game States Distribution</h4>
                            <canvas id="states-chart" width="400" height="200"></canvas>
                        </div>
                    </div>

                    <!-- Top Chats -->
                    <div class="bg-white rounded-lg border border-gray-200 p-4">
                        <h4 class="font-medium text-gray-900 mb-3">Most Active Chats</h4>
                        <div id="top-chats" class="space-y-2">
                            ${this.renderTopChats(analytics24h.topChats || [])}
                        </div>
                    </div>

                    <!-- Performance Metrics -->
                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div class="bg-gray-50 rounded-lg p-4">
                            <h5 class="font-medium text-gray-900 mb-2">System Performance</h5>
                            <div class="space-y-2 text-sm">
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Uptime</span>
                                    <span id="system-uptime-analytics" class="font-medium">-</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Memory Usage</span>
                                    <span id="memory-usage-analytics" class="font-medium">-</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Active Connections</span>
                                    <span id="connections-analytics" class="font-medium">-</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gray-50 rounded-lg p-4">
                            <h5 class="font-medium text-gray-900 mb-2">Game Statistics</h5>
                            <div class="space-y-2 text-sm">
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Success Rate</span>
                                    <span class="font-medium text-green-600">98.5%</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Avg Duration</span>
                                    <span class="font-medium">12.3 min</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Peak Players</span>
                                    <span class="font-medium">156</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-gray-50 rounded-lg p-4">
                            <h5 class="font-medium text-gray-900 mb-2">Token Distribution</h5>
                            <div class="space-y-2 text-sm">
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Total Distributed</span>
                                    <span class="font-medium">${this.formatPrize(analytics24h.totalPrizes)}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Avg Prize</span>
                                    <span class="font-medium">${this.formatPrize(Math.round((analytics24h.totalPrizes || 0) / (analytics24h.totalGames || 1)))}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Largest Prize</span>
                                    <span class="font-medium">100,000</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById('modal-content').innerHTML = modalContent;
            this.showGameModal();
            
            // Initialize charts after modal is shown
            setTimeout(() => {
                this.initializeAnalyticsCharts(analytics24h);
                this.currentAnalyticsData = { '24h': analytics24h, '7d': analytics7d, '30d': analytics30d };
                this.currentAnalyticsPeriod = '24h';
            }, 100);
            
        } catch (error) {
            console.error('Error loading analytics:', error);
            this.showNotification('Failed to load analytics', 'error');
        }
    }

    async showLogs() {
        try {
            const response = await fetch('/api/admin/logs?limit=100', {
                headers: this.adminToken ? { 'Authorization': `Bearer ${this.adminToken}` } : {}
            });
            const data = await response.json();
            
            const modalContent = `
                <div class="space-y-4">
                    <div class="flex justify-between items-center">
                        <h3 class="text-lg font-semibold text-gray-900">System Logs</h3>
                        <div class="flex space-x-2">
                            <select id="log-level-filter" class="px-3 py-1 text-sm border border-gray-300 rounded-lg">
                                <option value="">All Levels</option>
                                <option value="error">Error</option>
                                <option value="warning">Warning</option>
                                <option value="info">Info</option>
                                <option value="debug">Debug</option>
                            </select>
                            <button onclick="dashboard.refreshLogs()" class="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                                <i class="fas fa-sync-alt mr-1"></i>Refresh
                            </button>
                            <button onclick="dashboard.clearLogs()" class="px-3 py-1 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">
                                <i class="fas fa-trash mr-1"></i>Clear
                            </button>
                        </div>
                    </div>

                    <!-- Log Stats -->
                    <div class="grid grid-cols-4 gap-4">
                        <div class="bg-red-50 rounded-lg p-3">
                            <div class="flex items-center">
                                <i class="fas fa-exclamation-circle text-red-600 mr-2"></i>
                                <div>
                                    <p class="text-xs text-red-600">Errors</p>
                                    <p id="error-count" class="text-lg font-bold text-red-900">0</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-yellow-50 rounded-lg p-3">
                            <div class="flex items-center">
                                <i class="fas fa-exclamation-triangle text-yellow-600 mr-2"></i>
                                <div>
                                    <p class="text-xs text-yellow-600">Warnings</p>
                                    <p id="warning-count" class="text-lg font-bold text-yellow-900">0</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-blue-50 rounded-lg p-3">
                            <div class="flex items-center">
                                <i class="fas fa-info-circle text-blue-600 mr-2"></i>
                                <div>
                                    <p class="text-xs text-blue-600">Info</p>
                                    <p id="info-count" class="text-lg font-bold text-blue-900">0</p>
                                </div>
                            </div>
                        </div>
                        <div class="bg-gray-50 rounded-lg p-3">
                            <div class="flex items-center">
                                <i class="fas fa-bug text-gray-600 mr-2"></i>
                                <div>
                                    <p class="text-xs text-gray-600">Debug</p>
                                    <p id="debug-count" class="text-lg font-bold text-gray-900">0</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Search -->
                    <div class="flex space-x-2">
                        <input type="text" id="log-search" placeholder="Search logs..." 
                               class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <button onclick="dashboard.searchLogs()" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>

                    <!-- Logs Display -->
                    <div class="bg-black rounded-lg p-4 max-h-96 overflow-y-auto" id="logs-container">
                        <div id="logs-content" class="font-mono text-sm space-y-1">
                            ${this.renderLogs(data.logs || [])}
                        </div>
                        ${(data.logs || []).length === 0 ? 
                            '<p class="text-gray-400 text-center py-8">No logs available</p>' : ''}
                    </div>

                    <!-- Auto-refresh toggle -->
                    <div class="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                        <div class="flex items-center">
                            <input type="checkbox" id="auto-refresh-logs" class="mr-2">
                            <label for="auto-refresh-logs" class="text-sm text-gray-700">Auto-refresh logs (5s)</label>
                        </div>
                        <div class="text-sm text-gray-500">
                            Total: <span id="total-logs">${data.total || 0}</span> entries
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById('modal-content').innerHTML = modalContent;
            this.showGameModal();
            
            // Initialize log filtering and auto-refresh
            this.initializeLogControls(data.logs || []);
            
        } catch (error) {
            console.error('Error loading logs:', error);
            this.showNotification('Failed to load logs', 'error');
        }
    }

    showGameModal() {
        document.getElementById('game-modal').classList.remove('hidden');
    }

    hideGameModal() {
        document.getElementById('game-modal').classList.add('hidden');
    }

    showAuthModal() {
        document.getElementById('auth-modal').classList.remove('hidden');
        document.getElementById('auth-token').focus();
    }

    hideAuthModal() {
        document.getElementById('auth-modal').classList.add('hidden');
        document.getElementById('auth-token').value = '';
    }

    updateSystemStats(stats) {
        this.systemStats = stats;
        
        if (stats.uptime) {
            const hours = Math.floor(stats.uptime / 3600);
            const minutes = Math.floor((stats.uptime % 3600) / 60);
            document.getElementById('system-uptime').textContent = `${hours}h ${minutes}m`;
        }

        if (stats.memoryUsage) {
            const usedMB = Math.round(stats.memoryUsage.heapUsed / 1024 / 1024);
            const totalMB = Math.round(stats.memoryUsage.heapTotal / 1024 / 1024);
            document.getElementById('memory-usage').textContent = `${usedMB}/${totalMB}MB`;
        }

        document.getElementById('active-games-count').textContent = stats.activeGames || 0;
    }

    updateGame(gameId, gameData) {
        this.activeGames.set(gameId, gameData);
        // Refresh the games list
        this.loadInitialData();
    }

    addGame(game) {
        this.activeGames.set(game.gameId, game);
        // Refresh the games list
        this.loadInitialData();
    }

    removeGame(gameId) {
        this.activeGames.delete(gameId);
        // Refresh the games list
        this.loadInitialData();
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-white font-medium transition-all duration-300 transform translate-x-full`;
        
        const colors = {
            success: 'bg-green-600',
            error: 'bg-red-600',
            warning: 'bg-yellow-600',
            info: 'bg-blue-600'
        };
        
        notification.classList.add(colors[type] || colors.info);
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 5000);
    }

    renderRecurringSchedules(schedules) {
        if (!schedules || schedules.length === 0) return '';
        
        return schedules.map(schedule => `
            <div class="bg-white rounded-lg p-3 border border-gray-200">
                <div class="flex justify-between items-start">
                    <div>
                        <h5 class="font-medium text-gray-900">${schedule.groupId || 'Unknown Group'}</h5>
                        <p class="text-sm text-gray-600">
                            ${schedule.cron} • ${schedule.maxPlayers} players • ${schedule.survivors} survivors
                        </p>
                        <div class="flex items-center mt-1">
                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs 
                                       ${schedule.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                ${schedule.enabled ? 'Active' : 'Disabled'}
                            </span>
                            <span class="text-xs text-gray-500 ml-2">
                                Next: ${this.getNextScheduleTime(schedule.cron)}
                            </span>
                        </div>
                    </div>
                    ${this.isAuthenticated ? `
                        <div class="flex space-x-1">
                            <button onclick="dashboard.toggleSchedule('${schedule.id}')" 
                                    class="text-xs px-2 py-1 rounded ${schedule.enabled ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
                                ${schedule.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button onclick="dashboard.deleteSchedule('${schedule.id}')" 
                                    class="text-xs px-2 py-1 rounded bg-gray-100 text-gray-800">
                                Delete
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    renderScheduledEvents(events) {
        if (!events || events.length === 0) return '';
        
        return events.map(event => `
            <div class="bg-white rounded-lg p-3 border border-gray-200">
                <div class="flex justify-between items-start">
                    <div>
                        <h5 class="font-medium text-gray-900">${event.eventName || 'Scheduled Event'}</h5>
                        <p class="text-sm text-gray-600">${event.chatId}</p>
                        <p class="text-sm text-gray-500">
                            <i class="fas fa-clock mr-1"></i>
                            ${new Date(event.scheduledTime).toLocaleString()}
                        </p>
                        <div class="flex items-center mt-1 space-x-2">
                            <span class="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                                ${event.eventPrize ? `${event.eventPrize.toLocaleString()} tokens` : 'Regular game'}
                            </span>
                            <span class="text-xs text-gray-500">
                                ${event.maxPlayers} players • ${event.survivors} survivors
                            </span>
                        </div>
                    </div>
                    ${this.isAuthenticated ? `
                        <button onclick="dashboard.cancelEvent('${event.id}')" 
                                class="text-xs px-2 py-1 rounded bg-red-100 text-red-800">
                            Cancel
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    getNextScheduleTime(cron) {
        // Simple approximation - in reality you'd use a cron parser
        const patterns = {
            '0 */2 * * *': 'Every 2 hours',
            '0 */4 * * *': 'Every 4 hours',
            '0 */6 * * *': 'Every 6 hours',
            '0 */12 * * *': 'Every 12 hours',
            '0 0 * * *': 'Daily at midnight',
            '0 12 * * *': 'Daily at noon'
        };
        return patterns[cron] || 'Unknown pattern';
    }

    async quickSchedule(timeOffset) {
        const defaultChatId = '-1002330414734'; // Use default from env
        const now = new Date();
        let scheduledTime;
        
        switch(timeOffset) {
            case '1h': scheduledTime = new Date(now.getTime() + 60 * 60 * 1000); break;
            case '3h': scheduledTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); break;
            case '12h': scheduledTime = new Date(now.getTime() + 12 * 60 * 60 * 1000); break;
            case '24h': scheduledTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); break;
            default: return;
        }

        const eventData = {
            chatId: defaultChatId,
            scheduledTime: scheduledTime.toISOString(),
            eventName: `Quick Event (${timeOffset})`,
            eventPrize: 50000,
            maxPlayers: 50,
            survivors: 3
        };

        try {
            const response = await fetch('/api/admin/schedules/events', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventData)
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification(`Event scheduled for ${scheduledTime.toLocaleString()}`, 'success');
                this.showSchedules(); // Refresh the view
            } else {
                this.showNotification(result.error || 'Failed to schedule event', 'error');
            }
        } catch (error) {
            console.error('Error scheduling event:', error);
            this.showNotification('Failed to schedule event', 'error');
        }
    }

    showCreateScheduleForm() {
        const modalContent = `
            <div class="space-y-4">
                <h3 class="text-lg font-semibold text-gray-900">Schedule New Event</h3>
                <form id="schedule-form" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Chat ID</label>
                        <input type="text" id="schedule-chatid" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                               value="-1002330414734" required>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Event Name</label>
                        <input type="text" id="schedule-name" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                               placeholder="Enter event name" required>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Scheduled Time</label>
                        <input type="datetime-local" id="schedule-time" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                               required>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Prize (tokens)</label>
                            <input type="number" id="schedule-prize" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                                   value="100000" min="1000" max="1000000">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Max Players</label>
                            <input type="number" id="schedule-maxplayers" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                                   value="50" min="2" max="100">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Survivors</label>
                            <input type="number" id="schedule-survivors" class="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                                   value="3" min="1" max="10">
                        </div>
                    </div>
                    
                    <div class="flex space-x-2">
                        <button type="submit" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700">
                            Schedule Event
                        </button>
                        <button type="button" onclick="dashboard.showSchedules()" 
                                class="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400">
                            Back
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.getElementById('modal-content').innerHTML = modalContent;
        
        // Set minimum time to 1 hour from now
        const minTime = new Date(Date.now() + 60 * 60 * 1000);
        document.getElementById('schedule-time').min = minTime.toISOString().slice(0, 16);
        
        document.getElementById('schedule-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createScheduledEvent();
        });
    }

    async createScheduledEvent() {
        const formData = {
            chatId: document.getElementById('schedule-chatid').value,
            eventName: document.getElementById('schedule-name').value,
            scheduledTime: document.getElementById('schedule-time').value,
            eventPrize: parseInt(document.getElementById('schedule-prize').value),
            maxPlayers: parseInt(document.getElementById('schedule-maxplayers').value),
            survivors: parseInt(document.getElementById('schedule-survivors').value)
        };

        try {
            const response = await fetch('/api/admin/schedules/events', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification('Event scheduled successfully', 'success');
                this.showSchedules(); // Go back to schedules view
            } else {
                this.showNotification(result.error || 'Failed to schedule event', 'error');
            }
        } catch (error) {
            console.error('Error scheduling event:', error);
            this.showNotification('Failed to schedule event', 'error');
        }
    }

    async cancelEvent(eventId) {
        if (!confirm('Are you sure you want to cancel this event?')) return;
        
        try {
            const response = await fetch(`/api/admin/schedules/events/${eventId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.adminToken}` }
            });

            if (response.ok) {
                this.showNotification('Event cancelled successfully', 'success');
                this.showSchedules(); // Refresh view
            } else {
                this.showNotification('Failed to cancel event', 'error');
            }
        } catch (error) {
            console.error('Error cancelling event:', error);
            this.showNotification('Failed to cancel event', 'error');
        }
    }

    renderTopChats(topChats) {
        if (!topChats || topChats.length === 0) {
            return '<p class="text-gray-500 text-sm">No data available</p>';
        }
        
        return topChats.map((chat, index) => `
            <div class="flex items-center justify-between p-2 bg-gray-50 rounded">
                <div class="flex items-center">
                    <span class="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center mr-3">
                        ${index + 1}
                    </span>
                    <span class="font-medium">${chat.chatId}</span>
                </div>
                <div class="text-right">
                    <span class="font-bold text-blue-600">${chat.count}</span>
                    <span class="text-gray-500 text-sm ml-1">games</span>
                </div>
            </div>
        `).join('');
    }

    initializeAnalyticsCharts(data) {
        this.createGamesChart(data);
        this.createStatesChart(data);
        this.updateSystemStatsInAnalytics();
    }

    createGamesChart(data) {
        const ctx = document.getElementById('games-chart');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.gamesChart) {
            this.gamesChart.destroy();
        }

        const gamesByHour = data.gamesByHour || [];
        const labels = gamesByHour.map((_, index) => {
            const hoursAgo = gamesByHour.length - 1 - index;
            return hoursAgo === 0 ? 'Now' : `-${hoursAgo}h`;
        });

        this.gamesChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Games',
                    data: gamesByHour,
                    borderColor: 'rgb(59, 130, 246)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
    }

    createStatesChart(data) {
        const ctx = document.getElementById('states-chart');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.statesChart) {
            this.statesChart.destroy();
        }

        const gamesByState = data.gamesByState || {};
        const labels = Object.keys(gamesByState);
        const values = Object.values(gamesByState);
        
        if (labels.length === 0) {
            // Show empty state
            const chart_container = ctx.parentElement;
            chart_container.innerHTML = '<p class="text-gray-500 text-center py-8">No data available</p>';
            return;
        }

        const colors = [
            'rgba(34, 197, 94, 0.8)',   // green
            'rgba(59, 130, 246, 0.8)',  // blue
            'rgba(245, 158, 11, 0.8)',  // yellow
            'rgba(239, 68, 68, 0.8)',   // red
            'rgba(139, 69, 19, 0.8)'    // brown
        ];

        this.statesChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels.map(label => label.charAt(0) + label.slice(1).toLowerCase()),
                datasets: [{
                    data: values,
                    backgroundColor: colors.slice(0, labels.length),
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 12,
                            font: {
                                size: 11
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return `${context.label}: ${context.parsed} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    updateSystemStatsInAnalytics() {
        if (this.systemStats) {
            if (this.systemStats.uptime) {
                const hours = Math.floor(this.systemStats.uptime / 3600);
                const minutes = Math.floor((this.systemStats.uptime % 3600) / 60);
                const uptimeEl = document.getElementById('system-uptime-analytics');
                if (uptimeEl) uptimeEl.textContent = `${hours}h ${minutes}m`;
            }

            if (this.systemStats.memoryUsage) {
                const usedMB = Math.round(this.systemStats.memoryUsage.heapUsed / 1024 / 1024);
                const totalMB = Math.round(this.systemStats.memoryUsage.heapTotal / 1024 / 1024);
                const memoryEl = document.getElementById('memory-usage-analytics');
                if (memoryEl) memoryEl.textContent = `${usedMB}/${totalMB}MB`;
            }

            const connectionsEl = document.getElementById('connections-analytics');
            if (connectionsEl) connectionsEl.textContent = this.systemStats.activeGames || 0;
        }
    }

    setAnalyticsPeriod(period) {
        if (!this.currentAnalyticsData) return;
        
        // Update button states
        document.querySelectorAll('[id^="period-"]').forEach(btn => {
            btn.className = 'px-3 py-1 text-sm rounded-lg bg-gray-200 text-gray-700';
        });
        document.getElementById(`period-${period}`).className = 'px-3 py-1 text-sm rounded-lg bg-blue-600 text-white';
        
        // Update data
        const data = this.currentAnalyticsData[period];
        if (!data) return;
        
        // Update overview cards
        document.getElementById('analytics-total-games').textContent = data.totalGames || 0;
        document.getElementById('analytics-total-players').textContent = data.totalPlayers || 0;
        document.getElementById('analytics-total-prizes').textContent = this.formatPrize(data.totalPrizes);
        document.getElementById('analytics-avg-players').textContent = data.averagePlayersPerGame || 0;
        
        // Update top chats
        document.getElementById('top-chats').innerHTML = this.renderTopChats(data.topChats || []);
        
        // Update charts
        this.createGamesChart(data);
        this.createStatesChart(data);
        
        this.currentAnalyticsPeriod = period;
    }

    renderLogs(logs) {
        if (!logs || logs.length === 0) return '';
        
        return logs.map(log => {
            const levelColors = {
                error: 'text-red-400',
                warning: 'text-yellow-400',
                info: 'text-blue-400',
                debug: 'text-gray-400'
            };
            
            const timestamp = new Date(log.timestamp || Date.now()).toLocaleTimeString();
            const levelColor = levelColors[log.level] || 'text-white';
            
            return `
                <div class="log-entry flex text-xs" data-level="${log.level}">
                    <span class="text-gray-400 mr-2">${timestamp}</span>
                    <span class="${levelColor} mr-2 uppercase">[${log.level}]</span>
                    <span class="text-gray-300 mr-2">${log.service || 'system'}:</span>
                    <span class="text-white">${this.escapeHtml(log.message)}</span>
                </div>
            `;
        }).join('');
    }

    initializeLogControls(logs) {
        this.currentLogs = logs || [];
        this.updateLogStats();
        
        // Log level filter
        document.getElementById('log-level-filter').addEventListener('change', (e) => {
            this.filterLogs(e.target.value);
        });
        
        // Search functionality
        document.getElementById('log-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchLogs();
            }
        });
        
        // Auto-refresh
        document.getElementById('auto-refresh-logs').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startLogAutoRefresh();
            } else {
                this.stopLogAutoRefresh();
            }
        });
    }

    updateLogStats() {
        const stats = { error: 0, warning: 0, info: 0, debug: 0 };
        
        this.currentLogs.forEach(log => {
            if (stats.hasOwnProperty(log.level)) {
                stats[log.level]++;
            }
        });
        
        Object.keys(stats).forEach(level => {
            const element = document.getElementById(`${level}-count`);
            if (element) element.textContent = stats[level];
        });
    }

    filterLogs(level) {
        const logEntries = document.querySelectorAll('.log-entry');
        logEntries.forEach(entry => {
            if (!level || entry.dataset.level === level) {
                entry.style.display = 'flex';
            } else {
                entry.style.display = 'none';
            }
        });
    }

    searchLogs() {
        const searchTerm = document.getElementById('log-search').value.toLowerCase();
        const logEntries = document.querySelectorAll('.log-entry');
        
        logEntries.forEach(entry => {
            const text = entry.textContent.toLowerCase();
            if (!searchTerm || text.includes(searchTerm)) {
                entry.style.display = 'flex';
            } else {
                entry.style.display = 'none';
            }
        });
    }

    async refreshLogs() {
        try {
            const response = await fetch('/api/admin/logs?limit=100', {
                headers: this.adminToken ? { 'Authorization': `Bearer ${this.adminToken}` } : {}
            });
            const data = await response.json();
            
            document.getElementById('logs-content').innerHTML = this.renderLogs(data.logs || []);
            document.getElementById('total-logs').textContent = data.total || 0;
            
            this.currentLogs = data.logs || [];
            this.updateLogStats();
            
        } catch (error) {
            console.error('Error refreshing logs:', error);
            this.showNotification('Failed to refresh logs', 'error');
        }
    }

    clearLogs() {
        if (!confirm('Are you sure you want to clear all logs?')) return;
        
        // In a real implementation, this would call an API to clear logs
        document.getElementById('logs-content').innerHTML = '<p class="text-gray-400 text-center py-8">Logs cleared</p>';
        document.getElementById('total-logs').textContent = '0';
        
        // Reset stats
        ['error', 'warning', 'info', 'debug'].forEach(level => {
            const element = document.getElementById(`${level}-count`);
            if (element) element.textContent = '0';
        });
        
        this.showNotification('Logs cleared', 'info');
    }

    startLogAutoRefresh() {
        this.logRefreshInterval = setInterval(() => {
            this.refreshLogs();
        }, 5000);
    }

    stopLogAutoRefresh() {
        if (this.logRefreshInterval) {
            clearInterval(this.logRefreshInterval);
            this.logRefreshInterval = null;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize dashboard when page loads
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new LotteryDashboard();
});