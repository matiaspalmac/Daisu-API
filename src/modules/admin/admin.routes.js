// routes/admin.js — Admin bulk operations & dashboard
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';

const router = express.Router();

// In-memory store for system announcements
let activeAnnouncement = null;

// POST /api/admin/bulk/ban-users — ban multiple users
router.post('/admin/bulk/ban-users', auth, adminOnly, async (req, res) => {
  try {
    const { userIds, reason } = req.body || {};

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds must be a non-empty array of numbers' });
    }
    if (userIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 users per request' });
    }
    if (!userIds.every(id => typeof id === 'number' && Number.isInteger(id))) {
      return res.status(400).json({ error: 'All userIds must be integers' });
    }

    let banned = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        const result = await db.execute({
          sql: 'UPDATE users SET banned_at = CURRENT_TIMESTAMP WHERE id = ?',
          args: [userId],
        });
        if (result.rowsAffected > 0) {
          banned++;
          await db.execute({
            sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, details) VALUES (?, ?, ?, ?)',
            args: [req.user.id, 'bulk_ban', userId, JSON.stringify({ reason: reason || 'Bulk ban operation' })],
          });
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    res.json({ banned, failed });
  } catch (e) {
    console.error('Error in bulk ban:', e);
    res.status(500).json({ error: 'Error performing bulk ban' });
  }
});

// POST /api/admin/bulk/unban-users — unban multiple users
router.post('/admin/bulk/unban-users', auth, adminOnly, async (req, res) => {
  try {
    const { userIds } = req.body || {};

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds must be a non-empty array of numbers' });
    }
    if (userIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 users per request' });
    }
    if (!userIds.every(id => typeof id === 'number' && Number.isInteger(id))) {
      return res.status(400).json({ error: 'All userIds must be integers' });
    }

    const placeholders = userIds.map(() => '?').join(', ');
    const result = await db.execute({
      sql: `UPDATE users SET banned_at = NULL WHERE id IN (${placeholders})`,
      args: userIds,
    });

    res.json({ unbanned: result.rowsAffected || 0 });
  } catch (e) {
    console.error('Error in bulk unban:', e);
    res.status(500).json({ error: 'Error performing bulk unban' });
  }
});

// POST /api/admin/bulk/delete-messages — soft-delete multiple messages
router.post('/admin/bulk/delete-messages', auth, adminOnly, async (req, res) => {
  try {
    const { messageIds, reason } = req.body || {};

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds must be a non-empty array of numbers' });
    }
    if (messageIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 messages per request' });
    }
    if (!messageIds.every(id => typeof id === 'number' && Number.isInteger(id))) {
      return res.status(400).json({ error: 'All messageIds must be integers' });
    }

    const placeholders = messageIds.map(() => '?').join(', ');
    const result = await db.execute({
      sql: `UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
      args: messageIds,
    });

    await db.execute({
      sql: 'INSERT INTO moderator_actions (mod_id, action, details) VALUES (?, ?, ?)',
      args: [req.user.id, 'bulk_delete_messages', JSON.stringify({ messageIds, reason: reason || 'Bulk delete operation', count: result.rowsAffected || 0 })],
    });

    res.json({ deleted: result.rowsAffected || 0 });
  } catch (e) {
    console.error('Error in bulk delete messages:', e);
    res.status(500).json({ error: 'Error performing bulk delete' });
  }
});

// POST /api/admin/bulk/send-notification — send notifications to users
router.post('/admin/bulk/send-notification', auth, adminOnly, async (req, res) => {
  try {
    const { userIds, title, body, type } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const notificationType = type || 'system';
    let targetUserIds;

    if (userIds === 'all') {
      const result = await db.execute(
        "SELECT id FROM users WHERE banned_at IS NULL AND deleted_at IS NULL",
      );
      targetUserIds = result.rows.map(r => r.id);

      if (targetUserIds.length > 500) {
        return res.status(400).json({
          error: `Too many users (${targetUserIds.length}). Maximum 500 at a time. Use pagination to send in batches.`,
        });
      }
    } else if (Array.isArray(userIds)) {
      if (userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array or "all"' });
      }
      if (userIds.length > 500) {
        return res.status(400).json({ error: 'Maximum 500 users per request' });
      }
      if (!userIds.every(id => typeof id === 'number' && Number.isInteger(id))) {
        return res.status(400).json({ error: 'All userIds must be integers' });
      }
      targetUserIds = userIds;
    } else {
      return res.status(400).json({ error: 'userIds must be an array of numbers or "all"' });
    }

    let sent = 0;
    for (const userId of targetUserIds) {
      try {
        await db.execute({
          sql: 'INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)',
          args: [userId, title, body, notificationType],
        });
        sent++;
      } catch {
        // skip failed inserts (e.g. user doesn't exist)
      }
    }

    res.json({ sent });
  } catch (e) {
    console.error('Error in bulk send notification:', e);
    res.status(500).json({ error: 'Error sending notifications' });
  }
});

// GET /api/admin/dashboard — aggregated dashboard data
router.get('/admin/dashboard', auth, adminOnly, async (req, res) => {
  try {
    const [
      totalUsers,
      bannedUsers,
      deletedUsers,
      messagesToday,
      messagesWeek,
      messagesAll,
      totalRooms,
      active24h,
      active7d,
      active30d,
      membershipBreakdown,
      topRooms,
      recentActions,
    ] = await Promise.all([
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
      db.execute(`
        SELECT r.id, r.name, COUNT(m.id) as message_count
        FROM rooms r
        LEFT JOIN messages m ON r.id = m.room_id AND m.sent_at > datetime('now', '-1 day')
        GROUP BY r.id
        ORDER BY message_count DESC
        LIMIT 5
      `),
      db.execute(`
        SELECT ma.id, ma.mod_id, u_mod.name as mod_name, ma.action,
               ma.target_user_id, u_target.name as target_name,
               ma.details, ma.created_at
        FROM moderator_actions ma
        LEFT JOIN users u_mod ON ma.mod_id = u_mod.id
        LEFT JOIN users u_target ON ma.target_user_id = u_target.id
        ORDER BY ma.created_at DESC
        LIMIT 10
      `),
    ]);

    const membershipCounts = { free: 0, pro: 0, premium: 0 };
    for (const row of membershipBreakdown.rows) {
      membershipCounts[row.tier] = row.count;
    }

    res.json({
      users: {
        active: totalUsers.rows[0]?.count || 0,
        banned: bannedUsers.rows[0]?.count || 0,
        deleted: deletedUsers.rows[0]?.count || 0,
      },
      messages: {
        today: messagesToday.rows[0]?.count || 0,
        thisWeek: messagesWeek.rows[0]?.count || 0,
        allTime: messagesAll.rows[0]?.count || 0,
      },
      rooms: {
        total: totalRooms.rows[0]?.count || 0,
      },
      activeUsers: {
        '24h': active24h.rows[0]?.count || 0,
        '7d': active7d.rows[0]?.count || 0,
        '30d': active30d.rows[0]?.count || 0,
      },
      memberships: membershipCounts,
      topRoomsToday: topRooms.rows,
      recentModeratorActions: recentActions.rows,
    });
  } catch (e) {
    console.error('Error fetching dashboard data:', e);
    res.status(500).json({ error: 'Error fetching dashboard data' });
  }
});

// POST /api/admin/system-announcement — set active announcement
router.post('/admin/system-announcement', auth, adminOnly, async (req, res) => {
  try {
    const { message, type } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const validTypes = ['info', 'warning', 'maintenance'];
    const announcementType = validTypes.includes(type) ? type : 'info';

    activeAnnouncement = {
      message,
      type: announcementType,
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
    };

    res.json({ message: 'Announcement set', announcement: activeAnnouncement });
  } catch (e) {
    console.error('Error setting system announcement:', e);
    res.status(500).json({ error: 'Error setting announcement' });
  }
});

// GET /api/admin/system-announcement — get current announcement (public)
router.get('/admin/system-announcement', (req, res) => {
  res.json({ announcement: activeAnnouncement });
});

export default router;
