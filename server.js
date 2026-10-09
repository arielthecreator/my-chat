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

    // פתיחת צ'אט פרטי (בין שני אנשים)
    socket.on('create-private-room', (data) => {
        const { roomName, targetNickname } = data;
        const creatorNick = users[socket.id] ? users[socket.id].nickname : 'אורח';
        
        let existingRoomId = null;
        for (let rId in privateRooms) {
            let members = privateRooms[rId].members;
            if (members && members.includes(creatorNick) && members.includes(targetNickname) && members.length === 2) {
                existingRoomId = rId;
                break;
            }
        }

        if (existingRoomId) {
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
        
