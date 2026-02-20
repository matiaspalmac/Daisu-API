// socket.js
import { db } from './db.js';

const activeConnections = new Map();

function setupSocket(io) {
  io.on('connection', async (socket) => {
    const username = socket.handshake.auth.username ?? 'anonymous';
    const userId = socket.handshake.auth.userId;

    if (!activeConnections.has(userId)) {
      activeConnections.set(userId, socket.id);
      console.log(`User ${username} has connected!`);
    }

    socket.on('disconnect', () => {
      if (activeConnections.has(userId)) {
        activeConnections.delete(userId);
        console.log(`User ${username} has disconnected`);
      }
    });

    socket.on('join room', async (roomId) => {
      socket.join(`room_${roomId}`);
      console.log(`User ${username} joined room ${roomId}`);

      try {
        const results = await db.execute({
          sql: 'SELECT m.id, m.content, m.user_id, u.name as username FROM messages m JOIN users u ON m.user_id = u.id WHERE m.room_id = ? ORDER BY m.sent_at DESC LIMIT 50',
          args: [roomId],
        });

        results.rows.reverse().forEach((row) => {
          socket.emit('chat message', row.content, row.id.toString(), row.username, roomId);
        });
      } catch (e) {
        console.error('Error fetching messages:', e);
      }
    });

    socket.on('leave room', (roomId) => {
      socket.leave(`room_${roomId}`);
      console.log(`User ${username} left room ${roomId}`);
    });

    socket.on('chat message', async (msg, roomId) => {
      try {
        const userCheck = await db.execute({
          sql: 'SELECT id FROM users WHERE id = ?',
          args: [userId],
        });

        if (userCheck.rows.length === 0) {
          throw new Error(`User with id ${userId} does not exist`);
        }

        console.log(roomId);
        const roomCheck = await db.execute({
          sql: 'SELECT id FROM rooms WHERE id = ?',
          args: [roomId],
        });

        if (roomCheck.rows.length === 0) {
          throw new Error(`Room with id ${roomId} does not exist`);
        }

        const result = await db.execute({
          sql: 'INSERT INTO messages (content, user_id, room_id) VALUES (?, ?, ?)',
          args: [msg, userId, roomId],
        });

        io.to(`room_${roomId}`).emit('chat message', msg, result.lastInsertRowid.toString(), username, roomId);
      } catch (e) {
        console.error('Error saving message:', e);
        socket.emit('error', 'Failed to save message');
      }
    }); 

    socket.on('create room', async (roomName) => {
        try {
          const roomCheck = await db.execute({
            sql: 'SELECT id FROM rooms WHERE name = ?',
            args: [roomName],
          });
      
          if (roomCheck.rows.length > 0) {
            socket.emit('room creation error', `Room with name ${roomName} already exists`);
            return;
          }

          const result = await db.execute({
            sql: 'INSERT INTO rooms (name) VALUES (?)',
            args: [roomName],
          });
      
          const roomId = result.lastInsertRowid.toString();
      
          socket.emit('room created', roomId, roomName);
          io.emit('new room', roomId, roomName);
      
        } catch (e) {
          console.error('Error creating room:', e);
          socket.emit('room creation error', 'Failed to create room');
        }
      });
      
  });
}

export { setupSocket };