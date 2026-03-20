// src/sockets/chat.sockets.js — Chat-related socket event handlers
import { franc } from 'franc-min';
import { db } from '../config/database.js';
import { DAILY_PROMPTS } from '../db/seeds/rooms.js';
import { checkAndGrantAchievements } from '../modules/achievements/achievements.service.js';
import { updateStreak } from '../services/streaks.js';
import {
  roomOnlineUsers,
  messageRateMap,
  getUsersInRoom,
  supportsMessageRepliesTable,
} from './helpers.js';

export function registerChatEvents(io, socket, { userId, username, userKey }) {
  let userImage = '';
  let userTargetLang = '';

  // ────────────────────────────────────────────
  // JOIN ROOM
  // ────────────────────────────────────────────
  socket.on('join room', async (roomId) => {
    // Ensure latest user meta is loaded before publishing online list
    if (userId !== undefined && userId !== null) {
      try {
        const u = await db.execute({ sql: 'SELECT image, targetLang FROM users WHERE id = ?', args: [userId] });
        if (u.rows.length > 0) {
          userImage = u.rows[0].image || '';
          userTargetLang = u.rows[0].targetLang || '';
        }
      } catch (_) { }
    }

    // Check if user is banned from this room
    if (userId !== undefined && userId !== null) {
      try {
        const banCheck = await db.execute({
          sql: `SELECT id, reason FROM room_bans WHERE user_id = ? AND room_id = ? AND (is_permanent = 1 OR expires_at > datetime('now'))`,
          args: [userId, roomId],
        });
        if (banCheck.rows.length > 0) {
          socket.emit('join-denied', { roomId, reason: banCheck.rows[0].reason || 'You are banned from this room' });
          return;
        }
      } catch (_) { }
    }

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

    // Persist current room (fire-and-forget)
    db.execute({
      sql: 'UPDATE user_presence SET current_room_id = ? WHERE user_id = ?',
      args: [roomId, userId],
    }).catch(console.error);

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
      const hasReplyMeta = await supportsMessageRepliesTable();
      const results = await db.execute({
        sql: `SELECT m.id, m.content, m.user_id, u.name as username, u.image as user_image, m.sent_at, m.detected_lang${hasReplyMeta ? ', mr.reply_to_id, mr.reply_to_username, mr.reply_to_content' : ''}
              FROM messages m
              JOIN users u ON m.user_id = u.id
              ${hasReplyMeta ? 'LEFT JOIN message_replies mr ON mr.message_id = m.id' : ''}
              WHERE m.room_id = ? ORDER BY m.sent_at DESC LIMIT 30`,
        args: [roomId],
      });

      const rows = results.rows.reverse();
      const history = await Promise.all(rows.map(async (row) => {
        let reactions = [];
        try {
          const reactionRows = await db.execute({
            sql: `SELECT r.emoji, r.user_id, u.name as user_name, u.image as user_image
                  FROM reactions r
                  LEFT JOIN users u ON u.id = r.user_id
                  WHERE r.message_id = ?`,
            args: [row.id],
          });
          reactions = reactionRows.rows.map(r => ({ emoji: r.emoji, userId: r.user_id, userName: r.user_name || '', userImage: r.user_image || '' }));
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
          replyTo: hasReplyMeta && row.reply_to_id
            ? {
              id: String(row.reply_to_id),
              username: row.reply_to_username || row.username,
              content: row.reply_to_content || '',
            }
            : undefined,
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
  // CHAT MESSAGE
  // ────────────────────────────────────────────
  socket.on('chat message', async (msg, roomId, clientTempId, replyMetaOrAck, maybeAck) => {
    if (!msg?.trim()) return;

    // Socket-level rate limiting: max 15 messages per 30 seconds per user
    const now = Date.now();
    const userMsgTimes = messageRateMap.get(String(userId)) || [];
    const recent = userMsgTimes.filter(t => now - t < 30000);
    if (recent.length >= 15) {
      socket.emit('error', 'You are sending messages too fast');
      return;
    }
    recent.push(now);
    messageRateMap.set(String(userId), recent);
    const replyMeta = (replyMetaOrAck && typeof replyMetaOrAck === 'object') ? replyMetaOrAck : null;
    const ack = typeof replyMetaOrAck === 'function' ? replyMetaOrAck : maybeAck;
    try {
      const userCheck = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [userId] });
      if (userCheck.rows.length === 0) return;
      const roomCheck = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomId] });
      if (roomCheck.rows.length === 0) return;

      // Detect language of message
      const detectedLang = franc(msg.trim(), { minLength: 5 }) || 'und';

      const hasReplyMeta = await supportsMessageRepliesTable();
      const replyToId = replyMeta?.id ? String(replyMeta.id).slice(0, 64) : '';
      const replyToUsername = replyMeta?.username ? String(replyMeta.username).trim().slice(0, 120) : '';
      const replyToContent = replyMeta?.content ? String(replyMeta.content).trim().slice(0, 500) : '';

      const result = await db.execute({
        sql: 'INSERT INTO messages (content, user_id, room_id, detected_lang) VALUES (?, ?, ?, ?)',
        args: [msg.trim(), userId, roomId, detectedLang],
      });

      const msgId = result.lastInsertRowid.toString();

      if (hasReplyMeta && replyToId) {
        try {
          await db.execute({
            sql: `INSERT INTO message_replies (message_id, reply_to_id, reply_to_username, reply_to_content)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(message_id) DO UPDATE SET
                    reply_to_id = excluded.reply_to_id,
                    reply_to_username = excluded.reply_to_username,
                    reply_to_content = excluded.reply_to_content`,
            args: [msgId, replyToId, replyToUsername, replyToContent],
          });
        } catch (replyErr) {
          console.error('Reply metadata save error:', replyErr);
        }
      }

      const replyTo = replyToId
        ? { id: replyToId, username: replyToUsername || username, content: replyToContent || '' }
        : undefined;
      io.to(`room_${roomId}`).emit('chat message', msg.trim(), msgId, username, roomId, new Date().toISOString(), userImage, [], String(userId), detectedLang, replyTo, clientTempId || '');
      if (typeof ack === 'function') ack({ ok: true, id: msgId, clientTempId: clientTempId || '' });

      // Check for banned words (non-blocking for chat delivery)
      try {
        const bannedWordsRes = await db.execute('SELECT word FROM banned_words');
        const bannedWords = bannedWordsRes.rows.map(r => r.word.toLowerCase());
        const msgLower = msg.trim().toLowerCase();
        const hasBannedWord = bannedWords.some(w => msgLower.includes(w));
        if (hasBannedWord) {
          await db.execute({
            sql: "UPDATE messages SET message_type = 'flagged' WHERE id = ?",
            args: [msgId],
          });
          socket.emit('message-flagged', { messageId: msgId, reason: 'banned_word' });
        }
      } catch (flagErr) {
        console.error('Banned word check error:', flagErr);
      }

      // Update user stats (non-blocking for chat delivery)
      try {
        const wordCount = msg.trim().split(/\s+/).length;
        await db.execute({
          sql: `INSERT INTO user_stats (user_id, messages_sent, words_sent, last_active) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET messages_sent = messages_sent + 1, words_sent = words_sent + ?, last_active = CURRENT_TIMESTAMP`,
          args: [userId, wordCount, wordCount],
        });
        await db.execute({ sql: 'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?', args: [userId] });
        updateStreak(userId).catch(console.error);
        checkAndGrantAchievements(userId).catch(console.error);
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
        sql: `SELECT r.emoji, r.user_id, u.name as user_name, u.image as user_image
              FROM reactions r
              LEFT JOIN users u ON u.id = r.user_id
              WHERE r.message_id = ?`, args: [messageId],
      });
      io.to(`room_${roomId}`).emit('reaction-update', {
        messageId,
        reactions: allReactions.rows.map(r => ({ emoji: r.emoji, userId: r.user_id, userName: r.user_name || '', userImage: r.user_image || '' })),
      });
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

  // ────────────────────────────────────────────
  // EDIT MESSAGE
  // ────────────────────────────────────────────
  socket.on('edit-message', async ({ messageId, content, roomId: editRoomId }) => {
    try {
      if (!userId || !messageId || !content?.trim()) return;
      const msg = await db.execute({
        sql: 'SELECT user_id FROM messages WHERE id = ?',
        args: [messageId],
      });
      if (!msg.rows.length) return;
      if (String(msg.rows[0].user_id) !== String(userId)) {
        socket.emit('error', 'You can only edit your own messages');
        return;
      }
      await db.execute({
        sql: 'UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: [content.trim(), messageId],
      });
      const editedAt = new Date().toISOString();
      io.to(`room_${editRoomId}`).emit('message-edited', { messageId, content: content.trim(), editedAt });
    } catch (e) {
      console.error('Edit message error:', e);
    }
  });

  // ────────────────────────────────────────────
  // DELETE MESSAGE
  // ────────────────────────────────────────────
  socket.on('delete-message', async ({ messageId, roomId: deleteRoomId }) => {
    try {
      if (!userId || !messageId) return;
      const msg = await db.execute({
        sql: 'SELECT user_id, room_id FROM messages WHERE id = ? AND deleted_at IS NULL',
        args: [messageId],
      });
      if (!msg.rows.length) return;
      const isSender = String(msg.rows[0].user_id) === String(userId);
      if (!isSender) {
        // Check if user is mod/owner in the room
        const roleRes = await db.execute({
          sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
          args: [userId, deleteRoomId],
        });
        const role = roleRes.rows.length ? roleRes.rows[0].role : 'user';
        if (!['mod', 'owner'].includes(role)) {
          socket.emit('error', 'Insufficient permissions to delete this message');
          return;
        }
      }
      await db.execute({
        sql: 'UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: [messageId],
      });
      io.to(`room_${deleteRoomId}`).emit('message-deleted', { messageId });
    } catch (e) {
      console.error('Delete message error:', e);
    }
  });
}
