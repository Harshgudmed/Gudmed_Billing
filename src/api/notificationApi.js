import client from './client'

// The signed-in person's in-app notifications (the bell). The server only ever
// returns and marks this person's own rows in their own hospital.
export const notificationApi = {
  inbox:       (limit = 30) => client.get('/notifications/inbox', { params: { limit } }), // { data, unread }
  markRead:    (ids)        => client.patch('/notifications/inbox', { ids }),
  markAllRead: ()           => client.patch('/notifications/inbox', { all: true }),
}
