const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let messages = [];
let users = []; 
let activeUsers = []; 
const ADMIN_PASSWORD = "123"; 

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    socket.on('join', (data) => {
        const nickname = data.nickname;
        const isAdmin = data.isAdmin || false;

        let existingUser = users.find(u => u.id === socket.id || u.nickname === nickname);
        
        let userRole = null;
        if (existingUser) {
            userRole = existingUser.role;
        }
        if (isAdmin) {
            userRole = 'מנהל';
        }

        users = users.filter(u => u.nickname !== nickname && u.id !== socket.id);
        
        const userData = {
            id: socket.id,
            nickname: nickname,
            role: userRole,
            online: true
        };
        
        users.push(userData);
        activeUsers.push(userData);

        socket.emit('load-messages', messages);
        updateAllUsersList();

        io.emit('system-message', { text: `${nickname} הצטרף לצ'אט`, system: true });
    });

    socket.on('chat-message', (data) => {
        const timeNow = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        
        const messageObj = {
            id: 'msg_' + Date.now() + Math.random(),
            nickname: data.nickname,
            text: data.text,
            time: timeNow,
            role: users.find(u => u.nickname === data.nickname)?.role || null,
            readBy: [data.nickname] // מי כבר קרא את ההודעה
        };

        messages.push(messageObj);
        if (messages.length > 100) messages.shift(); // שומר עד 100 הודעות אחרונות

        io.emit('new-message', messageObj);
    });

    // סימון הודעות כנקראו על ידי משתמש שנמצא בצ'אט
    socket.on('mark-as-read', (nickname) => {
        let updated = false;
        messages.forEach(msg => {
            if (!msg.readBy.includes(nickname)) {
                msg.readBy.push(nickname);
                updated = true;
            }
        });
        if (updated) {
            io.emit('update-messages-status', messages);
        }
    });

    socket.on('edit-message', (data) => {
        const msg = messages.find(m => m.id === data.id);
        if (msg) {
            msg.newText = data.newText;
            msg.text = data.newText; // עדכון הטקסט
            io.emit('message-edited', { id: data.id, newText: data.newText });
        }
    });

    socket.on('clear-chat', () => {
        messages = [];
        io.emit('chat-cleared');
    });

    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            socket.emit('admin-success', true);
        } else {
            socket.emit('admin-success', false);
        }
    });

    socket.on('set-role', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (target) {
            target.role = data.role;
            updateAllUsersList();
        }
    });

    socket.on('kick-user', (targetId) => {
        const target = users.find(u => u.id === targetId);
        if (target) {
            target.online = false;
            activeUsers = activeUsers.filter(u => u.id !== targetId);
            io.to(targetId).emit('kicked');
            updateAllUsersList();
        }
    });

    socket.on('change-nickname', (data) => {
        const user = users.find(u => u.id === socket.id);
        if (user) {
            user.nickname = data.newNickname;
            updateAllUsersList();
        }
    });

    socket.on('disconnect', () => {
        const user = users.find(u => u.id === socket.id);
        if (user) {
            user.online = false;
            activeUsers = activeUsers.filter(u => u.id !== socket.id);
            updateAllUsersList();
            io.emit('system-message', { text: `${user.nickname} עזב את הצ'אט`, system: true });
        }
        console.log('משתמש התנתק:', socket.id);
    });
});

function updateAllUsersList() {
    io.emit('update-users', {
        activeUsers: activeUsers,
        allUsers: users
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ בהצלחה על פורט ${PORT}`);
});
