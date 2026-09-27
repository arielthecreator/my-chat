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
let bannedUsers = {}; // שומר את החסימות: { nickname: expirationTimestamp }

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
        try {
            if (!data || !data.nickname) return;
            const nickname = data.nickname;

            // בדיקה האם המשתמש חסום
            if (bannedUsers[nickname] && Date.now() < bannedUsers[nickname]) {
                const timeLeftMinutes = Math.ceil((bannedUsers[nickname] - Date.now()) / (60 * 1000));
                socket.emit('banned', `אתה חסום למערכת עוד כ-${timeLeftMinutes} דקות.`);
                return;
            } else if (bannedUsers[nickname] && Date.now() >= bannedUsers[nickname]) {
                delete bannedUsers[nickname];
            }

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
                const sysMsg = { id: Date.now().toString(), text: `${nickname} הצטרף/ה לצ'אט`, system: true, time, readBy: [] };
                publicMessages.push(sysMsg);
                if (publicMessages.length > 150) publicMessages.shift();
                io.to('public').emit('new-message', sysMsg);
            }

            updateUsersAndRoomsList();
        } catch (err) {
            console.error('Error in join:', err);
        }
    });

    socket.on('switch-room', (roomId) => {
        try {
            if (!roomId) return;
            socket.leave(currentRoom);
            currentRoom = roomId;
            socket.join(roomId);

            if (roomId === 'public') {
                socket.emit('load-messages', publicMessages);
            } else if (privateRooms[roomId]) {
                socket.emit('load-messages', privateRooms[roomId].messages);
            } else {
                socket.emit('load-messages', []);
            }
        } catch (err) {
            console.error('Error in switch-room:', err);
        }
    });

    socket.on('create-private-room', (data) => {
        try {
            const { roomName, targetNickname } = data;
            const targetUser = allUsers.find(u => u.nickname === targetNickname);
            
            if (!targetUser) {
                socket.emit('room-error', 'המשתמש שנבחר אינו נמצא במערכת.');
                return;
            }

            let existingRoomId = Object.keys(privateRooms).find(rId => {
                let r = privateRooms[rId];
                return r.members.includes(currentUser.nickname) && r.members.includes(targetUser.nickname);
            });

            if (existingRoomId) {
                socket.emit('room-created', existingRoomId);
                updateUsersAndRoomsList();
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
        } catch (err) {
            console.error('Error in create-private-room:', err);
        }
    });

    socket.on('delete-private-room', (roomId) => {
        try {
            if (privateRooms[roomId]) {
                let room = privateRooms[roomId];
                if ((currentUser && currentUser.isAdmin) || (currentUser && room.members.includes(currentUser.nickname))) {
                    io.to(roomId).emit('room-deleted-by-admin', roomId);
                    delete privateRooms[roomId];
                    updateUsersAndRoomsList();
                }
            }
        } catch (err) {
            console.error('Error in delete-private-room:', err);
        }
    });

    socket.on('chat-message', (data) => {
        try {
            if (!data || !data.text) return;
            const time = getJerusalemTime();
            const msgData = {
                id: Date.now().toString(),
                nickname: data.nickname,
                text: data.text,
                type: data.type || 'text',
                replyTo: data.replyTo || null,
                role: currentUser ? currentUser.role : null,
                time: time,
                readBy: currentUser ? [currentUser.nickname] : []
            };

            if (currentRoom === 'public') {
                publicMessages.push(msgData);
                if (publicMessages.length > 150) publicMessages.shift();
                io.to('public').emit('new-message', msgData);
            } else if (privateRooms[currentRoom]) {
                privateRooms[currentRoom].messages.push(msgData);
                if (privateRooms[currentRoom].messages.length > 150) privateRooms[currentRoom].messages.shift();
                io.to(currentRoom).emit('new-message', msgData);
            }
        } catch (err) {
            console.error('Error in chat-message:', err);
        }
    });

    socket.on('clear-chat', () => {
        try {
            if (currentUser && currentUser.isAdmin) {
                if (currentRoom === 'public') {
                    publicMessages = [];
                    io.to('public').emit('load-messages', []);
                } else if (privateRooms[currentRoom]) {
                    privateRooms[currentRoom].messages = [];
                    io.to(currentRoom).emit('load-messages', []);
                }
            }
        } catch (err) {
            console.error('Error in clear-chat:', err);
        }
    });

    socket.on('verify-admin', (password) => {
        try {
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
        } catch (err) {
            console.error('Error in verify-admin:', err);
        }
    });

    socket.on('ban-user', (data) => {
        try {
            if (currentUser && currentUser.isAdmin) {
                const { targetNickname, durationMs } = data;
                bannedUsers[targetNickname] = Date.now() + durationMs;
                
                const targetUser = allUsers.find(u => u.nickname === targetNickname);
                if (targetUser) {
                    io.to(targetUser.id).emit('banned', 'הושתה עליך חסימה ממערכת הצ\'אט.');
                }
                updateUsersAndRoomsList();
            }
        } catch (err) {
            console.error('Error in ban-user:', err);
        }
    });

    socket.on('kick-user', (targetId) => {
        try {
            if (currentUser && currentUser.isAdmin) {
                io.to(targetId).emit('kicked');
            }
        } catch (err) {
            console.error('Error in kick-user:', err);
        }
    });

    socket.on('disconnect', () => {
        try {
            if (currentUser) {
                const user = allUsers.find(u => u.id === socket.id);
                if (user) {
                    user.online = false;
                    user.lastSeen = getJerusalemTime();
                }
                updateUsersAndRoomsList();
            }
        } catch (err) {
            console.error('Error in disconnect:', err);
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
server.listen(PORT, () => { console.log(`השרת רץ בפורט ${PORT}`); });
