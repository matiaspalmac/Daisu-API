import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError, AuthorizationError, ConflictError } from '../../errors/index.js';

async function supportsMessageRepliesTable() {
  try {
    const result = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='message_replies' LIMIT 1");
    return Boolean(result.rows?.length);
  } catch { return false; }
}

export const ChatService = {
  async listRooms({ language, level, type }) {
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
    return result.rows;
  },

  async getRoomById(id) {
    const result = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [id] });
    if (!result.rows.length) throw new NotFoundError('Room not found');
    return result.rows[0];
  },

  async createRoom(data) {
    const { name, description, language, level, type } = data;
    const result = await db.execute({
      sql: 'INSERT OR IGNORE INTO rooms (name, description, language, level, type) VALUES (?, ?, ?, ?, ?)',
      args: [name, description || '', language || '', level || '', type || 'public'],
    });
    if (result.rowsAffected === 0) throw new ConflictError('Room already exists');
    return {
      id: result.lastInsertRowid.toString(), name,
      description: description || '', language: language || '',
      level: level || '', type: type || 'public', is_default: 0, message_count: 0,
    };
  },

  async updateRoom(id, data) {
    const { name, description, language, level, type, daily_prompt } = data;
    await db.execute({
      sql: `UPDATE rooms SET name = COALESCE(?, name), description = COALESCE(?, description),
            language = COALESCE(?, language), level = COALESCE(?, level), type = COALESCE(?, type),
            daily_prompt = COALESCE(?, daily_prompt) WHERE id = ?`,
      args: [name, description, language, level, type, daily_prompt, id],
    });
    return { message: 'Room updated' };
  },

  async deleteRoom(id) {
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
    return { message: 'Room deleted' };
  },

  async listMessages({ limit: rawLimit, offset: rawOffset, room_id, excludeUserIds: rawExclude }) {
    const limit = Math.min(parseInt(rawLimit) || config.limits.messageHistoryDefault, config.limits.messageHistoryMax);
    const offset = parseInt(rawOffset) || 0;
    const excludeUserIds = String(rawExclude || '')
      .split(',').map(v => v.trim()).filter(Boolean)
      .map(v => Number(v)).filter(v => Number.isFinite(v));

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
    if (room_id) { sql += ' AND m.room_id = ?'; args.push(room_id); }
    if (excludeUserIds.length > 0) {
      const placeholders = excludeUserIds.map(() => '?').join(',');
      sql += ` AND m.user_id NOT IN (${placeholders})`;
      args.push(...excludeUserIds);
    }
    sql += ' ORDER BY m.sent_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const result = await db.execute({ sql, args });
    return result.rows.map(row => ({
      id: row.id, content: row.content,
      user: { id: row.user_id, name: row.user_name, image: row.user_image },
      room: { id: row.room_id, name: row.room_name },
      sent_at: row.sent_at,
      replyTo: hasReplyMeta && row.reply_to_id
        ? { id: row.reply_to_id, username: row.reply_to_username || row.user_name, content: row.reply_to_content || '' }
        : undefined,
    }));
  },

  async getGlobalStats() {
    const [users, rooms, messages] = await Promise.all([
      db.execute('SELECT COUNT(*) as count FROM users'),
      db.execute('SELECT COUNT(*) as count FROM rooms'),
      db.execute('SELECT COUNT(*) as count FROM messages'),
    ]);
    return { users: users.rows[0].count, rooms: rooms.rows[0].count, messages: messages.rows[0].count };
  },

  async getPinnedMessages(roomId) {
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
    return result.rows;
  },

  async pinMessage(messageId, roomId, user) {
    if (!roomId) throw new ValidationError('roomId required');

    const userRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [user.id, roomId],
    });
    const isMod = user.isAdmin || (userRole.rows.length && (userRole.rows[0].role === 'owner' || userRole.rows[0].role === 'mod'));
    if (!isMod) throw new AuthorizationError('Only mods/owners can pin messages');

    const msg = await db.execute({
      sql: 'SELECT id FROM messages WHERE id = ? AND room_id = ?',
      args: [messageId, roomId],
    });
    if (!msg.rows.length) throw new NotFoundError('Message not found in this room');

    await db.execute({
      sql: `INSERT INTO pinned_messages (message_id, room_id, pinned_by) VALUES (?, ?, ?)
            ON CONFLICT(message_id, room_id) DO UPDATE SET pinned_by = excluded.pinned_by`,
      args: [messageId, roomId, user.id],
    });
    return { message: 'Message pinned', messageId, roomId };
  },

  async unpinMessage(messageId, roomId, user) {
    const userRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [user.id, roomId],
    });
    const isMod = user.isAdmin || (userRole.rows.length && (userRole.rows[0].role === 'owner' || userRole.rows[0].role === 'mod'));
    if (!isMod) throw new AuthorizationError('Only mods/owners can unpin messages');

    await db.execute({
      sql: 'DELETE FROM pinned_messages WHERE message_id = ? AND room_id = ?',
      args: [messageId, roomId],
    });
    return { message: 'Message unpinned' };
  },

  async createMention(messageId, userId) {
    if (!userId) throw new ValidationError('userId required');
    try {
      await db.execute({
        sql: 'INSERT INTO mentions (message_id, mentioned_user_id) VALUES (?, ?)',
        args: [messageId, userId],
      });
      return { message: 'Mention created', messageId, userId };
    } catch (e) {
      if (e.message?.includes('UNIQUE')) return { message: 'Mention already exists' };
      throw e;
    }
  },

  async editMessage(messageId, content, user) {
    if (!content?.trim()) throw new ValidationError('content required');

    const msg = await db.execute({ sql: 'SELECT user_id, sent_at FROM messages WHERE id = ?', args: [messageId] });
    if (!msg.rows.length) throw new NotFoundError('Message not found');
    if (String(msg.rows[0].user_id) !== String(user.id)) throw new AuthorizationError('You can only edit your own messages');

    const sentAt = new Date(msg.rows[0].sent_at).getTime();
    if (Date.now() - sentAt > config.messageEditWindowMs) {
      throw new AuthorizationError('Messages can only be edited within 15 minutes of sending');
    }

    await db.execute({
      sql: 'UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [content.trim(), messageId],
    });
    return { message: 'Message edited', messageId };
  },

  async deleteMessage(messageId, user) {
    const msg = await db.execute({
      sql: 'SELECT user_id, room_id FROM messages WHERE id = ? AND deleted_at IS NULL',
      args: [messageId],
    });
    if (!msg.rows.length) throw new NotFoundError('Message not found');
    const isSender = String(msg.rows[0].user_id) === String(user.id);
    const isAdminOrMod = user.isAdmin;
    if (!isSender && !isAdminOrMod) {
      const roleRes = await db.execute({
        sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
        args: [user.id, msg.rows[0].room_id],
      });
      const role = roleRes.rows.length ? roleRes.rows[0].role : 'user';
      if (!['mod', 'owner'].includes(role)) throw new AuthorizationError('Access denied');
    }
    await db.execute({
      sql: 'UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [messageId],
    });
    return { message: 'Message deleted', messageId };
  },
};
