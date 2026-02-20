// routes/users.js
import express from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db.js';

const router = express.Router();

// POST /api/createuser
router.post('/createuser', async (req, res) => {
    const { name, email, password, image } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
    try {
        const exists = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
        if (exists.rows.length > 0) return res.status(409).json({ error: 'User already exists' });

        const hashed = await bcrypt.hash(password, 10);
        const result = await db.execute({
            sql: `INSERT INTO users (name, email, password, image, isAdmin, bio, nativelang, learninglang)
            VALUES (?, ?, ?, ?, 0, '', '', '')`,
            args: [name, email, hashed, image || ''],
        });
        res.status(201).json({ id: result.lastInsertRowid.toString() });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error creating user' });
    }
});

// POST /api/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
        if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        if (!user.password) return res.status(401).json({ error: 'Invalid credentials' });
        if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
        if (user.banned_at) return res.status(403).json({ error: 'Account banned' });
        const { password: _, ...safe } = user;
        res.json(safe);
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/updateuser
router.put('/updateuser', async (req, res) => {
    const { id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang, targetLang, level, country, interests, tandem_goal, is_public, hide_old_messages, bubble_color } = req.body;
    if (!id) return res.status(400).json({ error: 'User ID required' });
    try {
        const safeImage = typeof image === 'string' ? image : '';
        const safeCoverImage = typeof cover_image === 'string' ? cover_image : '';
        const safeInterests = Array.isArray(interests) ? JSON.stringify(interests) : (interests || '[]');
        await db.execute({
            sql: `UPDATE users SET name=?, email=?, image=?, cover_image=?, isAdmin=?, bio=?, nativelang=?,
            learninglang=?, targetLang=?, level=?, country=?, interests=?, tandem_goal=?, is_public=?, hide_old_messages=?, bubble_color=? WHERE id=?`,
            args: [name || '', email || '', safeImage, safeCoverImage, isAdmin ? 1 : 0, bio || '', nativelang || '', learninglang || '',
                targetLang || '', level || 'A1', country || '',
                safeInterests,
                tandem_goal || '', is_public !== undefined ? (is_public ? 1 : 0) : 1, hide_old_messages ? 1 : 0, bubble_color || '#2d88ff', id],
        });
        const updated = await db.execute({
            sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
                   targetLang, level, country, interests, tandem_goal, streak, last_active, banned_at, created_at,
                   is_public, hide_old_messages, bubble_color
                  FROM users WHERE id = ?`,
            args: [id],
        });
        res.json({ message: 'User updated', user: updated.rows[0] || null });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error updating user' });
    }
});

// GET /api/getusers
router.get('/getusers', async (req, res) => {
    const search = req.query.search || '';
    try {
        const result = await db.execute({
            sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
                   targetLang, level, country, interests, tandem_goal, streak, last_active, banned_at, created_at
            FROM users ${search ? 'WHERE name LIKE ? OR email LIKE ?' : ''}
            ORDER BY created_at DESC`,
            args: search ? [`%${search}%`, `%${search}%`] : [],
        });
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/:id — full profile
router.get('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
                   targetLang, level, country, interests, tandem_goal, streak, last_active, created_at,
                   is_public, hide_old_messages, bubble_color
            FROM users WHERE id = ?`,
            args: [id],
        });
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
        const user = result.rows[0];
        try { user.interests = JSON.parse(user.interests || '[]'); } catch { user.interests = []; }
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/deleteuser/:id
router.delete('/deleteuser/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
        res.json({ message: 'User deleted' });
    } catch (e) {
        res.status(500).json({ error: 'Error deleting user' });
    }
});

// PATCH /api/users/:id/admin
router.patch('/users/:id/admin', async (req, res) => {
    const { id } = req.params;
    const { isAdmin } = req.body;
    try {
        await db.execute({ sql: 'UPDATE users SET isAdmin = ? WHERE id = ?', args: [isAdmin ? 1 : 0, id] });
        res.json({ message: 'Admin updated' });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

// PATCH /api/users/:id/ban
router.patch('/users/:id/ban', async (req, res) => {
    const { id } = req.params;
    const { ban } = req.body;
    try {
        await db.execute({
            sql: 'UPDATE users SET banned_at = ? WHERE id = ?',
            args: [ban ? new Date().toISOString() : null, id],
        });
        res.json({ message: ban ? 'User banned' : 'User unbanned' });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

// PATCH /api/users/:id/targetlang
router.patch('/users/:id/targetlang', async (req, res) => {
    const { id } = req.params;
    const { targetLang, level } = req.body;
    try {
        await db.execute({
            sql: 'UPDATE users SET targetLang = ?, level = ? WHERE id = ?',
            args: [targetLang || '', level || 'A1', id],
        });
        res.json({ message: 'Target language updated' });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

// GET /api/users/:id/chat-settings
router.get('/users/:id/chat-settings', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `SELECT bubble_theme, my_bubble_color, other_bubble_color, font_size,
                         effects_enabled, text_only_mode, data_saver_mode, disable_profile_images,
                         room_backgrounds, nicknames, last_room_id, room_drafts
                  FROM user_chat_settings WHERE user_id = ?`,
            args: [id],
        });

        if (!result.rows.length) {
            return res.json({
                bubbleTheme: 'neon',
                myBubbleColor: '#2d88ff',
                otherBubbleColor: '#1e2430',
                fontSize: 'large',
                effectsEnabled: true,
                textOnlyMode: false,
                dataSaverMode: false,
                disableProfileImages: false,
                roomBackgrounds: {},
                nicknames: {},
                lastRoomId: '',
                roomDrafts: {},
            });
        }

        const row = result.rows[0];
        let roomBackgrounds = {};
        let nicknames = {};
        let roomDrafts = {};
        try { roomBackgrounds = JSON.parse(row.room_backgrounds || '{}'); } catch { roomBackgrounds = {}; }
        try { nicknames = JSON.parse(row.nicknames || '{}'); } catch { nicknames = {}; }
        try { roomDrafts = JSON.parse(row.room_drafts || '{}'); } catch { roomDrafts = {}; }

        res.json({
            bubbleTheme: row.bubble_theme || 'neon',
            myBubbleColor: row.my_bubble_color || '#2d88ff',
            otherBubbleColor: row.other_bubble_color || '#1e2430',
            fontSize: row.font_size || 'large',
            effectsEnabled: Boolean(row.effects_enabled),
            textOnlyMode: Boolean(row.text_only_mode),
            dataSaverMode: Boolean(row.data_saver_mode),
            disableProfileImages: Boolean(row.disable_profile_images),
            roomBackgrounds,
            nicknames,
            lastRoomId: row.last_room_id || '',
            roomDrafts,
        });
    } catch (e) {
        console.error('Error fetching chat settings:', e);
        res.status(500).json({ error: 'Error fetching chat settings' });
    }
});

// PUT /api/users/:id/chat-settings
router.put('/users/:id/chat-settings', async (req, res) => {
    const { id } = req.params;
    const {
        bubbleTheme,
        myBubbleColor,
        otherBubbleColor,
        fontSize,
        effectsEnabled,
        textOnlyMode,
        dataSaverMode,
        disableProfileImages,
        roomBackgrounds,
        nicknames,
        lastRoomId,
        roomDrafts,
    } = req.body || {};

    const safeBubbleTheme = ['neon', 'pastel', 'minimal', 'custom'].includes(bubbleTheme) ? bubbleTheme : 'neon';
    const safeFontSize = ['small', 'medium', 'large'].includes(fontSize) ? fontSize : 'large';
    const safeMyColor = typeof myBubbleColor === 'string' ? myBubbleColor : '#2d88ff';
    const safeOtherColor = typeof otherBubbleColor === 'string' ? otherBubbleColor : '#1e2430';
    const safeRoomBackgrounds = roomBackgrounds && typeof roomBackgrounds === 'object' ? roomBackgrounds : {};
    const safeNicknames = nicknames && typeof nicknames === 'object' ? nicknames : {};
    const safeLastRoomId = typeof lastRoomId === 'string' ? lastRoomId : '';
    const safeRoomDrafts = roomDrafts && typeof roomDrafts === 'object' ? roomDrafts : {};

    try {
        await db.execute({
            sql: `INSERT INTO user_chat_settings (
                    user_id, bubble_theme, my_bubble_color, other_bubble_color, font_size,
                    effects_enabled, text_only_mode, data_saver_mode, disable_profile_images,
                                        room_backgrounds, nicknames, last_room_id, room_drafts, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id) DO UPDATE SET
                    bubble_theme = excluded.bubble_theme,
                    my_bubble_color = excluded.my_bubble_color,
                    other_bubble_color = excluded.other_bubble_color,
                    font_size = excluded.font_size,
                    effects_enabled = excluded.effects_enabled,
                    text_only_mode = excluded.text_only_mode,
                    data_saver_mode = excluded.data_saver_mode,
                    disable_profile_images = excluded.disable_profile_images,
                    room_backgrounds = excluded.room_backgrounds,
                    nicknames = excluded.nicknames,
                    last_room_id = excluded.last_room_id,
                    room_drafts = excluded.room_drafts,
                    updated_at = CURRENT_TIMESTAMP`,
            args: [
                id,
                safeBubbleTheme,
                safeMyColor,
                safeOtherColor,
                safeFontSize,
                effectsEnabled ? 1 : 0,
                textOnlyMode ? 1 : 0,
                dataSaverMode ? 1 : 0,
                disableProfileImages ? 1 : 0,
                JSON.stringify(safeRoomBackgrounds),
                JSON.stringify(safeNicknames),
                safeLastRoomId,
                JSON.stringify(safeRoomDrafts),
            ],
        });

        res.json({ message: 'Chat settings saved' });
    } catch (e) {
        console.error('Error saving chat settings:', e);
        res.status(500).json({ error: 'Error saving chat settings' });
    }
});

// GET /api/users/:id/moderation
router.get('/users/:id/moderation', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `SELECT target_user_id, muted, blocked FROM user_moderation WHERE user_id = ?`,
            args: [id],
        });
        const map = {};
        for (const row of result.rows) {
            map[String(row.target_user_id)] = {
                muted: Boolean(row.muted),
                blocked: Boolean(row.blocked),
            };
        }
        res.json({ entries: map });
    } catch (e) {
        console.error('Error fetching moderation:', e);
        res.status(500).json({ error: 'Error fetching moderation' });
    }
});

// PUT /api/users/:id/moderation/:targetId
router.put('/users/:id/moderation/:targetId', async (req, res) => {
    const { id, targetId } = req.params;
    const { muted, blocked } = req.body || {};
    const mutedValue = muted ? 1 : 0;
    const blockedValue = blocked ? 1 : 0;

    if (String(id) === String(targetId)) {
        return res.status(400).json({ error: 'Cannot moderate yourself' });
    }

    try {
        await db.execute({
            sql: `INSERT INTO user_moderation (user_id, target_user_id, muted, blocked, updated_at)
                  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id, target_user_id) DO UPDATE SET
                    muted = excluded.muted,
                    blocked = excluded.blocked,
                    updated_at = CURRENT_TIMESTAMP`,
            args: [id, targetId, mutedValue, blockedValue],
        });
        res.json({ message: 'Moderation updated', muted: Boolean(mutedValue), blocked: Boolean(blockedValue) });
    } catch (e) {
        console.error('Error updating moderation:', e);
        res.status(500).json({ error: 'Error updating moderation' });
    }
});

// GET /api/users/:id/room-role/:roomId
router.get('/users/:id/room-role/:roomId', async (req, res) => {
    const { id, roomId } = req.params;
    try {
        const result = await db.execute({
            sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
            args: [id, roomId],
        });
        const role = result.rows.length ? result.rows[0].role : 'user';
        res.json({ userId: id, roomId, role });
    } catch (e) {
        console.error('Error fetching user role:', e);
        res.status(500).json({ error: 'Error fetching role' });
    }
});

// PUT /api/users/:id/room-role/:roomId (only mods/owners can set roles)
router.put('/users/:id/room-role/:roomId', async (req, res) => {
    const { id, roomId } = req.params;
    const { role, requestingUserId } = req.body || {};
    if (!['user', 'mod', 'owner'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    try {
        // Check if requester is owner/mod of room
        const requesterRole = await db.execute({
            sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
            args: [requestingUserId, roomId],
        });
        const requesterIsAdmin = requesterRole.rows.length && (requesterRole.rows[0].role === 'owner' || requesterRole.rows[0].role === 'mod');
        if (!requesterIsAdmin) {
            return res.status(403).json({ error: 'Only mods/owners can assign roles' });
        }
        await db.execute({
            sql: `INSERT INTO user_room_roles (user_id, room_id, role, assigned_by, assigned_at)
                  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id, room_id) DO UPDATE SET role = excluded.role`,
            args: [id, roomId, role, requestingUserId],
        });
        // Log action
        await db.execute({
            sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id, details) VALUES (?, ?, ?, ?, ?)',
            args: [requestingUserId, 'set_role', id, roomId, JSON.stringify({ role })],
        });
        res.json({ message: 'Role assigned', userId: id, roomId, role });
    } catch (e) {
        console.error('Error assigning role:', e);
        res.status(500).json({ error: 'Error assigning role' });
    }
});

// GET /api/users/:id/mentions (unread mentions)
router.get('/users/:id/mentions', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `SELECT m.id, m.mentioned_user_id, msg.id as message_id, msg.content, msg.user_id as sender_id,
                         u.name as sender_name, u.image as sender_image, msg.room_id, r.name as room_name,
                         m.created_at, m.is_read
                  FROM mentions m
                  JOIN messages msg ON m.message_id = msg.id
                  JOIN users u ON msg.user_id = u.id
                  JOIN rooms r ON msg.room_id = r.id
                  WHERE m.mentioned_user_id = ?
                  ORDER BY m.created_at DESC LIMIT 50`,
            args: [id],
        });
        res.json({ mentions: result.rows });
    } catch (e) {
        console.error('Error fetching mentions:', e);
        res.status(500).json({ error: 'Error fetching mentions' });
    }
});

// POST /api/users/:id/mentions/mark-read
router.post('/users/:id/mentions/mark-read', async (req, res) => {
    const { id } = req.params;
    const { mentionIds } = req.body || {};
    if (!mentionIds || !Array.isArray(mentionIds)) {
        return res.status(400).json({ error: 'mentionIds array required' });
    }
    try {
        const placeholders = mentionIds.map(() => '?').join(',');
        await db.execute({
            sql: `UPDATE mentions SET is_read = 1 WHERE mentioned_user_id = ? AND id IN (${placeholders})`,
            args: [id, ...mentionIds],
        });
        res.json({ message: 'Mentions marked as read' });
    } catch (e) {
        console.error('Error marking mentions:', e);
        res.status(500).json({ error: 'Error marking mentions' });
    }
});

// POST /api/users/:id/ban (ban user from room)
router.post('/users/:id/ban', async (req, res) => {
    const { id } = req.params;
    const { roomId, banningUserId, reason, durationMinutes } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });
    if (String(id) === String(banningUserId)) {
        return res.status(400).json({ error: 'Cannot ban yourself' });
    }
    try {
        // Check if banning user is mod/owner
        const bannerRole = await db.execute({
            sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
            args: [banningUserId, roomId],
        });
        const isAdmin = bannerRole.rows.length && (bannerRole.rows[0].role === 'owner' || bannerRole.rows[0].role === 'mod');
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only mods/owners can ban' });
        }
        const isPermanent = !durationMinutes || durationMinutes === 0;
        const expiresAt = isPermanent ? null : new Date(Date.now() + durationMinutes * 60000).toISOString();
        await db.execute({
            sql: `INSERT INTO room_bans (user_id, room_id, banned_by, reason, expires_at, is_permanent)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, room_id) DO UPDATE SET
                    banned_by = excluded.banned_by,
                    reason = excluded.reason,
                    expires_at = excluded.expires_at`,
            args: [id, roomId, banningUserId, reason || '', expiresAt, isPermanent ? 1 : 0],
        });
        // Log action
        await db.execute({
            sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id, details) VALUES (?, ?, ?, ?, ?)',
            args: [banningUserId, 'ban_user', id, roomId, JSON.stringify({ reason, durationMinutes, isPermanent })],
        });
        res.json({ message: 'User banned', userId: id, roomId, expiresAt });
    } catch (e) {
        console.error('Error banning user:', e);
        res.status(500).json({ error: 'Error banning user' });
    }
});

// DELETE /api/users/:id/ban/:roomId (unban)
router.delete('/users/:id/ban/:roomId', async (req, res) => {
    const { id, roomId } = req.params;
    const { requestingUserId } = req.body || {};
    try {
        // Check admin
        const requesterRole = await db.execute({
            sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
            args: [requestingUserId, roomId],
        });
        const isAdmin = requesterRole.rows.length && (requesterRole.rows[0].role === 'owner' || requesterRole.rows[0].role === 'mod');
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only mods/owners can unban' });
        }
        await db.execute({
            sql: 'DELETE FROM room_bans WHERE user_id = ? AND room_id = ?',
            args: [id, roomId],
        });
        // Log action
        await db.execute({
            sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id) VALUES (?, ?, ?, ?)',
            args: [requestingUserId, 'unban_user', id, roomId],
        });
        res.json({ message: 'User unbanned' });
    } catch (e) {
        console.error('Error unbanning user:', e);
        res.status(500).json({ error: 'Error unbanning user' });
    }
});

// GET /api/users/:id/emoji-favorites
router.get('/users/:id/emoji-favorites', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: 'SELECT emoji, count FROM user_emoji_favorites WHERE user_id = ? ORDER BY count DESC, last_used DESC LIMIT 30',
            args: [id],
        });
        res.json({ favorites: result.rows.map(r => r.emoji) });
    } catch (e) {
        console.error('Error fetching emoji favorites:', e);
        res.status(500).json({ error: 'Error fetching emoji favorites' });
    }
});

// POST /api/users/:id/emoji-favorites/:emoji (track emoji usage)
router.post('/users/:id/emoji-favorites/:emoji', async (req, res) => {
    const { id, emoji } = req.params;
    try {
        await db.execute({
            sql: `INSERT INTO user_emoji_favorites (user_id, emoji, count, last_used)
                  VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id, emoji) DO UPDATE SET
                    count = count + 1,
                    last_used = CURRENT_TIMESTAMP`,
            args: [id, emoji],
        });
        res.json({ message: 'Emoji favorite tracked' });
    } catch (e) {
        console.error('Error tracking emoji:', e);
        res.status(500).json({ error: 'Error tracking emoji' });
    }
});

// GET /api/users/:id/audit-log/:roomId (mod actions in room)
router.get('/users/:id/audit-log/:roomId', async (req, res) => {
    const { id, roomId } = req.params;
    try {
        // Check if user is mod/owner of room
        const userRole = await db.execute({
            sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
            args: [id, roomId],
        });
        const isAdmin = userRole.rows.length && (userRole.rows[0].role === 'owner' || userRole.rows[0].role === 'mod');
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only mods/owners can view audit log' });
        }
        const result = await db.execute({
            sql: `SELECT ma.id, ma.mod_id, u1.name as mod_name, ma.action, ma.target_user_id, u2.name as target_name,
                         ma.details, ma.created_at
                  FROM moderator_actions ma
                  LEFT JOIN users u1 ON ma.mod_id = u1.id
                  LEFT JOIN users u2 ON ma.target_user_id = u2.id
                  WHERE ma.room_id = ?
                  ORDER BY ma.created_at DESC LIMIT 100`,
            args: [roomId],
        });
        res.json({ actions: result.rows });
    } catch (e) {
        console.error('Error fetching audit log:', e);
        res.status(500).json({ error: 'Error fetching audit log' });
    }
});

export default router;
