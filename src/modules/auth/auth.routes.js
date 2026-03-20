// src/modules/auth/auth.routes.js
import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { db } from '../../config/database.js';
import { generateToken, auth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { createUserSchema, loginSchema } from './auth.schemas.js';

const router = express.Router();

// POST /api/createuser — public
router.post('/createuser', validate(createUserSchema), async (req, res) => {
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

        const userId = result.lastInsertRowid.toString();
        const userRes = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] });
        const user = userRes.rows[0];
        const { password: _, ...safe } = user;
        const token = generateToken({ id: userId, email, isAdmin: false });

        res.status(201).json({ ...safe, token });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error creating user' });
    }
});

// POST /api/login — public
router.post('/login', validate(loginSchema), async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
        if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        if (!user.password) return res.status(401).json({ error: 'Invalid credentials' });
        if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
        if (user.deleted_at) return res.status(401).json({ error: 'Account has been deleted' });
        if (user.banned_at) return res.status(403).json({ error: 'Account banned' });

        const { password: _, deleted_at: _d, ...safe } = user;
        const token = generateToken(user);

        res.json({ ...safe, token });
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/forgot-password — public
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    try {
        const result = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
        if (!result.rows.length) {
            // Don't reveal whether the email exists
            return res.json({ message: 'If the email exists, a reset link has been generated' });
        }
        const user = result.rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await db.execute({
            sql: 'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
            args: [user.id, token, expiresAt],
        });
        // In production, send the token via email instead of returning it
        res.json({ message: 'If the email exists, a reset link has been generated', token });
    } catch (e) {
        console.error('Error in forgot-password:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/reset-password — public
router.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const result = await db.execute({
            sql: "SELECT id, user_id FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')",
            args: [token],
        });
        if (!result.rows.length) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }
        const resetRecord = result.rows[0];
        const hashed = await bcrypt.hash(newPassword, 10);
        await db.execute({
            sql: 'UPDATE users SET password = ? WHERE id = ?',
            args: [hashed, resetRecord.user_id],
        });
        await db.execute({
            sql: 'UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?',
            args: [resetRecord.id],
        });
        res.json({ message: 'Password reset successfully' });
    } catch (e) {
        console.error('Error in reset-password:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/change-password — authenticated
router.post('/change-password', auth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current password and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const result = await db.execute({ sql: 'SELECT password FROM users WHERE id = ?', args: [req.user.id] });
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
        const user = result.rows[0];
        if (!user.password || !(await bcrypt.compare(currentPassword, user.password))) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        await db.execute({
            sql: 'UPDATE users SET password = ? WHERE id = ?',
            args: [hashed, req.user.id],
        });
        res.json({ message: 'Password changed successfully' });
    } catch (e) {
        console.error('Error in change-password:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
