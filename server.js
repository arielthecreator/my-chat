const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// רשימת משתמשים מחוברים
let users = {};

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    // הצטרפות לצ'אט עם כינוי
    socket.on('join', (nickname) => {
        users[socket.id] = { id: socket.id, nickname: nickname };
        
        // עדכון כל המשתמשים ברשימת החברים
        io.emit('update-users', Object.values(users));
        
        // הודעת מערכת על הצטרפות
        io.emit('message', {
            system: true,
            text: `${nickname} הצטרף/ה לשיחה.`
        });
    });

    // קבלת הודעה ושליחתה לכולם
    socket.on('chat-message', (data) => {
        io.emit('message', {
            nickname: data.nickname,
            text: data.text,
            id: socket.id
        });
    });

    // פעולות מנהל: הסרת משתמש
    socket.on('kick-user', (targetId) => {
        if (users[targetId]) {
            io.to(targetId).emit('kicked');
            delete users[targetId];
            io.emit('update-users', Object.values(users));
        }
    });

    // ניתוק משתמש
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
        console.log('משתמש התנתק:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ באוויר על פורט ${PORT}`);
});
