import { db } from '../../config/database.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';

const VALID_TYPES = ['textbook', 'video', 'article', 'link', 'tool'];

export const ResourcesService = {
  async listSaved(userId, { limit = 20, offset = 0 }) {
    const result = await db.execute({
      sql: `SELECT r.*, rs.created_at AS saved_at FROM resource_saves rs JOIN resources r ON r.id = rs.resource_id
            WHERE rs.user_id = ? ORDER BY rs.created_at DESC LIMIT ? OFFSET ?`,
      args: [userId, Number(limit), Number(offset)],
    });
    return { resources: result.rows };
  },

  async list(userId, query) {
    const { type, language, level, search, featured_only, limit = 20, offset = 0 } = query;
    const conditions = [];
    const args = [];
    if (type) { conditions.push('r.type = ?'); args.push(type); }
    if (language) { conditions.push('r.language = ?'); args.push(language); }
    if (level) { conditions.push('r.level = ?'); args.push(level); }
    if (search) { conditions.push('r.title LIKE ?'); args.push(`%${search}%`); }
    if (featured_only === 'true') { conditions.push('r.is_featured = 1'); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const userRes = await db.execute({ sql: 'SELECT membership_tier FROM users WHERE id = ?', args: [userId] });
    const tier = userRes.rows[0]?.membership_tier || 'free';
    const countRes = await db.execute({ sql: `SELECT COUNT(*) AS total FROM resources r ${where}`, args });
    const result = await db.execute({
      sql: `SELECT r.* FROM resources r ${where} ORDER BY r.is_featured DESC, r.created_at DESC LIMIT ? OFFSET ?`,
      args: [...args, Number(limit), Number(offset)],
    });
    const resources = result.rows.map(r => tier === 'free' && r.is_premium ? { ...r, locked: true } : r);
    return { resources, total: countRes.rows[0]?.total || 0, limit: Number(limit), offset: Number(offset) };
  },

  async getById(id) {
    await db.execute({ sql: 'UPDATE resources SET view_count = view_count + 1 WHERE id = ?', args: [id] });
    const result = await db.execute({ sql: 'SELECT * FROM resources WHERE id = ?', args: [id] });
    if (!result.rows.length) throw new NotFoundError('Resource not found');
    return { resource: result.rows[0] };
  },

  async create(userId, data) {
    const { title, description, url, type, language, level, thumbnail_url, author, is_featured, is_premium } = data;
    if (!VALID_TYPES.includes(type)) throw new ValidationError(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    const result = await db.execute({
      sql: `INSERT INTO resources (title, description, url, type, language, level, thumbnail_url, author, is_featured, is_premium, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [title, description || '', url || '', type, language || '', level || '', thumbnail_url || '', author || '', is_featured ? 1 : 0, is_premium ? 1 : 0, userId],
    });
    return { id: Number(result.lastInsertRowid), message: 'Resource created' };
  },

  async update(id, data) {
    const existing = await db.execute({ sql: 'SELECT id FROM resources WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Resource not found');
    if (data.type && !VALID_TYPES.includes(data.type)) throw new ValidationError(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    const { title, description, url, type, language, level, thumbnail_url, author, is_featured, is_premium } = data;
    const fields = []; const args = [];
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
    if (!fields.length) throw new ValidationError('No fields to update');
    args.push(id);
    await db.execute({ sql: `UPDATE resources SET ${fields.join(', ')} WHERE id = ?`, args });
    return { message: 'Resource updated' };
  },

  async remove(id) {
    const existing = await db.execute({ sql: 'SELECT id FROM resources WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Resource not found');
    await db.execute({ sql: 'DELETE FROM resource_saves WHERE resource_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM resources WHERE id = ?', args: [id] });
    return { message: 'Resource deleted' };
  },

  async save(userId, id) {
    const existing = await db.execute({ sql: 'SELECT id FROM resources WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Resource not found');
    await db.execute({ sql: 'INSERT OR IGNORE INTO resource_saves (user_id, resource_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)', args: [userId, id] });
    return { message: 'Resource saved' };
  },

  async unsave(userId, id) {
    await db.execute({ sql: 'DELETE FROM resource_saves WHERE user_id = ? AND resource_id = ?', args: [userId, id] });
    return { message: 'Resource bookmark removed' };
  },
};
