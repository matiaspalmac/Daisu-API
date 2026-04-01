import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError, AuthorizationError } from '../../errors/index.js';
import { addXP } from '../achievements/achievements.service.js';

export const CorrectionsService = {
  async create(correctorId, messageId, { corrected_text, explanation }) {
    if (!corrected_text?.trim()) throw new ValidationError('corrected_text is required');
    const msgRes = await db.execute({ sql: 'SELECT id, content, user_id FROM messages WHERE id = ? AND deleted_at IS NULL', args: [messageId] });
    if (!msgRes.rows.length) throw new NotFoundError('Message not found');
    const message = msgRes.rows[0];
    if (String(correctorId) === String(message.user_id)) throw new AuthorizationError('You cannot correct your own message');

    const result = await db.execute({
      sql: 'INSERT INTO peer_corrections (message_id, corrector_id, original_text, corrected_text, explanation) VALUES (?, ?, ?, ?, ?)',
      args: [messageId, correctorId, message.content, corrected_text.trim(), (explanation || '').trim()],
    });
    const correctionId = result.lastInsertRowid.toString();
    await db.execute({ sql: 'INSERT INTO user_stats (user_id, corrections_given) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET corrections_given = corrections_given + 1', args: [correctorId] });
    await db.execute({ sql: 'INSERT INTO user_stats (user_id, corrections_received) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET corrections_received = corrections_received + 1', args: [message.user_id] });

    const correctorRes = await db.execute({ sql: 'SELECT name, image FROM users WHERE id = ?', args: [correctorId] });
    const corrector = correctorRes.rows[0] || {};
    return {
      id: correctionId, message_id: Number(messageId), corrector_id: correctorId,
      corrector_name: corrector.name || '', corrector_image: corrector.image || '',
      original_text: message.content, corrected_text: corrected_text.trim(),
      explanation: (explanation || '').trim(), was_helpful: 0, created_at: new Date().toISOString(),
    };
  },

  async listForMessage(messageId) {
    const result = await db.execute({
      sql: `SELECT pc.*, u.name AS corrector_name, u.image AS corrector_image FROM peer_corrections pc
            JOIN users u ON u.id = pc.corrector_id WHERE pc.message_id = ? ORDER BY pc.created_at ASC`,
      args: [messageId],
    });
    return result.rows.map(r => ({
      id: r.id, message_id: r.message_id, corrector_id: r.corrector_id,
      corrector_name: r.corrector_name || '', corrector_image: r.corrector_image || '',
      original_text: r.original_text, corrected_text: r.corrected_text,
      explanation: r.explanation || '', was_helpful: r.was_helpful, created_at: r.created_at,
    }));
  },

  async toggleHelpful(userId, correctionId) {
    const corrRes = await db.execute({
      sql: 'SELECT pc.*, m.user_id AS author_id FROM peer_corrections pc JOIN messages m ON m.id = pc.message_id WHERE pc.id = ?',
      args: [correctionId],
    });
    if (!corrRes.rows.length) throw new NotFoundError('Correction not found');
    const correction = corrRes.rows[0];
    if (String(userId) !== String(correction.author_id)) throw new AuthorizationError('Only the message author can mark corrections as helpful');

    const newValue = correction.was_helpful ? 0 : 1;
    await db.execute({ sql: 'UPDATE peer_corrections SET was_helpful = ? WHERE id = ?', args: [newValue, correctionId] });
    if (newValue === 1) await addXP(correction.corrector_id, config.limits.helpfulCorrectionXp, 'peer_correction_helpful', String(correctionId));
    return { id: Number(correctionId), was_helpful: newValue };
  },

  async getGiven(userId, offset) {
    const result = await db.execute({
      sql: `SELECT pc.*, m.content AS message_content, m.room_id, r.name AS room_name
            FROM peer_corrections pc JOIN messages m ON m.id = pc.message_id LEFT JOIN rooms r ON r.id = m.room_id
            WHERE pc.corrector_id = ? ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`,
      args: [userId, config.limits.correctionsLimit, Math.max(0, parseInt(offset) || 0)],
    });
    return result.rows.map(r => ({
      id: r.id, message_id: r.message_id, message_content: r.message_content || '', room_id: r.room_id, room_name: r.room_name || '',
      original_text: r.original_text, corrected_text: r.corrected_text, explanation: r.explanation || '', was_helpful: r.was_helpful, created_at: r.created_at,
    }));
  },

  async getReceived(userId, offset) {
    const result = await db.execute({
      sql: `SELECT pc.*, u.name AS corrector_name, u.image AS corrector_image, m.room_id, r.name AS room_name
            FROM peer_corrections pc JOIN messages m ON m.id = pc.message_id JOIN users u ON u.id = pc.corrector_id
            LEFT JOIN rooms r ON r.id = m.room_id WHERE m.user_id = ? ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`,
      args: [userId, config.limits.correctionsLimit, Math.max(0, parseInt(offset) || 0)],
    });
    return result.rows.map(r => ({
      id: r.id, message_id: r.message_id, corrector_id: r.corrector_id,
      corrector_name: r.corrector_name || '', corrector_image: r.corrector_image || '',
      room_id: r.room_id, room_name: r.room_name || '',
      original_text: r.original_text, corrected_text: r.corrected_text, explanation: r.explanation || '', was_helpful: r.was_helpful, created_at: r.created_at,
    }));
  },
};
