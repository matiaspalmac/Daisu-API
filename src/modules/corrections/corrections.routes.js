// routes/corrections.js — Peer Corrections
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';
import { addXP } from '../achievements/achievements.service.js';

const router = express.Router();

// ────────────────────────────────────────────
// POST /messages/:messageId/correct — Create a peer correction
// ────────────────────────────────────────────
router.post('/messages/:messageId/correct', auth, async (req, res) => {
  try {
    const correctorId = req.user.id;
    const { messageId } = req.params;
    const { corrected_text, explanation } = req.body;

    if (!corrected_text?.trim()) {
      return res.status(400).json({ error: 'corrected_text is required' });
    }

    // Verify message exists
    const msgRes = await db.execute({
      sql: 'SELECT id, content, user_id FROM messages WHERE id = ? AND deleted_at IS NULL',
      args: [messageId],
    });
    if (!msgRes.rows.length) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = msgRes.rows[0];
    const authorId = message.user_id;

    // Cannot correct own message
    if (String(correctorId) === String(authorId)) {
      return res.status(403).json({ error: 'You cannot correct your own message' });
    }

    // Insert correction
    const result = await db.execute({
      sql: `INSERT INTO peer_corrections (message_id, corrector_id, original_text, corrected_text, explanation)
            VALUES (?, ?, ?, ?, ?)`,
      args: [messageId, correctorId, message.content, corrected_text.trim(), (explanation || '').trim()],
    });

    const correctionId = result.lastInsertRowid.toString();

    // Upsert user_stats for corrector (corrections_given)
    await db.execute({
      sql: `INSERT INTO user_stats (user_id, corrections_given) VALUES (?, 1)
            ON CONFLICT(user_id) DO UPDATE SET corrections_given = corrections_given + 1`,
      args: [correctorId],
    });

    // Upsert user_stats for author (corrections_received)
    await db.execute({
      sql: `INSERT INTO user_stats (user_id, corrections_received) VALUES (?, 1)
            ON CONFLICT(user_id) DO UPDATE SET corrections_received = corrections_received + 1`,
      args: [authorId],
    });

    // Fetch corrector info for the response
    const correctorRes = await db.execute({
      sql: 'SELECT name, image FROM users WHERE id = ?',
      args: [correctorId],
    });
    const corrector = correctorRes.rows[0] || {};

    res.status(201).json({
      id: correctionId,
      message_id: Number(messageId),
      corrector_id: correctorId,
      corrector_name: corrector.name || '',
      corrector_image: corrector.image || '',
      original_text: message.content,
      corrected_text: corrected_text.trim(),
      explanation: (explanation || '').trim(),
      was_helpful: 0,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Create peer correction error:', e);
    res.status(500).json({ error: 'Failed to create correction' });
  }
});

// ────────────────────────────────────────────
// GET /messages/:messageId/corrections — List corrections for a message
// ────────────────────────────────────────────
router.get('/messages/:messageId/corrections', auth, async (req, res) => {
  try {
    const { messageId } = req.params;

    const result = await db.execute({
      sql: `SELECT pc.*, u.name AS corrector_name, u.image AS corrector_image
            FROM peer_corrections pc
            JOIN users u ON u.id = pc.corrector_id
            WHERE pc.message_id = ?
            ORDER BY pc.created_at ASC`,
      args: [messageId],
    });

    res.json(result.rows.map(r => ({
      id: r.id,
      message_id: r.message_id,
      corrector_id: r.corrector_id,
      corrector_name: r.corrector_name || '',
      corrector_image: r.corrector_image || '',
      original_text: r.original_text,
      corrected_text: r.corrected_text,
      explanation: r.explanation || '',
      was_helpful: r.was_helpful,
      created_at: r.created_at,
    })));
  } catch (e) {
    console.error('Get corrections error:', e);
    res.status(500).json({ error: 'Failed to get corrections' });
  }
});

// ────────────────────────────────────────────
// POST /corrections/:id/helpful — Toggle was_helpful
// ────────────────────────────────────────────
router.post('/corrections/:id/helpful', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Get the correction
    const corrRes = await db.execute({
      sql: 'SELECT pc.*, m.user_id AS author_id FROM peer_corrections pc JOIN messages m ON m.id = pc.message_id WHERE pc.id = ?',
      args: [id],
    });
    if (!corrRes.rows.length) {
      return res.status(404).json({ error: 'Correction not found' });
    }

    const correction = corrRes.rows[0];

    // Only the original message author can mark as helpful
    if (String(userId) !== String(correction.author_id)) {
      return res.status(403).json({ error: 'Only the message author can mark corrections as helpful' });
    }

    const newValue = correction.was_helpful ? 0 : 1;

    await db.execute({
      sql: 'UPDATE peer_corrections SET was_helpful = ? WHERE id = ?',
      args: [newValue, id],
    });

    // If marking helpful, add 5 XP to the corrector
    if (newValue === 1) {
      await addXP(correction.corrector_id, 5, 'peer_correction_helpful', String(id));
    }

    res.json({ id: Number(id), was_helpful: newValue });
  } catch (e) {
    console.error('Toggle helpful error:', e);
    res.status(500).json({ error: 'Failed to toggle helpful' });
  }
});

// ────────────────────────────────────────────
// GET /users/:id/corrections-given — Corrections given by a user
// ────────────────────────────────────────────
router.get('/users/:id/corrections-given', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    const result = await db.execute({
      sql: `SELECT pc.*, m.content AS message_content, m.room_id, r.name AS room_name
            FROM peer_corrections pc
            JOIN messages m ON m.id = pc.message_id
            LEFT JOIN rooms r ON r.id = m.room_id
            WHERE pc.corrector_id = ?
            ORDER BY pc.created_at DESC
            LIMIT 30 OFFSET ?`,
      args: [id, offset],
    });

    res.json(result.rows.map(r => ({
      id: r.id,
      message_id: r.message_id,
      message_content: r.message_content || '',
      room_id: r.room_id,
      room_name: r.room_name || '',
      original_text: r.original_text,
      corrected_text: r.corrected_text,
      explanation: r.explanation || '',
      was_helpful: r.was_helpful,
      created_at: r.created_at,
    })));
  } catch (e) {
    console.error('Get corrections given error:', e);
    res.status(500).json({ error: 'Failed to get corrections given' });
  }
});

// ────────────────────────────────────────────
// GET /users/:id/corrections-received — Corrections received by a user
// ────────────────────────────────────────────
router.get('/users/:id/corrections-received', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    const result = await db.execute({
      sql: `SELECT pc.*, u.name AS corrector_name, u.image AS corrector_image,
                   m.room_id, r.name AS room_name
            FROM peer_corrections pc
            JOIN messages m ON m.id = pc.message_id
            JOIN users u ON u.id = pc.corrector_id
            LEFT JOIN rooms r ON r.id = m.room_id
            WHERE m.user_id = ?
            ORDER BY pc.created_at DESC
            LIMIT 30 OFFSET ?`,
      args: [id, offset],
    });

    res.json(result.rows.map(r => ({
      id: r.id,
      message_id: r.message_id,
      corrector_id: r.corrector_id,
      corrector_name: r.corrector_name || '',
      corrector_image: r.corrector_image || '',
      room_id: r.room_id,
      room_name: r.room_name || '',
      original_text: r.original_text,
      corrected_text: r.corrected_text,
      explanation: r.explanation || '',
      was_helpful: r.was_helpful,
      created_at: r.created_at,
    })));
  } catch (e) {
    console.error('Get corrections received error:', e);
    res.status(500).json({ error: 'Failed to get corrections received' });
  }
});

export default router;
