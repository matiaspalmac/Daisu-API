// sockets.js — Daisu Language Learning Platform
import { franc } from 'franc-min';
import { db, DAILY_PROMPTS } from './db.js';

// Online users per room: Map<roomId, Map<userId, {name, image, targetLang}>>
const roomOnlineUsers = new Map();

function getUsersInRoom(roomId) {
  return roomId && roomOnlineUsers.has(roomId)
    ? Array.from(roomOnlineUsers.get(roomId).values())
    : [];
}

function setupSocket(io) {
  io.on('connection', async (socket) => {
    const username = socket.handshake.auth.username ?? 'anonymous';
    const userId = socket.handshake.auth.userId;
    let userImage = '';
    let userTargetLang = '';

    // Load user meta in background (do not block listener registration)
    if (userId) {
      void db.execute({ sql: 'SELECT image, targetLang FROM users WHERE id = ?', args: [userId] })
        .then(u => {
          if (u.rows.length > 0) {
            userImage = u.rows[0].image || '';
            userTargetLang = u.rows[0].targetLang || '';
          }
        })
        .catch(() => { });
    }

    console.log(`User ${username} connected (id=${userId})`);

    // ────────────────────────────────────────────
    // JOIN ROOM
    // ────────────────────────────────────────────
    socket.on('join room', async (roomId) => {
      // Leave all previous rooms
      const prevRooms = Array.from(socket.rooms).filter(r => r !== socket.id && r.startsWith('room_'));
      for (const r of prevRooms) {
        const prevId = r.replace('room_', '');
        socket.leave(r);
        if (roomOnlineUsers.has(prevId)) {
          roomOnlineUsers.get(prevId).delete(String(userId));
          socket.to(r).emit('user-left', { userId, name: username });
          io.to(r).emit('online-users', getUsersInRoom(prevId));
        }
      }

      socket.join(`room_${roomId}`);
      console.log(`${username} joined room ${roomId}`);

      // Track online
      if (!roomOnlineUsers.has(String(roomId))) roomOnlineUsers.set(String(roomId), new Map());
      roomOnlineUsers.get(String(roomId)).set(String(userId), { userId, name: username, image: userImage, targetLang: userTargetLang });

      // Broadcast join
      socket.to(`room_${roomId}`).emit('user-joined', { userId, name: username, image: userImage });
      io.to(`room_${roomId}`).emit('online-users', getUsersInRoom(String(roomId)));

      // Send daily prompt
      try {
        const roomRes = await db.execute({ sql: 'SELECT daily_prompt, language FROM rooms WHERE id = ?', args: [roomId] });
        if (roomRes.rows.length > 0) {
          const { daily_prompt, language } = roomRes.rows[0];
          if (daily_prompt) socket.emit('daily-prompt', daily_prompt);
          else if (language && DAILY_PROMPTS[language]) {
            const prompt = DAILY_PROMPTS[language][new Date().getDay() % DAILY_PROMPTS[language].length];
            socket.emit('daily-prompt', prompt);
          }
        }
      } catch (_) { }

      // Send message history
      try {
        const results = await db.execute({
          sql: `SELECT m.id, m.content, m.user_id, u.name as username, u.image as user_image, m.sent_at, m.detected_lang
                FROM messages m JOIN users u ON m.user_id = u.id
                WHERE m.room_id = ? ORDER BY m.sent_at DESC LIMIT 60`,
          args: [roomId],
        });

        const rows = results.rows.reverse();
        const history = await Promise.all(rows.map(async (row) => {
          let reactions = [];
          try {
            const reactionRows = await db.execute({
              sql: 'SELECT emoji, user_id FROM reactions WHERE message_id = ?',
              args: [row.id],
            });
            reactions = reactionRows.rows.map(r => ({ emoji: r.emoji, userId: r.user_id }));
          } catch (_) {
            reactions = [];
          }

          return {
            id: row.id?.toString?.() || String(row.id),
            content: row.content,
            username: row.username,
            roomId,
            timestamp: row.sent_at,
            userImage: row.user_image || '',
            reactions,
            senderId: row.user_id?.toString?.() || row.user_id,
            detectedLang: row.detected_lang || '',
          };
        }));

        socket.emit('chat-history', history);
      } catch (e) { console.error('Error fetching history:', e); }
    });

    // ────────────────────────────────────────────
    // LEAVE ROOM
    // ────────────────────────────────────────────
    socket.on('leave room', (roomId) => {
      socket.leave(`room_${roomId}`);
      if (roomOnlineUsers.has(String(roomId))) {
        roomOnlineUsers.get(String(roomId)).delete(String(userId));
        socket.to(`room_${roomId}`).emit('user-left', { userId, name: username });
        io.to(`room_${roomId}`).emit('online-users', getUsersInRoom(String(roomId)));
      }
    });

    // ────────────────────────────────────────────
    // DISCONNECT
    // ────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`${username} disconnected`);
      // Remove from all rooms
      for (const [rId, members] of roomOnlineUsers.entries()) {
        if (members.has(String(userId))) {
          members.delete(String(userId));
          io.to(`room_${rId}`).emit('user-left', { userId, name: username });
          io.to(`room_${rId}`).emit('online-users', getUsersInRoom(rId));
        }
      }
    });

    // ────────────────────────────────────────────
    // CHAT MESSAGE
    // ────────────────────────────────────────────
    socket.on('chat message', async (msg, roomId) => {
      if (!msg?.trim()) return;
      try {
        const userCheck = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [userId] });
        if (userCheck.rows.length === 0) return;
        const roomCheck = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomId] });
        if (roomCheck.rows.length === 0) return;

        // Detect language of message
        const detectedLang = franc(msg.trim(), { minLength: 5 }) || 'und';

        const result = await db.execute({
          sql: 'INSERT INTO messages (content, user_id, room_id, detected_lang) VALUES (?, ?, ?, ?)',
          args: [msg.trim(), userId, roomId, detectedLang],
        });

        const msgId = result.lastInsertRowid.toString();

        io.to(`room_${roomId}`).emit('chat message', msg.trim(), msgId, username, roomId, new Date().toISOString(), userImage, [], String(userId), detectedLang);

        // Update user stats (non-blocking for chat delivery)
        try {
          const wordCount = msg.trim().split(/\s+/).length;
          await db.execute({
            sql: `INSERT INTO user_stats (user_id, messages_sent, words_sent, last_active) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET messages_sent = messages_sent + 1, words_sent = words_sent + ?, last_active = CURRENT_TIMESTAMP`,
            args: [userId, wordCount, wordCount],
          });
          await db.execute({ sql: 'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?', args: [userId] });
        } catch (statsError) {
          console.error('Stats update error:', statsError);
        }
      } catch (e) {
        console.error('Error saving message:', e);
        socket.emit('error', 'Failed to send message');
      }
    });

    // ────────────────────────────────────────────
    // TYPING
    // ────────────────────────────────────────────
    socket.on('typing-start', (roomId) => {
      socket.to(`room_${roomId}`).emit('user-typing', { userId, name: username });
    });
    socket.on('typing-stop', (roomId) => {
      socket.to(`room_${roomId}`).emit('user-stop-typing', { userId });
    });

    // ────────────────────────────────────────────
    // REACTIONS
    // ────────────────────────────────────────────
    socket.on('react', async ({ messageId, emoji, roomId }) => {
      try {
        // Toggle: insert or delete
        const existing = await db.execute({
          sql: 'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
          args: [messageId, userId, emoji],
        });
        if (existing.rows.length > 0) {
          await db.execute({ sql: 'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', args: [messageId, userId, emoji] });
        } else {
          await db.execute({ sql: 'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', args: [messageId, userId, emoji] });
        }
        // Broadcast updated reactions for this message
        const allReactions = await db.execute({
          sql: 'SELECT emoji, user_id FROM reactions WHERE message_id = ?', args: [messageId],
        });
        io.to(`room_${roomId}`).emit('reaction-update', { messageId, reactions: allReactions.rows.map(r => ({ emoji: r.emoji, userId: r.user_id })) });
      } catch (e) { console.error('Reaction error:', e); }
    });

    // ────────────────────────────────────────────
    // CREATE ROOM
    // ────────────────────────────────────────────
    socket.on('create room', async ({ name, language, level }) => {
      try {
        const exists = await db.execute({ sql: 'SELECT id FROM rooms WHERE name = ?', args: [name] });
        if (exists.rows.length > 0) { socket.emit('room creation error', 'Room already exists'); return; }
        const result = await db.execute({
          sql: 'INSERT INTO rooms (name, language, level, type) VALUES (?, ?, ?, ?)',
          args: [name, language || '', level || '', 'public'],
        });
        const roomId = result.lastInsertRowid.toString();
        socket.emit('room created', roomId, name);
        io.emit('new room', { id: roomId, name, language: language || '', level: level || '', is_default: 0, type: 'public', description: '' });
      } catch (e) { console.error('Create room error:', e); socket.emit('room creation error', 'Failed'); }
    });
  });
}

export { setupSocket };