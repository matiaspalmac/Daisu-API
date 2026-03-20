// routes/resources.js — Learning resources CRUD & bookmarking
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { createResourceSchema } from './resources.schemas.js';

const router = express.Router();

// ──────────────────────────────────────────
// GET /api/resources/saved — current user's bookmarked resources
// (must be defined before :id to avoid route conflict)
// ──────────────────────────────────────────
router.get('/resources/saved', auth, async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        const result = await db.execute({
            sql: `SELECT r.*, rs.created_at AS saved_at
                  FROM resource_saves rs
                  JOIN resources r ON r.id = rs.resource_id
                  WHERE rs.user_id = ?
                  ORDER BY rs.created_at DESC
                  LIMIT ? OFFSET ?`,
            args: [req.user.id, Number(limit), Number(offset)],
        });
        res.json({ resources: result.rows });
    } catch (e) {
        console.error('Get saved resources error:', e);
        res.status(500).json({ error: 'Error fetching saved resources' });
    }
});

// ──────────────────────────────────────────
// GET /api/resources — list with filters & pagination
// ──────────────────────────────────────────
router.get('/resources', auth, async (req, res) => {
    try {
        const { type, language, level, search, featured_only, limit = 20, offset = 0 } = req.query;

        const conditions = [];
        const args = [];

        if (type) {
            conditions.push('r.type = ?');
            args.push(type);
        }
        if (language) {
            conditions.push('r.language = ?');
            args.push(language);
        }
        if (level) {
            conditions.push('r.level = ?');
            args.push(level);
        }
        if (search) {
            conditions.push('r.title LIKE ?');
            args.push(`%${search}%`);
        }
        if (featured_only === 'true') {
            conditions.push('r.is_featured = 1');
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Fetch the user's membership tier to determine premium access
        const userRes = await db.execute({
            sql: 'SELECT membership_tier FROM users WHERE id = ?',
            args: [req.user.id],
        });
        const tier = userRes.rows[0]?.membership_tier || 'free';

        const countRes = await db.execute({ sql: `SELECT COUNT(*) AS total FROM resources r ${where}`, args });

        const queryArgs = [...args, Number(limit), Number(offset)];
        const result = await db.execute({
            sql: `SELECT r.* FROM resources r ${where} ORDER BY r.is_featured DESC, r.created_at DESC LIMIT ? OFFSET ?`,
            args: queryArgs,
        });

        const resources = result.rows.map((r) => {
            if (tier === 'free' && r.is_premium) {
                return { ...r, locked: true };
            }
            return r;
        });

        res.json({
            resources,
            total: countRes.rows[0]?.total || 0,
            limit: Number(limit),
            offset: Number(offset),
        });
    } catch (e) {
        console.error('List resources error:', e);
        res.status(500).json({ error: 'Error fetching resources' });
    }
});

// ──────────────────────────────────────────
// GET /api/resources/:id — single resource + increment view
// ──────────────────────────────────────────
router.get('/resources/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;

        await db.execute({
            sql: 'UPDATE resources SET view_count = view_count + 1 WHERE id = ?',
            args: [id],
        });

        const result = await db.execute({
            sql: 'SELECT * FROM resources WHERE id = ?',
            args: [id],
        });

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        res.json({ resource: result.rows[0] });
    } catch (e) {
        console.error('Get resource error:', e);
        res.status(500).json({ error: 'Error fetching resource' });
    }
});

// ──────────────────────────────────────────
// POST /api/resources — admin: create resource
// ──────────────────────────────────────────
router.post('/resources', auth, adminOnly, validate(createResourceSchema), async (req, res) => {
    try {
        const { title, description, url, type, language, level, thumbnail_url, author, is_featured, is_premium } = req.body;

        if (!title || !type) {
            return res.status(400).json({ error: 'Title and type are required' });
        }

        const validTypes = ['textbook', 'video', 'article', 'link', 'tool'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
        }

        const result = await db.execute({
            sql: `INSERT INTO resources (title, description, url, type, language, level, thumbnail_url, author, is_featured, is_premium, created_by, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            args: [
                title,
                description || '',
                url || '',
                type,
                language || '',
                level || '',
                thumbnail_url || '',
                author || '',
                is_featured ? 1 : 0,
                is_premium ? 1 : 0,
                req.user.id,
            ],
        });

        res.status(201).json({ id: Number(result.lastInsertRowid), message: 'Resource created' });
    } catch (e) {
        console.error('Create resource error:', e);
        res.status(500).json({ error: 'Error creating resource' });
    }
});

// ──────────────────────────────────────────
// PUT /api/resources/:id — admin: update resource
// ──────────────────────────────────────────
router.put('/resources/:id', auth, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, url, type, language, level, thumbnail_url, author, is_featured, is_premium } = req.body;

        if (type) {
            const validTypes = ['textbook', 'video', 'article', 'link', 'tool'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
            }
        }

        const existing = await db.execute({ sql: 'SELECT id FROM resources WHERE id = ?', args: [id] });
        if (!existing.rows.length) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        const fields = [];
        const args = [];

        if (title !== undefined) { fields.push('title = ?'); args.push(title); }
        if (description !== undefined) { fields.push('description = ?'); args.push(description); }
        if (url !== undefined) { fields.push('url = ?'); args.push(url); }
        if (type !== undefined) { fields.push('type = ?'); args.push(type); }
        if (language !== undefined) { fields.push('language = ?'); args.push(language); }
        if (level !== undefined) { fields.push('level = ?'); args.push(level); }
        if (thumbnail_url !== undefined) { fields.push('thumbnail_url = ?'); args.push(thumbnail_url); }
        if (author !== undefined) { fields.push('author = ?'); args.push(author); }
        if (is_featured !== undefined) { fields.push('is_featured = ?'); args.push(is_featured ? 1 : 0); }
        if (is_premium !== undefined) { fields.push('is_premium = ?'); args.push(is_premium ? 1 : 0); }

        if (!fields.length) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        args.push(id);
        await db.execute({ sql: `UPDATE resources SET ${fields.join(', ')} WHERE id = ?`, args });

        res.json({ message: 'Resource updated' });
    } catch (e) {
        console.error('Update resource error:', e);
        res.status(500).json({ error: 'Error updating resource' });
    }
});

// ──────────────────────────────────────────
// DELETE /api/resources/:id — admin: delete resource
// ──────────────────────────────────────────
router.delete('/resources/:id', auth, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await db.execute({ sql: 'SELECT id FROM resources WHERE id = ?', args: [id] });
        if (!existing.rows.length) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        await db.execute({ sql: 'DELETE FROM resource_saves WHERE resource_id = ?', args: [id] });
        await db.execute({ sql: 'DELETE FROM resources WHERE id = ?', args: [id] });

        res.json({ message: 'Resource deleted' });
    } catch (e) {
        console.error('Delete resource error:', e);
        res.status(500).json({ error: 'Error deleting resource' });
    }
});

// ──────────────────────────────────────────
// POST /api/resources/:id/save — bookmark resource
// ──────────────────────────────────────────
router.post('/resources/:id/save', auth, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await db.execute({ sql: 'SELECT id FROM resources WHERE id = ?', args: [id] });
        if (!existing.rows.length) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        await db.execute({
            sql: 'INSERT OR IGNORE INTO resource_saves (user_id, resource_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            args: [req.user.id, id],
        });

        res.json({ message: 'Resource saved' });
    } catch (e) {
        console.error('Save resource error:', e);
        res.status(500).json({ error: 'Error saving resource' });
    }
});

// ──────────────────────────────────────────
// DELETE /api/resources/:id/save — remove bookmark
// ──────────────────────────────────────────
router.delete('/resources/:id/save', auth, async (req, res) => {
    try {
        const { id } = req.params;

        await db.execute({
            sql: 'DELETE FROM resource_saves WHERE user_id = ? AND resource_id = ?',
            args: [req.user.id, id],
        });

        res.json({ message: 'Resource bookmark removed' });
    } catch (e) {
        console.error('Remove bookmark error:', e);
        res.status(500).json({ error: 'Error removing bookmark' });
    }
});

export default router;
