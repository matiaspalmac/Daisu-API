// src/sockets/dm.sockets.js — Direct Message socket event handlers
import { db } from '../config/database.js';
import { emitToUser, getDMOtherUser } from './helpers.js';

export function registerDMEvents(io, socket, { userId, username }) {
  // ────────────────────────────────────────────
  // DM MESSAGE
  // ────────────────────────────────────────────
  socket.on('dm-message', async ({ conversationId, content }, callback) => {
    try {
      if (!conversationId || !content?.trim()) return;

      // Verify user is a participant
      const otherUserId = await getDMOtherUser(conversationId, userId);
      if (!otherUserId) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Not a participant' });
        return;
      }

      // Check if blocked
      const blockCheck = await db.execute({
        sql: `SELECT 1 FROM user_blocks
              WHERE is_active = 1
                AND ((user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?))
              LIMIT 1`,
        args: [userId, otherUserId, otherUserId, userId],
      });
      if (blockCheck.rows.length > 0) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Blocked' });
        return;
      }

      // Insert message
      const result = await db.execute({
        sql: 'INSERT INTO dm_messages (conversation_id, sender_id, content) VALUES (?, ?, ?)',
        args: [conversationId, userId, content.trim()],
      });
      const messageId = result.lastInsertRowid.toString();
      const sentAt = new Date().toISOString();

      // Update conversation metadata and increment other user's unread count
      const conv = await db.execute({
        sql: 'SELECT user1_id, user2_id FROM dm_conversations WHERE id = ?',
        args: [conversationId],
      });
      const { user1_id, user2_id } = conv.rows[0];
      const unreadCol = String(user1_id) === otherUserId ? 'user1_unread_count' : 'user2_unread_count';
      await db.execute({
        sql: `UPDATE dm_conversations SET last_message_at = CURRENT_TIMESTAMP, last_message_preview = ?, ${unreadCol} = ${unreadCol} + 1 WHERE id = ?`,
        args: [content.trim().slice(0, 100), conversationId],
      });

      // Emit to the other user
      emitToUser(io, otherUserId, 'dm-message', {
        conversationId,
        message: { id: messageId, sender_id: userId, content: content.trim(), sent_at: sentAt },
      });

      // Ack to sender
      if (typeof callback === 'function') callback({ ok: true, id: messageId });
    } catch (e) {
      console.error('DM message error:', e);
      if (typeof callback === 'function') callback({ ok: false, error: 'Failed to send DM' });
    }
  });

  // ────────────────────────────────────────────
  // DM TYPING
  // ────────────────────────────────────────────
  socket.on('dm-typing-start', async ({ conversationId }) => {
    try {
      const otherUserId = await getDMOtherUser(conversationId, userId);
      if (!otherUserId) return;
      emitToUser(io, otherUserId, 'dm-typing', { conversationId, userId, name: username });
    } catch (e) {
      console.error('DM typing-start error:', e);
    }
  });

  socket.on('dm-typing-stop', async ({ conversationId }) => {
    try {
      const otherUserId = await getDMOtherUser(conversationId, userId);
      if (!otherUserId) return;
      emitToUser(io, otherUserId, 'dm-stop-typing', { conversationId, userId });
    } catch (e) {
      console.error('DM typing-stop error:', e);
    }
  });

  // ────────────────────────────────────────────
  // DM READ
  // ────────────────────────────────────────────
  socket.on('dm-read', async ({ conversationId }) => {
    try {
      const otherUserId = await getDMOtherUser(conversationId, userId);
      if (!otherUserId) return;

      // Reset current user's unread count
      const conv = await db.execute({
        sql: 'SELECT user1_id FROM dm_conversations WHERE id = ?',
        args: [conversationId],
      });
      const unreadCol = String(conv.rows[0].user1_id) === String(userId) ? 'user1_unread_count' : 'user2_unread_count';
      await db.execute({
        sql: `UPDATE dm_conversations SET ${unreadCol} = 0 WHERE id = ?`,
        args: [conversationId],
      });

      // Notify the other user
      emitToUser(io, otherUserId, 'dm-read-receipt', { conversationId, userId });
    } catch (e) {
      console.error('DM read error:', e);
    }
  });
}
