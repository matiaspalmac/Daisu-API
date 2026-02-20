// routes/social.js
import express from 'express';
import { db } from '../db.js';

const router = express.Router();

// POST /api/report — report a message
router.post('/report', async (req, res) => {
    const { messageId, reporterId, reason } = req.body;
    if (!messageId || !reporterId || !reason) return res.status(400).json({ error: 'messageId, reporterId, reason required' });
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

// GET /api/reports — admin: get all pending reports
router.get('/reports', async (req, res) => {
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

// PATCH /api/reports/:id — resolve or dismiss
router.patch('/reports/:id', async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    try {
        await db.execute({ sql: 'UPDATE reports SET status = ?, notes = ? WHERE id = ?', args: [status, notes || '', id] });
        res.json({ message: 'Report updated' });
    } catch (e) {
        res.status(500).json({ error: 'Error updating report' });
    }
});

// GET /api/match — find a compatible tandem partner and create a private room
router.get('/match', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
        const me = await db.execute({ sql: 'SELECT targetLang, nativelang, level FROM users WHERE id = ?', args: [userId] });
        if (!me.rows.length) return res.status(404).json({ error: 'User not found' });
        const { targetLang, nativelang, level } = me.rows[0];

        // Find user whose nativeLang = my targetLang and whose targetLang = my nativeLang
        const match = await db.execute({
            sql: `SELECT id, name, image, level FROM users
            WHERE id != ? AND nativelang = ? AND targetLang = ? AND banned_at IS NULL
            ORDER BY RANDOM() LIMIT 1`,
            args: [userId, targetLang || '', nativelang || ''],
        });

        if (!match.rows.length) return res.status(404).json({ error: 'No match found right now. Try again in a moment!' });

        const partner = match.rows[0];
        const roomName = `private_${Math.min(Number(userId), partner.id)}_${Math.max(Number(userId), partner.id)}_${Date.now()}`;

        const existing = await db.execute({ sql: 'SELECT id FROM rooms WHERE name = ?', args: [roomName] });
        let roomId;
        if (existing.rows.length > 0) {
            roomId = existing.rows[0].id.toString();
        } else {
            const result = await db.execute({
                sql: `INSERT INTO rooms (name, description, type, language) VALUES (?, ?, 'private', ?)`,
                args: [roomName, `Sesión privada entre compañeros de tandem`, targetLang || ''],
            });
            roomId = result.lastInsertRowid.toString();
        }

        res.json({ roomId, roomName, partner: { id: partner.id, name: partner.name, image: partner.image, level: partner.level } });
    } catch (e) {
        console.error('Match error:', e);
        res.status(500).json({ error: 'Match error' });
    }
});

// GET /api/users/:id/followers — get user's followers
router.get('/users/:id/followers', async (req, res) => {
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

// GET /api/users/:id/following — get users this account follows
router.get('/users/:id/following', async (req, res) => {
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

// GET /api/users/:id/follow-status?viewerId=123 — relationship + counters
router.get('/users/:id/follow-status', async (req, res) => {
    const { id } = req.params;
    const viewerId = req.query.viewerId;

    if (!viewerId) {
        return res.status(400).json({ error: 'viewerId required' });
    }

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

// POST /api/users/:id/follow — viewer follows target user
router.post('/users/:id/follow', async (req, res) => {
    const { id } = req.params;
    const { followerId } = req.body || {};

    if (!followerId) {
        return res.status(400).json({ error: 'followerId required' });
    }

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

        res.json({ message: 'Now following', followersCount: Number(followersRes.rows?.[0]?.total || 0) });
    } catch (e) {
        console.error('Follow error:', e);
        res.status(500).json({ error: 'Error following user' });
    }
});

// POST /api/users/:id/unfollow — viewer unfollows target user
router.post('/users/:id/unfollow', async (req, res) => {
    const { id } = req.params;
    const { followerId } = req.body || {};

    if (!followerId) {
        return res.status(400).json({ error: 'followerId required' });
    }

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

// GET /api/users/:id/blocked — get user's blocked users list
router.get('/users/:id/blocked', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `
              SELECT u.id, u.name, u.image, u.email
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

// POST /api/users/:id/unblock — unblock a user
router.post('/users/:id/unblock', async (req, res) => {
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

// GET /api/users/:id/profile-views — get profile view history
router.get('/users/:id/profile-views', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `
              SELECT pv.id, u.id, u.name, u.image, pv.viewed_at
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

// PATCH /api/users/:id/privacy — update privacy settings
router.patch('/users/:id/privacy', async (req, res) => {
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
        const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        
        await db.execute({ sql, args });
        res.json({ message: 'Privacy settings updated' });
    } catch (e) {
        console.error('Privacy update error:', e);
        res.status(500).json({ error: 'Error updating privacy settings' });
    }
});

export default router;
