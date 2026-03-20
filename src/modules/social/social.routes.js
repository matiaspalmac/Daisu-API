// routes/social.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly, ownerOrAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { reportSchema } from './social.schemas.js';
import { createNotification } from '../notifications/notifications.service.js';
import { checkAndGrantAchievements } from '../achievements/achievements.service.js';

const router = express.Router();

// POST /api/report — authenticated
router.post('/report', auth, validate(reportSchema), async (req, res) => {
    const { messageId, reason } = req.body;
    const reporterId = req.user.id;
    if (!messageId || !reason) return res.status(400).json({ error: 'messageId and reason required' });
    try {
        await db.execute({
            sql: 'INSERT INTO reports (message_id, reporter_id, reason) VALUES (?, ?, ?)',
            args: [messageId, reporterId, reason],
        });
        res.status(201).json({ message: 'Report submitted' });
    } catch (e) {
        console.error('Report error:', e);
        res.status(500).json({ error: 'Error submitting report' });
    }
});

// GET /api/reports — admin only
router.get('/reports', auth, adminOnly, async (req, res) => {
    const status = req.query.status || 'pending';
    try {
        const result = await db.execute({
            sql: `SELECT r.id, r.reason, r.status, r.created_at, r.notes,
              m.content as message_content, m.id as message_id, m.room_id,
              u.name as reporter_name, u.id as reporter_id,
              author.name as author_name, author.id as author_id
            FROM reports r
            JOIN messages m ON r.message_id = m.id
            JOIN users u ON r.reporter_id = u.id
            JOIN users author ON m.user_id = author.id
            WHERE r.status = ?
            ORDER BY r.created_at DESC`,
            args: [status],
        });
        res.json(result.rows);
    } catch (e) {
        console.error('Reports error:', e);
        res.status(500).json({ error: 'Error fetching reports' });
    }
});

// PATCH /api/reports/:id — admin only
router.patch('/reports/:id', auth, adminOnly, async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });
    try {
        // Fetch reporter before updating so we can notify them
        const reportRow = await db.execute({ sql: 'SELECT reporter_id FROM reports WHERE id = ?', args: [id] });
        await db.execute({ sql: 'UPDATE reports SET status = ?, notes = ? WHERE id = ?', args: [status, notes || '', id] });

        // Fire-and-forget notification to the reporter
        if (reportRow.rows.length > 0) {
            const reporterId = reportRow.rows[0].reporter_id;
            createNotification(
                reporterId,
                'report_resolved',
                'Report updated',
                `Your report has been marked as "${status}"`,
                { reportId: id, status }
            ).catch(console.error);
        }

        res.json({ message: 'Report updated' });
    } catch (e) {
        res.status(500).json({ error: 'Error updating report' });
    }
});

// GET /api/match — authenticated
router.get('/match', auth, async (req, res) => {
    const userId = req.user.id;
    try {
        const me = await db.execute({ sql: 'SELECT targetLang, nativelang, level FROM users WHERE id = ?', args: [userId] });
        if (!me.rows.length) return res.status(404).json({ error: 'User not found' });
        const { targetLang, nativelang } = me.rows[0];

        const match = await db.execute({
            sql: `SELECT id, name, image, level FROM users
            WHERE id != ? AND nativelang = ? AND targetLang = ? AND banned_at IS NULL
            ORDER BY RANDOM() LIMIT 1`,
            args: [userId, targetLang || '', nativelang || ''],
        });

        if (!match.rows.length) return res.status(404).json({ error: 'No match found right now. Try again in a moment!' });

        const partner = match.rows[0];
        const pairMin = Math.min(Number(userId), Number(partner.id));
        const pairMax = Math.max(Number(userId), Number(partner.id));
        const roomName = `private_${pairMin}_${pairMax}_${Date.now()}`;

        const result = await db.execute({
            sql: `INSERT OR IGNORE INTO rooms (name, description, type, language) VALUES (?, ?, 'private', ?)`,
            args: [roomName, 'Sesión privada entre compañeros de tandem', targetLang || ''],
        });

        let roomId;
        if (result.rowsAffected > 0) {
            roomId = result.lastInsertRowid.toString();
        } else {
            const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE name = ?', args: [roomName] });
            roomId = existing.rows[0].id.toString();
        }

        const sessionResult = await db.execute({
            sql: 'INSERT INTO tandem_sessions (room_id, user1_id, user2_id, language, status) VALUES (?, ?, ?, ?, ?)',
            args: [roomId, userId, partner.id, targetLang || '', 'active'],
        });
        const tandemSessionId = sessionResult.lastInsertRowid.toString();

        // Fire-and-forget notification to the matched partner
        const myName = (await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] })).rows[0]?.name || 'Someone';
        createNotification(
            partner.id,
            'tandem_match',
            'Tandem match found!',
            `${myName} has been matched with you for a tandem session`,
            { roomId, tandemSessionId, partnerName: myName }
        ).catch(console.error);

        res.json({ roomId, roomName, tandemSessionId, partner: { id: partner.id, name: partner.name, image: partner.image, level: partner.level } });
    } catch (e) {
        console.error('Match error:', e);
        res.status(500).json({ error: 'Match error' });
    }
});

// GET /api/users/:id/followers — authenticated
router.get('/users/:id/followers', auth, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `
              SELECT u.id, u.name, u.image, u.level
              FROM users u
              WHERE u.id IN (
                SELECT follower_id FROM follows WHERE following_id = ? AND is_active = 1
              )
              LIMIT 100
            `,
            args: [id],
        });
        res.json(result.rows || []);
    } catch (e) {
        console.error('Followers error:', e);
        res.status(500).json({ error: 'Error fetching followers' });
    }
});

// GET /api/users/:id/following — authenticated
router.get('/users/:id/following', auth, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `
              SELECT u.id, u.name, u.image, u.level
              FROM users u
              WHERE u.id IN (
                SELECT following_id FROM follows WHERE follower_id = ? AND is_active = 1
              )
              LIMIT 100
            `,
            args: [id],
        });
        res.json(result.rows || []);
    } catch (e) {
        console.error('Following error:', e);
        res.status(500).json({ error: 'Error fetching following users' });
    }
});

// GET /api/users/:id/follow-status — authenticated
router.get('/users/:id/follow-status', auth, async (req, res) => {
    const { id } = req.params;
    const viewerId = req.query.viewerId || req.user.id;

    try {
        const [isFollowingRes, followsYouRes, followersRes, followingRes] = await Promise.all([
            db.execute({
                sql: 'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND is_active = 1 LIMIT 1',
                args: [viewerId, id],
            }),
            db.execute({
                sql: 'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND is_active = 1 LIMIT 1',
                args: [id, viewerId],
            }),
            db.execute({
                sql: 'SELECT COUNT(*) as total FROM follows WHERE following_id = ? AND is_active = 1',
                args: [id],
            }),
            db.execute({
                sql: 'SELECT COUNT(*) as total FROM follows WHERE follower_id = ? AND is_active = 1',
                args: [id],
            }),
        ]);

        res.json({
            isFollowing: isFollowingRes.rows.length > 0,
            followsYou: followsYouRes.rows.length > 0,
            followersCount: Number(followersRes.rows?.[0]?.total || 0),
            followingCount: Number(followingRes.rows?.[0]?.total || 0),
        });
    } catch (e) {
        console.error('Follow status error:', e);
        res.status(500).json({ error: 'Error fetching follow status' });
    }
});

// POST /api/users/:id/follow — authenticated, uses token identity
router.post('/users/:id/follow', auth, async (req, res) => {
    const { id } = req.params;
    const followerId = req.user.id;

    if (String(followerId) === String(id)) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    try {
        await db.execute({
            sql: `INSERT INTO follows (follower_id, following_id, is_active, created_at)
                  VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                  ON CONFLICT(follower_id, following_id) DO UPDATE SET is_active = 1`,
            args: [followerId, id],
        });

        const followersRes = await db.execute({
            sql: 'SELECT COUNT(*) as total FROM follows WHERE following_id = ? AND is_active = 1',
            args: [id],
        });

        // Fire-and-forget notification to the followed user
        const followerName = req.user.name || 'Someone';
        createNotification(
            id,
            'follow',
            'New follower',
            `${followerName} started following you`,
            { followerId: followerId, followerName }
        ).catch(console.error);

        // Check achievements for both the follower (following_count) and the followed user (followers_count)
        checkAndGrantAchievements(followerId).catch(console.error);
        checkAndGrantAchievements(id).catch(console.error);

        res.json({ message: 'Now following', followersCount: Number(followersRes.rows?.[0]?.total || 0) });
    } catch (e) {
        console.error('Follow error:', e);
        res.status(500).json({ error: 'Error following user' });
    }
});

// POST /api/users/:id/unfollow — authenticated, uses token identity
router.post('/users/:id/unfollow', auth, async (req, res) => {
    const { id } = req.params;
    const followerId = req.user.id;

    if (String(followerId) === String(id)) {
        return res.status(400).json({ error: 'Cannot unfollow yourself' });
    }

    try {
        await db.execute({
            sql: 'UPDATE follows SET is_active = 0 WHERE follower_id = ? AND following_id = ?',
            args: [followerId, id],
        });

        const followersRes = await db.execute({
            sql: 'SELECT COUNT(*) as total FROM follows WHERE following_id = ? AND is_active = 1',
            args: [id],
        });

        res.json({ message: 'Unfollowed', followersCount: Number(followersRes.rows?.[0]?.total || 0) });
    } catch (e) {
        console.error('Unfollow error:', e);
        res.status(500).json({ error: 'Error unfollowing user' });
    }
});

// GET /api/users/:id/blocked — owner or admin
router.get('/users/:id/blocked', auth, ownerOrAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `
              SELECT u.id, u.name, u.image
              FROM users u
              WHERE u.id IN (
                SELECT blocked_user_id FROM user_blocks WHERE user_id = ? AND is_active = 1
              )
              LIMIT 100
            `,
            args: [id],
        });
        res.json(result.rows || []);
    } catch (e) {
        console.error('Blocked users error:', e);
        res.status(500).json({ error: 'Error fetching blocked users' });
    }
});

// POST /api/users/:id/unblock — owner or admin
router.post('/users/:id/unblock', auth, ownerOrAdmin, async (req, res) => {
    const { id } = req.params;
    const { blockedUserId } = req.body;
    if (!blockedUserId) return res.status(400).json({ error: 'blockedUserId required' });
    try {
        await db.execute({
            sql: 'UPDATE user_blocks SET is_active = 0 WHERE user_id = ? AND blocked_user_id = ?',
            args: [id, blockedUserId],
        });
        res.json({ message: 'User unblocked' });
    } catch (e) {
        console.error('Unblock error:', e);
        res.status(500).json({ error: 'Error unblocking user' });
    }
});

// GET /api/users/:id/profile-views — owner or admin
router.get('/users/:id/profile-views', auth, ownerOrAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `
              SELECT pv.id, u.id as viewer_id, u.name, u.image, pv.viewed_at
              FROM profile_views pv
              JOIN users u ON pv.viewer_id = u.id
              WHERE pv.profile_owner_id = ? AND pv.viewed_at >= datetime('now', '-90 days')
              ORDER BY pv.viewed_at DESC
              LIMIT 50
            `,
            args: [id],
        });
        res.json(result.rows || []);
    } catch (e) {
        console.error('Profile views error:', e);
        res.status(500).json({ error: 'Error fetching profile views' });
    }
});

// PATCH /api/users/:id/privacy — owner or admin
router.patch('/users/:id/privacy', auth, ownerOrAdmin, async (req, res) => {
    const { id } = req.params;
    const { is_public, hide_old_messages } = req.body;
    try {
        const updates = [];
        const args = [];

        if (is_public !== undefined) {
            updates.push('is_public = ?');
            args.push(is_public ? 1 : 0);
        }
        if (hide_old_messages !== undefined) {
            updates.push('hide_old_messages = ?');
            args.push(hide_old_messages ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        args.push(id);
        await db.execute({
            sql: `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            args,
        });
        res.json({ message: 'Privacy settings updated' });
    } catch (e) {
        console.error('Privacy update error:', e);
        res.status(500).json({ error: 'Error updating privacy settings' });
    }
});

export default router;
