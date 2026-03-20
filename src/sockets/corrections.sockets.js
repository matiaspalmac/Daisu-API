// src/sockets/corrections.sockets.js — Peer correction socket event handlers
import { db } from '../config/database.js';
import { emitToUser } from './helpers.js';

export function registerCorrectionEvents(io, socket, { userId, username }) {
  // ────────────────────────────────────────────
  // PEER CORRECT
  // ────────────────────────────────────────────
  socket.on('peer-correct', async ({ messageId, correctedText, explanation, roomId: correctRoomId }) => {
    try {
      if (!userId || !messageId || !correctedText?.trim()) return;

      // Fetch the message
      const msgRes = await db.execute({
        sql: 'SELECT id, content, user_id FROM messages WHERE id = ? AND deleted_at IS NULL',
        args: [messageId],
      });
      if (!msgRes.rows.length) return;

      const message = msgRes.rows[0];
      const authorId = message.user_id;

      // Cannot correct own message
      if (String(userId) === String(authorId)) {
        socket.emit('error', 'You cannot correct your own message');
        return;
      }

      // Insert correction
      const result = await db.execute({
        sql: `INSERT INTO peer_corrections (message_id, corrector_id, original_text, corrected_text, explanation)
              VALUES (?, ?, ?, ?, ?)`,
        args: [messageId, userId, message.content, correctedText.trim(), (explanation || '').trim()],
      });

      const correctionId = result.lastInsertRowid.toString();

      // Broadcast to room
      io.to(`room_${correctRoomId}`).emit('peer-correction', {
        messageId,
        correctorId: userId,
        correctorName: username,
        correctedText: correctedText.trim(),
        explanation: (explanation || '').trim(),
        correctionId,
      });

      // Also emit directly to the message author if they're online
      emitToUser(io, authorId, 'peer-correction', {
        messageId,
        correctorId: userId,
        correctorName: username,
        correctedText: correctedText.trim(),
        explanation: (explanation || '').trim(),
        correctionId,
      });
    } catch (e) {
      console.error('Peer correct error:', e);
    }
  });
}
