const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const TURN_TIMEOUT = 10000; // 10 Sekunden

function generateTrapFields() {
    const traps = [];
    const safeZones = [0, 10, 20, 30]; 
    while(traps.length < 8) {
        const r = Math.floor(Math.random() * 40);
        if(!traps.includes(r) && !safeZones.includes(r)) traps.push(r);
    }
    return traps;
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;

    // Alten Timer löschen
    if(room.timer) clearTimeout(room.timer);

    // Nächster Spieler
    room.turnIndex = (room.turnIndex + 1) % 4;
    const activePlayer = room.players[room.turnIndex];

    // Info an alle senden
    io.to(roomId).emit('turnChanged', { 
        activeColor: activePlayer.color,
        activePlayerId: activePlayer.id,
        activeName: activePlayer.name,
        isBot: activePlayer.isBot
    });

    // Neuen Timer starten (Nur fürs Würfeln)
    room.timer = setTimeout(() => {
        io.to(roomId).emit('statusMessage', { msg: `Zeit abgelaufen für ${activePlayer.name}!` });
        nextTurn(roomId);
    }, TURN_TIMEOUT);
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
                turnIndex: -1,
                timer: null
            };
        }
        const room = rooms[roomId];

        if (room.status === 'playing') {
            socket.emit('errorMsg', 'Spiel läuft bereits!');
            return;
        }

        if (room.players.length < 4) {
            const colors = ['red', 'blue', 'green', 'yellow'];
            const playerColor = colors[room.players.length];
            const figures = {'red': 'Puppe', 'blue': 'Kreuz', 'green': 'Grabstein', 'yellow': 'Geist'};
            
            const player = {
                id: socket.id,
                color: playerColor,
                isBot: false,
                name: `Spieler ${room.players.length + 1}`,
                figure: figures[playerColor]
            };
            room.players.push(player);

            // Update Lobby
            io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host });

            // Identität an den neuen Spieler senden
            socket.emit('setIdentity', { 
                color: playerColor, 
                figure: figures[playerColor],
                isHost: room.host === socket.id 
            });
        }
    });

    socket.on('requestStartGame', (roomId) => {
        const room = rooms[roomId];
        if(!room || room.host !== socket.id) return;

        // Bots auffüllen
        const colors = ['red', 'blue', 'green', 'yellow'];
        const figures = {'red': 'Puppe', 'blue': 'Kreuz', 'green': 'Grabstein', 'yellow': 'Geist'};
        
        while(room.players.length < 4) {
            const c = colors[room.players.length];
            room.players.push({
                id: 'BOT_' + Math.random(),
                color: c,
                isBot: true,
                name: 'Bot ' + figures[c],
                figure: figures[c]
            });
        }

        room.status = 'playing';
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            trapFields: room.trapFields
        });

        // Starten
        room.turnIndex = -1;
        nextTurn(roomId);
    });

    socket.on('rollDice', ({ roomId }) => {
        const room = rooms[roomId];
        if(!room) return;
        
        // Timer stoppen, da gewürfelt wurde
        if(room.timer) clearTimeout(room.timer);
        
        const val = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('diceRolled', { playerId: socket.id, value: val });
        
        // Optional: Move Timer starten, damit Spiel nicht hängt wenn einer nicht zieht
        // (Für dieses Beispiel lassen wir es beim Würfeltimer)
    });

    socket.on('movePiece', ({ roomId, pieceId, newPosition }) => {
        io.to(roomId).emit('pieceMoved', { 
            playerId: socket.id, 
            pieceId: pieceId, 
            newPosition: newPosition 
        });
    });

    socket.on('endTurn', ({ roomId }) => {
        nextTurn(roomId);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});

