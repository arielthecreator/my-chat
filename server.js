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
let allRegisteredUsers = [];
let messages = [];

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    socket.on('join', (data) => {
        let nickname = typeof data === 'string' ? data : (data ? data.nickname : '');
        let requestedAdmin = data && data.isAdmin;
        let requestedOwner = data && data.isOwner;

        if (!nickname || typeof nickname !== 'string' || !nickname.trim()) return;

        socket.nickname = nickname.trim();
        
        if (requestedOwner) {
            socket.isOwner = true;
            socket.isAdmin = true;
            socket.role = 'בעלים';
        } else if (requestedAdmin) {
            socket.isAdmin = true;
            socket.role = 'מנהל';
        } else {
            socket.role = socket.role || null;
            socket.isAdmin = socket.isAdmin || false;
            socket.isOwner = false;
        }

        const existingUserIndex = users.findIndex(u => u.id === socket.id);
        if (existingUserIndex !== -1) {
            users[existingUserIndex].nickname = socket.nickname;
            users[existingUserIndex].role = socket.role;
            users[existingUserIndex].isAdmin = socket.isAdmin;
            users[existingUserIndex].isOwner = socket.isOwner;
        } else {
            users.push({
                id: socket.id,
                nickname: socket.nickname,
                role: socket.role,
                isAdmin: socket.isAdmin,
                isOwner: socket.isOwner
            });
        }

        const regIndex = allRegisteredUsers.findIndex(u => u.nickname === socket.nickname);
        if (regIndex !== -1) {
            allRegisteredUsers[regIndex].online = true;
            allRegisteredUsers[regIndex].id = socket.id;
            if (socket.isOwner) allRegisteredUsers[regIndex].isOwner = true;
        } else {
            allRegisteredUsers.push({
                id: socket.id,
                nickname: socket.nickname,
                role: socket.role,
                isAdmin: socket.isAdmin,
                isOwner: socket.isOwner,
                online: true
            });
        }

        socket.emit('load-messages', messages);
        updateUserList();
    });

    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            socket.isAdmin = true;
            socket.isOwner = true; // מי שנכנס עם הסיסמה הראשית הוא הבעלים
            socket.role = 'בעלים';

            const user = users.find(u => u.id === socket.id);
            if (user) {
                user.isAdmin = true;
                user.isOwner = true;
                user.role = 'בעלים';
            }
            const regUser = allRegisteredUsers.find(u => u.nickname === socket.nickname);
            if (regUser) {
                regUser.isAdmin = true;
                regUser.isOwner = true;
                regUser.role = 'בעלים';
            }

            socket.emit('admin-success', { success: true, isOwner: true });
            updateUserList();
        } else {
            socket.emit('admin-success', { success: false });
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

    socket.on('clear-chat', () => {
        if (!socket.isAdmin) return;
        messages = [];
        io.emit('chat-cleared');
    });

    socket.on('change-nickname', (data) => {
        const oldName = socket.nickname;
        const newName = data && data.newNickname ? data.newNickname.trim() : '';
        if (!newName) return;

        socket.nickname = newName;
        const user = users.find(u => u.id === socket.id);
        if (user) user.nickname = newName;

        const regUser = allRegisteredUsers.find(u => u.nickname === oldName);
        if (regUser) {
            regUser.nickname = newName;
        }

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

        // רק הבעלים יכול להסיר ניהול ממנהל אחר
        if (data.role === null && !socket.isOwner) {
            return; // מנהל רגיל לא יכול להוריד ניהול
        }

        const targetUser = users.find(u => u.id === data.targetId);
        if (targetUser) {
            targetUser.role = data.role;
            targetUser.isAdmin = (data.role === 'מנהל');
            
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) {
                targetSocket.role = data.role;
                targetSocket.isAdmin = (data.role === 'מנהל');
            }
        }
        
        const regUser = allRegisteredUsers.find(u => u.id === data.targetId);
        if (regUser) {
            regUser.role = data.role;
            regUser.isAdmin = (data.role === 'מנהל');
        }

        updateUserList();
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
        
        const regUser = allRegisteredUsers.find(u => u.id === socket.id);
        if (regUser) {
            regUser.online = false;
        }

        updateUserList();
    });
});

function updateUserList() {
    io.emit('update-users', { activeUsers: users, allUsers: allRegisteredUsers });
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`השרת רץ בכתובת: http://localhost:${PORT}`);
});
