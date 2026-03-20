// routes/achievements.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';

const router = express.Router();

// GET /api/achievements — list all achievements, include whether current user earned each
router.get('/achievements', auth, async (req, res) => {
    const userId = req.user.id;
    const isAdmin = req.user.isAdmin;
    try {
        const result = await db.execute({
            sql: `SELECT a.id, a.name, a.description, a.icon, a.category, a.xp_reward,
                         a.requirement_type, a.requirement_value, a.is_hidden,
                         ua.earned_at
                  FROM achievements a
                  LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
                  ${isAdmin ? '' : 'WHERE a.is_hidden = 0 OR ua.earned_at IS NOT NULL'}
                  ORDER BY a.category, a.name`,
            args: [userId],
        });
        const achievements = result.rows.map(row => ({
            ...row,
            is_hidden: Boolean(row.is_hidden),
            earned: row.earned_at !== null,
            earned_at: row.earned_at || null,
        }));
        res.json({ achievements });
    } catch (e) {
        console.error('Error fetching achievements:', e);
        res.status(500).json({ error: 'Error fetching achievements' });
    }
});

// GET /api/users/:id/achievements — list achievements earned by a user
router.get('/users/:id/achievements', auth, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: `SELECT a.id, a.name, a.description, a.icon, a.category, a.xp_reward,
                         ua.earned_at
                  FROM user_achievements ua
                  JOIN achievements a ON ua.achievement_id = a.id
                  WHERE ua.user_id = ?
                  ORDER BY ua.earned_at DESC`,
            args: [id],
        });
        res.json({ achievements: result.rows });
    } catch (e) {
        console.error('Error fetching user achievements:', e);
        res.status(500).json({ error: 'Error fetching user achievements' });
    }
});

// GET /api/users/:id/xp — get XP total + recent XP log
router.get('/users/:id/xp', auth, async (req, res) => {
    const { id } = req.params;
    try {
        const userResult = await db.execute({
            sql: 'SELECT xp FROM users WHERE id = ?',
            args: [id],
        });
        if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });

        const xp = Number(userResult.rows[0].xp) || 0;
        const level = Math.floor(xp / 100) + 1;

        const logResult = await db.execute({
            sql: `SELECT id, amount, reason, reference_id, created_at
                  FROM xp_log
                  WHERE user_id = ?
                  ORDER BY created_at DESC
                  LIMIT 20`,
            args: [id],
        });
        res.json({ xp, level, log: logResult.rows });
    } catch (e) {
        console.error('Error fetching XP:', e);
        res.status(500).json({ error: 'Error fetching XP' });
    }
});

// GET /api/leaderboard — top 20 users by XP
router.get('/leaderboard', auth, async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT id, name, image, xp
                  FROM users
                  WHERE banned_at IS NULL
                  ORDER BY xp DESC
                  LIMIT 20`,
            args: [],
        });
        const leaderboard = result.rows.map(row => ({
            ...row,
            xp: Number(row.xp) || 0,
            level: Math.floor((Number(row.xp) || 0) / 100) + 1,
        }));
        res.json({ leaderboard });
    } catch (e) {
        console.error('Error fetching leaderboard:', e);
        res.status(500).json({ error: 'Error fetching leaderboard' });
    }
});

// POST /api/admin/achievements — create new achievement (admin only)
router.post('/admin/achievements', auth, adminOnly, async (req, res) => {
    const { id, name, description, icon, category, xp_reward, requirement_type, requirement_value, is_hidden } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'Achievement id and name are required' });
    try {
        await db.execute({
            sql: `INSERT INTO achievements (id, name, description, icon, category, xp_reward, requirement_type, requirement_value, is_hidden)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                id,
                name,
                description || '',
                icon || '',
                category || '',
                xp_reward || 0,
                requirement_type || '',
                requirement_value || 0,
                is_hidden ? 1 : 0,
            ],
        });
        res.status(201).json({ message: 'Achievement created', id });
    } catch (e) {
        if (e.message?.includes('UNIQUE') || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            return res.status(409).json({ error: 'Achievement with this id already exists' });
        }
        console.error('Error creating achievement:', e);
        res.status(500).json({ error: 'Error creating achievement' });
    }
});

// PUT /api/admin/achievements/:id — update achievement (admin only)
router.put('/admin/achievements/:id', auth, adminOnly, async (req, res) => {
    const { id } = req.params;
    const { name, description, icon, category, xp_reward, requirement_type, requirement_value, is_hidden } = req.body;
    try {
        const existing = await db.execute({
            sql: 'SELECT id FROM achievements WHERE id = ?',
            args: [id],
        });
        if (!existing.rows.length) return res.status(404).json({ error: 'Achievement not found' });

        await db.execute({
            sql: `UPDATE achievements
                  SET name = ?, description = ?, icon = ?, category = ?, xp_reward = ?,
                      requirement_type = ?, requirement_value = ?, is_hidden = ?
                  WHERE id = ?`,
            args: [
                name || '',
                description || '',
                icon || '',
                category || '',
                xp_reward || 0,
                requirement_type || '',
                requirement_value || 0,
                is_hidden ? 1 : 0,
                id,
            ],
        });
        res.json({ message: 'Achievement updated', id });
    } catch (e) {
        console.error('Error updating achievement:', e);
        res.status(500).json({ error: 'Error updating achievement' });
    }
});

export default router;
