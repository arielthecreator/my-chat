const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// אובייקטים לניהול נתונים בשרת
let users = {};          // socket.id -> { nickname, isAdmin, online, lastSeen }
let messages = {         // roomId -> [array of messages]
    'public': []
};
let privateRooms = {};   // roomId -> { name, members: [nicknames] }
let bannedUsers = {};    // socket.id או זיהוי אחר -> timestamp של סיום חסימה

const ADMIN_PASSWORD = "1234"; // סיסמת מנהל לדוגמה

function updateAllData() {
    let allUsers = Object.keys(users).map(id => ({
        id: id,
        nickname: users[id].nickname,
        isAdmin: users[id].isAdmin,
        online: users[id].online,
        lastSeen: users[id].lastSeen
    }));

    io.emit('update-data', {
        allUsers: allUsers,
        privateRooms: privateRooms
    });
}

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    // בדיקת חסימה בכניסה
    if (bannedUsers[socket.id] && bannedUsers[socket.id] > Date.now()) {
        socket.emit('banned', 'אתה חסום מהצ\'אט.');
        return;
    }

    // הצטרפות לצ'אט
    socket.on('join', (data) => {
        const { nickname, isAdmin } = data;
        
        users[socket.id] = {
            nickname: nickname,
            isAdmin: isAdmin || false,
            online: true,
            lastSeen: 'עכשיו'
        };

        socket.join('public');
        
        // שליחת הודעות החדר הראשי למשתמש
        socket.emit('load-messages', messages['public'] || []);
        updateAllData();
    });

    // אימות מנהל
    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            if (users[socket.id]) {
                users[socket.id].isAdmin = true;
            }
            socket.emit('admin-success', true);
            updateAllData();
        } else {
            socket.emit('admin-success', false);
        }
    });

    // מעבר בין חדרים (צ'אט ציבורי או פרטי)
    socket.on('switch-room', (roomId) => {
        // יציאה מכל החדרים הקודמים מלבד ה-socket.id עצמו
        for (let r of socket.rooms) {
            if (r !== socket.id) {
                socket.leave(r);
            }
        }

        socket.join(roomId);
        if (!messages[roomId]) {
            messages[roomId] = [];
        }
        socket.emit('load-messages', messages[roomId]);
    });

    // יצירת צ'אט פרטי
    socket.on('create-private-room', (data) => {
        const { roomName, targetNickname } = data;
        const creatorNick = users[socket.id] ? users[socket.id].nickname : 'אורח';
        
        let roomId = 'room_' + Date.now() + '_' + Math.random().toString(36.substring(2, 7));
        
        privateRooms[roomId] = {
            name: roomName,
            members: [creatorNick, targetNickname]
        };

        messages[roomId] = [];

        // מציאת ה-socket.id של קהל היעד אם מחובר
        let targetSocketId = null;
        for (let id in users) {
            if (users[id].nickname === targetNickname) {
                targetSocketId = id;
                break;
            }
        }

        socket.join(roomId);
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.sockets.sockets.get(targetSocketId).join(roomId);
        }

        socket.emit('room-created', roomId);
        updateAllData();
    });

    // שליחת הודעת טקסט
    socket.on('chat-message', (data) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) {
                currentRoom = r;
                break;
            }
        }

        const user = users[socket.id];
        const newMessage = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            nickname: data.nickname,
            text: data.text,
            type: data.type || 'text',
            replyTo: data.replyTo || null,
            role: user && user.isAdmin ? 'מנהל' : null,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            readBy: [socket.id],
            reactions: {}
        };

        if (!messages[currentRoom]) {
            messages[currentRoom] = [];
        }
        messages[currentRoom].push(newMessage);

        io.to(currentRoom).emit('new-message', newMessage);
    });

    // סימון הודעות כנקראו (וי כחול)
    socket.on('mark-as-read', () => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) {
                currentRoom = r;
                break;
            }
        }

        if (messages[currentRoom]) {
            let updated = false;
            messages[currentRoom].forEach(msg => {
                if (!msg.readBy) msg.readBy = [];
                if (!msg.readBy.includes(socket.id)) {
                    msg.readBy.push(socket.id);
                    updated = true;
                }
            });

            if (updated) {
                io.to(currentRoom).emit('update-messages-status', messages[currentRoom]);
            }
        }
    });

    // אינדיקטור הקלדה
    socket.on('typing', (isTyping) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) {
                currentRoom = r;
                break;
            }
        }

        const user = users[socket.id];
        if (user) {
            socket.to(currentRoom).emit('user-typing', {
                nickname: user.nickname,
                isTyping: isTyping
            });
        }
    });

    // מחיקת הודעה בודדת
    socket.on('delete-message', (messageId) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) {
                currentRoom = r;
                break;
            }
        }
        
        if (messages[currentRoom]) {
            messages[currentRoom] = messages[currentRoom].filter(m => m.id !== messageId);
            io.to(currentRoom).emit('message-deleted', messageId);
        }
    });

    // הוספת/הסרת אימוגי תגובה (החלפה או ביטול אם נבחר שוב - כמו בוואטסאפ אימוגי יחיד למשתמש)
    socket.on('reaction-message', (data) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) {
                currentRoom = r;
                break;
            }
        }
        
        const { messageId, emoji, nickname } = data;
        if (messages[currentRoom]) {
            const msg = messages[currentRoom].find(m => m.id === messageId);
            if (msg) {
                if (!msg.reactions) msg.reactions = {};
                
                if (msg.reactions[nickname] === emoji) {
                    delete msg.reactions[nickname];
                    io.to(currentRoom).emit('message-reaction-updated', { messageId, emoji: null, nickname });
                } else {
                    msg.reactions[nickname] = emoji;
                    io.to(currentRoom).emit('message-reaction-updated', { messageId, emoji, nickname });
                }
            }
        }
    });

    // ניקוי היסטוריית צ'אט (עבור מנהל)
    socket.on('clear-current-chat', (roomId) => {
        if (users[socket.id] && users[socket.id].isAdmin) {
            messages[roomId] = [];
            io.to(roomId).emit('load-messages', []);
        }
    });

    // מחיקת צ'אט פרטי
    socket.on('delete-private-room', (roomId) => {
        delete privateRooms[roomId];
        delete messages[roomId];
        io.to(roomId).emit('room-deleted-by-admin', roomId);
        updateAllData();
    });

    // חסימת משתמש
    socket.on('ban-user', (data) => {
        if (users[socket.id] && users[socket.id].isAdmin) {
            const { targetId, durationMs } = data;
            bannedUsers[targetId] = Date.now() + durationMs;
            
            if (io.sockets.sockets.get(targetId)) {
                io.sockets.sockets.get(targetId).emit('banned', 'הושתה עליך חסימה זמנית/קבועה מהמערכת.');
                io.sockets.sockets.get(targetId).disconnect();
            }

            delete users[targetId];
            updateAllData();
        }
    });

    // התנתקות משתמש
    socket.on('disconnect', () => {
        console.log('משתמש התנתק:', socket.id);
        if (users[socket.id]) {
            users[socket.id].online = false;
            users[socket.id].lastSeen = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        updateAllData();
        
        // מחיקה מלאה אחרי זמן מה כדי לא לצבור סתם בזיכרון
        setTimeout(() => {
            if (users[socket.id] && !users[socket.id].online) {
                delete users[socket.id];
                updateAllData();
            }
        }, 60000);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ בהצלחה בפורט ${PORT}`);
});
