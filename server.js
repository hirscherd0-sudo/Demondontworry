const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Generiert 8 zufällige Fallen-Felder (nicht auf Start/Safe-Zones)
function generateTrapFields() {
    const traps = [];
    const safeZones = [0, 10, 20, 30]; // Absolute Startpositionen
    // Pfad ist 0-39
    while(traps.length < 8) {
        const r = Math.floor(Math.random() * 40);
        // Nicht auf Startfeldern und nicht direkt davor
        if(!traps.includes(r) && !safeZones.includes(r)) {
            traps.push(r);
        }
    }
    return traps;
}

io.on('connection', (socket) => {
    socket.on('joinGame', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                status: 'waiting',
                host: socket.id,
                trapFields: generateTrapFields(),
                turnIndex: 0
            };
        }
        const room = rooms[roomId];

        if (room.status === 'playing') {
            socket.emit('errorMsg', 'Spiel läuft bereits!');
            return;
        }

        if (room.players.length < 4) {
            const colors = ['red', 'blue', 'green', 'yellow']; // Rot, Blau, Grün, Gelb
            const playerColor = colors[room.players.length];
            
            const player = {
                id: socket.id,
                color: playerColor,
                isBot: false,
                name: `Spieler ${room.players.length + 1}`
            };
            room.players.push(player);

            io.to(roomId).emit('lobbyUpdate', {
                players: room.players,
                isHost: room.host === socket.id,
                hostId: room.host
            });

            socket.emit('joinedLobby', { 
                color: playerColor, 
                isHost: room.host === socket.id 
            });
        }
    });

    socket.on('requestStartGame', (roomId) => {
        const room = rooms[roomId];
        if(!room || room.host !== socket.id) return;

        // Bots auffüllen
        const colors = ['red', 'blue', 'green', 'yellow'];
        while(room.players.length < 4) {
            const nextColor = colors[room.players.length];
            room.players.push({
                id: 'BOT_' + Date.now() + Math.random(),
                color: nextColor,
                isBot: true,
                name: 'Geister-Bot'
            });
        }

        room.status = 'playing';
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            trapFields: room.trapFields
        });
    });

    socket.on('rollDice', ({ roomId }) => {
        // Server entscheidet Würfelzahl für Fairness
        const val = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('diceRolled', { 
            playerId: socket.id, 
            value: val 
        });
    });

    socket.on('movePiece', ({ roomId, pieceId, newPosition, isFinished }) => {
        io.to(roomId).emit('pieceMoved', { 
            playerId: socket.id, 
            pieceId: pieceId, 
            newPosition: newPosition,
            isFinished: isFinished
        });
    });

    socket.on('endTurn', ({ roomId }) => {
        const room = rooms[roomId];
        if(room) {
            room.turnIndex = (room.turnIndex + 1) % 4;
            io.to(roomId).emit('turnChanged', { 
                activeColor: room.players[room.turnIndex].color,
                isBot: room.players[room.turnIndex].isBot
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});


