// src/modules/achievements/achievements.routes.js
import express from 'express';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { auth, adminOnly } from '../../middleware/auth.js';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/index.js';

const router = express.Router();

router.get('/achievements', auth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.isAdmin;
    const result = await db.execute({
      sql: `SELECT a.id, a.name, a.description, a.icon, a.category, a.xp_reward,
                   a.requirement_type, a.requirement_value, a.is_hidden, ua.earned_at
            FROM achievements a LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
            ${isAdmin ? '' : 'WHERE a.is_hidden = 0 OR ua.earned_at IS NOT NULL'} ORDER BY a.category, a.name`,
      args: [userId],
    });
    res.json({ achievements: result.rows.map(row => ({ ...row, is_hidden: Boolean(row.is_hidden), earned: row.earned_at !== null, earned_at: row.earned_at || null })) });
  } catch (err) { next(err); }
});

router.get('/users/:id/achievements', auth, async (req, res, next) => {
  try {
    const result = await db.execute({
      sql: `SELECT a.id, a.name, a.description, a.icon, a.category, a.xp_reward, ua.earned_at
            FROM user_achievements ua JOIN achievements a ON ua.achievement_id = a.id WHERE ua.user_id = ? ORDER BY ua.earned_at DESC`,
      args: [req.params.id],
    });
    res.json({ achievements: result.rows });
  } catch (err) { next(err); }
});

router.get('/users/:id/xp', auth, async (req, res, next) => {
  try {
    const userResult = await db.execute({ sql: 'SELECT xp FROM users WHERE id = ?', args: [req.params.id] });
    if (!userResult.rows.length) throw new NotFoundError('User not found');
    const xp = Number(userResult.rows[0].xp) || 0;
    const logResult = await db.execute({
      sql: 'SELECT id, amount, reason, reference_id, created_at FROM xp_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [req.params.id, config.limits.leaderboardLimit],
    });
    res.json({ xp, level: Math.floor(xp / 100) + 1, log: logResult.rows });
  } catch (err) { next(err); }
});

router.get('/leaderboard', auth, async (req, res, next) => {
  try {
    const result = await db.execute({
      sql: `SELECT id, name, image, xp FROM users WHERE banned_at IS NULL ORDER BY xp DESC LIMIT ?`, args: [config.limits.leaderboardLimit],
    });
    res.json({ leaderboard: result.rows.map(row => ({ ...row, xp: Number(row.xp) || 0, level: Math.floor((Number(row.xp) || 0) / 100) + 1 })) });
  } catch (err) { next(err); }
});

router.post('/admin/achievements', auth, adminOnly, async (req, res, next) => {
  try {
    const { id, name, description, icon, category, xp_reward, requirement_type, requirement_value, is_hidden } = req.body;
    if (!id || !name) throw new ValidationError('Achievement id and name are required');
    try {
      await db.execute({
        sql: 'INSERT INTO achievements (id, name, description, icon, category, xp_reward, requirement_type, requirement_value, is_hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [id, name, description || '', icon || '', category || '', xp_reward || 0, requirement_type || '', requirement_value || 0, is_hidden ? 1 : 0],
      });
    } catch (e) {
      if (e.message?.includes('UNIQUE') || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new ConflictError('Achievement with this id already exists');
      throw e;
    }
    res.status(201).json({ message: 'Achievement created', id });
  } catch (err) { next(err); }
});

router.put('/admin/achievements/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await db.execute({ sql: 'SELECT id FROM achievements WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Achievement not found');
    const { name, description, icon, category, xp_reward, requirement_type, requirement_value, is_hidden } = req.body;
    await db.execute({
      sql: 'UPDATE achievements SET name = ?, description = ?, icon = ?, category = ?, xp_reward = ?, requirement_type = ?, requirement_value = ?, is_hidden = ? WHERE id = ?',
      args: [name || '', description || '', icon || '', category || '', xp_reward || 0, requirement_type || '', requirement_value || 0, is_hidden ? 1 : 0, id],
    });
    res.json({ message: 'Achievement updated', id });
  } catch (err) { next(err); }
});

export default router;
