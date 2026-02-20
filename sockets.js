// sockets.js — Daisu Language Learning Platform
import { franc } from 'franc-min';
import { db, DAILY_PROMPTS } from './db.js';

// Online users per room: Map<roomId, Map<userId, {name, image, targetLang}>>
const roomOnlineUsers = new Map();
// Connected sockets per user: Map<userId, Set<socketId>>
const connectedUsers = new Map();

function addConnectedUser(userId, socketId) {
  const key = String(userId);
  if (!connectedUsers.has(key)) connectedUsers.set(key, new Set());
  connectedUsers.get(key).add(socketId);
}

function removeConnectedUser(userId, socketId) {
  const key = String(userId);
  if (!connectedUsers.has(key)) return;
  connectedUsers.get(key).delete(socketId);
  if (connectedUsers.get(key).size === 0) connectedUsers.delete(key);
}

function emitToUser(io, userId, event, payload) {
  const sockets = connectedUsers.get(String(userId));
  if (!sockets || sockets.size === 0) return false;
  for (const socketId of sockets) io.to(socketId).emit(event, payload);
  return true;
}

function getUsersInRoom(roomId) {
  return roomId && roomOnlineUsers.has(roomId)
    ? Array.from(roomOnlineUsers.get(roomId).values())
    : [];
}

function setupSocket(io) {
  io.on('connection', async (socket) => {
    const username = socket.handshake.auth.username ?? 'anonymous';
    const userId = socket.handshake.auth.userId;
    const userKey = String(userId ?? socket.id);
    let userImage = '';
    let userTargetLang = '';

    if (userId !== undefined && userId !== null) addConnectedUser(userId, socket.id);

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
      roomOnlineUsers.get(String(roomId)).set(userKey, { userId, name: username, image: userImage, targetLang: userTargetLang });

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
        roomOnlineUsers.get(String(roomId)).delete(userKey);
        socket.to(`room_${roomId}`).emit('user-left', { userId, name: username });
        io.to(`room_${roomId}`).emit('online-users', getUsersInRoom(String(roomId)));
      }
    });

    // ────────────────────────────────────────────
    // DISCONNECT
    // ────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`${username} disconnected`);
      if (userId !== undefined && userId !== null) removeConnectedUser(userId, socket.id);
      // Remove from all rooms
      for (const [rId, members] of roomOnlineUsers.entries()) {
        if (members.has(userKey)) {
          members.delete(userKey);
          io.to(`room_${rId}`).emit('user-left', { userId, name: username });
          io.to(`room_${rId}`).emit('online-users', getUsersInRoom(rId));
        }
      }
    });

    // ────────────────────────────────────────────
    // CHAT MESSAGE
    // ────────────────────────────────────────────
    socket.on('chat message', async (msg, roomId, clientTempId, ack) => {
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

        io.to(`room_${roomId}`).emit('chat message', msg.trim(), msgId, username, roomId, new Date().toISOString(), userImage, [], String(userId), detectedLang, clientTempId || '');
        if (typeof ack === 'function') ack({ ok: true, id: msgId, clientTempId: clientTempId || '' });

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
        if (typeof ack === 'function') ack({ ok: false, error: 'Failed to send message', clientTempId: clientTempId || '' });
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
    // PRIVATE CHAT INVITES
    // ────────────────────────────────────────────
    socket.on('private-chat-invite', async ({ toUserId, fromUserId, fromName }) => {
      try {
        if (!userId || !toUserId) return;
        if (String(toUserId) === String(userId)) return;
        if (String(fromUserId) !== String(userId)) return;

        const blockedRes = await db.execute({
          sql: `SELECT blocked FROM user_moderation WHERE user_id = ? AND target_user_id = ? LIMIT 1`,
          args: [toUserId, userId],
        });
        if (blockedRes.rows.length > 0 && Number(blockedRes.rows[0].blocked) === 1) {
          socket.emit('private-chat-invite-error', {
            toUserId,
            reason: 'blocked',
          });
          return;
        }

        const senderRes = await db.execute({ sql: 'SELECT isAdmin FROM users WHERE id = ?', args: [userId] });
        const isAdmin = Boolean(senderRes.rows[0]?.isAdmin);

        if (!isAdmin) {
          const rejectedRes = await db.execute({
            sql: `SELECT rejected_at, created_at
                  FROM private_chat_invites
                  WHERE from_user_id = ? AND to_user_id = ? AND status = 'rejected'
                  ORDER BY id DESC LIMIT 1`,
            args: [userId, toUserId],
          });

          const lastRejected = rejectedRes.rows[0];
          if (lastRejected) {
            const baseTime = lastRejected.rejected_at || lastRejected.created_at;
            const rejectedAtMs = baseTime ? new Date(baseTime).getTime() : 0;
            const cooldownMs = 15 * 60 * 1000;
            const retryAfterMs = rejectedAtMs + cooldownMs - Date.now();
            if (retryAfterMs > 0) {
              socket.emit('private-chat-invite-error', {
                toUserId,
                reason: 'cooldown',
                retryAfterMs,
              });
              return;
            }
          }
        }

        await db.execute({
          sql: 'INSERT INTO private_chat_invites (from_user_id, to_user_id, status) VALUES (?, ?, ?)',
          args: [userId, toUserId, 'pending'],
        });

        const delivered = emitToUser(io, toUserId, 'private-chat-invite', {
          fromUserId: userId,
          fromName: fromName || username,
        });

        socket.emit('private-chat-invite-sent', {
          toUserId,
          delivered,
        });
      } catch (e) {
        console.error('Private invite error:', e);
        socket.emit('private-chat-invite-error', { reason: 'server' });
      }
    });

    socket.on('private-chat-invite-response', async ({ toUserId, fromUserId, fromName, accepted }) => {
      try {
        if (!userId || !toUserId) return;
        if (String(fromUserId) !== String(userId)) return;
        const acceptedBool = Boolean(accepted);

        await db.execute({
          sql: `UPDATE private_chat_invites
                SET status = ?, responded_at = CURRENT_TIMESTAMP,
                    rejected_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
                WHERE id = (
                  SELECT id FROM private_chat_invites
                  WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
                  ORDER BY id DESC LIMIT 1
                )`,
          args: [acceptedBool ? 'accepted' : 'rejected', acceptedBool ? 1 : 0, toUserId, userId],
        });

        emitToUser(io, toUserId, 'private-chat-invite-response', {
          fromUserId: userId,
          fromName: fromName || username,
          accepted: acceptedBool,
        });
      } catch (e) {
        console.error('Private invite response error:', e);
      }
    });

    // ────────────────────────────────────────────
    // PIN MESSAGE
    // ────────────────────────────────────────────
    socket.on('pin-message', async ({ messageId, roomId: msgRoomId }, callback) => {
      try {
        if (!userId) return callback({ ok: false, error: 'Not authenticated' });
        
        // Check if user is mod/owner
        const roleRes = await db.execute({
          sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
          args: [userId, msgRoomId],
        });
        const role = roleRes.rows.length ? roleRes.rows[0].role : 'user';
        if (!['mod', 'owner'].includes(role)) {
          return callback({ ok: false, error: 'Insufficient permissions' });
        }

        await db.execute({
          sql: `INSERT INTO pinned_messages (message_id, room_id, pinned_by)
                VALUES (?, ?, ?)
                ON CONFLICT(message_id, room_id) DO UPDATE SET pinned_by = excluded.pinned_by`,
          args: [messageId, msgRoomId, userId],
        });

        io.to(`room_${msgRoomId}`).emit('message-pinned', { messageId, roomId: msgRoomId, pinnedBy: username });
        callback({ ok: true });
      } catch (e) {
        console.error('Pin message error:', e);
        callback({ ok: false, error: 'Failed to pin' });
      }
    });

    socket.on('unpin-message', async ({ messageId, roomId: msgRoomId }, callback) => {
      try {
        if (!userId) return callback({ ok: false });
        
        const roleRes = await db.execute({
          sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
          args: [userId, msgRoomId],
        });
        const role = roleRes.rows.length ? roleRes.rows[0].role : 'user';
        if (!['mod', 'owner'].includes(role)) {
          return callback({ ok: false });
        }

        await db.execute({
          sql: 'DELETE FROM pinned_messages WHERE message_id = ? AND room_id = ?',
          args: [messageId, msgRoomId],
        });

        io.to(`room_${msgRoomId}`).emit('message-unpinned', { messageId, roomId: msgRoomId });
        callback({ ok: true });
      } catch (e) {
        console.error('Unpin message error:', e);
        callback({ ok: false });
      }
    });

    // ────────────────────────────────────────────
    // BAN USER
    // ────────────────────────────────────────────
    socket.on('ban-user', async ({ targetUserId, roomId: banRoomId, reason, durationMinutes }, callback) => {
      try {
        if (!userId) return callback({ ok: false });
        
        const roleRes = await db.execute({
          sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
          args: [userId, banRoomId],
        });
        const role = roleRes.rows.length ? roleRes.rows[0].role : 'user';
        if (!['mod', 'owner'].includes(role)) {
          return callback({ ok: false, error: 'Insufficient permissions' });
        }

        const isPermanent = !durationMinutes || durationMinutes === 0;
        const expiresAt = isPermanent ? null : new Date(Date.now() + durationMinutes * 60000).toISOString();

        await db.execute({
          sql: `INSERT INTO room_bans (user_id, room_id, banned_by, reason, expires_at, is_permanent)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, room_id) DO UPDATE SET
                  banned_by = excluded.banned_by,
                  reason = excluded.reason,
                  expires_at = excluded.expires_at`,
          args: [targetUserId, banRoomId, userId, reason || '', expiresAt, isPermanent ? 1 : 0],
        });

        // Log action
        await db.execute({
          sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id, details) VALUES (?, ?, ?, ?, ?)',
          args: [userId, 'ban_user', targetUserId, banRoomId, JSON.stringify({ reason, durationMinutes })],
        });

        // Emit ban event to all users in room and to banned user
        io.to(`room_${banRoomId}`).emit('user-banned', { userId: targetUserId, reason, isPermanent, expiresAt });
        emitToUser(io, targetUserId, 'you-were-banned', { roomId: banRoomId, reason, isPermanent, expiresAt });
        
        callback({ ok: true });
      } catch (e) {
        console.error('Ban user error:', e);
        callback({ ok: false });
      }
    });

    socket.on('unban-user', async ({ targetUserId, roomId: banRoomId }, callback) => {
      try {
        if (!userId) return callback({ ok: false });
        
        const roleRes = await db.execute({
          sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
          args: [userId, banRoomId],
        });
        const role = roleRes.rows.length ? roleRes.rows[0].role : 'user';
        if (!['mod', 'owner'].includes(role)) {
          return callback({ ok: false });
        }

        await db.execute({
          sql: 'DELETE FROM room_bans WHERE user_id = ? AND room_id = ?',
          args: [targetUserId, banRoomId],
        });

        await db.execute({
          sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id) VALUES (?, ?, ?, ?)',
          args: [userId, 'unban_user', targetUserId, banRoomId],
        });

        io.to(`room_${banRoomId}`).emit('user-unbanned', { userId: targetUserId });
        callback({ ok: true });
      } catch (e) {
        console.error('Unban user error:', e);
        callback({ ok: false });
      }
    });

    // ────────────────────────────────────────────
    // USER MENTIONS
    // ────────────────────────────────────────────
    socket.on('user-mention', async ({ messageId, mentionedUserIds, roomId: mentionRoomId }) => {
      try {
        if (!messageId) return;
        for (const mentionedId of mentionedUserIds) {
          // Create mention in DB
          await db.execute({
            sql: 'INSERT INTO mentions (message_id, mentioned_user_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
            args: [messageId, mentionedId],
          });

          // Emit notification to mentioned user
          emitToUser(io, mentionedId, 'you-were-mentioned', {
            messageId,
            roomId: mentionRoomId,
            mentionedBy: username,
            mentionedById: userId,
          });
        }
      } catch (e) {
        console.error('User mention error:', e);
      }
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