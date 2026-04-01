import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { ValidationError } from '../../errors/index.js';

export const SearchService = {
  async globalSearch(query) {
    const { q, type = 'all' } = query;
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || config.limits.searchDefaultLimit, 1), config.limits.searchMaxLimit);
    if (!q || q.trim().length < config.limits.searchMinLength) throw new ValidationError('Search query must be at least 2 characters');
    const validTypes = ['all', 'users', 'rooms', 'messages'];
    if (!validTypes.includes(type)) throw new ValidationError(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
    const pattern = `%${q.trim()}%`; const results = {};
    if (type === 'all' || type === 'users') {
      const users = await db.execute({ sql: 'SELECT id, name, image, level, country FROM users WHERE name LIKE ? AND banned_at IS NULL LIMIT ?', args: [pattern, limit] });
      results.users = users.rows;
    }
    if (type === 'all' || type === 'rooms') {
      const rooms = await db.execute({ sql: 'SELECT id, name, description, language, type FROM rooms WHERE (name LIKE ? OR description LIKE ?) LIMIT ?', args: [pattern, pattern, limit] });
      results.rooms = rooms.rows;
    }
    if (type === 'all' || type === 'messages') {
      const messages = await db.execute({
        sql: `SELECT m.id, SUBSTR(m.content, 1, 200) AS content, m.user_id, u.name AS user_name, m.room_id, r.name AS room_name, m.sent_at
              FROM messages m JOIN users u ON u.id = m.user_id JOIN rooms r ON r.id = m.room_id
              WHERE m.content LIKE ? AND m.deleted_at IS NULL ORDER BY m.sent_at DESC LIMIT ?`, args: [pattern, limit],
      });
      results.messages = messages.rows;
    }
    return { query: q.trim(), results };
  },

  async searchMessages(query) {
    const { q, room_id, user_id, language } = query;
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || config.limits.messageHistoryDefault, 1), config.limits.paginationMax);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    if (!q || q.trim().length < config.limits.searchMinLength) throw new ValidationError('Search query must be at least 2 characters');
    const pattern = `%${q.trim()}%`;
    let sql = `SELECT m.id, m.content, m.user_id, u.name AS user_name, u.image AS user_image, m.room_id, r.name AS room_name, m.detected_lang, m.sent_at
               FROM messages m JOIN users u ON u.id = m.user_id JOIN rooms r ON r.id = m.room_id WHERE m.content LIKE ? AND m.deleted_at IS NULL`;
    const args = [pattern];
    if (room_id) { sql += ' AND m.room_id = ?'; args.push(room_id); }
    if (user_id) { sql += ' AND m.user_id = ?'; args.push(user_id); }
    if (language) { sql += ' AND m.detected_lang = ?'; args.push(language); }
    sql += ' ORDER BY m.sent_at DESC LIMIT ? OFFSET ?'; args.push(limit, offset);
    const messages = await db.execute({ sql, args });
    return { query: q.trim(), messages: messages.rows, limit, offset };
  },

  async searchUsers(query) {
    const { q, language, country, level } = query;
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || config.limits.messageHistoryDefault, 1), config.limits.paginationMax);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    let sql = 'SELECT id, name, image, level, country, nativelang, targetLang, bio FROM users WHERE banned_at IS NULL';
    const args = [];
    if (q && q.trim().length >= config.limits.searchMinLength) { sql += ' AND name LIKE ?'; args.push(`%${q.trim()}%`); }
    if (language) { sql += ' AND (nativelang = ? OR targetLang = ?)'; args.push(language, language); }
    if (country) { sql += ' AND country = ?'; args.push(country); }
    if (level) { sql += ' AND level = ?'; args.push(level); }
    sql += ' ORDER BY last_active DESC LIMIT ? OFFSET ?'; args.push(limit, offset);
    const users = await db.execute({ sql, args });
    return { users: users.rows, limit, offset };
  },
};
