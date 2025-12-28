const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Hilfsfunktion: Zufällige Fragen-Felder generieren (nicht auf Start/Haus)
function generateTrapFields() {
    const traps = [];
    while(traps.length < 8) {
        // Pfad ist index 0-39. Vermeide Startfelder (0, 10, 20, 30) und erste Schritte (1, 11, 21, 31)
        const r = Math.floor(Math.random() * 40);
        const safeZones = [0, 1, 10, 11, 20, 21, 30, 31];
        if(!traps.includes(r) && !safeZones.includes(r)) {
            traps.push(r);
        }
    }
    return traps;
}

io.on('connection', (socket) => {
    console.log('Geist verbunden:', socket.id);

    socket.on('joinGame', (roomId) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                status: 'waiting', // waiting, playing
                host: socket.id,
                trapFields: generateTrapFields(),
                turnIndex: 0
            };
        }

        const room = rooms[roomId];

        if (room.status === 'playing') {
            socket.emit('errorMsg', 'Das Spiel läuft bereits!');
            return;
        }

        if (room.players.length < 4) {
            const colors = ['red', 'blue', 'green', 'yellow'];
            const playerColor = colors[room.players.length];
            
            const player = {
                id: socket.id,
                color: playerColor,
                isBot: false,
                name: `Spieler ${room.players.length + 1}`
            };
            room.players.push(player);

            // Update an alle: Wer ist da?
            io.to(roomId).emit('lobbyUpdate', {
                players: room.players,
                isHost: room.host === socket.id,
                hostId: room.host
            });

            // Persönliche Info
            socket.emit('joinedLobby', { 
                color: playerColor, 
                isHost: room.host === socket.id 
            });

        } else {
            socket.emit('errorMsg', 'Die Krypta ist voll (4 Spieler)!');
        }
    });

    // Nur der Host kann das starten
    socket.on('requestStartGame', (roomId) => {
        const room = rooms[roomId];
        if(!room) return;
        if(room.host !== socket.id) return;

        // Fülle restliche Plätze mit Bots
        const colors = ['red', 'blue', 'green', 'yellow'];
        while(room.players.length < 4) {
            const nextColor = colors[room.players.length];
            room.players.push({
                id: 'BOT_' + Date.now() + Math.random(),
                color: nextColor,
                isBot: true,
                name: 'Horror Bot'
            });
        }

        room.status = 'playing';
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            trapFields: room.trapFields
        });
    });

    socket.on('rollDice', ({ roomId, diceValue }) => {
        io.to(roomId).emit('diceRolled', { 
            playerId: socket.id, 
            value: diceValue 
        });
    });

    socket.on('movePiece', ({ roomId, pieceId, newPosition, isFinished }) => {
        io.to(roomId).emit('pieceMoved', { 
            playerId: socket.id, 
            pieceId: pieceId, // 0-3
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

    socket.on('disconnect', () => {
        // Simple Logic: Wenn Host geht, Raum kaputt (für Demo ok)
        // Besser wäre: Nächsten Spieler zum Host machen
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Pforte zur Hölle geöffnet auf Port ${PORT}`);
});


