import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError, AuthorizationError } from '../../errors/index.js';

export const UsersService = {
  async getOnlineUsers() {
    const result = await db.execute(
      `SELECT up.user_id, u.name, u.image, up.current_room_id
       FROM user_presence up
       JOIN users u ON up.user_id = u.id
       WHERE up.is_online = 1`
    );
    return result.rows.map(r => ({
      userId: r.user_id,
      name: r.name,
      image: r.image || '',
      currentRoomId: r.current_room_id || null,
    }));
  },

  async getById(id) {
    const result = await db.execute({
      sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
             targetLang, level, country, interests, tandem_goal, streak, last_active, created_at,
             is_public, hide_old_messages, bubble_color, deleted_at
      FROM users WHERE id = ?`,
      args: [id],
    });
    if (!result.rows.length) throw new NotFoundError('User not found');
    const user = result.rows[0];
    if (user.deleted_at) return { id: user.id, name: 'Deleted User', deleted: true };
    try { user.interests = JSON.parse(user.interests || '[]'); } catch { user.interests = []; }
    const { deleted_at, ...safeUser } = user;
    return safeUser;
  },

  async getPresence(id) {
    const result = await db.execute({
      sql: 'SELECT is_online, last_seen_at, current_room_id FROM user_presence WHERE user_id = ?',
      args: [id],
    });
    if (!result.rows.length) {
      return { isOnline: false, lastSeenAt: null, currentRoomId: null };
    }
    const row = result.rows[0];
    return {
      isOnline: Boolean(row.is_online),
      lastSeenAt: row.last_seen_at || null,
      currentRoomId: row.current_room_id || null,
    };
  },

  async update(id, data, requestingUser) {
    if (!id) throw new ValidationError('User ID required');
    if (String(requestingUser.id) !== String(id) && !requestingUser.isAdmin) {
      throw new AuthorizationError('Access denied');
    }

    const { name, email, image, cover_image, bio, nativelang, learninglang, targetLang, level, country, interests, tandem_goal, is_public, hide_old_messages, bubble_color } = data;
    const safeImage = typeof image === 'string' ? image : '';
    const safeCoverImage = typeof cover_image === 'string' ? cover_image : '';
    const safeInterests = Array.isArray(interests) ? JSON.stringify(interests) : (interests || '[]');

    // Non-admins cannot change isAdmin via updateuser
    const currentUser = await db.execute({ sql: 'SELECT isAdmin FROM users WHERE id = ?', args: [id] });
    const currentIsAdmin = currentUser.rows[0]?.isAdmin || 0;

    await db.execute({
      sql: `UPDATE users SET name=?, email=?, image=?, cover_image=?, isAdmin=?, bio=?, nativelang=?,
      learninglang=?, targetLang=?, level=?, country=?, interests=?, tandem_goal=?, is_public=?, hide_old_messages=?, bubble_color=? WHERE id=?`,
      args: [name || '', email || '', safeImage, safeCoverImage, currentIsAdmin, bio || '', nativelang || '', learninglang || '',
        targetLang || '', level || 'A1', country || '',
        safeInterests,
        tandem_goal || '', is_public !== undefined ? (is_public ? 1 : 0) : 1, hide_old_messages ? 1 : 0, bubble_color || '#2d88ff', id],
    });
    const updated = await db.execute({
      sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
             targetLang, level, country, interests, tandem_goal, streak, last_active, banned_at, created_at,
             is_public, hide_old_messages, bubble_color
            FROM users WHERE id = ?`,
      args: [id],
    });
    return { message: 'User updated', user: updated.rows[0] || null };
  },

  async softDelete(id) {
    await db.execute({
      sql: `UPDATE users SET deleted_at = CURRENT_TIMESTAMP, email = 'deleted_' || id || '@deleted.com',
            name = 'Deleted User', image = '', cover_image = '', bio = '', password = NULL WHERE id = ?`,
      args: [id],
    });
    return { message: 'User deleted' };
  },

  async setAdmin(id, isAdmin) {
    await db.execute({ sql: 'UPDATE users SET isAdmin = ? WHERE id = ?', args: [isAdmin ? 1 : 0, id] });
    return { message: 'Admin updated' };
  },

  async setBan(id, ban) {
    await db.execute({
      sql: 'UPDATE users SET banned_at = ? WHERE id = ?',
      args: [ban ? new Date().toISOString() : null, id],
    });
    return { message: ban ? 'User banned' : 'User unbanned' };
  },

  async setTargetLang(id, { targetLang, level }) {
    await db.execute({
      sql: 'UPDATE users SET targetLang = ?, level = ? WHERE id = ?',
      args: [targetLang || '', level || 'A1', id],
    });
    return { message: 'Target language updated' };
  },

  async list(search) {
    const result = await db.execute({
      sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
             targetLang, level, country, interests, tandem_goal, streak, last_active, banned_at, created_at
      FROM users WHERE deleted_at IS NULL ${search ? 'AND (name LIKE ? OR email LIKE ?)' : ''}
      ORDER BY created_at DESC`,
      args: search ? [`%${search}%`, `%${search}%`] : [],
    });
    return result.rows;
  },

  async exportData(id) {
    // User profile (excluding password)
    const userResult = await db.execute({
      sql: `SELECT id, name, email, image, cover_image, isAdmin, bio, nativelang, learninglang,
             targetLang, level, country, interests, tandem_goal, streak, last_active, created_at,
             is_public, hide_old_messages, bubble_color, membership_tier, xp, timezone, notification_prefs
      FROM users WHERE id = ?`,
      args: [id],
    });
    if (!userResult.rows.length) throw new NotFoundError('User not found');
    const user = userResult.rows[0];

    const [messagesResult, reactionsResult, followersResult, followingResult, dmConversationsResult, vocabularyResult, achievementsResult, chatSettingsResult, statsResult, notificationsResult] = await Promise.all([
      db.execute({
        sql: `SELECT id, content, room_id, detected_lang, reply_to_id, reply_to_username, reply_to_content,
               message_type, edited_at, deleted_at, sent_at
        FROM messages WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?`,
        args: [id, config.limits.exportMessagesLimit],
      }),
      db.execute({
        sql: 'SELECT id, message_id, emoji, created_at FROM reactions WHERE user_id = ?',
        args: [id],
      }),
      db.execute({
        sql: `SELECT f.follower_id, u.name as follower_name, f.created_at
        FROM follows f JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ? AND f.is_active = 1`,
        args: [id],
      }),
      db.execute({
        sql: `SELECT f.following_id, u.name as following_name, f.created_at
        FROM follows f JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ? AND f.is_active = 1`,
        args: [id],
      }),
      db.execute({
        sql: `SELECT id, user1_id, user2_id, last_message_at, last_message_preview, created_at
        FROM dm_conversations WHERE user1_id = ? OR user2_id = ?`,
        args: [id, id],
      }),
      db.execute({
        sql: `SELECT id, word, translation, language, context_sentence, source, mastery_level,
               next_review_at, review_count, notes, created_at
        FROM user_vocabulary WHERE user_id = ?`,
        args: [id],
      }),
      db.execute({
        sql: `SELECT ua.achievement_id, a.name, a.description, a.icon, a.category, a.xp_reward, ua.earned_at
        FROM user_achievements ua JOIN achievements a ON ua.achievement_id = a.id
        WHERE ua.user_id = ?`,
        args: [id],
      }),
      db.execute({
        sql: `SELECT bubble_theme, my_bubble_color, other_bubble_color, font_size,
               effects_enabled, text_only_mode, data_saver_mode, disable_profile_images,
               room_backgrounds, nicknames, last_room_id, room_drafts
        FROM user_chat_settings WHERE user_id = ?`,
        args: [id],
      }),
      db.execute({
        sql: `SELECT messages_sent, words_sent, corrections_given, streak, longest_streak, xp,
               tandem_sessions_completed, corrections_received, vocabulary_count, last_streak_date, last_active
        FROM user_stats WHERE user_id = ?`,
        args: [id],
      }),
      db.execute({
        sql: `SELECT id, type, title, body, data, is_read, created_at
        FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        args: [id, config.limits.exportNotificationsLimit],
      }),
    ]);

    // DM messages
    const convIds = dmConversationsResult.rows.map(c => c.id);
    let dmMessages = [];
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      const dmMsgResult = await db.execute({
        sql: `SELECT id, conversation_id, sender_id, content, message_type, edited_at, deleted_at, sent_at
        FROM dm_messages WHERE conversation_id IN (${placeholders}) AND sender_id = ?
        ORDER BY sent_at DESC LIMIT ?`,
        args: [...convIds, id, config.limits.exportMessagesLimit],
      });
      dmMessages = dmMsgResult.rows;
    }

    return {
      exported_at: new Date().toISOString(),
      note: 'This export contains all your personal data per GDPR Article 20',
      user,
      messages: messagesResult.rows,
      reactions: reactionsResult.rows,
      follows: {
        followers: followersResult.rows,
        following: followingResult.rows,
      },
      dm_conversations: dmConversationsResult.rows.map(conv => ({
        ...conv,
        messages: dmMessages.filter(m => m.conversation_id === conv.id),
      })),
      vocabulary: vocabularyResult.rows,
      achievements: achievementsResult.rows,
      chat_settings: chatSettingsResult.rows[0] || null,
      stats: statsResult.rows[0] || null,
      notifications: notificationsResult.rows,
    };
  },
};
