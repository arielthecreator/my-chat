const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let users = {};          
let messages = {         
    'public': []
};
let privateRooms = {};   
let bannedUsers = {};    

const ADMIN_PASSWORD = "1234";

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

function checkAllReadStatus(roomId, message) {
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (!roomSockets) return false;
    
    let otherSocketsInRoom = 0;
    for (let socketId of roomSockets) {
        if (socketId !== message.senderSocketId) {
            otherSocketsInRoom++;
        }
    }

    if (otherSocketsInRoom === 0) return false;

    let readCountByOthers = 0;
    roomSockets.forEach(socketId => {
        if (socketId !== message.senderSocketId && message.readBy && message.readBy.includes(socketId)) {
            readCountByOthers++;
        }
    });

    return readCountByOthers >= otherSocketsInRoom;
}

io.on('connection', (socket) => {
    console.log('משתמש התחבר:', socket.id);

    if (bannedUsers[socket.id] && bannedUsers[socket.id] > Date.now()) {
        socket.emit('banned', 'אתה חסום מהצ\'אט.');
        return;
    }

    socket.on('join', (data) => {
        const { nickname, isAdmin } = data;
        
        for (let id in users) {
            if (users[id].nickname === nickname && id !== socket.id) {
                delete users[id];
            }
        }
        
        users[socket.id] = {
            nickname: nickname,
            isAdmin: isAdmin || false,
            online: true,
            lastSeen: 'עכשיו'
        };

        socket.join('public');
        socket.emit('load-messages', messages['public'] || []);
        updateAllData();
    });

    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            if (users[socket.id]) users[socket.id].isAdmin = true;
            socket.emit('admin-success', true);
            updateAllData();
        } else {
            socket.emit('admin-success', false);
        }
    });

    socket.on('switch-room', (roomId) => {
        for (let r of socket.rooms) {
            if (r !== socket.id) socket.leave(r);
        }
        socket.join(roomId);
        if (!messages[roomId]) messages[roomId] = [];
        socket.emit('load-messages', messages[roomId]);
    });

    socket.on('create-private-room', (data) => {
        const { roomName, targetNickname } = data;
        const creatorNick = users[socket.id] ? users[socket.id].nickname : 'אורח';
        
        // בדיקה האם כבר קיים צ'אט פרטי בדיוק בין שני המשתמשים האלו כדי למנוע שכפולים!
        let existingRoomId = null;
        for (let rId in privateRooms) {
            let members = privateRooms[rId].members;
            if (members && members.includes(creatorNick) && members.includes(targetNickname) && members.length === 2) {
                existingRoomId = rId;
                break;
            }
        }

        if (existingRoomId) {
            // אם כבר קיים, פשוט נכניס אליו במקום ליצור חדש
            let targetSocketId = null;
            for (let id in users) {
                if (users[id].nickname === targetNickname) {
                    targetSocketId = id;
                    break;
                }
            }
            socket.join(existingRoomId);
            if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
                io.sockets.sockets.get(targetSocketId).join(existingRoomId);
            }
            socket.emit('room-created', existingRoomId);
            return;
        }

        let roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        
        privateRooms[roomId] = {
            name: roomName,
            members: [creatorNick, targetNickname]
        };
        messages[roomId] = [];

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

    socket.on('chat-message', (data) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) { currentRoom = r; break; }
        }

        const user = users[socket.id];
        const nickname = user ? user.nickname : data.nickname;

        const newMessage = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            senderSocketId: socket.id,
            nickname: nickname,
            text: data.text,
            type: data.type || 'text',
            replyTo: data.replyTo || null,
            role: user && user.isAdmin ? 'מנהל' : null,
            time: new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }),
            readBy: [socket.id],
            reactions: {},
            isAllRead: false
        };

        if (!messages[currentRoom]) messages[currentRoom] = [];
        messages[currentRoom].push(newMessage);

        io.to(currentRoom).emit('new-message', newMessage);
    });

    socket.on('mark-as-read', () => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) { currentRoom = r; break; }
        }

        if (messages[currentRoom]) {
            let updated = false;
            messages[currentRoom].forEach(msg => {
                if (!msg.readBy) msg.readBy = [];
                if (!msg.readBy.includes(socket.id)) {
                    msg.readBy.push(socket.id);
                    updated = true;
                }
                let allReadNow = checkAllReadStatus(currentRoom, msg);
                if (msg.isAllRead !== allReadNow) {
                    msg.isAllRead = allReadNow;
                    updated = true;
                }
            });

            if (updated) {
                io.to(currentRoom).emit('update-messages-status', messages[currentRoom]);
            }
        }
    });

    socket.on('typing', (isTyping) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) { currentRoom = r; break; }
        }
        const user = users[socket.id];
        if (user) {
            socket.to(currentRoom).emit('user-typing', {
                nickname: user.nickname,
                isTyping: isTyping
            });
        }
    });

    socket.on('delete-message', (messageId) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) { currentRoom = r; break; }
        }
        
        if (messages[currentRoom]) {
            messages[currentRoom] = messages[currentRoom].filter(m => m.id !== messageId);
            io.to(currentRoom).emit('message-deleted', messageId);
        }
    });

    socket.on('reaction-message', (data) => {
        let currentRoom = 'public';
        for (let r of socket.rooms) {
            if (r !== socket.id) { currentRoom = r; break; }
        }
        
        const { messageId, emoji } = data;
        const user = users[socket.id];
        if (!user) return;
        const nickname = user.nickname;

        if (messages[currentRoom]) {
            const msg = messages[currentRoom].find(m => m.id === messageId);
            if (msg) {
                if (!msg.reactions) msg.reactions = {};
                
                if (msg.reactions[nickname] === emoji) {
                    delete msg.reactions[nickname]; 
                } else {
                    msg.reactions[nickname] = emoji; 
                }

                io.to(currentRoom).emit('message-reaction-updated', { messageId, reactions: msg.reactions });
            }
        }
    });

    socket.on('clear-current-chat', (roomId) => {
        if (users[socket.id] && users[socket.id].isAdmin) {
            messages[roomId] = [];
            io.to(roomId).emit('load-messages', []);
        }
    });

    socket.on('delete-private-room', (roomId) => {
        delete privateRooms[roomId];
        delete messages[roomId];
        io.to(roomId).emit('room-deleted-by-admin', roomId);
        updateAllData();
    });

    socket.on('ban-user', (data) => {
        if (users[socket.id] && users[socket.id].isAdmin) {
            const { targetId, durationMs } = data;
            bannedUsers[targetId] = Date.now() + durationMs;
            if (io.sockets.sockets.get(targetId)) {
                io.sockets.sockets.get(targetId).emit('banned', 'הושתה עליך חסימה.');
                io.sockets.sockets.get(targetId).disconnect();
            }
            delete users[targetId];
            updateAllData();
        }
    });

    socket.on('disconnect', () => {
        console.log('משתמש התנתק:', socket.id);
        if (users[socket.id]) {
            users[socket.id].online = false;
            users[socket.id].lastSeen = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
        }
        updateAllData();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`השרת רץ בהצלחה בפורט ${PORT}`);
});
