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
// Konstanten
const SAFE_ZONES = [0, 10, 20, 30, 39, 9, 19, 29, 1, 11, 21, 31];

function generateTrapFields() {
    const traps = [];
    while(traps.length < 8) {
        const r = Math.floor(Math.random() * 40);
        if(!traps.includes(r) && !SAFE_ZONES.includes(r)) traps.push(r);
    }
    return traps;
}

// --- GAME LOGIK SERVER SEITIG ---

function nextTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    
    // Timer reset
    if(room.timer) clearTimeout(room.timer);

    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const activePlayer = room.players[room.turnIndex];
    
    // Reset Zug-Status
    room.rollCount = 0; 
    room.hasRolledSix = false;

    // Info an alle
    io.to(roomId).emit('turnChanged', { 
        activeColor: activePlayer.color,
        activeName: activePlayer.name,
        isBot: activePlayer.isBot,
        timeout: 20 // 20 Sekunden für Menschen
    });

    if (activePlayer.isBot) {
        // Bot Logik starten (Verzögerung für Realismus)
        room.timer = setTimeout(() => handleBotTurn(roomId, activePlayer), 1500);
    } else {
        // Timeout für Menschen starten
        room.timer = setTimeout(() => {
            io.to(roomId).emit('statusMessage', { msg: `Zeit abgelaufen für ${activePlayer.name}!` });
            nextTurn(roomId);
        }, 20000);
    }
}

async function handleBotTurn(roomId, bot) {
    const room = rooms[roomId];
    if(!room) return;

    // 1. Würfeln
    let val = Math.floor(Math.random() * 6) + 1;
    io.to(roomId).emit('diceRolled', { playerId: 'BOT', value: val }); // ID 'BOT' signalisiert Server-Aktion

    // Bot "denkt" kurz nach nach dem Würfeln (Animation abwarten)
    await new Promise(r => setTimeout(r, 1000));

    // 2. Prüfen: Alle im Haus?
    // Wir brauchen den State der Figuren. Da der Server in dieser einfachen Version 
    // den exakten Pos-State nicht speichert (nur Clients), simulieren wir eine Annahme 
    // oder zwingen den Client zur Validierung. 
    // Besser für Stabilität: Wir lassen den Bot "dumm" würfeln bis 6 oder 3x.
    // Da wir den State nicht haben, machen wir es probabilistisch oder senden "BotAttemptMove".
    // FIX: Wir speichern Positionen nun simpel im Server für Bots.
    if(!room.pieceState) room.pieceState = {}; // Key: Color, Val: [pos, pos, pos, pos]
    if(!room.pieceState[bot.color]) room.pieceState[bot.color] = [-1,-1,-1,-1];
    
    const myPieces = room.pieceState[bot.color];
    const allInBase = myPieces.every(p => p === -1);

    if (allInBase && val !== 6) {
        // Darf nochmal würfeln (Max 3 mal)
        room.rollCount++;
        if(room.rollCount < 3) {
            io.to(roomId).emit('statusMessage', { msg: `${bot.name}: Versuch ${room.rollCount}/3...` });
            setTimeout(() => handleBotTurn(roomId, bot), 1000); // Rekursiv nochmal
            return;
        } else {
            io.to(roomId).emit('statusMessage', { msg: `${bot.name} hat Pech.` });
            setTimeout(() => nextTurn(roomId), 1000);
            return;
        }
    }

    // 3. Zug ausführen
    // Suche erste Figur die ziehen kann
    let moved = false;
    for(let i=0; i<4; i++) {
        const pos = myPieces[i];
        let newPos = -1;
        
        if (pos === -1) {
            if(val === 6) newPos = 0;
        } else {
            if(pos + val <= 43) newPos = pos + val;
        }

        if(newPos !== -1) {
            // Move Valid
            myPieces[i] = newPos; // Update Server State
            io.to(roomId).emit('pieceMoved', { 
                playerId: 'BOT', // Bot ID
                pieceId: i, 
                newPosition: newPos,
                color: bot.color // Wichtig für Client zu wissen welcher Bot
            });
            moved = true;
            break; 
        }
    }

    if(moved && val === 6) {
        // Bei 6 nochmal
        room.rollCount = 0; // Reset count for normal turn logic
        setTimeout(() => handleBotTurn(roomId, bot), 1000);
    } else {
        setTimeout(() => nextTurn(roomId), 1000);
    }
}

// --- SOCKET HANDLING ---

io.on('connection', (socket) => {
    socket.on('joinGame', (roomId) => {
        // Cleanup
        if (rooms[roomId] && rooms[roomId].players.filter(p => !p.isBot).length === 0) delete rooms[roomId];

        socket.join(roomId);
        socketRoomMap[socket.id] = roomId;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                status: 'waiting',
                host: socket.id,
                trapFields: generateTrapFields(),
                turnIndex: -1,
                pieceState: {} // Server Side State Tracking
            };
        }
        const room = rooms[roomId];

        if (room.status === 'playing') {
            socket.emit('errorMsg', 'Spiel läuft bereits!'); return;
        }

        if (room.players.length < 4) {
            const colors = ['red', 'blue', 'green', 'yellow'];
            const figures = {'red': 'Puppe', 'blue': 'Kreuz', 'green': 'Grabstein', 'yellow': 'Geist'};
            const c = colors[room.players.length];
            
            // Init State
            room.pieceState[c] = [-1,-1,-1,-1];

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

        const colors = ['red', 'blue', 'green', 'yellow'];
        const figures = {'red': 'Bot-Puppe', 'blue': 'Bot-Kreuz', 'green': 'Bot-Grab', 'yellow': 'Bot-Geist'};
        
        // Bots auffüllen
        while(room.players.length < 4) {
            const c = colors[room.players.length];
            room.pieceState[c] = [-1,-1,-1,-1]; // Init Bot State
            room.players.push({ id: 'BOT_'+Math.random(), color: c, isBot: true, name: figures[c], figure: figures[c] });
        }

        room.status = 'playing';
        io.to(roomId).emit('prepareGame', { players: room.players, trapFields: room.trapFields });
        
        setTimeout(() => {
            io.to(roomId).emit('gameLive');
            room.turnIndex = -1;
            nextTurn(roomId);
        }, 3000); 
    });

    socket.on('rollDice', ({ roomId }) => {
        const room = rooms[roomId];
        if(room) {
            if(room.timer) clearTimeout(room.timer); // Timer Stop
            const val = Math.floor(Math.random() * 6) + 1;
            io.to(roomId).emit('diceRolled', { playerId: socket.id, value: val });
        }
    });

    socket.on('movePiece', ({ roomId, pieceId, newPosition }) => {
        const room = rooms[roomId];
        if(room) {
            // Update Server State für Menschen
            const player = room.players[room.turnIndex];
            if(room.pieceState[player.color]) {
                room.pieceState[player.color][pieceId] = newPosition;
            }
            io.to(roomId).emit('pieceMoved', { playerId: socket.id, pieceId, newPosition, color: player.color });
        }
    });

    socket.on('endTurn', ({ roomId }) => nextTurn(roomId));

    socket.on('disconnect', () => {
        const roomId = socketRoomMap[socket.id];
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            const humans = room.players.filter(p => !p.isBot);
            if (humans.length === 0) {
                if(room.timer) clearTimeout(room.timer);
                delete rooms[roomId];
            } else {
                if(room.host === socket.id) {
                     room.host = humans[0].id;
                     const s = io.sockets.sockets.get(room.host);
                     if(s) s.emit('youAreHost');
                }
                io.to(roomId).emit('lobbyUpdate', { players: room.players, hostId: room.host });
            }
        }
        delete socketRoomMap[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));


