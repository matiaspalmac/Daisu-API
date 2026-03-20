// src/sockets/index.js — Socket.IO orchestrator
import { db } from '../config/database.js';
import {
  addConnectedUser,
  removeConnectedUser,
  roomOnlineUsers,
  connectedUsers,
  getUsersInRoom,
} from './helpers.js';
import { registerChatEvents } from './chat.sockets.js';
import { registerDMEvents } from './dm.sockets.js';
import { registerModerationEvents } from './moderation.sockets.js';
import { registerCorrectionEvents } from './corrections.sockets.js';

export function setupSocket(io) {
  io.on('connection', async (socket) => {
    // userId and identity come from the verified JWT (set by io.use middleware)
    const userId = socket.user.id;
    const userKey = String(userId);
    let username = 'anonymous';

    // Fetch the username from the database using the verified user id
    try {
      const userRow = await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] });
      if (userRow.rows.length > 0) {
        username = userRow.rows[0].name || 'anonymous';
      }
    } catch (_) { /* fallback to 'anonymous' */ }

    addConnectedUser(userId, socket.id);

    // Persist online status (fire-and-forget)
    db.execute({
      sql: `INSERT INTO user_presence (user_id, is_online, last_seen_at) VALUES (?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET is_online = 1, last_seen_at = CURRENT_TIMESTAMP`,
      args: [userId],
    }).catch(console.error);

    console.log(`User ${username} connected (id=${userId})`);

    const context = { userId, username, userKey };
    registerChatEvents(io, socket, context);
    registerDMEvents(io, socket, context);
    registerModerationEvents(io, socket, context);
    registerCorrectionEvents(io, socket, context);

    // ────────────────────────────────────────────
    // DISCONNECT
    // ────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`${username} disconnected`);
      if (userId !== undefined && userId !== null) removeConnectedUser(userId, socket.id);

      // Persist offline status only if user has no other connected sockets (fire-and-forget)
      if (userId !== undefined && userId !== null && !connectedUsers.has(String(userId))) {
        db.execute({
          sql: 'UPDATE user_presence SET is_online = 0, last_seen_at = CURRENT_TIMESTAMP, current_room_id = NULL WHERE user_id = ?',
          args: [userId],
        }).catch(console.error);
      }

      // Remove from all rooms
      for (const [rId, members] of roomOnlineUsers.entries()) {
        if (members.has(userKey)) {
          members.delete(userKey);
          io.to(`room_${rId}`).emit('user-left', { userId, name: username });
          io.to(`room_${rId}`).emit('online-users', getUsersInRoom(rId));
        }
      }
    });
  });
}
