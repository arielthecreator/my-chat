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

    // צ'אט אישי (בין שניים)
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
            members: [creatorNick, targetNickname],
            admins: [creatorNick],
            settings: { editNameBy: 'all', addMembersBy: 'all' }
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

    // פתיחת קבוצה מרובת משתמשים
    socket.on('create-group-room', (data) => {
        const { roomName, selectedMembers } = data;
        const creatorNick = users[socket.id] ? users[socket.id].nickname : 'אורח';
        
        let members = [creatorNick, ...selectedMembers];
        members = [...new Set(members)];

        let roomId = 'group_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        privateRooms[roomId] = {
            name: roomName,
            members: members,
            admins: [creatorNick],
            settings: {
                editNameBy: 'all',
                addMembersBy: 'all'
            }
        };
        messages[roomId] = [];

        socket.join(roomId);
        members.forEach(nick => {
            for (let id in users) {
                if (users[id].nickname === nick) {
                    let s = io.sockets.sockets.get(id);
                    if (s) s.join(roomId);
                }
            }
        });

        socket.emit('room-created', roomId);
        updateAllData();
    });

    // עדכון הגדרות קבוצה
    socket.on('update-group-settings', (data) => {
        const { roomId, newName, settings } = data;
        const user = users[socket.id];
        if (!user || !privateRooms[roomId]) return;

        let room = privateRooms[roomId];
        let isGroupAdmin = room.admins && room.admins.includes(user.nickname);
        let isSuperAdmin = user.isAdmin;

        if (newName && newName.trim() !== '') {
            if (room.settings.editNameBy === 'admin' && !isGroupAdmin && !isSuperAdmin) {
                socket.emit('error-msg', 'רק מנהל קבוצה יכול לשנות את שם הקבוצה.');
                return;
            }
            room.name = newName.trim();
        }

        if (settings) {
            if (!isGroupAdmin && !isSuperAdmin) {
                socket.emit('error-msg', 'רק מנהל קבוצה יכול לשנות הגדרות.');
                return;
            }
            room.settings.editNameBy = settings.editNameBy || room.settings.editNameBy;
            room.settings.addMembersBy = settings.addMembersBy || room.settings.addMembersBy;
        }

        updateAllData();
        io.to(roomId).emit('room-settings-updated', room);
    });

    // הוספת חברים
    socket.on('add-members-to-group', (data) => {
        const { roomId, newMembers } = data;
        const user = users[socket.id];
        if (!user || !privateRooms[roomId]) return;

        let room = privateRooms[roomId];
        let isGroupAdmin = room.admins && room.admins.includes(user.nickname);
        let isSuperAdmin = user.isAdmin;

        if (room.settings.addMembersBy === 'admin' && !isGroupAdmin && !isSuperAdmin) {
            socket.emit('error-msg', 'רק מנהל קבוצה יכול להוסיף חברים חדשים.');
            return;
        }

        newMembers.forEach(nick => {
            if (!room.members.includes(nick)) {
                room.members.push(nick);
                for (let id in users) {
                    if (users[id].nickname === nick) {
                        let s = io.sockets.sockets.get(id);
                        if (s) s.join(roomId);
                    }
                }
            }
        });

        updateAllData();
        io.to(roomId).emit('room-settings-updated', room);
    });

    // ניהול משתמשים (הסרה, מינוי מנהל, הורדה ממנהל)
    socket.on('manage-group-member', (data) => {
        const { roomId, targetNickname, action } = data;
        const user = users[socket.id];
        if (!user || !privateRooms[roomId]) return;

        let room = privateRooms[roomId];
        let isGroupAdmin = room.admins && room.admins.includes(user.nickname);
        let isSuperAdmin = user.isAdmin;

        if (!isGroupAdmin && !isSuperAdmin) {
            socket.emit('error-msg', 'פעולת ניהול מותרת למנהלים בלבד.');
            return;
        }

        if (action === 'remove') {
            room.members = room.members.filter(m => m !== targetNickname);
            room.admins = room.admins.filter(a => a !== targetNickname);
            for (let id in users) {
                if (users[id].nickname === targetNickname) {
                    let s = io.sockets.sockets.get(id);
                    if (s) s.leave(roomId);
                }
            }
        } else if (action === 'promote') {
            if (!room.admins.includes(targetNickname)) {
                room.admins.push(targetNickname);
            }
        } else if (action === 'demote') {
            if (room.admins.length === 1 && room.members.length > 1) {
                socket.emit('error-msg', 'חייב להישאר לפחות מנהל אחד בקבוצה לפני הסרת מנהל זה.');
                return;
            }
            room.admins = room.admins.filter(a => a !== targetNickname);
        }

        updateAllData();
        io.to(roomId).emit('room-settings-updated', room);
    });

    // עזיבת קבוצה ע"י חבר
    socket.on('leave-group', (roomId) => {
        const user = users[socket.id];
        if (!user || !privateRooms[roomId]) return;

        let room = privateRooms[roomId];
        let isGroupAdmin = room.admins && room.admins.includes(user.nickname);

        if (isGroupAdmin && room.admins.length === 1 && room.members.length > 1) {
            socket.emit('error-msg', 'אינך יכול לעזוב כי אתה מנהל יחיד. עליך למנות מנהל אחר לפני העזיבה.');
            return;
        }

        room.members = room.members.filter(m => m !== user.nickname);
        room.admins = room.admins.filter(a => a !== user.nickname);
        socket.leave(roomId);

        updateAllData();
        io.to(roomId).emit('room-settings-updated', room);
        socket.emit('left-room-success');
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
            role:
