const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const socketRoomMap = {};
const TURN_TIMEOUT = 20000;

function generateTrapFields() {
    const traps = [];
    // Sichere Felder: Start (0,10,20,30) + Felder davor/danach und Safe-Zones
    const safeZones = [0, 10, 20, 30, 9, 19, 29, 39, 1, 11, 21, 31]; 
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

    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const activePlayer = room.players[room.turnIndex];

    io.to(roomId).emit('turnChanged', { 
        activeColor: activePlayer.color,
        activeName: activePlayer.name,
        isBot: activePlayer.isBot,
        timeout: TURN_TIMEOUT / 1000
    });

    room.timer = setTimeout(() => {
        io.to(roomId).emit('statusMessage', { msg: `Zeit abgelaufen für ${activePlayer.name}!` });
        nextTurn(roomId);
    }, TURN_TIMEOUT);
}

io.on('connection', (socket) => {
    socket.on('joinGame', (roomId) => {
        // Aufräumen falls leer
        if (rooms[roomId] && rooms[roomId].players.filter(p => !p.isBot).length === 0) {
            delete rooms[roomId];
        }

        socket.join(roomId);
        socketRoomMap[socket.id] = roomId;

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
            const figures = {'red': 'Puppe', 'blue': 'Kreuz', 'green': 'Grabstein', 'yellow': 'Geist'};
            const c = colors[room.players.length];
            
            const p = { id: socket.id, color: c, isBot: false, name: `Spieler ${room.players.length + 1}`, figure: figures[c] };
            room.players.push(p);

            socket.emit('setIdentity', { color: c, figure: figures[c], isHost: room.host === socket.id });
            io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host });
        } else {
            socket.emit('errorMsg', 'Raum voll!');
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
            room.players.push({ id: 'BOT_'+Math.random(), color: c, isBot: true, name: 'Bot', figure: figures[c] });
        }

        room.status = 'playing';
        io.to(roomId).emit('gameStarted', { players: room.players, trapFields: room.trapFields });
        
        room.turnIndex = -1;
        nextTurn(roomId);
    });

    socket.on('rollDice', ({ roomId }) => {
        const room = rooms[roomId];
        if(room) {
            if(room.timer) clearTimeout(room.timer);
            const val = Math.floor(Math.random() * 6) + 1;
            io.to(roomId).emit('diceRolled', { playerId: socket.id, value: val });
        }
    });

    socket.on('movePiece', ({ roomId, pieceId, newPosition }) => {
        io.to(roomId).emit('pieceMoved', { playerId: socket.id, pieceId, newPosition });
    });

    socket.on('endTurn', ({ roomId }) => nextTurn(roomId));

    socket.on('disconnect', () => {
        const roomId = socketRoomMap[socket.id];
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.filter(p => !p.isBot).length === 0) {
                if(room.timer) clearTimeout(room.timer);
                delete rooms[roomId];
            } else {
                if(room.host === socket.id) {
                     const next = room.players.find(p=>!p.isBot);
                     if(next) { room.host = next.id; io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host }); }
                } else {
                    io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host });
                }
            }
        }
        delete socketRoomMap[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));


