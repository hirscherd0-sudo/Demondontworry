const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Globale Speicher
const rooms = {};
const socketRoomMap = {}; // Map socketId -> roomId für schnellen Disconnect
const TURN_TIMEOUT = 25000; // 25s Zeit (genug für 3x Würfeln)

function generateTrapFields() {
    const traps = [];
    // Safezones (Startfelder und Zielgeraden-Eingänge) schützen
    const safeZones = [0, 10, 20, 30, 9, 19, 29, 39]; 
    while(traps.length < 8) {
        const r = Math.floor(Math.random() * 40);
        if(!traps.includes(r) && !safeZones.includes(r)) traps.push(r);
    }
    return traps;
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    if(room.timer) clearTimeout(room.timer);

    // Nächster Spieler
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const activePlayer = room.players[room.turnIndex];

    io.to(roomId).emit('turnChanged', { 
        activeColor: activePlayer.color,
        activeName: activePlayer.name,
        isBot: activePlayer.isBot,
        timeout: TURN_TIMEOUT / 1000
    });

    // Server Timer erzwingt Zugende
    room.timer = setTimeout(() => {
        io.to(roomId).emit('statusMessage', { msg: `Zeit abgelaufen für ${activePlayer.name}!` });
        nextTurn(roomId);
    }, TURN_TIMEOUT);
}

io.on('connection', (socket) => {
    
    socket.on('joinGame', (roomId) => {
        // Cleanup Logic: Wenn Raum existiert aber leer ist (oder nur Bots), löschen
        if (rooms[roomId]) {
            const humans = rooms[roomId].players.filter(p => !p.isBot);
            if (humans.length === 0) {
                console.log(`Raum ${roomId} war verwaist. Reset.`);
                delete rooms[roomId];
            }
        }

        socket.join(roomId);
        socketRoomMap[socket.id] = roomId;

        // Raum erstellen
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

        // Check ob Spiel läuft
        if (room.status === 'playing') {
            socket.emit('errorMsg', 'Das Spiel läuft bereits! Bitte wähle einen anderen Raumnamen.');
            return;
        }

        // Spielerlimit
        if (room.players.length < 4) {
            const colors = ['red', 'blue', 'green', 'yellow'];
            const figures = {'red': 'Mörder-Puppe', 'blue': 'Grabkreuz', 'green': 'Grabstein', 'yellow': 'Poltergeist'};
            const c = colors[room.players.length];
            
            const p = { 
                id: socket.id, 
                color: c, 
                isBot: false, 
                name: `Spieler ${room.players.length + 1}`, 
                figure: figures[c] 
            };
            room.players.push(p);

            // Identität senden
            socket.emit('setIdentity', { color: c, figure: figures[c], isHost: room.host === socket.id });
            
            // Lobby Update an alle
            io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host });
        } else {
            socket.emit('errorMsg', 'Der Raum ist voll!');
        }
    });

    socket.on('requestStartGame', (roomId) => {
        const room = rooms[roomId];
        if(!room) return;
        if(room.host !== socket.id) return; // Nur Host darf starten

        // Bots auffüllen
        const colors = ['red', 'blue', 'green', 'yellow'];
        const figures = {'red': 'Mörder-Puppe', 'blue': 'Grabkreuz', 'green': 'Grabstein', 'yellow': 'Poltergeist'};
        
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
        
        // Spielstart
        room.turnIndex = -1;
        nextTurn(roomId);
    });

    socket.on('rollDice', ({ roomId }) => {
        const room = rooms[roomId];
        if(room) {
            // Timer pausieren/resetten
            if(room.timer) clearTimeout(room.timer);
            // Zufallswert
            const val = Math.floor(Math.random() * 6) + 1;
            io.to(roomId).emit('diceRolled', { playerId: socket.id, value: val });
        }
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

    socket.on('disconnect', () => {
        const roomId = socketRoomMap[socket.id];
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            
            // Host Migration oder Löschen
            const humans = room.players.filter(p => !p.isBot);
            if (humans.length === 0) {
                if(room.timer) clearTimeout(room.timer);
                delete rooms[roomId];
            } else if (room.host === socket.id) {
                room.host = humans[0].id;
                io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host });
                // Neuem Host Bescheid geben
                const s = io.sockets.sockets.get(room.host);
                if(s) s.emit('youAreHost');
            } else {
                io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host });
            }
        }
        delete socketRoomMap[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));


