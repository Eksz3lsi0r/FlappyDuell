// Flappy Duell - Multiplayer Flappy Bird Game
class FlappyDuell {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        // WebSocket connection
        this.ws = null;
        this.playerId = null;
        this.playerName = '';
        this.opponentName = '';

        // Game state
        this.gameState = 'connecting'; // connecting, searching, countdown, playing, gameOver
        this.gameRunning = false;
        this.seed = 0;

        // Bird properties
        this.bird = {
            x: 100,
            y: this.canvas.height / 2,
            velocity: 0,
            gravity: 0.6,
            jumpStrength: -12,
            size: 20
        };

        // Opponent bird
        this.opponentBird = {
            x: 100,
            y: this.canvas.height / 2,
            velocity: 0,
            size: 20
        };

        // Pipes
        this.pipes = [];
        this.pipeWidth = 60;
        this.pipeGap = 150;
        this.pipeSpeed = 3;

        // Score
        this.score = 0;
        this.opponentScore = 0;

        // Screen elements
        this.screens = {
            connection: document.getElementById('connectionScreen'),
            matchmaking: document.getElementById('matchmakingScreen'),
            matchFound: document.getElementById('matchFoundScreen'),
            gameUI: document.getElementById('gameUI'),
            gameOver: document.getElementById('gameOverScreen'),
            disconnection: document.getElementById('disconnectionScreen')
        };

        // UI elements
        this.elements = {
            playerName: document.getElementById('playerName'),
            matchmakingText: document.getElementById('matchmakingText'),
            player1Name: document.getElementById('player1Name'),
            player2Name: document.getElementById('player2Name'),
            countdownDisplay: document.getElementById('countdownDisplay'),
            yourName: document.getElementById('yourName'),
            opponentName: document.getElementById('opponentName'),
            yourScore: document.getElementById('yourScore'),
            opponentScore: document.getElementById('opponentScore'),
            gameResult: document.getElementById('gameResult'),
            finalYourName: document.getElementById('finalYourName'),
            finalOpponentName: document.getElementById('finalOpponentName'),
            finalYourScore: document.getElementById('finalYourScore'),
            finalOpponentScore: document.getElementById('finalOpponentScore'),
            rematchBtn: document.getElementById('rematchBtn'),
            newMatchBtn: document.getElementById('newMatchBtn'),
            rematchStatus: document.getElementById('rematchStatus'),
            reconnectBtn: document.getElementById('reconnectBtn'),
            connectionStatus: document.getElementById('connectionStatus')
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.connectToServer();
        this.gameLoop();
    }

    setupEventListeners() {
        // Jump controls
        this.canvas.addEventListener('click', () => this.jump());
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.code === 'ArrowUp') {
                e.preventDefault();
                this.jump();
            }
        });

        // UI buttons
        this.elements.rematchBtn.addEventListener('click', () => this.requestRematch());
        this.elements.newMatchBtn.addEventListener('click', () => this.searchNewMatch());
        this.elements.reconnectBtn.addEventListener('click', () => this.connectToServer());
    }

    connectToServer() {
        this.showScreen('connection');

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to server');
            this.updateConnectionStatus(true);
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus(false);
            // Try to reconnect after 3 seconds if not intentionally disconnected
            if (this.gameState !== 'connecting') {
                setTimeout(() => this.connectToServer(), 3000);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus(false);
        };
    }

    handleServerMessage(data) {
        switch (data.type) {
            case 'connected':
                this.playerId = data.playerId;
                this.playerName = data.playerName;
                this.elements.playerName.textContent = this.playerName;
                break;

            case 'searching':
                this.gameState = 'searching';
                this.showScreen('matchmaking');
                this.elements.matchmakingText.textContent = data.message;
                break;

            case 'matchFound':
                this.opponentName = data.opponent;
                this.elements.player1Name.textContent = this.playerName;
                this.elements.player2Name.textContent = this.opponentName;
                this.showScreen('matchFound');
                break;

            case 'countdown':
                this.elements.countdownDisplay.textContent = data.count;
                if (data.count === 0) {
                    this.elements.countdownDisplay.textContent = 'GO!';
                }
                break;

            case 'gameStart':
                this.startGame(data.seed);
                break;

            case 'opponentMove':
                this.updateOpponent(data.birdY, data.velocity, data.score);
                break;

            case 'gameOver':
                this.handleGameOver(data);
                break;

            case 'rematchVote':
                this.showRematchVote(data.playerName);
                break;

            case 'opponentDisconnected':
                this.handleOpponentDisconnected();
                break;
        }
    }

    startGame(seed) {
        this.gameState = 'playing';
        this.gameRunning = true;
        this.seed = seed;
        this.score = 0;
        this.opponentScore = 0;

        // Reset bird position
        this.bird.y = this.canvas.height / 2;
        this.bird.velocity = 0;
        this.opponentBird.y = this.canvas.height / 2;
        this.opponentBird.velocity = 0;

        // Reset pipes
        this.pipes = [];
        this.generateInitialPipes();

        // Update UI
        this.elements.yourName.textContent = this.playerName;
        this.elements.opponentName.textContent = this.opponentName;
        this.updateScoreDisplay();

        this.showScreen('game');
    }

    jump() {
        if (this.gameState === 'playing' && this.gameRunning) {
            this.bird.velocity = this.bird.jumpStrength;
        }
    }

    updateGame() {
        if (!this.gameRunning) return;

        // Update bird physics
        this.bird.velocity += this.bird.gravity;
        this.bird.y += this.bird.velocity;

        // Check boundaries
        if (this.bird.y + this.bird.size > this.canvas.height || this.bird.y < 0) {
            this.playerDied();
            return;
        }

        // Update pipes
        this.updatePipes();

        // Check pipe collisions
        if (this.checkCollisions()) {
            this.playerDied();
            return;
        }

        // Send player state to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'playerMove',
                birdY: this.bird.y,
                velocity: this.bird.velocity,
                score: this.score
            }));
        }
    }

    updatePipes() {
        // Move pipes
        for (let pipe of this.pipes) {
            pipe.x -= this.pipeSpeed;

            // Check scoring
            if (!pipe.scored && pipe.x + this.pipeWidth < this.bird.x) {
                pipe.scored = true;
                this.score++;
                this.updateScoreDisplay();
            }
        }

        // Remove off-screen pipes
        this.pipes = this.pipes.filter(pipe => pipe.x + this.pipeWidth > -50);

        // Generate new pipes
        if (this.pipes.length === 0 || this.pipes[this.pipes.length - 1].x < this.canvas.width - 300) {
            this.generatePipe();
        }
    }

    generateInitialPipes() {
        // Generate first set of pipes using seed for synchronization
        const rng = this.seedRandom(this.seed);
        for (let i = 0; i < 3; i++) {
            const x = this.canvas.width + i * 300;
            const gapY = rng() * (this.canvas.height - this.pipeGap - 100) + 50;
            this.pipes.push({
                x: x,
                gapY: gapY,
                scored: false
            });
        }
    }

    generatePipe() {
        const x = this.pipes.length > 0 ?
            this.pipes[this.pipes.length - 1].x + 300 :
            this.canvas.width;

        // Use deterministic pipe generation for synchronization
        const pipeIndex = this.pipes.length;
        const rng = this.seedRandom(this.seed + pipeIndex);
        const gapY = rng() * (this.canvas.height - this.pipeGap - 100) + 50;

        this.pipes.push({
            x: x,
            gapY: gapY,
            scored: false
        });
    }

    // Seeded random number generator for synchronized pipe generation
    seedRandom(seed) {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    checkCollisions() {
        for (let pipe of this.pipes) {
            // Check collision with top pipe
            if (this.bird.x + this.bird.size > pipe.x &&
                this.bird.x < pipe.x + this.pipeWidth &&
                this.bird.y < pipe.gapY) {
                return true;
            }

            // Check collision with bottom pipe
            if (this.bird.x + this.bird.size > pipe.x &&
                this.bird.x < pipe.x + this.pipeWidth &&
                this.bird.y + this.bird.size > pipe.gapY + this.pipeGap) {
                return true;
            }
        }
        return false;
    }

    playerDied() {
        this.gameRunning = false;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'playerDeath'
            }));
        }
    }

    updateOpponent(birdY, velocity, score) {
        this.opponentBird.y = birdY;
        this.opponentBird.velocity = velocity;
        this.opponentScore = score;
        this.updateScoreDisplay();
    }

    handleGameOver(data) {
        this.gameState = 'gameOver';
        this.gameRunning = false;

        // Update final scores
        this.elements.finalYourName.textContent = this.playerName;
        this.elements.finalOpponentName.textContent = this.opponentName;
        this.elements.finalYourScore.textContent = data.finalScores[this.playerId] || this.score;
        this.elements.finalOpponentScore.textContent = data.finalScores[Object.keys(data.finalScores).find(id => id !== this.playerId)] || this.opponentScore;

        // Show result
        if (data.winner === this.playerName) {
            this.elements.gameResult.textContent = 'Du hast gewonnen! 🎉';
            this.elements.gameResult.className = 'winner';
        } else {
            this.elements.gameResult.textContent = 'Du hast verloren 😢';
            this.elements.gameResult.className = 'loser';
        }

        this.showScreen('gameOver');
    }

    requestRematch() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'rematch'
            }));
        }
        this.elements.rematchStatus.classList.remove('hidden');
    }

    searchNewMatch() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'searchNewMatch'
            }));
        }
        this.showScreen('matchmaking');
        this.elements.matchmakingText.textContent = 'Suche nach neuem Gegner...';
    }

    showRematchVote(playerName) {
        // Show notification that opponent wants rematch
        // This could be enhanced with a toast notification
        console.log(`${playerName} möchte ein Rematch`);
    }

    handleOpponentDisconnected() {
        this.gameRunning = false;
        this.showScreen('disconnection');
    }

    updateScoreDisplay() {
        this.elements.yourScore.textContent = this.score;
        this.elements.opponentScore.textContent = this.opponentScore;
    }

    updateConnectionStatus(connected) {
        const dot = this.elements.connectionStatus.querySelector('.connection-dot');
        if (connected) {
            dot.classList.remove('disconnected');
        } else {
            dot.classList.add('disconnected');
        }
    }

    showScreen(screenName) {
        // Hide all screens
        Object.values(this.screens).forEach(screen => {
            screen.classList.add('hidden');
        });

        // Show specific screen
        switch (screenName) {
            case 'connection':
                this.screens.connection.classList.remove('hidden');
                break;
            case 'matchmaking':
                this.screens.matchmaking.classList.remove('hidden');
                break;
            case 'matchFound':
                this.screens.matchFound.classList.remove('hidden');
                break;
            case 'game':
                this.screens.gameUI.classList.remove('hidden');
                break;
            case 'gameOver':
                this.screens.gameOver.classList.remove('hidden');
                this.elements.rematchStatus.classList.add('hidden');
                break;
            case 'disconnection':
                this.screens.disconnection.classList.remove('hidden');
                break;
        }
    }

    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw background gradient
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(1, '#98FB98');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.gameState === 'playing' || this.gameState === 'gameOver') {
            // Draw pipes
            this.drawPipes();

            // Draw birds
            this.drawBird(this.bird, '#FFD700', true); // Your bird (golden)
            this.drawBird(this.opponentBird, '#FF6B6B', false); // Opponent bird (red)
        }
    }

    drawPipes() {
        this.ctx.fillStyle = '#4A4A4A';
        this.ctx.strokeStyle = '#2A2A2A';
        this.ctx.lineWidth = 2;

        for (let pipe of this.pipes) {
            // Top pipe
            this.ctx.fillRect(pipe.x, 0, this.pipeWidth, pipe.gapY);
            this.ctx.strokeRect(pipe.x, 0, this.pipeWidth, pipe.gapY);

            // Bottom pipe
            this.ctx.fillRect(pipe.x, pipe.gapY + this.pipeGap, this.pipeWidth, this.canvas.height - pipe.gapY - this.pipeGap);
            this.ctx.strokeRect(pipe.x, pipe.gapY + this.pipeGap, this.pipeWidth, this.canvas.height - pipe.gapY - this.pipeGap);

            // Pipe caps
            this.ctx.fillRect(pipe.x - 5, pipe.gapY - 20, this.pipeWidth + 10, 20);
            this.ctx.fillRect(pipe.x - 5, pipe.gapY + this.pipeGap, this.pipeWidth + 10, 20);
            this.ctx.strokeRect(pipe.x - 5, pipe.gapY - 20, this.pipeWidth + 10, 20);
            this.ctx.strokeRect(pipe.x - 5, pipe.gapY + this.pipeGap, this.pipeWidth + 10, 20);
        }
    }

    drawBird(bird, color, isPlayer) {
        this.ctx.save();

        // Draw bird body
        this.ctx.fillStyle = color;
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;

        this.ctx.beginPath();
        this.ctx.arc(bird.x + bird.size/2, bird.y + bird.size/2, bird.size/2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw wing
        this.ctx.fillStyle = isPlayer ? '#FFA500' : '#CC0000';
        this.ctx.beginPath();
        this.ctx.arc(bird.x + bird.size/2 - 3, bird.y + bird.size/2, bird.size/3, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw eye
        this.ctx.fillStyle = '#FFF';
        this.ctx.beginPath();
        this.ctx.arc(bird.x + bird.size/2 + 3, bird.y + bird.size/2 - 3, 3, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#000';
        this.ctx.beginPath();
        this.ctx.arc(bird.x + bird.size/2 + 4, bird.y + bird.size/2 - 3, 1.5, 0, Math.PI * 2);
        this.ctx.fill();

        // Draw beak
        this.ctx.fillStyle = '#FFA500';
        this.ctx.beginPath();
        this.ctx.moveTo(bird.x + bird.size, bird.y + bird.size/2);
        this.ctx.lineTo(bird.x + bird.size + 8, bird.y + bird.size/2 - 2);
        this.ctx.lineTo(bird.x + bird.size + 8, bird.y + bird.size/2 + 2);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
    }

    gameLoop() {
        this.updateGame();
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new FlappyDuell();
});
