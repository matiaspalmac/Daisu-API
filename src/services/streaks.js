import { db } from '../config/database.js';

/**
 * Update a user's streak. Call this when user sends a message or performs any activity.
 * Logic:
 * - Get last_streak_date from user_stats
 * - Get today's date as YYYY-MM-DD (UTC)
 * - If last_streak_date === today -> do nothing (already counted today)
 * - If last_streak_date === yesterday -> increment streak by 1
 * - Otherwise -> reset streak to 1 (new streak starting today)
 * - Update longest_streak if current streak > longest_streak
 * - Update last_streak_date to today
 * - Also sync users.streak
 */
export async function updateStreak(userId) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD in UTC

  // Calculate yesterday's date in UTC
  const yesterdayDate = new Date(now);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

  // Ensure user_stats row exists
  await db.execute({
    sql: `INSERT INTO user_stats (user_id, streak, longest_streak, last_streak_date)
          VALUES (?, 0, 0, '')
          ON CONFLICT(user_id) DO NOTHING`,
    args: [userId],
  });

  // Get current streak info
  const result = await db.execute({
    sql: 'SELECT streak, longest_streak, last_streak_date FROM user_stats WHERE user_id = ?',
    args: [userId],
  });

  if (result.rows.length === 0) return;

  const { streak, longest_streak, last_streak_date } = result.rows[0];

  // If already counted today, do nothing
  if (last_streak_date === today) return;

  let newStreak;
  if (last_streak_date === yesterday) {
    // Consecutive day — increment streak
    newStreak = (streak || 0) + 1;
  } else {
    // Streak broken or first activity — reset to 1
    newStreak = 1;
  }

  const newLongest = Math.max(newStreak, longest_streak || 0);

  // Update user_stats
  await db.execute({
    sql: `UPDATE user_stats SET streak = ?, longest_streak = ?, last_streak_date = ? WHERE user_id = ?`,
    args: [newStreak, newLongest, today, userId],
  });

  // Sync users.streak
  await db.execute({
    sql: 'UPDATE users SET streak = ? WHERE id = ?',
    args: [newStreak, userId],
  });
}
