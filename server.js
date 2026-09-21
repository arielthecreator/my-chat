const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let users = {};

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    socket.on('join', (nickname) => {
        users[socket.id] = { id: socket.id, nickname: nickname, role: null };
        io.emit('update-users', Object.values(users));
        io.emit('message', {
            system: true,
            text: `${nickname} הצטרף/ה לשיחה.`
        });
    });

    socket.on('change-nickname', (newNickname) => {
        if (users[socket.id]) {
            const oldNickname = users[socket.id].nickname;
            users[socket.id].nickname = newNickname;
            io.emit('update-users', Object.values(users));
            io.emit('message', {
                system: true,
                text: `${oldNickname} שינה/ה את כינויו ל-${newNickname}.`
            });
        }
    });

    socket.on('chat-message', (data) => {
        const messageId = 'msg_' + Math.random().toString(36).substr(2, 9);
        io.emit('new-message', {
            id: messageId,
            socketId: socket.id,
            nickname: data.nickname,
            text: data.text
        });
    });

    socket.on('edit-message', (data) => {
        io.emit('message-edited', { id: data.id, newText: data.newText });
    });

    socket.on('delete-message', (messageId) => {
        io.emit('message-deleted', messageId);
    });

    socket.on('set-role', (data) => {
        if (users[data.targetId]) {
            users[data.targetId].role = data.role;
            io.emit('update-users', Object.values(users));
        }
    });

    socket.on('kick-user', (targetId) => {
        if (users[targetId]) {
            io.to(targetId).emit('kicked');
            delete users[targetId];
            io.emit('update-users', Object.values(users));
        }
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const nickname = users[socket.id].nickname;
            delete users[socket.id];
            io.emit('update-users', Object.values(users));
            io.emit('message', {
                system: true,
                text: `${nickname} עזב/ה את השיחה.`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ על פורט ${PORT}`);
});
