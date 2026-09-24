const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PASSWORD = '123';
let publicMessages = [];
let allUsers = [];
let privateRooms = {};

function getJerusalemTime() {
    return new Date().toLocaleTimeString('he-IL', { 
        timeZone: 'Asia/Jerusalem', 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

io.on('connection', (socket) => {
    let currentUser = null;
    let currentRoom = 'public';

    socket.on('join', (data) => {
        const nickname = data.nickname;
        const isAdmin = data.isAdmin || false;
        
        currentUser = { id: socket.id, nickname, isAdmin, role: isAdmin ? 'מנהל' : null, online: true, lastSeen: 'מחובר כעת' };

        const existingUser = allUsers.find(u => u.nickname === nickname);
        let isFirstTime = false;

        if (existingUser) {
            existingUser.id = socket.id;
            existingUser.online = true;
            existingUser.lastSeen = 'מחובר כעת';
            if (isAdmin) existingUser.role = 'מנהל';
        } else {
            isFirstTime = true;
            allUsers.push(currentUser);
        }

        socket.join('public');
        socket.emit('load-messages', publicMessages);

        if (isFirstTime) {
            const time = getJerusalemTime();
            const sysMsg = { id: Date.now().toString(), text: `${nickname} הצטרף/ה לצ'אט`, system: true, time };
            publicMessages.push(sysMsg);
            io.to('public').emit('new-message', sysMsg);
        }

        updateUsersAndRoomsList();
    });

    socket.on('switch-room', (roomId) => {
        socket.leave(currentRoom);
        currentRoom = roomId;
        socket.join(roomId);

        if (roomId === 'public') {
            socket.emit('load-messages', publicMessages);
        } else if (privateRooms[roomId]) {
            socket.emit('load-messages', privateRooms[roomId].messages);
        }
    });

    socket.on('create-private-room', (data) => {
        const { roomName, targetNickname } = data;
        const targetUser = allUsers.find(u => u.nickname === targetNickname);
        
        if (!targetUser) {
            socket.emit('room-error', 'המשתמש שנבחר אינו נמצא במערכת.');
            return;
        }

        const roomId = 'room_' + Date.now();
        privateRooms[roomId] = {
            name: roomName,
            creator: currentUser.nickname,
            members: [currentUser.nickname, targetUser.nickname],
            messages: []
        };

        socket.emit('room-created', roomId);
        updateUsersAndRoomsList();
    });

    socket.on('delete-private-room', (roomId) => {
        if (currentUser && currentUser.isAdmin && privateRooms[roomId]) {
            io.to(roomId).emit('room-deleted-by-admin', roomId);
            delete privateRooms[roomId];
            updateUsersAndRoomsList();
        }
    });

    socket.on('chat-message', (data) => {
        const time = getJerusalemTime();
        const msgData = {
            id: Date.now().toString(),
            nickname: data.nickname,
            text: data.text,
            type: data.type || 'text',
            role: currentUser ? currentUser.role : null,
            time: time,
            readBy: [socket.id]
        };

        if (currentRoom === 'public') {
            publicMessages.push(msgData);
            if (publicMessages.length > 150) publicMessages.shift();
            io.to('public').emit('new-message', msgData);
        } else if (privateRooms[currentRoom]) {
            privateRooms[currentRoom].messages.push(msgData);
            io.to(currentRoom).emit('new-message', msgData);
        }
    });

    socket.on('edit-message', (data) => {
        const { messageId, newText } = data;
        let msgs = currentRoom === 'public' ? publicMessages : (privateRooms[currentRoom] ? privateRooms[currentRoom].messages : null);
        if (msgs) {
            const msg = msgs.find(m => m.id === messageId);
            if (msg && msg.nickname === currentUser.nickname) {
                msg.text = newText;
                msg.edited = true;
                io.to(currentRoom).emit('message-edited', { messageId, newText });
            }
        }
    });

    socket.on('mark-as-read', () => {
        let msgs = currentRoom === 'public' ? publicMessages : (privateRooms[currentRoom] ? privateRooms[currentRoom].messages : null);
        if (msgs) {
            let updated = false;
            msgs.forEach(msg => {
                if (!msg.system && msg.readBy && !msg.readBy.includes(socket.id)) {
                    msg.readBy.push(socket.id);
                    updated = true;
                }
            });
            if (updated) {
                io.to(currentRoom).emit('update-messages-status', msgs);
            }
        }
    });

    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            if (currentUser) {
                currentUser.role = 'מנהל';
                currentUser.isAdmin = true;
            }
            socket.emit('admin-success', true);
            updateUsersAndRoomsList();
        } else {
            socket.emit('admin-success', false);
        }
    });

    socket.on('set-role', (data) => {
        if (currentUser && currentUser.isAdmin) {
            const target = allUsers.find(u => u.id === data.targetId);
            if (target) {
                target.role = data.role;
                updateUsersAndRoomsList();
            }
        }
    });

    socket.on('kick-user', (targetId) => {
        if (currentUser && currentUser.isAdmin) {
            io.to(targetId).emit('kicked');
        }
    });

    socket.on('disconnect', () => {
        if (currentUser) {
            const user = allUsers.find(u => u.id === socket.id);
            if (user) {
                user.online = false;
                user.lastSeen = getJerusalemTime();
            }
            updateUsersAndRoomsList();
        }
    });

    function updateUsersAndRoomsList() {
        io.emit('update-data', {
            allUsers: allUsers,
            privateRooms: privateRooms
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ בהצלחה בפורט ${PORT}`);
});
