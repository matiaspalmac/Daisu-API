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
    const { id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang, targetLang, level, country, interests, tandem_goal } = req.body;
    if (!id) return res.status(400).json({ error: 'User ID required' });
    try {
        const safeImage = typeof image === 'string' ? image : '';
        const safeCoverImage = typeof cover_image === 'string' ? cover_image : '';
        const safeInterests = Array.isArray(interests) ? JSON.stringify(interests) : (interests || '[]');
        await db.execute({
            sql: `UPDATE users SET name=?, email=?, image=?, cover_image=?, isAdmin=?, bio=?, nativelang=?,
            learninglang=?, targetLang=?, level=?, country=?, interests=?, tandem_goal=? WHERE id=?`,
            args: [name || '', email || '', safeImage, safeCoverImage, isAdmin ? 1 : 0, bio || '', nativelang || '', learninglang || '',
                targetLang || '', level || 'A1', country || '',
                safeInterests,
                tandem_goal || '', id],
        });
        const updated = await db.execute({
            sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
                   targetLang, level, country, interests, tandem_goal, streak, last_active, banned_at, created_at
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
                   targetLang, level, country, interests, tandem_goal, streak, last_active, created_at
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

export default router;
