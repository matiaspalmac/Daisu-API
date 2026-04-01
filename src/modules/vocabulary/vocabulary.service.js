import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError, AuthorizationError } from '../../errors/index.js';
import { checkAndGrantAchievements } from '../achievements/achievements.service.js';
import { updateStreak } from '../../services/streaks.js';

export const VocabularyService = {
  async list(userId, query) {
    const { language, mastery_level, search } = query;
    const limit = Math.min(Math.max(parseInt(query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset) || 0, 0);

    const conditions = ['user_id = ?'];
    const args = [userId];
    if (language) { conditions.push('language = ?'); args.push(language); }
    if (mastery_level !== undefined && mastery_level !== '') { conditions.push('mastery_level = ?'); args.push(parseInt(mastery_level)); }
    if (search) { conditions.push('(word LIKE ? OR translation LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }

    const where = conditions.join(' AND ');
    const countResult = await db.execute({ sql: `SELECT COUNT(*) as total FROM user_vocabulary WHERE ${where}`, args });
    const total = Number(countResult.rows[0].total);
    const result = await db.execute({ sql: `SELECT * FROM user_vocabulary WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, args: [...args, limit, offset] });
    return { words: result.rows, total, limit, offset };
  },

  async getReviewWords(userId) {
    const now = new Date().toISOString();
    const result = await db.execute({
      sql: `SELECT * FROM user_vocabulary WHERE user_id = ? AND (next_review_at <= ? OR mastery_level = 0) ORDER BY next_review_at ASC LIMIT ?`,
      args: [userId, now, config.limits.reviewWordsLimit],
    });
    return { words: result.rows };
  },

  async getStats(userId) {
    const [masteryResult, languageResult] = await Promise.all([
      db.execute({ sql: 'SELECT mastery_level, COUNT(*) as count FROM user_vocabulary WHERE user_id = ? GROUP BY mastery_level ORDER BY mastery_level', args: [userId] }),
      db.execute({ sql: 'SELECT language, COUNT(*) as count FROM user_vocabulary WHERE user_id = ? GROUP BY language ORDER BY count DESC', args: [userId] }),
    ]);
    return { by_mastery_level: masteryResult.rows, by_language: languageResult.rows };
  },

  async addWord(userId, data) {
    const { word, translation, language, context_sentence, source, notes } = data;
    const validSources = ['manual', 'chat', 'ai_correction', 'resource'];
    const safeSource = validSources.includes(source) ? source : 'manual';

    const result = await db.execute({
      sql: `INSERT INTO user_vocabulary (user_id, word, translation, language, context_sentence, source, notes, next_review_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, word, language) DO UPDATE SET
              translation = excluded.translation, context_sentence = excluded.context_sentence,
              source = excluded.source, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
      args: [userId, word, translation || '', language, context_sentence || '', safeSource, notes || ''],
    });

    if (result.rowsAffected > 0) {
      await db.execute({
        sql: `UPDATE user_stats SET vocabulary_count = vocabulary_count + 1
              WHERE user_id = ? AND NOT EXISTS (
                SELECT 1 FROM user_vocabulary WHERE user_id = ? AND word = ? AND language = ? AND id != last_insert_rowid()
              )`,
        args: [userId, userId, word, language],
      });
    }

    const inserted = await db.execute({ sql: 'SELECT * FROM user_vocabulary WHERE user_id = ? AND word = ? AND language = ?', args: [userId, word, language] });
    updateStreak(userId).catch(console.error);
    checkAndGrantAchievements(userId).catch(console.error);
    return { word: inserted.rows[0] };
  },

  async updateWord(userId, id, data) {
    const { translation, notes, mastery_level } = data;
    const existing = await db.execute({ sql: 'SELECT * FROM user_vocabulary WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Word not found');
    if (String(existing.rows[0].user_id) !== String(userId)) throw new AuthorizationError('Access denied');

    const updates = [];
    const args = [];
    if (translation !== undefined) { updates.push('translation = ?'); args.push(translation); }
    if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }
    if (mastery_level !== undefined) { updates.push('mastery_level = ?'); args.push(Math.min(Math.max(parseInt(mastery_level) || 0, 0), 3)); }
    if (updates.length === 0) throw new ValidationError('No fields to update');

    updates.push('updated_at = CURRENT_TIMESTAMP');
    args.push(id);
    await db.execute({ sql: `UPDATE user_vocabulary SET ${updates.join(', ')} WHERE id = ?`, args });
    const updated = await db.execute({ sql: 'SELECT * FROM user_vocabulary WHERE id = ?', args: [id] });
    return { word: updated.rows[0] };
  },

  async deleteWord(userId, id) {
    const existing = await db.execute({ sql: 'SELECT * FROM user_vocabulary WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Word not found');
    if (String(existing.rows[0].user_id) !== String(userId)) throw new AuthorizationError('Access denied');

    await db.execute({ sql: 'DELETE FROM user_vocabulary WHERE id = ?', args: [id] });
    await db.execute({ sql: 'UPDATE user_stats SET vocabulary_count = MAX(vocabulary_count - 1, 0) WHERE user_id = ?', args: [userId] });
    return { message: 'Word deleted' };
  },

  async reviewWord(userId, id, correct) {
    if (correct === undefined) throw new ValidationError('correct (boolean) is required');

    const existing = await db.execute({ sql: 'SELECT * FROM user_vocabulary WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Word not found');
    if (String(existing.rows[0].user_id) !== String(userId)) throw new AuthorizationError('Access denied');

    const word = existing.rows[0];
    const now = Date.now();
    let newMastery, nextReview;

    if (correct) {
      newMastery = Math.min((word.mastery_level || 0) + 1, 3);
      const intervals = { 1: 1, 2: 3, 3: 7 };
      const daysAhead = intervals[newMastery] || 1;
      nextReview = new Date(now + daysAhead * 24 * 60 * 60 * 1000).toISOString();
    } else {
      newMastery = 0;
      nextReview = new Date(now + 60 * 60 * 1000).toISOString();
    }

    await db.execute({
      sql: 'UPDATE user_vocabulary SET mastery_level = ?, next_review_at = ?, review_count = review_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [newMastery, nextReview, id],
    });
    const updated = await db.execute({ sql: 'SELECT * FROM user_vocabulary WHERE id = ?', args: [id] });
    return { word: updated.rows[0] };
  },
};
