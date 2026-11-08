const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 15 * 1024 * 1024 // הגדלת נפח להעברת תמונות ואודיו
});

app.use(express.static('public'));

let users = {};          
let messages = {         
    'public': []
};
let privateRooms = {};   
let bannedUsers = {};    

const ADMIN_PASSWORD = "2311";
let currentAdminSocketId = null;

function updateAllData() {
    let allUsers = Object.keys(users).map(id => ({
        id: id,
        nickname: users[id].nickname,
        isAdmin: users[id].isAdmin,
        canSendImages: users[id].canSendImages || false,
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

    // חיבור משתמש - שומר אותו ברשימה לפי ה-socket.id שלו כדי לא לדרוס אחרים עם אותו שם
    socket.on('join', (data) => {
        let { nickname, isAdmin } = data;
        nickname = nickname ? nickname.trim() : 'אורח';

        let grantAdmin = isAdmin || false;
        if (grantAdmin) {
            if (currentAdminSocketId && currentAdminSocketId !== socket.id) {
                grantAdmin = false;
            } else {
                currentAdminSocketId = socket.id;
            }
        }

        users[socket.id] = {
            id: socket.id,
            nickname: nickname,
            isAdmin: grantAdmin,
            canSendImages: grantAdmin ? true : false,
            online: true,
            lastSeen: 'עכשיו'
        };

        socket.join('public');
        socket.emit('load-messages', messages['public'] || []);
        updateAllData();
    });

    socket.on('verify-admin', (password) => {
        if (password === ADMIN_PASSWORD) {
            if (currentAdminSocketId && currentAdminSocketId !== socket.id) {
                if (io.sockets.sockets.get(currentAdminSocketId) && users[currentAdminSocketId] && users[currentAdminSocketId].online) {
                    socket.emit('error-msg', 'כבר קיים מנהל פעיל במערכת!');
                    socket.emit('admin-success', false);
                    return;
                }
            }

            currentAdminSocketId = socket.id;
            if (users[socket.id]) {
                users[socket.id].isAdmin = true;
                users[socket.id].canSendImages = true;
            }
            socket.emit('admin-success', true);
            updateAllData();
        } else {
            socket.emit('admin-success', false);
        }
    });

    socket.on('toggle-image-permission', (targetSocketId) => {
        const user = users[socket.id];
        if (!user || !user.isAdmin) {
            socket.emit('error-msg', 'פעולה מותרת למנהלים בלבד.');
            return;
        }

        if (users[targetSocketId]) {
            users[targetSocketId].canSendImages = !users[targetSocketId].canSendImages;
            updateAllData();
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

        if (data.type === 'image') {
            if (!user || !user.canSendImages) {
                socket.emit('error-msg', 'אין לך הרשאה לשלוח תמונות בצ\'אט.');
                return;
            }
        }

        const newMessage = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            senderSocketId: socket.id,
            nickname: nickname,
            text: data.text || '',
            mediaData: data.mediaData || null,
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
        if (currentAdminSocketId === socket.id) {
            currentAdminSocketId = null;
        }
        // מעדכנים סטטוס ללא מחיקה מהרשימה כדי שכולם יישארו גלויים ברשימת המשתמשים
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
