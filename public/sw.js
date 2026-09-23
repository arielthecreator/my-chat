self.addEventListener('push', function(event) {
    let data = { title: 'הודעה חדשה', body: 'התקבלה הודעה חדשה בצ\'אט' };
    if (event.data) {
        data = event.data.json();
    }

    const options = {
        body: data.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/1041/1041916.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/1041/1041916.png',
        vibrate: [200, 100, 200]
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});
