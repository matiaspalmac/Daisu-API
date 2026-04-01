import { db } from '../../config/database.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';

const VALID_CATEGORIES = ['tips', 'events', 'stories', 'updates', 'world'];

function slugify(title) {
  return title.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const NewsService = {
  async list(query) {
    const { category, language, limit = 10, offset = 0 } = query;
    const conditions = ['n.is_published = 1']; const args = [];
    if (category) { conditions.push('n.category = ?'); args.push(category); }
    if (language) { conditions.push('n.language = ?'); args.push(language); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [countRes, result] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) AS total FROM news_articles n ${where}`, args }),
      db.execute({
        sql: `SELECT n.id, n.title, n.slug, n.excerpt, n.category, n.cover_image_url, n.language, n.author_id, n.published_at, n.created_at
              FROM news_articles n ${where} ORDER BY n.published_at DESC LIMIT ? OFFSET ?`,
        args: [...args, Number(limit), Number(offset)],
      }),
    ]);
    return { articles: result.rows, total: countRes.rows[0]?.total || 0, limit: Number(limit), offset: Number(offset) };
  },

  async getBySlug(slug) {
    const result = await db.execute({ sql: 'SELECT * FROM news_articles WHERE slug = ? AND is_published = 1', args: [slug] });
    if (!result.rows.length) throw new NotFoundError('Article not found');
    return { article: result.rows[0] };
  },

  async create(userId, data) {
    const { title, content, excerpt, category, cover_image_url, language, is_published } = data;
    if (!VALID_CATEGORIES.includes(category)) throw new ValidationError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    let baseSlug = slugify(title); let slug = baseSlug; let suffix = 0;
    while (true) {
      const existing = await db.execute({ sql: 'SELECT id FROM news_articles WHERE slug = ?', args: [slug] });
      if (!existing.rows.length) break;
      suffix++; slug = `${baseSlug}-${suffix}`;
    }
    const publishNow = is_published ? 1 : 0;
    const publishedAt = publishNow ? new Date().toISOString() : null;
    const result = await db.execute({
      sql: `INSERT INTO news_articles (title, slug, content, excerpt, category, cover_image_url, language, author_id, is_published, published_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      args: [title, slug, content, excerpt || '', category, cover_image_url || '', language || '', userId, publishNow, publishedAt],
    });
    return { id: Number(result.lastInsertRowid), slug, message: 'Article created' };
  },

  async update(id, data) {
    const existing = await db.execute({ sql: 'SELECT * FROM news_articles WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Article not found');
    const article = existing.rows[0];
    const { title, content, excerpt, category, cover_image_url, language, is_published } = data;
    if (category && !VALID_CATEGORIES.includes(category)) throw new ValidationError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    const fields = ['updated_at = CURRENT_TIMESTAMP']; const args = [];
    if (title !== undefined) { fields.push('title = ?'); args.push(title); }
    if (content !== undefined) { fields.push('content = ?'); args.push(content); }
    if (excerpt !== undefined) { fields.push('excerpt = ?'); args.push(excerpt); }
    if (category !== undefined) { fields.push('category = ?'); args.push(category); }
    if (cover_image_url !== undefined) { fields.push('cover_image_url = ?'); args.push(cover_image_url); }
    if (language !== undefined) { fields.push('language = ?'); args.push(language); }
    if (is_published !== undefined) {
      const publishFlag = is_published ? 1 : 0;
      fields.push('is_published = ?'); args.push(publishFlag);
      if (publishFlag === 1 && !article.published_at) { fields.push('published_at = ?'); args.push(new Date().toISOString()); }
    }
    args.push(id);
    await db.execute({ sql: `UPDATE news_articles SET ${fields.join(', ')} WHERE id = ?`, args });
    return { message: 'Article updated' };
  },

  async remove(id) {
    const existing = await db.execute({ sql: 'SELECT id FROM news_articles WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Article not found');
    await db.execute({ sql: 'DELETE FROM news_articles WHERE id = ?', args: [id] });
    return { message: 'Article deleted' };
  },
};
