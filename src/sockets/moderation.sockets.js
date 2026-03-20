// src/sockets/moderation.sockets.js — Moderation socket event handlers
import { db } from '../config/database.js';
import { createNotification } from '../modules/notifications/notifications.service.js';
import { emitToUser } from './helpers.js';

export function registerModerationEvents(io, socket, { userId, username }) {
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

        // Emit real-time notification to mentioned user
        emitToUser(io, mentionedId, 'you-were-mentioned', {
          messageId,
          roomId: mentionRoomId,
          mentionedBy: username,
          mentionedById: userId,
        });

        // Persist notification (fire-and-forget)
        createNotification(
          mentionedId,
          'mention',
          'You were mentioned',
          `${username} mentioned you in a chat`,
          { messageId, roomId: mentionRoomId, mentionedBy: username }
        ).catch(console.error);
      }
    } catch (e) {
      console.error('User mention error:', e);
    }
  });
}
