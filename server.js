const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// רשימת המנהלים שלך - תוכל לשנות או להוסיף שמות משתמש שיהיו מנהלים
const admins = ['אריאל', 'מנהל']; 

// היסטוריית הודעות שנשמרת בזמן ריצת השרת
let messages = [];

io.on('connection', (socket) => {
    socket.emit('load_history', messages);

    socket.on('send_message', (data) => {
        const { username, text } = data;
        const isAdmin = admins.includes(username);

        const messageData = {
            id: Date.now(),
            username: username,
            text: text,
            isAdmin: isAdmin,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        messages.push(messageData);
        io.emit('receive_message', messageData);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
