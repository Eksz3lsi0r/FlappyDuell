const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname)));

// Game state management
class GameRoom {
    constructor(player1, player2) {
        this.id = uuidv4();
        this.players = [player1, player2];
        this.gameState = 'countdown'; // countdown, playing, finished
        this.scores = { [player1.id]: 0, [player2.id]: 0 };
        this.gameData = {
            pipes: [],
            gameStartTime: null,
            seed: Math.random() // For synchronized pipe generation
        };
        this.rematchVotes = new Set();

        // Set room reference for players
        player1.room = this;
        player2.room = this;

        console.log(`New room created: ${this.id}`);
        this.startCountdown();
    }

    startCountdown() {
        this.broadcast({
            type: 'matchFound',
            opponent: this.getOpponentName(this.players[0])
        });

        let countdown = 3;
        const countdownTimer = setInterval(() => {
            this.broadcast({
                type: 'countdown',
                count: countdown
            });

            countdown--;
            if (countdown < 0) {
                clearInterval(countdownTimer);
                this.startGame();
            }
        }, 1000);
    }

    startGame() {
        this.gameState = 'playing';
        this.gameData.gameStartTime = Date.now();
        this.broadcast({
            type: 'gameStart',
            seed: this.gameData.seed
        });
    }

    handlePlayerMove(playerId, birdY, velocity, score) {
        // Update player state
        this.scores[playerId] = score;

        // Broadcast to opponent
        const opponent = this.players.find(p => p.id !== playerId);
        if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
            opponent.ws.send(JSON.stringify({
                type: 'opponentMove',
                birdY: birdY,
                velocity: velocity,
                score: score
            }));
        }
    }

    handlePlayerDeath(playerId) {
        if (this.gameState !== 'playing') return;

        this.gameState = 'finished';
        const winner = this.players.find(p => p.id !== playerId);
        const loser = this.players.find(p => p.id === playerId);

        this.broadcast({
            type: 'gameOver',
            winner: winner.name,
            loser: loser.name,
            finalScores: this.scores
        });
    }

    handleRematchVote(playerId) {
        this.rematchVotes.add(playerId);

        if (this.rematchVotes.size === 2) {
            // Both players want rematch
            this.rematchVotes.clear();
            this.scores = { [this.players[0].id]: 0, [this.players[1].id]: 0 };
            this.gameData.seed = Math.random();
            this.gameState = 'countdown';
            this.startCountdown();
        } else {
            // Notify other player about rematch vote
            const opponent = this.players.find(p => p.id !== playerId);
            if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
                opponent.ws.send(JSON.stringify({
                    type: 'rematchVote',
                    playerName: this.players.find(p => p.id === playerId).name
                }));
            }
        }
    }

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
            this.players.splice(playerIndex, 1);

            // Notify remaining player
            if (this.players.length > 0) {
                const remainingPlayer = this.players[0];
                if (remainingPlayer.ws.readyState === WebSocket.OPEN) {
                    remainingPlayer.ws.send(JSON.stringify({
                        type: 'opponentDisconnected'
                    }));
                }
            }
        }

        return this.players.length === 0;
    }

    getOpponentName(player) {
        const opponent = this.players.find(p => p.id !== player.id);
        return opponent ? opponent.name : 'Unknown';
    }

    broadcast(message) {
        this.players.forEach(player => {
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify(message));
            }
        });
    }
}

// Player management
const waitingPlayers = [];
const activeRooms = new Map();

class Player {
    constructor(ws) {
        this.id = uuidv4();
        this.ws = ws;
        this.name = `Player${Math.floor(Math.random() * 9999)}`;
        this.room = null;
    }
}

function findMatch(player) {
    if (waitingPlayers.length > 0) {
        const opponent = waitingPlayers.shift();
        const room = new GameRoom(player, opponent);
        activeRooms.set(room.id, room);
        return room;
    } else {
        waitingPlayers.push(player);
        player.ws.send(JSON.stringify({
            type: 'searching',
            message: 'Suche nach Gegner...'
        }));
        return null;
    }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    const player = new Player(ws);
    console.log(`Player connected: ${player.id}`);

    // Send player info
    ws.send(JSON.stringify({
        type: 'connected',
        playerId: player.id,
        playerName: player.name
    }));

    // Start matchmaking immediately
    findMatch(player);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'playerMove':
                    if (player.room) {
                        player.room.handlePlayerMove(
                            player.id,
                            data.birdY,
                            data.velocity,
                            data.score
                        );
                    }
                    break;

                case 'playerDeath':
                    if (player.room) {
                        player.room.handlePlayerDeath(player.id);
                    }
                    break;

                case 'rematch':
                    if (player.room) {
                        player.room.handleRematchVote(player.id);
                    }
                    break;

                case 'searchNewMatch':
                    // Remove from current room if exists
                    if (player.room) {
                        const roomEmpty = player.room.removePlayer(player.id);
                        if (roomEmpty) {
                            activeRooms.delete(player.room.id);
                        }
                        player.room = null;
                    }

                    // Start new matchmaking
                    findMatch(player);
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected: ${player.id}`);

        // Remove from waiting list
        const waitingIndex = waitingPlayers.findIndex(p => p.id === player.id);
        if (waitingIndex !== -1) {
            waitingPlayers.splice(waitingIndex, 1);
        }

        // Remove from room
        if (player.room) {
            const roomEmpty = player.room.removePlayer(player.id);
            if (roomEmpty) {
                activeRooms.delete(player.room.id);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Game available at http://localhost:${PORT}`);
});

// Cleanup inactive rooms periodically
setInterval(() => {
    activeRooms.forEach((room, roomId) => {
        const activePlayers = room.players.filter(p => p.ws.readyState === WebSocket.OPEN);
        if (activePlayers.length === 0) {
            activeRooms.delete(roomId);
            console.log(`Cleaned up empty room: ${roomId}`);
        }
    });
}, 30000); // Clean up every 30 seconds
