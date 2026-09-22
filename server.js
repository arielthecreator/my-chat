const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 }); // הגדלת נפח להעברת קבצי אודיו קטנים

app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PASSWORD = '123';
let messages = [];
let allUsers = [];
let activeUsers = [];

io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('join', (data) => {
        const nickname = data.nickname;
        const isAdmin = data.isAdmin || false;
        currentUser = { id: socket.id, nickname, isAdmin, role: isAdmin ? 'מנהל' : null, online: true };

        const existingUserIndex = allUsers.findIndex(u => u.nickname === nickname);
        if (existingUserIndex !== -1) {
            allUsers[existingUserIndex].id = socket.id;
            allUsers[existingUserIndex].online = true;
            if (isAdmin) allUsers[existingUserIndex].role = 'מנהל';
        } else {
            allUsers.push(currentUser);
        }

        activeUsers = allUsers.filter(u => u.online);
        socket.emit('load-messages', messages);

        const time = new Date().toLocaleTimeString('he-IL', { 
            timeZone: 'Asia/Jerusalem', 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        const sysMsg = { id: Date.now().toString(), text: `${nickname} הצטרף/ה לצ'אט`, system: true, time };
        messages.push(sysMsg);
        io.emit('new-message', sysMsg);

        updateUsersList();
    });

    socket.on('chat-message', (data) => {
        const user = allUsers.find(u => u.id === socket.id);
        const time = new Date().toLocaleTimeString('he-IL', { 
            timeZone: 'Asia/Jerusalem', 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        const msgData = {
            id: Date.now().toString(),
            nickname: data.nickname,
            text: data.text,
            type: data.type || 'text', // טקסט או אודיו
            role: user ? user.role : null,
            time: time,
            readBy: [socket.id]
        };

        messages.push(msgData);
        if (messages.length > 100) messages.shift();

        io.emit('new-message', msgData);
    });

    socket.on('mark-as-read', (nickname) => {
        let updated = false;
        messages.forEach(msg => {
            if (!msg.system && msg.readBy && !msg.readBy.includes(socket.id)) {
                msg.readBy.push(socket.id);
                updated = true;
            }
        });
        if (updated) {
            io.emit('update-messages-status', messages);
        }
    });

    socket.on('edit-message', (data) => {
        const msg = messages.find(m => m.id === data.id);
        if (msg && msg.type === 'text') {
            msg.text = data.newText + ' (נערך)';
            io.emit('message-edited', { id: data.id, newText: msg.text });
        }
    });

    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            const user = allUsers.find(u => u.id === socket.id);
            if (user) {
                user.role = 'מנהל';
                user.isAdmin = true;
            }
            socket.emit('admin-success', true);
            updateUsersList();
        } else {
            socket.emit('admin-success', false);
        }
    });

    socket.on('clear-chat', () => {
        const user = allUsers.find(u => u.id === socket.id);
        if (user && user.isAdmin) {
            messages = [];
            io.emit('chat-cleared');
        }
    });

    socket.on('set-role', (data) => {
        const adminUser = allUsers.find(u => u.id === socket.id);
        if (adminUser && adminUser.isAdmin) {
            const target = allUsers.find(u => u.id === data.targetId);
            if (target) {
                target.role = data.role;
                target.isAdmin = (data.role === 'מנהל');
                updateUsersList();
            }
        }
    });

    socket.on('kick-user', (targetId) => {
        const adminUser = allUsers.find(u => u.id === socket.id);
        if (adminUser && adminUser.isAdmin) {
            io.to(targetId).emit('kicked');
        }
    });

    socket.on('change-nickname', (data) => {
        const user = allUsers.find(u => u.id === socket.id);
        if (user) {
            user.nickname = data.newNickname;
            updateUsersList();
        }
    });

    socket.on('disconnect', () => {
        if (currentUser) {
            const user = allUsers.find(u => u.id === socket.id);
            if (user) {
                user.online = false;
            }
            activeUsers = allUsers.filter(u => u.online);
            updateUsersList();
        }
    });

    function updateUsersList() {
        io.emit('update-users', {
            activeUsers: activeUsers,
            allUsers: allUsers
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ בהצלחה בפורט ${PORT}`);
});
