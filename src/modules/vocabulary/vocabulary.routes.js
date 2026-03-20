// routes/vocabulary.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { addVocabularySchema } from './vocabulary.schemas.js';
import { checkAndGrantAchievements } from '../achievements/achievements.service.js';
import { updateStreak } from '../../services/streaks.js';

const router = express.Router();

// GET /api/vocabulary — list current user's vocabulary with filters and pagination
router.get('/vocabulary', auth, async (req, res) => {
    const userId = req.user.id;
    const { language, mastery_level, search } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    try {
        const conditions = ['user_id = ?'];
        const args = [userId];

        if (language) {
            conditions.push('language = ?');
            args.push(language);
        }
        if (mastery_level !== undefined && mastery_level !== '') {
            conditions.push('mastery_level = ?');
            args.push(parseInt(mastery_level));
        }
        if (search) {
            conditions.push('(word LIKE ? OR translation LIKE ?)');
            args.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.join(' AND ');

        const countResult = await db.execute({
            sql: `SELECT COUNT(*) as total FROM user_vocabulary WHERE ${where}`,
            args,
        });
        const total = Number(countResult.rows[0].total);

        const result = await db.execute({
            sql: `SELECT * FROM user_vocabulary WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            args: [...args, limit, offset],
        });

        res.json({ words: result.rows, total, limit, offset });
    } catch (e) {
        console.error('Vocabulary list error:', e);
        res.status(500).json({ error: 'Error fetching vocabulary' });
    }
});

// GET /api/vocabulary/review — get words due for review
router.get('/vocabulary/review', auth, async (req, res) => {
    const userId = req.user.id;
    const now = new Date().toISOString();

    try {
        const result = await db.execute({
            sql: `SELECT * FROM user_vocabulary
                  WHERE user_id = ? AND (next_review_at <= ? OR mastery_level = 0)
                  ORDER BY next_review_at ASC
                  LIMIT 20`,
            args: [userId, now],
        });

        res.json({ words: result.rows });
    } catch (e) {
        console.error('Vocabulary review error:', e);
        res.status(500).json({ error: 'Error fetching review words' });
    }
});

// GET /api/vocabulary/stats — vocabulary statistics for current user
router.get('/vocabulary/stats', auth, async (req, res) => {
    const userId = req.user.id;

    try {
        const [masteryResult, languageResult] = await Promise.all([
            db.execute({
                sql: `SELECT mastery_level, COUNT(*) as count
                      FROM user_vocabulary WHERE user_id = ?
                      GROUP BY mastery_level ORDER BY mastery_level`,
                args: [userId],
            }),
            db.execute({
                sql: `SELECT language, COUNT(*) as count
                      FROM user_vocabulary WHERE user_id = ?
                      GROUP BY language ORDER BY count DESC`,
                args: [userId],
            }),
        ]);

        res.json({
            by_mastery_level: masteryResult.rows,
            by_language: languageResult.rows,
        });
    } catch (e) {
        console.error('Vocabulary stats error:', e);
        res.status(500).json({ error: 'Error fetching vocabulary stats' });
    }
});

// POST /api/vocabulary — add a word (upsert on conflict)
router.post('/vocabulary', auth, validate(addVocabularySchema), async (req, res) => {
    const userId = req.user.id;
    const { word, translation, language, context_sentence, source, notes } = req.body;

    if (!word || !language) {
        return res.status(400).json({ error: 'word and language are required' });
    }

    const validSources = ['manual', 'chat', 'ai_correction', 'resource'];
    const safeSource = validSources.includes(source) ? source : 'manual';

    try {
        const result = await db.execute({
            sql: `INSERT INTO user_vocabulary (user_id, word, translation, language, context_sentence, source, notes, next_review_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id, word, language) DO UPDATE SET
                    translation = excluded.translation,
                    context_sentence = excluded.context_sentence,
                    source = excluded.source,
                    notes = excluded.notes,
                    updated_at = CURRENT_TIMESTAMP`,
            args: [userId, word, translation || '', language, context_sentence || '', safeSource, notes || ''],
        });

        // Increment vocabulary_count only if a new row was inserted
        if (result.rowsAffected > 0) {
            await db.execute({
                sql: `UPDATE user_stats SET vocabulary_count = vocabulary_count + 1
                      WHERE user_id = ? AND NOT EXISTS (
                        SELECT 1 FROM user_vocabulary
                        WHERE user_id = ? AND word = ? AND language = ? AND id != last_insert_rowid()
                      )`,
                args: [userId, userId, word, language],
            });
        }

        const inserted = await db.execute({
            sql: 'SELECT * FROM user_vocabulary WHERE user_id = ? AND word = ? AND language = ?',
            args: [userId, word, language],
        });

        updateStreak(userId).catch(console.error);
        checkAndGrantAchievements(userId).catch(console.error);

        res.status(201).json({ word: inserted.rows[0] });
    } catch (e) {
        console.error('Vocabulary add error:', e);
        res.status(500).json({ error: 'Error adding word' });
    }
});

// PUT /api/vocabulary/:id — update a word (owner only)
router.put('/vocabulary/:id', auth, async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { translation, notes, mastery_level } = req.body;

    try {
        const existing = await db.execute({
            sql: 'SELECT * FROM user_vocabulary WHERE id = ?',
            args: [id],
        });
        if (!existing.rows.length) return res.status(404).json({ error: 'Word not found' });
        if (String(existing.rows[0].user_id) !== String(userId)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const updates = [];
        const args = [];

        if (translation !== undefined) {
            updates.push('translation = ?');
            args.push(translation);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            args.push(notes);
        }
        if (mastery_level !== undefined) {
            const level = Math.min(Math.max(parseInt(mastery_level) || 0, 0), 3);
            updates.push('mastery_level = ?');
            args.push(level);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        args.push(id);

        await db.execute({
            sql: `UPDATE user_vocabulary SET ${updates.join(', ')} WHERE id = ?`,
            args,
        });

        const updated = await db.execute({
            sql: 'SELECT * FROM user_vocabulary WHERE id = ?',
            args: [id],
        });

        res.json({ word: updated.rows[0] });
    } catch (e) {
        console.error('Vocabulary update error:', e);
        res.status(500).json({ error: 'Error updating word' });
    }
});

// DELETE /api/vocabulary/:id — delete a word (owner only)
router.delete('/vocabulary/:id', auth, async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    try {
        const existing = await db.execute({
            sql: 'SELECT * FROM user_vocabulary WHERE id = ?',
            args: [id],
        });
        if (!existing.rows.length) return res.status(404).json({ error: 'Word not found' });
        if (String(existing.rows[0].user_id) !== String(userId)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await db.execute({
            sql: 'DELETE FROM user_vocabulary WHERE id = ?',
            args: [id],
        });

        await db.execute({
            sql: `UPDATE user_stats SET vocabulary_count = MAX(vocabulary_count - 1, 0) WHERE user_id = ?`,
            args: [userId],
        });

        res.json({ message: 'Word deleted' });
    } catch (e) {
        console.error('Vocabulary delete error:', e);
        res.status(500).json({ error: 'Error deleting word' });
    }
});

// POST /api/vocabulary/:id/review — submit review result
router.post('/vocabulary/:id/review', auth, async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { correct } = req.body;

    if (correct === undefined) {
        return res.status(400).json({ error: 'correct (boolean) is required' });
    }

    try {
        const existing = await db.execute({
            sql: 'SELECT * FROM user_vocabulary WHERE id = ?',
            args: [id],
        });
        if (!existing.rows.length) return res.status(404).json({ error: 'Word not found' });
        if (String(existing.rows[0].user_id) !== String(userId)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const word = existing.rows[0];
        const now = Date.now();
        let newMastery;
        let nextReview;

        if (correct) {
            newMastery = Math.min((word.mastery_level || 0) + 1, 3);
            const intervals = { 1: 1, 2: 3, 3: 7 }; // days
            const daysAhead = intervals[newMastery] || 1;
            nextReview = new Date(now + daysAhead * 24 * 60 * 60 * 1000).toISOString();
        } else {
            newMastery = 0;
            nextReview = new Date(now + 60 * 60 * 1000).toISOString(); // 1 hour
        }

        await db.execute({
            sql: `UPDATE user_vocabulary
                  SET mastery_level = ?, next_review_at = ?, review_count = review_count + 1, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
            args: [newMastery, nextReview, id],
        });

        const updated = await db.execute({
            sql: 'SELECT * FROM user_vocabulary WHERE id = ?',
            args: [id],
        });

        res.json({ word: updated.rows[0] });
    } catch (e) {
        console.error('Vocabulary review error:', e);
        res.status(500).json({ error: 'Error submitting review' });
    }
});

export default router;
