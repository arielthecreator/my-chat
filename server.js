const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let users = {};
let messages = [];

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    socket.emit('load-messages', messages);

    socket.on('join', (nickname) => {
        users[socket.id] = { id: socket.id, nickname: nickname, role: null };
        io.emit('update-users', Object.values(users));
        
        const joinMsg = {
            id: 'sys_' + Math.random().toString(36).substr(2, 9),
            system: true,
            text: `${nickname} הצטרף/ה לשיחה.`
        };
        messages.push(joinMsg);
        io.emit('message', joinMsg);
    });

    socket.on('change-nickname', (data) => {
        if (users[socket.id]) {
            const oldNickname = users[socket.id].nickname;
            users[socket.id].nickname = data.newNickname;
            io.emit('update-users', Object.values(users));

            const nickMsg = {
                id: 'sys_' + Math.random().toString(36).substr(2, 9),
                system: true,
                text: `${oldNickname} שינה/ה את כינויו ל-${data.newNickname}.`
            };
            messages.push(nickMsg);
            io.emit('message', nickMsg);
        }
    });

    socket.on('chat-message', (data) => {
        const messageId = 'msg_' + Math.random().toString(36).substr(2, 9);
        const newMessage = {
            id: messageId,
            socketId: socket.id,
            nickname: data.nickname,
            text: data.text
        };
        messages.push(newMessage);
        io.emit('new-message', newMessage);
    });

    socket.on('edit-message', (data) => {
        const msg = messages.find(m => m.id === data.id);
        if (msg) {
            msg.text = data.newText;
            io.emit('message-edited', { id: data.id, newText: data.newText });
        }
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

    socket.on('leave-chat', () => {
        if (users[socket.id]) {
            const nickname = users[socket.id].nickname;
            delete users[socket.id];
            io.emit('update-users', Object.values(users));
            
            const leaveMsg = {
                id: 'sys_' + Math.random().toString(36).substr(2, 9),
                system: true,
                text: `${nickname} עזב/ה את השיחה.`
            };
            messages.push(leaveMsg);
            io.emit('message', leaveMsg);
        }
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ על פורט ${PORT}`);
});
