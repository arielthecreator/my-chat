const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');

// סיסמת מנהל נסתרת
const ADMIN_PASSWORD = "123";

// הגדרת תיקייה ציבורית
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

let users = [];
let messages = [];

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    // התחברות לצ'אט עם כינוי
    socket.on('join', (nickname) => {
        if (!nickname || typeof nickname !== 'string' || !nickname.trim()) return;

        socket.nickname = nickname.trim();
        socket.role = socket.role || null;

        // בדיקה האם המשתמש כבר קיים ברשימה לפי ה-ID שלו
        const existingUserIndex = users.findIndex(u => u.id === socket.id);
        
        if (existingUserIndex !== -1) {
            users[existingUserIndex].nickname = socket.nickname;
        } else {
            users.push({
                id: socket.id,
                nickname: socket.nickname,
                role: socket.role,
                isAdmin: socket.isAdmin || false
            });
        }

        // שליחת היסטוריית הודעות למשתמש שנכנס (זה מה שמעביר את המסך לצ'אט!)
        socket.emit('load-messages', messages);

        // עדכון רשימת המשתמשים לכולם
        updateUserList();
        console.log(`משתמש התחבר בהצלחה בשם: ${socket.nickname}`);
    });

    // אימות מנהל
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

    // שליחת הודעה חדשה
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

    // עריכת הודעה
    socket.on('edit-message', (data) => {
        const msg = messages.find(m => m.id === data.id);
        if (msg) {
            if (msg.nickname === socket.nickname || socket.isAdmin) {
                msg.text = data.newText;
                io.emit('message-edited', { id: data.id, newText: data.newText });
            }
        }
    });

    // שינוי כינוי תוך כדי תנועה
    socket.on('change-nickname', (data) => {
        const oldName = socket.nickname;
        socket.nickname = data.newNickname;

        const user = users.find(u => u.id === socket.id);
        if (user) {
            user.nickname = data.newNickname;
        }

        const sysMsg = {
            id: Date.now().toString(),
            text: `${oldName} שינה את שמו ל- ${data.newNickname}`,
            system: true
        };
        messages.push(sysMsg);
        io.emit('new-message', sysMsg);
        updateUserList();
    });

    // הגדרת תפקיד למשתמש ע"י מנהל
    socket.on('set-role', (data) => {
        if (!socket.isAdmin) return;

        const targetUser = users.find(u => u.id === data.targetId);
        if (targetUser) {
            targetUser.role = data.role;
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) {
                targetSocket.role = data.role;
            }
            updateUserList();
        }
    });

    // בעיטת משתמש ע"י מנהל
    socket.on('kick-user', (targetId) => {
        if (!socket.isAdmin) return;

        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.emit('kicked');
            targetSocket.disconnect(true);
        }
    });

    // התנתקות
    socket.on('disconnect', () => {
        users = users.filter(u => u.id !== socket.id);
        updateUserList();
        console.log('משתמש התנתק:', socket.id);
    });
});

function updateUserList() {
    io.emit('update-users', users);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`השרת רץ אחי בכתובת: http://localhost:${PORT}`);
});
