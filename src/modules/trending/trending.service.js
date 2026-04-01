import { db } from '../../config/database.js';
import { config } from '../../config/index.js';

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'your', 'have', 'been', 'will', 'would', 'could',
  'should', 'their', 'there', 'they', 'them', 'then', 'than', 'what', 'when', 'where',
  'which', 'while', 'about', 'after', 'before', 'between', 'through', 'during', 'each',
  'some', 'were', 'does', 'done', 'doing', 'being', 'just', 'also', 'into', 'over',
  'such', 'only', 'very', 'more', 'most', 'other', 'like', 'here', 'well', 'back',
  'even', 'still', 'know', 'really', 'think', 'much', 'because', 'these', 'those',
  'para', 'como', 'pero', 'esto', 'esta', 'esos', 'esas', 'este', 'estos',
  'estas', 'algo', 'todo', 'toda', 'todos', 'todas', 'mucho', 'mucha', 'muchos',
  'muchas', 'otro', 'otra', 'otros', 'otras', 'poco', 'poca', 'pocos', 'pocas',
  'bien', 'aqui', 'alla', 'donde', 'cuando', 'quien', 'cual', 'sobre', 'entre',
  'desde', 'hasta', 'tiene', 'puede', 'hacer', 'hola', 'solo', 'sino', 'cada',
  'nada', 'mismo', 'misma', 'tambien', 'porque', 'aunque',
]);

export const TrendingService = {
  async getRooms() {
    const result = await db.execute({
      sql: `SELECT r.id, r.name, r.description, r.language, r.level, r.type,
                   COUNT(m.id) as messages_24h,
                   (SELECT COUNT(DISTINCT user_id) FROM messages WHERE room_id = r.id AND sent_at > datetime('now', '-24 hours')) as active_users_24h
            FROM rooms r LEFT JOIN messages m ON r.id = m.room_id AND m.sent_at > datetime('now', '-24 hours') AND m.deleted_at IS NULL
            GROUP BY r.id HAVING messages_24h > 0 ORDER BY messages_24h DESC LIMIT 10`, args: [],
    });
    return { rooms: result.rows };
  },

  async getUsers() {
    const result = await db.execute({
      sql: `SELECT u.id, u.name, u.image, u.level, u.country, u.xp, COUNT(m.id) as messages_7d, COUNT(DISTINCT m.room_id) as rooms_active
            FROM users u JOIN messages m ON u.id = m.user_id AND m.sent_at > datetime('now', '-7 days') AND m.deleted_at IS NULL
            WHERE u.banned_at IS NULL GROUP BY u.id ORDER BY messages_7d DESC LIMIT 20`, args: [],
    });
    return { users: result.rows };
  },

  async getWords(language) {
    let sql = `SELECT m.content FROM messages m JOIN rooms r ON m.room_id = r.id WHERE m.sent_at > datetime('now', '-7 days') AND m.deleted_at IS NULL`;
    const args = [];
    if (language) { sql += ' AND r.language = ?'; args.push(language); }
    sql += ` ORDER BY m.sent_at DESC LIMIT ${config.limits.trendingRecentMessages}`;
    const result = await db.execute({ sql, args });
    const wordCounts = new Map();
    for (const row of result.rows) {
      if (!row.content) continue;
      const words = row.content.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/)
        .filter(w => w.length >= config.limits.trendingMinWordLength && !STOP_WORDS.has(w));
      for (const word of words) wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
    const words = Array.from(wordCounts.entries()).map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count).slice(0, config.limits.trendingWordsLimit);
    return { language: language || null, words };
  },

  async getReactions() {
    const result = await db.execute({
      sql: `SELECT emoji, COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users FROM reactions
            WHERE created_at > datetime('now', '-7 days') GROUP BY emoji ORDER BY count DESC LIMIT 20`, args: [],
    });
    return { reactions: result.rows };
  },

  async getRoomActivity(roomId) {
    const [messagesTodayRes, messagesWeekRes, messagesAllTimeRes, usersTodayRes, usersWeekRes, topUsersRes, topReactionsRes, peakHourRes] = await Promise.all([
      db.execute({ sql: "SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-1 day') AND deleted_at IS NULL", args: [roomId] }),
      db.execute({ sql: "SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-7 days') AND deleted_at IS NULL", args: [roomId] }),
      db.execute({ sql: 'SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND deleted_at IS NULL', args: [roomId] }),
      db.execute({ sql: "SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-1 day') AND deleted_at IS NULL", args: [roomId] }),
      db.execute({ sql: "SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-7 days') AND deleted_at IS NULL", args: [roomId] }),
      db.execute({ sql: `SELECT u.id, u.name, u.image, COUNT(m.id) as msg_count FROM messages m JOIN users u ON m.user_id = u.id WHERE m.room_id = ? AND m.sent_at > datetime('now', '-7 days') AND m.deleted_at IS NULL GROUP BY u.id ORDER BY msg_count DESC LIMIT 5`, args: [roomId] }),
      db.execute({ sql: `SELECT r.emoji, COUNT(*) as count FROM reactions r JOIN messages m ON r.message_id = m.id WHERE m.room_id = ? AND r.created_at > datetime('now', '-7 days') GROUP BY r.emoji ORDER BY count DESC LIMIT 10`, args: [roomId] }),
      db.execute({ sql: "SELECT strftime('%H', sent_at) as hour, COUNT(*) as count FROM messages WHERE room_id = ? AND sent_at > datetime('now', '-7 days') AND deleted_at IS NULL GROUP BY hour ORDER BY count DESC LIMIT 1", args: [roomId] }),
    ]);
    return {
      roomId,
      messages: { today: messagesTodayRes.rows[0]?.count ?? 0, thisWeek: messagesWeekRes.rows[0]?.count ?? 0, allTime: messagesAllTimeRes.rows[0]?.count ?? 0 },
      uniqueUsers: { today: usersTodayRes.rows[0]?.count ?? 0, thisWeek: usersWeekRes.rows[0]?.count ?? 0 },
      topUsers: topUsersRes.rows, topReactions: topReactionsRes.rows, peakHour: peakHourRes.rows[0] || null,
    };
  },
};
