// routes/chats.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { createRoomSchema, editMessageSchema } from './chat.schemas.js';

const router = express.Router();

async function supportsMessageRepliesTable() {
  try {
    const result = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='message_replies' LIMIT 1");
    return Boolean(result.rows?.length);
  } catch {
    return false;
  }
}

// GET /api/rooms — authenticated
router.get('/rooms', auth, async (req, res) => {
  const { language, level, type } = req.query;
  try {
    let sql = `
      SELECT r.id, r.name, r.description, r.language, r.level, r.type, r.is_default,
             r.daily_prompt, r.created_at,
             (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) as message_count
      FROM rooms r WHERE 1=1
    `;
    const args = [];
    if (language) { sql += ' AND r.language = ?'; args.push(language); }
    if (level) { sql += ' AND r.level = ?'; args.push(level); }
    if (type) { sql += ' AND r.type = ?'; args.push(type); }
    sql += ' ORDER BY r.is_default DESC, r.created_at ASC';

    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching rooms:', e);
    res.status(500).json({ error: 'Error fetching rooms' });
  }
});

// GET /api/rooms/:id — authenticated
router.get('/rooms/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM rooms WHERE id = ?', args: [id],
    });
    if (!result.rows.length) return res.status(404).json({ error: 'Room not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error fetching room' });
  }
});

// POST /api/rooms — authenticated
router.post('/rooms', auth, validate(createRoomSchema), async (req, res) => {
  const { name, description, language, level, type } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name is required' });
  try {
    // Use INSERT OR IGNORE + check to avoid race condition
    const result = await db.execute({
      sql: 'INSERT OR IGNORE INTO rooms (name, description, language, level, type) VALUES (?, ?, ?, ?, ?)',
      args: [name, description || '', language || '', level || '', type || 'public'],
    });

    if (result.rowsAffected === 0) {
      return res.status(409).json({ error: 'Room already exists' });
    }

    res.status(201).json({
      id: result.lastInsertRowid.toString(), name,
      description: description || '', language: language || '',
      level: level || '', type: type || 'public', is_default: 0, message_count: 0,
    });
  } catch (e) {
    console.error('Error creating room:', e);
    res.status(500).json({ error: 'Error creating room' });
  }
});

// PATCH /api/rooms/:id — admin only
router.patch('/rooms/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { name, description, language, level, type, daily_prompt } = req.body;
  try {
    await db.execute({
      sql: `UPDATE rooms SET name = COALESCE(?, name), description = COALESCE(?, description),
            language = COALESCE(?, language), level = COALESCE(?, level), type = COALESCE(?, type),
            daily_prompt = COALESCE(?, daily_prompt) WHERE id = ?`,
      args: [name, description, language, level, type, daily_prompt, id],
    });
    res.json({ message: 'Room updated' });
  } catch (e) {
    res.status(500).json({ error: 'Error updating room' });
  }
});

// DELETE /api/rooms/:id — admin only, with complete cascade
router.delete('/rooms/:id', auth, adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    // Complete cascade: delete all related data
    await db.execute({ sql: 'DELETE FROM pinned_messages WHERE room_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM room_bans WHERE room_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM user_room_roles WHERE room_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM mentions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM message_replies WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM reports WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM moderator_actions WHERE room_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM messages WHERE room_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM rooms WHERE id = ?', args: [id] });
    res.json({ message: 'Room deleted' });
  } catch (e) {
    console.error('Error deleting room:', e);
    res.status(500).json({ error: 'Error deleting room' });
  }
});

// GET /api/chats — authenticated
router.get('/chats', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 200);
  const offset = parseInt(req.query.offset) || 0;
  const roomId = req.query.room_id;
  const excludeUserIds = String(req.query.excludeUserIds || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => Number(v))
    .filter(v => Number.isFinite(v));
  try {
    const hasReplyMeta = await supportsMessageRepliesTable();
    let sql = `
      SELECT m.id, m.content, m.user_id, u.name as user_name, u.image as user_image,
             m.room_id, r.name as room_name, m.sent_at${hasReplyMeta ? ', mr.reply_to_id, mr.reply_to_username, mr.reply_to_content' : ''}
      FROM messages m
      JOIN users u ON m.user_id = u.id
      JOIN rooms r ON m.room_id = r.id
      ${hasReplyMeta ? 'LEFT JOIN message_replies mr ON mr.message_id = m.id' : ''}
      WHERE 1=1 AND m.deleted_at IS NULL
    `;
    const args = [];
    if (roomId) { sql += ' AND m.room_id = ?'; args.push(roomId); }
    if (excludeUserIds.length > 0) {
      const placeholders = excludeUserIds.map(() => '?').join(',');
      sql += ` AND m.user_id NOT IN (${placeholders})`;
      args.push(...excludeUserIds);
    }
    sql += ' ORDER BY m.sent_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const result = await db.execute({ sql, args });
    res.json(result.rows.map(row => ({
      id: row.id, content: row.content,
      user: { id: row.user_id, name: row.user_name, image: row.user_image },
      room: { id: row.room_id, name: row.room_name },
      sent_at: row.sent_at,
      replyTo: hasReplyMeta && row.reply_to_id
        ? {
          id: row.reply_to_id,
          username: row.reply_to_username || row.user_name,
          content: row.reply_to_content || '',
        }
        : undefined,
    })));
  } catch (e) {
    console.error('Error fetching chats:', e);
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

// GET /api/stats — authenticated
router.get('/stats', auth, async (_, res) => {
  try {
    const [users, rooms, messages] = await Promise.all([
      db.execute('SELECT COUNT(*) as count FROM users'),
      db.execute('SELECT COUNT(*) as count FROM rooms'),
      db.execute('SELECT COUNT(*) as count FROM messages'),
    ]);
    res.json({
      users: users.rows[0].count,
      rooms: rooms.rows[0].count,
      messages: messages.rows[0].count,
    });
  } catch (e) {
    res.status(500).json({ error: 'Error fetching stats' });
  }
});

// GET /api/rooms/:roomId/pinned — authenticated
router.get('/rooms/:roomId/pinned', auth, async (req, res) => {
  const { roomId } = req.params;
  try {
    const result = await db.execute({
      sql: `SELECT pm.id, m.id as message_id, m.content, m.user_id, u.name as user_name, u.image as user_image,
                   pm.pinned_by, ub.name as pinned_by_name, pm.created_at
            FROM pinned_messages pm
            JOIN messages m ON pm.message_id = m.id
            JOIN users u ON m.user_id = u.id
            LEFT JOIN users ub ON pm.pinned_by = ub.id
            WHERE pm.room_id = ?
            ORDER BY pm.created_at DESC LIMIT 3`,
      args: [roomId],
    });
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching pinned messages:', e);
    res.status(500).json({ error: 'Error fetching pinned messages' });
  }
});

// POST /api/messages/:messageId/pin — authenticated, uses token for user identity
router.post('/messages/:messageId/pin', auth, async (req, res) => {
  const { messageId } = req.params;
  const { roomId } = req.body || {};
  const userId = req.user.id;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  try {
    const userRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [userId, roomId],
    });
    const isMod = req.user.isAdmin || (userRole.rows.length && (userRole.rows[0].role === 'owner' || userRole.rows[0].role === 'mod'));
    if (!isMod) {
      return res.status(403).json({ error: 'Only mods/owners can pin messages' });
    }
    const msg = await db.execute({
      sql: 'SELECT id FROM messages WHERE id = ? AND room_id = ?',
      args: [messageId, roomId],
    });
    if (!msg.rows.length) return res.status(404).json({ error: 'Message not found in this room' });

    await db.execute({
      sql: `INSERT INTO pinned_messages (message_id, room_id, pinned_by)
            VALUES (?, ?, ?)
            ON CONFLICT(message_id, room_id) DO UPDATE SET pinned_by = excluded.pinned_by`,
      args: [messageId, roomId, userId],
    });
    res.json({ message: 'Message pinned', messageId, roomId });
  } catch (e) {
    console.error('Error pinning message:', e);
    res.status(500).json({ error: 'Error pinning message' });
  }
});

// DELETE /api/messages/:messageId/pin/:roomId — authenticated, uses token
router.delete('/messages/:messageId/pin/:roomId', auth, async (req, res) => {
  const { messageId, roomId } = req.params;
  const userId = req.user.id;
  try {
    const userRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [userId, roomId],
    });
    const isMod = req.user.isAdmin || (userRole.rows.length && (userRole.rows[0].role === 'owner' || userRole.rows[0].role === 'mod'));
    if (!isMod) {
      return res.status(403).json({ error: 'Only mods/owners can unpin messages' });
    }
    await db.execute({
      sql: 'DELETE FROM pinned_messages WHERE message_id = ? AND room_id = ?',
      args: [messageId, roomId],
    });
    res.json({ message: 'Message unpinned' });
  } catch (e) {
    console.error('Error unpinning message:', e);
    res.status(500).json({ error: 'Error unpinning message' });
  }
});

// POST /api/messages/:messageId/mention — authenticated
router.post('/messages/:messageId/mention', auth, async (req, res) => {
  const { messageId } = req.params;
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    await db.execute({
      sql: 'INSERT INTO mentions (message_id, mentioned_user_id) VALUES (?, ?)',
      args: [messageId, userId],
    });
    res.json({ message: 'Mention created', messageId, userId });
  } catch (e) {
    if (!e.message.includes('UNIQUE')) {
      console.error('Error creating mention:', e);
      return res.status(500).json({ error: 'Error creating mention' });
    }
    res.json({ message: 'Mention already exists' });
  }
});

// PATCH /api/messages/:messageId — authenticated, edit message content
router.patch('/messages/:messageId', auth, validate(editMessageSchema), async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = req.user.id;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const msg = await db.execute({
      sql: 'SELECT user_id, sent_at FROM messages WHERE id = ?',
      args: [messageId],
    });
    if (!msg.rows.length) return res.status(404).json({ error: 'Message not found' });
    if (String(msg.rows[0].user_id) !== String(userId)) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }
    const sentAt = new Date(msg.rows[0].sent_at).getTime();
    const fifteenMinutes = 15 * 60 * 1000;
    if (Date.now() - sentAt > fifteenMinutes) {
      return res.status(403).json({ error: 'Messages can only be edited within 15 minutes of sending' });
    }
    await db.execute({
      sql: 'UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [content.trim(), messageId],
    });
    res.json({ message: 'Message edited', messageId });
  } catch (e) {
    console.error('Error editing message:', e);
    res.status(500).json({ error: 'Error editing message' });
  }
});

// DELETE /api/messages/:messageId — authenticated, soft-delete message
router.delete('/messages/:messageId', auth, async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;
  try {
    const msg = await db.execute({
      sql: 'SELECT user_id, room_id FROM messages WHERE id = ? AND deleted_at IS NULL',
      args: [messageId],
    });
    if (!msg.rows.length) return res.status(404).json({ error: 'Message not found' });
    const isSender = String(msg.rows[0].user_id) === String(userId);
    const isAdminOrMod = req.user.isAdmin;
    if (!isSender && !isAdminOrMod) {
      // Check if user is mod/owner in the room
      const roleRes = await db.execute({
        sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
        args: [userId, msg.rows[0].room_id],
      });
      const role = roleRes.rows.length ? roleRes.rows[0].role : 'user';
      if (!['mod', 'owner'].includes(role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    await db.execute({
      sql: 'UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [messageId],
    });
    res.json({ message: 'Message deleted', messageId });
  } catch (e) {
    console.error('Error deleting message:', e);
    res.status(500).json({ error: 'Error deleting message' });
  }
});

export default router;
