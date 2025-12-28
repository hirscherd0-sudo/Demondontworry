const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

// Statische Dateien aus dem "public" Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Spielzustand Speicher
const rooms = {};

io.on('connection', (socket) => {
    console.log('Ein Benutzer hat sich verbunden:', socket.id);

    // Spieler tritt einem Raum bei
    socket.on('joinGame', (roomId) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                turnIndex: 0
            };
        }

        // Spieler zur Liste hinzufügen (max 4)
        if (rooms[roomId].players.length < 4) {
            const colors = ['red', 'blue', 'green', 'yellow'];
            const playerColor = colors[rooms[roomId].players.length];
            
            const player = {
                id: socket.id,
                color: playerColor
            };
            rooms[roomId].players.push(player);

            // Dem Spieler seine Farbe mitteilen
            socket.emit('playerJoined', { 
                color: playerColor, 
                playerIndex: rooms[roomId].players.length - 1 
            });

            // Allen im Raum die neuen Spieler zeigen (optional für Lobby-Liste)
            io.to(roomId).emit('updatePlayerList', rooms[roomId].players);
        } else {
            socket.emit('errorMsg', 'Raum ist voll!');
        }
    });

    // Würfelwurf weiterleiten
    socket.on('rollDice', ({ roomId, diceValue }) => {
        io.to(roomId).emit('diceRolled', { 
            playerId: socket.id, 
            value: diceValue 
        });
    });

    // Figur bewegen
    socket.on('movePiece', ({ roomId, pieceId, newPosition, isFinished }) => {
        io.to(roomId).emit('pieceMoved', { 
            playerId: socket.id, 
            pieceId: pieceId, 
            newPosition: newPosition,
            isFinished: isFinished
        });
    });

    // Zug beenden
    socket.on('endTurn', ({ roomId }) => {
        const room = rooms[roomId];
        if(room) {
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('turnChanged', { 
                activeColor: room.players[room.turnIndex].color 
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Hinweis: Hier könnte man Logik einfügen, um den Raum zu resetten
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});


