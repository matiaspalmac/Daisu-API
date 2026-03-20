// services/achievements.js — Achievement checking and granting engine
import { db } from '../../config/database.js';

/**
 * Check all achievements for a user and grant any newly earned ones.
 * Call this after any stat-changing action.
 * Returns array of newly earned achievements (for notification/UI).
 */
export async function checkAndGrantAchievements(userId) {
  const newlyEarned = [];

  // 1. Fetch user_stats
  const statsRes = await db.execute({
    sql: 'SELECT * FROM user_stats WHERE user_id = ?',
    args: [userId],
  });
  const stats = statsRes.rows[0] || {};

  // 2. Fetch all achievements
  const achievementsRes = await db.execute('SELECT * FROM achievements');
  const allAchievements = achievementsRes.rows;

  // 3. Fetch already earned achievements for this user
  const earnedRes = await db.execute({
    sql: 'SELECT achievement_id FROM user_achievements WHERE user_id = ?',
    args: [userId],
  });
  const earnedIds = new Set(earnedRes.rows.map(r => String(r.achievement_id)));

  // 4. Check each unearned achievement
  for (const achievement of allAchievements) {
    if (earnedIds.has(String(achievement.id))) continue;

    const reqType = achievement.requirement_type;
    const reqValue = Number(achievement.requirement_value);
    let qualified = false;

    switch (reqType) {
      case 'messages_sent':
        qualified = Number(stats.messages_sent || 0) >= reqValue;
        break;
      case 'streak_days':
        qualified = Number(stats.streak || 0) >= reqValue;
        break;
      case 'vocabulary_count':
        qualified = Number(stats.vocabulary_count || 0) >= reqValue;
        break;
      case 'corrections_received':
        qualified = Number(stats.corrections_received || 0) >= reqValue;
        break;
      case 'tandem_sessions_completed':
        qualified = Number(stats.tandem_sessions_completed || 0) >= reqValue;
        break;
      case 'following_count': {
        const followingRes = await db.execute({
          sql: 'SELECT COUNT(*) as total FROM follows WHERE follower_id = ? AND is_active = 1',
          args: [userId],
        });
        qualified = Number(followingRes.rows[0].total) >= reqValue;
        break;
      }
      case 'followers_count': {
        const followersRes = await db.execute({
          sql: 'SELECT COUNT(*) as total FROM follows WHERE following_id = ? AND is_active = 1',
          args: [userId],
        });
        qualified = Number(followersRes.rows[0].total) >= reqValue;
        break;
      }
      case 'events_attended': {
        const eventsRes = await db.execute({
          sql: "SELECT COUNT(*) as total FROM event_attendees WHERE user_id = ? AND status = 'attended'",
          args: [userId],
        });
        qualified = Number(eventsRes.rows[0].total) >= reqValue;
        break;
      }
      case 'languages_count': {
        const langsRes = await db.execute({
          sql: "SELECT COUNT(*) as total FROM user_languages WHERE user_id = ? AND type = 'learning'",
          args: [userId],
        });
        qualified = Number(langsRes.rows[0].total) >= reqValue;
        break;
      }
      case 'manual':
        // Skip — admin grants only
        break;
      default:
        break;
    }

    if (qualified) {
      // Grant the achievement
      await db.execute({
        sql: 'INSERT INTO user_achievements (user_id, achievement_id, earned_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        args: [userId, achievement.id],
      });

      // Award XP for the achievement
      if (achievement.xp_reward && Number(achievement.xp_reward) > 0) {
        await addXP(userId, Number(achievement.xp_reward), 'achievement', String(achievement.id));
      }

      newlyEarned.push(achievement);
    }
  }

  return newlyEarned;
}

/**
 * Add XP to a user and log it.
 */
export async function addXP(userId, amount, reason, referenceId = '') {
  // 1. Insert into xp_log
  await db.execute({
    sql: 'INSERT INTO xp_log (user_id, amount, reason, reference_id, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
    args: [userId, amount, reason, referenceId],
  });

  // 2. Update user_stats xp
  await db.execute({
    sql: 'UPDATE user_stats SET xp = xp + ? WHERE user_id = ?',
    args: [amount, userId],
  });

  // 3. Update users xp
  await db.execute({
    sql: 'UPDATE users SET xp = xp + ? WHERE id = ?',
    args: [amount, userId],
  });
}
