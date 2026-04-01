import { db } from '../../config/database.js';
import { ValidationError } from '../../errors/index.js';

export const AnalyticsService = {
  async getTopUsers() {
    const result = await db.execute(`SELECT u.id, u.name, u.image, COUNT(m.id) as message_count, COUNT(DISTINCT m.room_id) as rooms_count, MAX(m.sent_at) as last_active FROM users u LEFT JOIN messages m ON u.id = m.user_id GROUP BY u.id ORDER BY message_count DESC LIMIT 10`);
    return result.rows;
  },

  async getMessagesPerRoom() {
    const result = await db.execute(`SELECT r.id, r.name, r.language, r.level, COUNT(m.id) as message_count, COUNT(DISTINCT m.user_id) as unique_users, MAX(m.sent_at) as last_message FROM rooms r LEFT JOIN messages m ON r.id = m.room_id GROUP BY r.id ORDER BY message_count DESC`);
    return result.rows;
  },

  async getActiveUsersTimeline() {
    const [h24, d7, d30] = await Promise.all([
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-1 day')"),
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-7 days')"),
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-30 days')"),
    ]);
    return { '24h': h24.rows[0]?.count || 0, '7d': d7.rows[0]?.count || 0, '30d': d30.rows[0]?.count || 0 };
  },

  async getLanguageStats() {
    const result = await db.execute(`SELECT r.language, COUNT(m.id) as message_count, COUNT(DISTINCT m.user_id) as unique_users, COUNT(DISTINCT r.id) as room_count FROM rooms r LEFT JOIN messages m ON r.id = m.room_id GROUP BY r.language ORDER BY message_count DESC`);
    return result.rows;
  },

  async getFloodDetection() {
    const result = await db.execute(`SELECT u.id, u.name, COUNT(m.id) as recent_messages, MAX(m.sent_at) as last_message_time, r.id as room_id, r.name as room_name FROM users u JOIN messages m ON u.id = m.user_id JOIN rooms r ON m.room_id = r.id WHERE m.sent_at > datetime('now', '-5 minutes') GROUP BY u.id, m.room_id HAVING recent_messages > 10 ORDER BY recent_messages DESC`);
    return { flagged_users: result.rows, timestamp: new Date().toISOString() };
  },

  async getAuditLog(limit) {
    const safeLimit = Math.min(parseInt(limit || '100'), 500);
    const result = await db.execute({
      sql: `SELECT ma.id, ma.mod_id, u_mod.name as mod_name, ma.action, ma.target_user_id, u_target.name as target_name, ma.room_id, r.name as room_name, ma.details, ma.created_at
            FROM moderator_actions ma LEFT JOIN users u_mod ON ma.mod_id = u_mod.id LEFT JOIN users u_target ON ma.target_user_id = u_target.id LEFT JOIN rooms r ON ma.room_id = r.id ORDER BY ma.created_at DESC LIMIT ?`,
      args: [safeLimit],
    });
    return result.rows;
  },

  async getBannedWords() {
    const result = await db.execute({ sql: 'SELECT word FROM banned_words ORDER BY word ASC', args: [] });
    return { words: result.rows.map(r => r.word) };
  },

  async addBannedWord(adminId, word) {
    if (!word) throw new ValidationError('word required');
    const normalizedWord = String(word).trim().toLowerCase();
    if (!normalizedWord) throw new ValidationError('word is required');
    await db.execute({ sql: 'INSERT OR IGNORE INTO banned_words (word, created_by) VALUES (?, ?)', args: [normalizedWord, adminId] });
    await db.execute({ sql: 'INSERT INTO moderator_actions (mod_id, action, details) VALUES (?, ?, ?)', args: [adminId, 'add_banned_word', JSON.stringify({ word: normalizedWord })] });
    return { message: 'Word added to blacklist', word: normalizedWord };
  },
};
