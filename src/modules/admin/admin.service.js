import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { ValidationError } from '../../errors/index.js';

// In-memory store for system announcements
let activeAnnouncement = null;

export const AdminService = {
  async bulkBanUsers(adminId, { userIds, reason }) {
    if (!Array.isArray(userIds) || userIds.length === 0) throw new ValidationError('userIds must be a non-empty array of numbers');
    if (userIds.length > config.limits.bulkBanMax) throw new ValidationError(`Maximum ${config.limits.bulkBanMax} users per request`);
    if (!userIds.every(id => typeof id === 'number' && Number.isInteger(id))) throw new ValidationError('All userIds must be integers');
    let banned = 0, failed = 0;
    for (const userId of userIds) {
      try {
        const result = await db.execute({ sql: 'UPDATE users SET banned_at = CURRENT_TIMESTAMP WHERE id = ?', args: [userId] });
        if (result.rowsAffected > 0) {
          banned++;
          await db.execute({ sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, details) VALUES (?, ?, ?, ?)', args: [adminId, 'bulk_ban', userId, JSON.stringify({ reason: reason || 'Bulk ban operation' })] });
        } else { failed++; }
      } catch { failed++; }
    }
    return { banned, failed };
  },

  async bulkUnbanUsers(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) throw new ValidationError('userIds must be a non-empty array of numbers');
    if (userIds.length > config.limits.bulkBanMax) throw new ValidationError(`Maximum ${config.limits.bulkBanMax} users per request`);
    if (!userIds.every(id => typeof id === 'number' && Number.isInteger(id))) throw new ValidationError('All userIds must be integers');
    const placeholders = userIds.map(() => '?').join(', ');
    const result = await db.execute({ sql: `UPDATE users SET banned_at = NULL WHERE id IN (${placeholders})`, args: userIds });
    return { unbanned: result.rowsAffected || 0 };
  },

  async bulkDeleteMessages(adminId, { messageIds, reason }) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) throw new ValidationError('messageIds must be a non-empty array of numbers');
    if (messageIds.length > config.limits.bulkDeleteMax) throw new ValidationError(`Maximum ${config.limits.bulkDeleteMax} messages per request`);
    if (!messageIds.every(id => typeof id === 'number' && Number.isInteger(id))) throw new ValidationError('All messageIds must be integers');
    const placeholders = messageIds.map(() => '?').join(', ');
    const result = await db.execute({ sql: `UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, args: messageIds });
    await db.execute({ sql: 'INSERT INTO moderator_actions (mod_id, action, details) VALUES (?, ?, ?)', args: [adminId, 'bulk_delete_messages', JSON.stringify({ messageIds, reason: reason || 'Bulk delete operation', count: result.rowsAffected || 0 })] });
    return { deleted: result.rowsAffected || 0 };
  },

  async bulkSendNotification({ userIds, title, body, type }) {
    if (!title || !body) throw new ValidationError('title and body are required');
    const notificationType = type || 'system';
    let targetUserIds;
    if (userIds === 'all') {
      const result = await db.execute("SELECT id FROM users WHERE banned_at IS NULL AND deleted_at IS NULL");
      targetUserIds = result.rows.map(r => r.id);
      if (targetUserIds.length > config.limits.bulkNotificationMax) throw new ValidationError(`Too many users (${targetUserIds.length}). Maximum ${config.limits.bulkNotificationMax} at a time.`);
    } else if (Array.isArray(userIds)) {
      if (userIds.length === 0) throw new ValidationError('userIds must be a non-empty array or "all"');
      if (userIds.length > config.limits.bulkNotificationMax) throw new ValidationError(`Maximum ${config.limits.bulkNotificationMax} users per request`);
      if (!userIds.every(id => typeof id === 'number' && Number.isInteger(id))) throw new ValidationError('All userIds must be integers');
      targetUserIds = userIds;
    } else { throw new ValidationError('userIds must be an array of numbers or "all"'); }
    let sent = 0;
    for (const userId of targetUserIds) {
      try { await db.execute({ sql: 'INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)', args: [userId, title, body, notificationType] }); sent++; } catch { /* skip */ }
    }
    return { sent };
  },

  async getDashboard() {
    const [totalUsers, bannedUsers, deletedUsers, messagesToday, messagesWeek, messagesAll, totalRooms, active24h, active7d, active30d, membershipBreakdown, topRooms, recentActions] = await Promise.all([
      db.execute("SELECT COUNT(*) as count FROM users WHERE banned_at IS NULL AND deleted_at IS NULL"),
      db.execute("SELECT COUNT(*) as count FROM users WHERE banned_at IS NOT NULL"),
      db.execute("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NOT NULL"),
      db.execute("SELECT COUNT(*) as count FROM messages WHERE sent_at > datetime('now', '-1 day')"),
      db.execute("SELECT COUNT(*) as count FROM messages WHERE sent_at > datetime('now', '-7 days')"),
      db.execute("SELECT COUNT(*) as count FROM messages"),
      db.execute("SELECT COUNT(*) as count FROM rooms"),
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-1 day')"),
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-7 days')"),
      db.execute("SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE sent_at > datetime('now', '-30 days')"),
      db.execute("SELECT COALESCE(membership_tier, 'free') as tier, COUNT(*) as count FROM users WHERE banned_at IS NULL AND deleted_at IS NULL GROUP BY tier"),
      db.execute("SELECT r.id, r.name, COUNT(m.id) as message_count FROM rooms r LEFT JOIN messages m ON r.id = m.room_id AND m.sent_at > datetime('now', '-1 day') GROUP BY r.id ORDER BY message_count DESC LIMIT 5"),
      db.execute("SELECT ma.id, ma.mod_id, u_mod.name as mod_name, ma.action, ma.target_user_id, u_target.name as target_name, ma.details, ma.created_at FROM moderator_actions ma LEFT JOIN users u_mod ON ma.mod_id = u_mod.id LEFT JOIN users u_target ON ma.target_user_id = u_target.id ORDER BY ma.created_at DESC LIMIT 10"),
    ]);
    const membershipCounts = { free: 0, pro: 0, premium: 0 };
    for (const row of membershipBreakdown.rows) membershipCounts[row.tier] = row.count;
    return {
      users: { active: totalUsers.rows[0]?.count || 0, banned: bannedUsers.rows[0]?.count || 0, deleted: deletedUsers.rows[0]?.count || 0 },
      messages: { today: messagesToday.rows[0]?.count || 0, thisWeek: messagesWeek.rows[0]?.count || 0, allTime: messagesAll.rows[0]?.count || 0 },
      rooms: { total: totalRooms.rows[0]?.count || 0 },
      activeUsers: { '24h': active24h.rows[0]?.count || 0, '7d': active7d.rows[0]?.count || 0, '30d': active30d.rows[0]?.count || 0 },
      memberships: membershipCounts, topRoomsToday: topRooms.rows, recentModeratorActions: recentActions.rows,
    };
  },

  setAnnouncement(userId, { message, type }) {
    if (!message) throw new ValidationError('message is required');
    const validTypes = ['info', 'warning', 'maintenance'];
    activeAnnouncement = { message, type: validTypes.includes(type) ? type : 'info', createdBy: userId, createdAt: new Date().toISOString() };
    return { message: 'Announcement set', announcement: activeAnnouncement };
  },

  getAnnouncement() { return { announcement: activeAnnouncement }; },
};
