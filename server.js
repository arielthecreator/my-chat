const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');

const ADMIN_PASSWORD = "123";

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

let users = [];
let messages = [];

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    socket.on('join', (data) => {
        let nickname = typeof data === 'string' ? data : (data ? data.nickname : '');
        let requestedAdmin = data && data.isAdmin;

        if (!nickname || typeof nickname !== 'string' || !nickname.trim()) return;

        socket.nickname = nickname.trim();
        if (requestedAdmin) {
            socket.isAdmin = true;
            socket.role = 'מנהל';
        } else {
            socket.role = socket.role || null;
            socket.isAdmin = socket.isAdmin || false;
        }

        const existingUserIndex = users.findIndex(u => u.id === socket.id);
        if (existingUserIndex !== -1) {
            users[existingUserIndex].nickname = socket.nickname;
            users[existingUserIndex].role = socket.role;
            users[existingUserIndex].isAdmin = socket.isAdmin;
        } else {
            users.push({
                id: socket.id,
                nickname: socket.nickname,
                role: socket.role,
                isAdmin: socket.isAdmin
            });
        }

        socket.emit('load-messages', messages);
        updateUserList();
    });

    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            socket.isAdmin = true;
            socket.role = 'מנהל';

            const user = users.find(u => u.id === socket.id);
            if (user) {
                user.isAdmin = true;
                user.role = 'מנהל';
            }

            socket.emit('admin-success', true);
            updateUserList();
        } else {
            socket.emit('admin-success', false);
        }
    });

    socket.on('chat-message', (data) => {
        if (!data || !data.text || !data.text.trim()) return;

        const messageData = {
            id: Date.now().toString(),
            nickname: data.nickname || socket.nickname || 'אורח',
            text: data.text.trim(),
            role: socket.role,
            system: false
        };

        messages.push(messageData);
        if (messages.length > 100) messages.shift();

        io.emit('new-message', messageData);
    });

    socket.on('edit-message', (data) => {
        const msg = messages.find(m => m.id === data.id);
        if (msg) {
            if (msg.nickname === socket.nickname || socket.isAdmin) {
                msg.text = data.newText;
                io.emit('message-edited', { id: data.id, newText: data.newText });
            }
        }
    });

    // ניקוי צ'אט מלא (לבעלים בלבד)
    socket.on('clear-chat', () => {
        if (!socket.isAdmin) return;
        messages = []; // מחיקת כל ההיסטוריה בשרת
        io.emit('chat-cleared'); // עדכון כל המשתמשים לניקוי המסך
    });

    socket.on('change-nickname', (data) => {
        const oldName = socket.nickname;
        const newName = data && data.newNickname ? data.newNickname.trim() : '';
        if (!newName) return;

        socket.nickname = newName;
        const user = users.find(u => u.id === socket.id);
        if (user) user.nickname = newName;

        const sysMsg = {
            id: Date.now().toString(),
            text: `${oldName} שינה את שמו ל- ${newName}`,
            system: true
        };
        messages.push(sysMsg);
        if (messages.length > 100) messages.shift();

        io.emit('new-message', sysMsg);
        updateUserList();
    });

    socket.on('set-role', (data) => {
        if (!socket.isAdmin) return;

        const targetUser = users.find(u => u.id === data.targetId);
        if (targetUser) {
            targetUser.role = data.role;
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) {
                targetSocket.role = data.role;
                if (data.role === 'מנהל') targetSocket.isAdmin = true;
            }
            updateUserList();
        }
    });

    socket.on('kick-user', (targetId) => {
        if (!socket.isAdmin) return;

        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.emit('kicked');
            targetSocket.disconnect(true);
        }
    });

    socket.on('disconnect', () => {
        users = users.filter(u => u.id !== socket.id);
        updateUserList();
    });
});

function updateUserList() {
    io.emit('update-users', users);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`השרת רץ בכתובת: http://localhost:${PORT}`);
});
