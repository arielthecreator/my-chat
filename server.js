<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>צ'אט קבוצתי מתקדם</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background-color: #e5ddd5; height: 100vh; display: flex; justify-content: center; align-items: center; }
        .app-container { display: flex; width: 100vw; height: 100vh; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        
        /* סיידבר */
        .sidebar { width: 300px; background: #f8f9fa; border-left: 1px solid #ddd; display: flex; flex-direction: column; padding: 15px; }
        .sidebar-header { font-size: 18px; font-weight: bold; margin-bottom: 15px; color: #333; }
        .sidebar-content { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .user-mgmt-item, .room-item { background: white; padding: 10px; border-radius: 6px; border: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
        .online-status { color: #4caf50; font-weight: bold; font-size: 11px; }
        .offline-status { color: #f44336; font-size: 11px; }

        /* אזור הצ'אט המרכזי */
        .chat-main { flex: 1; display: flex; flex-direction: column; background: #efeae2; }
        .chat-header { padding: 15px; background: #007bff; color: white; display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: bold; }
        .messages-container { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        
        .message { max-width: 65%; padding: 10px 14px; border-radius: 8px; position: relative; word-break: break-word; font-size: 14px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); }
        .message.incoming { background: #ffffff; align-self: flex-start; border-top-right-radius: 0; }
        .message.outgoing { background: #dcf8c6; align-self: flex-end; border-top-left-radius: 0; }
        .message.system { background: #e2e2e2; align-self: center; max-width: 90%; font-size: 12px; color: #555; text-align: center; }
        
        .msg-info { font-size: 11px; color: #777; margin-top: 4px; display: flex; justify-content: flex-end; gap: 5px; }
        .msg-nickname { font-weight: bold; color: #007bff; margin-bottom: 2px; font-size: 12px; }

        /* אזור הקלדה */
        .chat-input-area { padding: 15px; background: #f0f0f0; display: flex; gap: 10px; align-items: center; }
        .chat-input-area input { flex: 1; padding: 10px 14px; border: 1px solid #ccc; border-radius: 20px; outline: none; font-size: 14px; }
        .chat-input-area button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: bold; }
        .chat-input-area button:hover { background: #0056b3; }

        /* מסך כניסה */
        #login-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 1000; }
        .login-box { background: white; padding: 30px; border-radius: 10px; text-align: center; width: 320px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .login-box input { width: 100%; padding: 10px; margin: 15px 0; border: 1px solid #ccc; border-radius: 5px; font-size: 14px; }
        .login-box button { width: 100%; padding: 10px; background: #28a745; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
        
        .menu-action-btn { width: 100%; padding: 8px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; text-align: center; }
    </style>
</head>
<body>

    <!-- מסך בחירת כינוי -->
    <div id="login-overlay">
        <div class="login-box">
            <h2>ברוכים הבאים לצ'אט</h2>
            <input type="text" id="nickname-input" placeholder="הכנס את הכינוי שלך..." maxlength="15">
            <button onclick="login()">הכנס לצ'אט</button>
        </div>
    </div>

    <div class="app-container">
        <!-- אזור הצ'אט המרכזי -->
        <div class="chat-main">
            <div class="chat-header">
                <span id="room-title">צ'אט קבוצתי</span>
                <div>
                    <button style="background:transparent; color:white; border:1px solid white; padding:5px 10px; border-radius:4px; cursor:pointer;" onclick="openAdminLogin()">פאנל מנהל</button>
                </div>
            </div>
            
            <div class="messages-container" id="messages"></div>

            <div class="chat-input-area">
                <input type="text" id="message-input" placeholder="הקלד הודעה..." onkeypress="checkEnter(event)">
                <button onclick="sendMessage()">שלח</button>
            </div>
        </div>

        <!-- סיידבר צדדי -->
        <div class="sidebar">
            <div class="sidebar-header" id="sidebar-title">משתמשים מחוברים</div>
            <div class="sidebar-content" id="sidebar-content">
                <!-- רשימת המשתמשים והצ'אטים תופיע כאן אוטומטית -->
            </div>
        </div>
    </div>

    <!-- סקריפט חיבור לשרת Socket.io -->
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        
        let currentNickname = '';
        let isUserAdmin = false;
        let currentRoomId = 'public';
        let currentRoomName = 'צ\'אט קבוצתי';
        let globalUsers = [];
        let globalRooms = {};

        function login() {
            const input = document.getElementById('nickname-input');
            const nickname = input.value.trim();
            if (!nickname) {
                alert('אנא הכנס כינוי תקין');
                return;
            }
            currentNickname = nickname;
            document.getElementById('login-overlay').style.display = 'none';
            socket.emit('join', { nickname: nickname, isAdmin: isUserAdmin });
        }

        function checkEnter(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        }

        function sendMessage() {
            const input = document.getElementById('message-input');
            const text = input.value.trim();
            if (!text) return;

            socket.emit('chat-message', {
                text: text,
                nickname: currentNickname
            });
            input.value = '';
        }

        function switchToRoom(roomId, roomName) {
            currentRoomId = roomId;
            currentRoomName = roomName;
            document.getElementById('room-title').innerText = roomName;
            socket.emit('switch-room', roomId);
        }

        function createPrivateChatWithUser(targetNickname) {
            const roomName = `צ'אט: ${currentNickname} & ${targetNickname}`;
            socket.emit('create-private-room', { roomName, targetNickname });
        }

        socket.on('room-created', (roomId) => {
            switchToRoom(roomId, `צ'אט פרטי`);
        });

        function deleteRoom(roomId) {
            if (confirm('האם אתה בטוח שברצונך למחוק את החדר הזה?')) {
                socket.emit('delete-private-room', roomId);
            }
        }

        function kickUser(targetId) {
            if (confirm('האם אתה בטוח שברצונך להסיר משתמש זה?')) {
                socket.emit('kick-user', targetId);
            }
        }

        socket.on('kicked', () => {
            alert('הוסרת מהמערכת על ידי מנהל.');
            window.location.reload();
        });

        function promptRole(targetId) {
            const role = prompt('הכנס תפקיד חדש למשתמש (למשל: מנהל משנה / VIP):');
            if (role) {
                socket.emit('set-role', { targetId, role });
            }
        }

        function openAdminLogin() {
            const password = prompt('הכנס סיסמת מנהל מערכת:');
            if (password) {
                socket.emit('verify-admin', password);
            }
        }

        socket.on('admin-success', (success) => {
            if (success) {
                isUserAdmin = true;
                alert('התחברת בהצלחה כמנהל מערכת!');
                socket.emit('join', { nickname: currentNickname, isAdmin: true });
            } else {
                alert('סיסמה שגויה!');
            }
        });

        socket.on('load-messages', (messages) => {
            const container = document.getElementById('messages');
            container.innerHTML = '';
            messages.forEach(msg => appendMessage(msg));
        });

        socket.on('new-message', (msg) => {
            appendMessage(msg);
        });

        function appendMessage(msg) {
            const container = document.getElementById('messages');
            const div = document.createElement('div');
            
            if (msg.system) {
                div.className = 'message system';
                div.innerText = msg.text;
            } else {
                div.className = msg.nickname === currentNickname ? 'message outgoing' : 'message incoming';
                div.innerHTML = `
                    <div class="msg-nickname">${msg.nickname} ${msg.role ? '('+msg.role+')' : ''}</div>
                    <div>${msg.text}</div>
                    <div class="msg-info"><span>${msg.time}</span></div>
                `;
            }
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        socket.on('update-data', (data) => {
            globalUsers = data.allUsers;
            globalRooms = data.privateRooms;
            const sidebarContent = document.getElementById('sidebar-content');
            const sidebarTitle = document.getElementById('sidebar-title');
            sidebarContent.innerHTML = '';

            // כפתור חזרה לצ'אט הראשי - מופיע רק כשנמצאים בצ'אט פרטי
            if (currentRoomId !== 'public') {
                const backBtn = document.createElement('button');
                backBtn.className = 'menu-action-btn';
                backBtn.style.backgroundColor = '#607d8b';
                backBtn.style.marginBottom = '10px';
                backBtn.innerText = '⬅️ חזרה לצ\'אט הראשי';
                backBtn.onclick = () => switchToRoom('public', 'צ\'אט קבוצתי');
                sidebarContent.appendChild(backBtn);
            }

            if (isUserAdmin) {
                sidebarTitle.innerText = "פאנל מנהל מערכת";

                let adminHeaderTitle = document.createElement('div');
                adminHeaderTitle.innerHTML = '<strong style="color:#d32f2f; font-size:13px;">ניהול משתמשים:</strong>';
                sidebarContent.appendChild(adminHeaderTitle);

                globalUsers.forEach(user => {
                    if (user.nickname !== currentNickname) {
                        const item = document.createElement('div');
                        item.className = 'user-mgmt-item';
                        let statusHtml = user.online ? `<span class="online-status">מחובר</span>` : `<span class="offline-status">נראה: ${user.lastSeen}</span>`;
                        item.innerHTML = `
                            <span style="flex:1;"><strong>${user.nickname}</strong><br>${statusHtml}</span>
                            <div style="display:flex; gap:2px;">
                                <button style="background:#0084ff;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;" onclick="createPrivateChatWithUser('${user.nickname}')">צ'אט</button>
                                <button style="background:#4caf50;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;" onclick="promptRole('${user.id}')">מנהל</button>
                                ${user.online ? `<button style="background:#e53935;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;" onclick="kickUser('${user.id}')">הסר</button>` : ''}
                            </div>
                        `;
                        sidebarContent.appendChild(item);
                    }
                });

                let roomsHeaderTitle = document.createElement('div');
                roomsHeaderTitle.innerHTML = '<br><strong style="color:#d32f2f; font-size:13px;">כל הצ\'אטים האישיים במערכת:</strong>';
                sidebarContent.appendChild(roomsHeaderTitle);

                const roomsKeys = Object.keys(globalRooms);
                if (roomsKeys.length === 0) {
                    let noRooms = document.createElement('div');
                    noRooms.style.fontSize = '12px';
                    noRooms.style.color = '#777';
                    noRooms.innerText = 'אין צ\'אטים אישיים כרגע.';
                    sidebarContent.appendChild(noRooms);
                } else {
                    roomsKeys.forEach(rId => {
                        let room = globalRooms[rId];
                        let item = document.createElement('div');
                        item.className = 'room-item';
                        item.innerHTML = `
                            <span style="flex:1;"><strong>${room.name}</strong><br><small>${room.members.join(', ')}</small></span>
                            <div style="display:flex; gap:2px;">
                                <button style="background:#0084ff;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;" onclick="switchToRoom('${rId}', '${room.name.replace(/'/g, "\\'")}')">הכנס</button>
                                <button style="background:#e53935;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;" onclick="deleteRoom('${rId}')">מחק</button>
                            </div>
                        `;
                        sidebarContent.appendChild(item);
                    });
                }
            } else {
                sidebarTitle.innerText = "משתמשים מחוברים";
                globalUsers.forEach(user => {
                    if (user.nickname !== currentNickname) {
                        const item = document.createElement('div');
                        item.className = 'user-mgmt-item';
                        let statusHtml = user.online ? `<span class="online-status">מחובר כעת</span>` : `<span class="offline-status">התחבר ב-${user.lastSeen}</span>`;
                        item.innerHTML = `
                            <span style="flex:1;"><strong>${user.nickname}</strong><br>${statusHtml}</span>
                            <button style="background:#0084ff;color:white;border:none;padding:4px 8px;border-radius:3px;cursor:pointer;font-weight:bold;" onclick="createPrivateChatWithUser('${user.nickname}')">💬 צ'אט</button>
                        `;
                        sidebarContent.appendChild(item);
                    }
                });

                let myRoomsHeader = document.createElement('div');
                myRoomsHeader.innerHTML = '<br><strong style="font-size:13px;">הצ\'אטים הפרטיים שלי:</strong>';
                sidebarContent.appendChild(myRoomsHeader);

                let myRooms = Object.keys(globalRooms).filter(rId => globalRooms[rId].members.includes(currentNickname));
                if (myRooms.length === 0) {
                    let noMyRooms = document.createElement('div');
                    noMyRooms.style.fontSize = '12px';
                    noMyRooms.style.color = '#777';
                    noMyRooms.innerText = 'אין לך צ\'אטים אישיים פעילים.';
                    sidebarContent.appendChild(noMyRooms);
                } else {
                    myRooms.forEach(rId => {
                        let room = globalRooms[rId];
                        let item = document.createElement('div');
                        item.className = 'room-item';
                        item.innerHTML = `
                            <span style="flex:1;"><strong>${room.name}</strong></span>
                            <div style="display:flex; gap:2px;">
                                <button style="background:#0084ff;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;" onclick="switchToRoom('${rId}', '${room.name.replace(/'/g, "\\'")}')">הכנס</button>
                                <button style="background:#e53935;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;" onclick="deleteRoom('${rId}')">מחק</button>
                            </div>
                        `;
                        sidebarContent.appendChild(item);
                    });
                }
            }
        });
    </script>
</body>
</html>
