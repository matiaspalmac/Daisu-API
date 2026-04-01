import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError, AuthorizationError } from '../../errors/index.js';
import { createNotification } from '../notifications/notifications.service.js';
import { checkAndGrantAchievements } from '../achievements/achievements.service.js';

export const SocialService = {
  async createReport(reporterId, { messageId, reason }) {
    await db.execute({
      sql: 'INSERT INTO reports (message_id, reporter_id, reason) VALUES (?, ?, ?)',
      args: [messageId, reporterId, reason],
    });
    return { message: 'Report submitted' };
  },

  async listReports(status) {
    const result = await db.execute({
      sql: `SELECT r.id, r.reason, r.status, r.created_at, r.notes,
        m.content as message_content, m.id as message_id, m.room_id,
        u.name as reporter_name, u.id as reporter_id,
        author.name as author_name, author.id as author_id
      FROM reports r
      JOIN messages m ON r.message_id = m.id
      JOIN users u ON r.reporter_id = u.id
      JOIN users author ON m.user_id = author.id
      WHERE r.status = ? ORDER BY r.created_at DESC`,
      args: [status || 'pending'],
    });
    return result.rows;
  },

  async updateReport(id, { status, notes }) {
    if (!status) throw new ValidationError('status required');
    const reportRow = await db.execute({ sql: 'SELECT reporter_id FROM reports WHERE id = ?', args: [id] });
    await db.execute({ sql: 'UPDATE reports SET status = ?, notes = ? WHERE id = ?', args: [status, notes || '', id] });

    if (reportRow.rows.length > 0) {
      createNotification(reportRow.rows[0].reporter_id, 'report_resolved', 'Report updated', `Your report has been marked as "${status}"`, { reportId: id, status }).catch(console.error);
    }
    return { message: 'Report updated' };
  },

  async findMatch(userId) {
    const me = await db.execute({ sql: 'SELECT targetLang, nativelang, level FROM users WHERE id = ?', args: [userId] });
    if (!me.rows.length) throw new NotFoundError('User not found');
    const { targetLang, nativelang } = me.rows[0];

    const match = await db.execute({
      sql: `SELECT id, name, image, level FROM users
      WHERE id != ? AND nativelang = ? AND targetLang = ? AND banned_at IS NULL ORDER BY RANDOM() LIMIT 1`,
      args: [userId, targetLang || '', nativelang || ''],
    });
    if (!match.rows.length) throw new NotFoundError('No match found right now. Try again in a moment!');

    const partner = match.rows[0];
    const pairMin = Math.min(Number(userId), Number(partner.id));
    const pairMax = Math.max(Number(userId), Number(partner.id));
    const roomName = `private_${pairMin}_${pairMax}_${Date.now()}`;

    const result = await db.execute({
      sql: "INSERT OR IGNORE INTO rooms (name, description, type, language) VALUES (?, ?, 'private', ?)",
      args: [roomName, 'Sesion privada entre companeros de tandem', targetLang || ''],
    });

    let roomId;
    if (result.rowsAffected > 0) { roomId = result.lastInsertRowid.toString(); }
    else { const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE name = ?', args: [roomName] }); roomId = existing.rows[0].id.toString(); }

    const sessionResult = await db.execute({
      sql: 'INSERT INTO tandem_sessions (room_id, user1_id, user2_id, language, status) VALUES (?, ?, ?, ?, ?)',
      args: [roomId, userId, partner.id, targetLang || '', 'active'],
    });
    const tandemSessionId = sessionResult.lastInsertRowid.toString();

    const myName = (await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] })).rows[0]?.name || 'Someone';
    createNotification(partner.id, 'tandem_match', 'Tandem match found!', `${myName} has been matched with you for a tandem session`, { roomId, tandemSessionId, partnerName: myName }).catch(console.error);

    return { roomId, roomName, tandemSessionId, partner: { id: partner.id, name: partner.name, image: partner.image, level: partner.level } };
  },

  async getFollowers(id) {
    const result = await db.execute({
      sql: `SELECT u.id, u.name, u.image, u.level FROM users u
            WHERE u.id IN (SELECT follower_id FROM follows WHERE following_id = ? AND is_active = 1) LIMIT ?`,
      args: [id, config.limits.followersMax],
    });
    return result.rows || [];
  },

  async getFollowing(id) {
    const result = await db.execute({
      sql: `SELECT u.id, u.name, u.image, u.level FROM users u
            WHERE u.id IN (SELECT following_id FROM follows WHERE follower_id = ? AND is_active = 1) LIMIT ?`,
      args: [id, config.limits.followersMax],
    });
    return result.rows || [];
  },

  async getFollowStatus(id, viewerId) {
    const [isFollowingRes, followsYouRes, followersRes, followingRes] = await Promise.all([
      db.execute({ sql: 'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND is_active = 1 LIMIT 1', args: [viewerId, id] }),
      db.execute({ sql: 'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND is_active = 1 LIMIT 1', args: [id, viewerId] }),
      db.execute({ sql: 'SELECT COUNT(*) as total FROM follows WHERE following_id = ? AND is_active = 1', args: [id] }),
      db.execute({ sql: 'SELECT COUNT(*) as total FROM follows WHERE follower_id = ? AND is_active = 1', args: [id] }),
    ]);
    return {
      isFollowing: isFollowingRes.rows.length > 0,
      followsYou: followsYouRes.rows.length > 0,
      followersCount: Number(followersRes.rows?.[0]?.total || 0),
      followingCount: Number(followingRes.rows?.[0]?.total || 0),
    };
  },

  async follow(followerId, targetId) {
    if (String(followerId) === String(targetId)) throw new ValidationError('Cannot follow yourself');
    await db.execute({
      sql: `INSERT INTO follows (follower_id, following_id, is_active, created_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(follower_id, following_id) DO UPDATE SET is_active = 1`,
      args: [followerId, targetId],
    });
    const followersRes = await db.execute({ sql: 'SELECT COUNT(*) as total FROM follows WHERE following_id = ? AND is_active = 1', args: [targetId] });
    createNotification(targetId, 'follow', 'New follower', `Someone started following you`, { followerId }).catch(console.error);
    checkAndGrantAchievements(followerId).catch(console.error);
    checkAndGrantAchievements(targetId).catch(console.error);
    return { message: 'Now following', followersCount: Number(followersRes.rows?.[0]?.total || 0) };
  },

  async unfollow(followerId, targetId) {
    if (String(followerId) === String(targetId)) throw new ValidationError('Cannot unfollow yourself');
    await db.execute({ sql: 'UPDATE follows SET is_active = 0 WHERE follower_id = ? AND following_id = ?', args: [followerId, targetId] });
    const followersRes = await db.execute({ sql: 'SELECT COUNT(*) as total FROM follows WHERE following_id = ? AND is_active = 1', args: [targetId] });
    return { message: 'Unfollowed', followersCount: Number(followersRes.rows?.[0]?.total || 0) };
  },

  async getBlocked(userId) {
    const result = await db.execute({
      sql: `SELECT u.id, u.name, u.image FROM users u
            WHERE u.id IN (SELECT blocked_user_id FROM user_blocks WHERE user_id = ? AND is_active = 1) LIMIT ?`,
      args: [userId, config.limits.followersMax],
    });
    return result.rows || [];
  },

  async unblock(userId, blockedUserId) {
    if (!blockedUserId) throw new ValidationError('blockedUserId required');
    await db.execute({ sql: 'UPDATE user_blocks SET is_active = 0 WHERE user_id = ? AND blocked_user_id = ?', args: [userId, blockedUserId] });
    return { message: 'User unblocked' };
  },

  async getProfileViews(userId) {
    const result = await db.execute({
      sql: `SELECT pv.id, u.id as viewer_id, u.name, u.image, pv.viewed_at
            FROM profile_views pv JOIN users u ON pv.viewer_id = u.id
            WHERE pv.profile_owner_id = ? AND pv.viewed_at >= datetime('now', '-${config.limits.profileViewRetentionDays} days')
            ORDER BY pv.viewed_at DESC LIMIT ?`,
      args: [userId, config.limits.mentionsLimit],
    });
    return result.rows || [];
  },

  async updatePrivacy(userId, { is_public, hide_old_messages }) {
    const updates = [];
    const args = [];
    if (is_public !== undefined) { updates.push('is_public = ?'); args.push(is_public ? 1 : 0); }
    if (hide_old_messages !== undefined) { updates.push('hide_old_messages = ?'); args.push(hide_old_messages ? 1 : 0); }
    if (updates.length === 0) throw new ValidationError('No fields to update');
    args.push(userId);
    await db.execute({ sql: `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, args });
    return { message: 'Privacy settings updated' };
  },
};
