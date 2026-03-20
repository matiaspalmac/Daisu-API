// services/notifications.js — Automatic notification helper
import { db } from '../../config/database.js';

/**
 * Insert a row into the notifications table and return the created record.
 * Designed to be called fire-and-forget: callers should use
 *   createNotification(...).catch(console.error)
 * so it never blocks the hot path.
 */
export async function createNotification(userId, type, title, body, data = {}) {
  const result = await db.execute({
    sql: `INSERT INTO notifications (user_id, type, title, body, data)
          VALUES (?, ?, ?, ?, ?)`,
    args: [userId, type, title, body, JSON.stringify(data)],
  });

  const id = result.lastInsertRowid;

  return { id, user_id: userId, type, title, body, data, is_read: 0 };
}
