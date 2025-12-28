const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Konstante für Timer
const TURN_TIME_LIMIT = 10000; // 10 Sekunden

function generateTrapFields() {
    const traps = [];
    const safeZones = [0, 10, 20, 30]; 
    while(traps.length < 8) {
        const r = Math.floor(Math.random() * 40);
        if(!traps.includes(r) && !safeZones.includes(r)) {
            traps.push(r);
        }
    }
    return traps;
}

// Hilfsfunktion: Zugwechsel mit Timer
function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;

    // Alten Timer löschen
    if(room.timer) clearTimeout(room.timer);

    // Nächster Spieler
    room.turnIndex = (room.turnIndex + 1) % 4;
    
    // Checken ob Slot belegt ist (falls Spieler rausgehen), sonst überspringen
    // (Vereinfacht: Wir nehmen an, Slots sind fix durch Bots oder Spieler belegt)

    const activePlayer = room.players[room.turnIndex];

    io.to(roomId).emit('turnChanged', { 
        activeColor: activePlayer.color,
        isBot: activePlayer.isBot,
        timeoutDuration: TURN_TIME_LIMIT
    });

    // Neuen Timer starten (Server Authority)
    room.timer = setTimeout(() => {
        // Zeit abgelaufen!
        io.to(roomId).emit('timeoutOccurred', { 
            message: `Zeit abgelaufen für ${activePlayer.name}!` 
        });
        // Nächster dran
        nextTurn(roomId);
    }, TURN_TIME_LIMIT);
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
                turnIndex: -1, // Startet bei Spielbeginn
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
                name: 'Horror Bot'
            });
        }

        room.status = 'playing';
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            trapFields: room.trapFields
        });

        // Ersten Zug starten
        room.turnIndex = -1; // Damit nextTurn auf 0 springt
        nextTurn(roomId);
    });

    socket.on('rollDice', ({ roomId }) => {
        const room = rooms[roomId];
        if(!room) return;

        // Timer stoppen, da Aktion erfolgt ist
        if(room.timer) clearTimeout(room.timer);

        const val = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('diceRolled', { 
            playerId: socket.id, 
            value: val 
        });
        
        // Timer wird NICHT neu gestartet. Wir warten auf 'movePiece' oder 'endTurn'.
        // Damit man nicht ewig wartet, könnte man hier einen "Move Timer" starten.
        // Für dieses Beispiel lassen wir den Move Timer weg, da der Roll Timer das wichtigste war.
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
        // Zug beenden und Timer für nächsten Spieler starten
        nextTurn(roomId);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});


