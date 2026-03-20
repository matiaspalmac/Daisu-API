import { db } from '../config/database.js';

/**
 * Remove expired non-permanent room bans.
 * Should be called periodically.
 */
export async function cleanupExpiredBans() {
  try {
    const result = await db.execute(
      "DELETE FROM room_bans WHERE is_permanent = 0 AND expires_at IS NOT NULL AND expires_at < datetime('now')"
    );
    if (result.rowsAffected > 0) {
      console.log(`[cleanup] Removed ${result.rowsAffected} expired room bans`);
    }
  } catch (e) {
    console.error('[cleanup] Error cleaning expired bans:', e);
  }
}

/**
 * Clean up old notifications (older than 90 days).
 */
export async function cleanupOldNotifications() {
  try {
    const result = await db.execute(
      "DELETE FROM notifications WHERE created_at < datetime('now', '-90 days')"
    );
    if (result.rowsAffected > 0) {
      console.log(`[cleanup] Removed ${result.rowsAffected} old notifications`);
    }
  } catch (e) {
    console.error('[cleanup] Error cleaning notifications:', e);
  }
}

/**
 * Run all cleanup tasks.
 */
export async function runCleanup() {
  await cleanupExpiredBans();
  await cleanupOldNotifications();
}
