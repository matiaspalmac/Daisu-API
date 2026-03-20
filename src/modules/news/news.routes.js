// routes/news.js — News articles CRUD & public listing
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { createNewsSchema } from './news.schemas.js';

const router = express.Router();

/**
 * Generate a URL-safe slug from a title string.
 * Handles Unicode by stripping diacritics and non-alphanumeric characters.
 */
function slugify(title) {
    return title
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ──────────────────────────────────────────
// GET /api/news — public: list published articles
// ──────────────────────────────────────────
router.get('/news', async (req, res) => {
    try {
        const { category, language, limit = 10, offset = 0 } = req.query;

        const conditions = ['n.is_published = 1'];
        const args = [];

        if (category) {
            conditions.push('n.category = ?');
            args.push(category);
        }
        if (language) {
            conditions.push('n.language = ?');
            args.push(language);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;

        const [countRes, result] = await Promise.all([
            db.execute({ sql: `SELECT COUNT(*) AS total FROM news_articles n ${where}`, args }),
            db.execute({
                sql: `SELECT n.id, n.title, n.slug, n.excerpt, n.category, n.cover_image_url,
                             n.language, n.author_id, n.published_at, n.created_at
                      FROM news_articles n ${where}
                      ORDER BY n.published_at DESC
                      LIMIT ? OFFSET ?`,
                args: [...args, Number(limit), Number(offset)],
            }),
        ]);

        res.json({
            articles: result.rows,
            total: countRes.rows[0]?.total || 0,
            limit: Number(limit),
            offset: Number(offset),
        });
    } catch (e) {
        console.error('List news error:', e);
        res.status(500).json({ error: 'Error fetching news articles' });
    }
});

// ──────────────────────────────────────────
// GET /api/news/:slug — public: single article by slug
// ──────────────────────────────────────────
router.get('/news/:slug', async (req, res) => {
    try {
        const { slug } = req.params;

        const result = await db.execute({
            sql: 'SELECT * FROM news_articles WHERE slug = ? AND is_published = 1',
            args: [slug],
        });

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Article not found' });
        }

        res.json({ article: result.rows[0] });
    } catch (e) {
        console.error('Get article error:', e);
        res.status(500).json({ error: 'Error fetching article' });
    }
});

// ──────────────────────────────────────────
// POST /api/news — admin: create article
// ──────────────────────────────────────────
router.post('/news', auth, adminOnly, validate(createNewsSchema), async (req, res) => {
    try {
        const { title, content, excerpt, category, cover_image_url, language, is_published } = req.body;

        if (!title || !content || !category) {
            return res.status(400).json({ error: 'Title, content, and category are required' });
        }

        const validCategories = ['tips', 'events', 'stories', 'updates', 'world'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
        }

        // Generate a unique slug
        let baseSlug = slugify(title);
        let slug = baseSlug;
        let suffix = 0;

        while (true) {
            const existing = await db.execute({ sql: 'SELECT id FROM news_articles WHERE slug = ?', args: [slug] });
            if (!existing.rows.length) break;
            suffix++;
            slug = `${baseSlug}-${suffix}`;
        }

        const publishNow = is_published ? 1 : 0;
        const publishedAt = publishNow ? new Date().toISOString() : null;

        const result = await db.execute({
            sql: `INSERT INTO news_articles (title, slug, content, excerpt, category, cover_image_url, language, author_id, is_published, published_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            args: [
                title,
                slug,
                content,
                excerpt || '',
                category,
                cover_image_url || '',
                language || '',
                req.user.id,
                publishNow,
                publishedAt,
            ],
        });

        res.status(201).json({ id: Number(result.lastInsertRowid), slug, message: 'Article created' });
    } catch (e) {
        console.error('Create article error:', e);
        res.status(500).json({ error: 'Error creating article' });
    }
});

// ──────────────────────────────────────────
// PUT /api/news/:id — admin: update article
// ──────────────────────────────────────────
router.put('/news/:id', auth, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, excerpt, category, cover_image_url, language, is_published } = req.body;

        const existing = await db.execute({ sql: 'SELECT * FROM news_articles WHERE id = ?', args: [id] });
        if (!existing.rows.length) {
            return res.status(404).json({ error: 'Article not found' });
        }

        const article = existing.rows[0];

        if (category) {
            const validCategories = ['tips', 'events', 'stories', 'updates', 'world'];
            if (!validCategories.includes(category)) {
                return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
            }
        }

        const fields = ['updated_at = CURRENT_TIMESTAMP'];
        const args = [];

        if (title !== undefined) { fields.push('title = ?'); args.push(title); }
        if (content !== undefined) { fields.push('content = ?'); args.push(content); }
        if (excerpt !== undefined) { fields.push('excerpt = ?'); args.push(excerpt); }
        if (category !== undefined) { fields.push('category = ?'); args.push(category); }
        if (cover_image_url !== undefined) { fields.push('cover_image_url = ?'); args.push(cover_image_url); }
        if (language !== undefined) { fields.push('language = ?'); args.push(language); }

        if (is_published !== undefined) {
            const publishFlag = is_published ? 1 : 0;
            fields.push('is_published = ?');
            args.push(publishFlag);

            // If publishing for the first time, set published_at
            if (publishFlag === 1 && !article.published_at) {
                fields.push('published_at = ?');
                args.push(new Date().toISOString());
            }
        }

        args.push(id);
        await db.execute({ sql: `UPDATE news_articles SET ${fields.join(', ')} WHERE id = ?`, args });

        res.json({ message: 'Article updated' });
    } catch (e) {
        console.error('Update article error:', e);
        res.status(500).json({ error: 'Error updating article' });
    }
});

// ──────────────────────────────────────────
// DELETE /api/news/:id — admin: delete article
// ──────────────────────────────────────────
router.delete('/news/:id', auth, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await db.execute({ sql: 'SELECT id FROM news_articles WHERE id = ?', args: [id] });
        if (!existing.rows.length) {
            return res.status(404).json({ error: 'Article not found' });
        }

        await db.execute({ sql: 'DELETE FROM news_articles WHERE id = ?', args: [id] });

        res.json({ message: 'Article deleted' });
    } catch (e) {
        console.error('Delete article error:', e);
        res.status(500).json({ error: 'Error deleting article' });
    }
});

export default router;
