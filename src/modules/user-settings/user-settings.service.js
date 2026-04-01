import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { ValidationError, AuthorizationError, NotFoundError } from '../../errors/index.js';

const CHAT_SETTINGS_DEFAULTS = {
  bubbleTheme: 'neon',
  myBubbleColor: '#2d88ff',
  otherBubbleColor: '#1e2430',
  fontSize: 'large',
  effectsEnabled: true,
  textOnlyMode: false,
  dataSaverMode: false,
  disableProfileImages: false,
  roomBackgrounds: {},
  nicknames: {},
  lastRoomId: '',
  roomDrafts: {},
};

export const UserSettingsService = {
  async getChatSettings(userId) {
    const result = await db.execute({
      sql: `SELECT bubble_theme, my_bubble_color, other_bubble_color, font_size,
                   effects_enabled, text_only_mode, data_saver_mode, disable_profile_images,
                   room_backgrounds, nicknames, last_room_id, room_drafts
            FROM user_chat_settings WHERE user_id = ?`,
      args: [userId],
    });

    if (!result.rows.length) return { ...CHAT_SETTINGS_DEFAULTS };

    const row = result.rows[0];
    let roomBackgrounds = {};
    let nicknames = {};
    let roomDrafts = {};
    try { roomBackgrounds = JSON.parse(row.room_backgrounds || '{}'); } catch { roomBackgrounds = {}; }
    try { nicknames = JSON.parse(row.nicknames || '{}'); } catch { nicknames = {}; }
    try { roomDrafts = JSON.parse(row.room_drafts || '{}'); } catch { roomDrafts = {}; }

    return {
      bubbleTheme: row.bubble_theme || 'neon',
      myBubbleColor: row.my_bubble_color || '#2d88ff',
      otherBubbleColor: row.other_bubble_color || '#1e2430',
      fontSize: row.font_size || 'large',
      effectsEnabled: Boolean(row.effects_enabled),
      textOnlyMode: Boolean(row.text_only_mode),
      dataSaverMode: Boolean(row.data_saver_mode),
      disableProfileImages: Boolean(row.disable_profile_images),
      roomBackgrounds,
      nicknames,
      lastRoomId: row.last_room_id || '',
      roomDrafts,
    };
  },

  async updateChatSettings(userId, data) {
    const { bubbleTheme, myBubbleColor, otherBubbleColor, fontSize, effectsEnabled, textOnlyMode, dataSaverMode, disableProfileImages, roomBackgrounds, nicknames, lastRoomId, roomDrafts } = data || {};

    const safeBubbleTheme = ['neon', 'pastel', 'minimal', 'custom'].includes(bubbleTheme) ? bubbleTheme : 'neon';
    const safeFontSize = ['small', 'medium', 'large'].includes(fontSize) ? fontSize : 'large';
    const safeMyColor = typeof myBubbleColor === 'string' ? myBubbleColor : '#2d88ff';
    const safeOtherColor = typeof otherBubbleColor === 'string' ? otherBubbleColor : '#1e2430';
    const safeRoomBackgrounds = roomBackgrounds && typeof roomBackgrounds === 'object' ? roomBackgrounds : {};
    const safeNicknames = nicknames && typeof nicknames === 'object' ? nicknames : {};
    const safeLastRoomId = typeof lastRoomId === 'string' ? lastRoomId : '';
    const safeRoomDrafts = roomDrafts && typeof roomDrafts === 'object' ? roomDrafts : {};

    await db.execute({
      sql: `INSERT INTO user_chat_settings (
              user_id, bubble_theme, my_bubble_color, other_bubble_color, font_size,
              effects_enabled, text_only_mode, data_saver_mode, disable_profile_images,
              room_backgrounds, nicknames, last_room_id, room_drafts, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
              bubble_theme = excluded.bubble_theme,
              my_bubble_color = excluded.my_bubble_color,
              other_bubble_color = excluded.other_bubble_color,
              font_size = excluded.font_size,
              effects_enabled = excluded.effects_enabled,
              text_only_mode = excluded.text_only_mode,
              data_saver_mode = excluded.data_saver_mode,
              disable_profile_images = excluded.disable_profile_images,
              room_backgrounds = excluded.room_backgrounds,
              nicknames = excluded.nicknames,
              last_room_id = excluded.last_room_id,
              room_drafts = excluded.room_drafts,
              updated_at = CURRENT_TIMESTAMP`,
      args: [
        userId, safeBubbleTheme, safeMyColor, safeOtherColor, safeFontSize,
        effectsEnabled ? 1 : 0, textOnlyMode ? 1 : 0, dataSaverMode ? 1 : 0, disableProfileImages ? 1 : 0,
        JSON.stringify(safeRoomBackgrounds), JSON.stringify(safeNicknames), safeLastRoomId, JSON.stringify(safeRoomDrafts),
      ],
    });

    return { message: 'Chat settings saved' };
  },

  async getModeration(userId) {
    const result = await db.execute({
      sql: 'SELECT target_user_id, muted, blocked FROM user_moderation WHERE user_id = ?',
      args: [userId],
    });
    const map = {};
    for (const row of result.rows) {
      map[String(row.target_user_id)] = { muted: Boolean(row.muted), blocked: Boolean(row.blocked) };
    }
    return { entries: map };
  },

  async updateModeration(userId, targetId, { muted, blocked }) {
    if (String(userId) === String(targetId)) throw new ValidationError('Cannot moderate yourself');

    const mutedValue = muted ? 1 : 0;
    const blockedValue = blocked ? 1 : 0;

    await db.execute({
      sql: `INSERT INTO user_moderation (user_id, target_user_id, muted, blocked, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, target_user_id) DO UPDATE SET
              muted = excluded.muted, blocked = excluded.blocked, updated_at = CURRENT_TIMESTAMP`,
      args: [userId, targetId, mutedValue, blockedValue],
    });
    return { message: 'Moderation updated', muted: Boolean(mutedValue), blocked: Boolean(blockedValue) };
  },

  async getRoomRole(userId, roomId) {
    const result = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [userId, roomId],
    });
    const role = result.rows.length ? result.rows[0].role : 'user';
    return { userId, roomId, role };
  },

  async setRoomRole(targetUserId, roomId, role, requestingUser) {
    if (!['user', 'mod', 'owner'].includes(role)) throw new ValidationError('Invalid role');

    const requesterRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [requestingUser.id, roomId],
    });
    const requesterIsAdmin = requestingUser.isAdmin || (requesterRole.rows.length && (requesterRole.rows[0].role === 'owner' || requesterRole.rows[0].role === 'mod'));
    if (!requesterIsAdmin) throw new AuthorizationError('Only mods/owners can assign roles');

    await db.execute({
      sql: `INSERT INTO user_room_roles (user_id, room_id, role, assigned_by, assigned_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, room_id) DO UPDATE SET role = excluded.role`,
      args: [targetUserId, roomId, role, requestingUser.id],
    });
    await db.execute({
      sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id, details) VALUES (?, ?, ?, ?, ?)',
      args: [requestingUser.id, 'set_role', targetUserId, roomId, JSON.stringify({ role })],
    });
    return { message: 'Role assigned', userId: targetUserId, roomId, role };
  },

  async getMentions(userId) {
    const result = await db.execute({
      sql: `SELECT m.id, m.mentioned_user_id, msg.id as message_id, msg.content, msg.user_id as sender_id,
                   u.name as sender_name, u.image as sender_image, msg.room_id, r.name as room_name,
                   m.created_at, m.is_read
            FROM mentions m
            JOIN messages msg ON m.message_id = msg.id
            JOIN users u ON msg.user_id = u.id
            JOIN rooms r ON msg.room_id = r.id
            WHERE m.mentioned_user_id = ?
            ORDER BY m.created_at DESC LIMIT ?`,
      args: [userId, config.limits.mentionsLimit],
    });
    return { mentions: result.rows };
  },

  async markMentionsRead(userId, mentionIds) {
    if (!mentionIds || !Array.isArray(mentionIds) || mentionIds.length === 0) {
      throw new ValidationError('mentionIds array required');
    }
    const safeIds = mentionIds.filter(v => Number.isFinite(Number(v))).map(Number);
    if (safeIds.length === 0) throw new ValidationError('No valid mention IDs');

    const placeholders = safeIds.map(() => '?').join(',');
    await db.execute({
      sql: `UPDATE mentions SET is_read = 1 WHERE mentioned_user_id = ? AND id IN (${placeholders})`,
      args: [userId, ...safeIds],
    });
    return { message: 'Mentions marked as read' };
  },

  async banFromRoom(targetUserId, data, requestingUser) {
    const { roomId, reason, durationMinutes } = data;
    if (!roomId) throw new ValidationError('roomId required');
    if (String(targetUserId) === String(requestingUser.id)) throw new ValidationError('Cannot ban yourself');

    const bannerRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [requestingUser.id, roomId],
    });
    const isMod = requestingUser.isAdmin || (bannerRole.rows.length && (bannerRole.rows[0].role === 'owner' || bannerRole.rows[0].role === 'mod'));
    if (!isMod) throw new AuthorizationError('Only mods/owners can ban');

    const isPermanent = !durationMinutes || durationMinutes === 0;
    const expiresAt = isPermanent ? null : new Date(Date.now() + durationMinutes * 60000).toISOString();
    await db.execute({
      sql: `INSERT INTO room_bans (user_id, room_id, banned_by, reason, expires_at, is_permanent)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, room_id) DO UPDATE SET
              banned_by = excluded.banned_by, reason = excluded.reason, expires_at = excluded.expires_at`,
      args: [targetUserId, roomId, requestingUser.id, reason || '', expiresAt, isPermanent ? 1 : 0],
    });
    await db.execute({
      sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id, details) VALUES (?, ?, ?, ?, ?)',
      args: [requestingUser.id, 'ban_user', targetUserId, roomId, JSON.stringify({ reason, durationMinutes, isPermanent })],
    });
    return { message: 'User banned', userId: targetUserId, roomId, expiresAt };
  },

  async unbanFromRoom(targetUserId, roomId, requestingUser) {
    const requesterRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [requestingUser.id, roomId],
    });
    const isMod = requestingUser.isAdmin || (requesterRole.rows.length && (requesterRole.rows[0].role === 'owner' || requesterRole.rows[0].role === 'mod'));
    if (!isMod) throw new AuthorizationError('Only mods/owners can unban');

    await db.execute({
      sql: 'DELETE FROM room_bans WHERE user_id = ? AND room_id = ?',
      args: [targetUserId, roomId],
    });
    await db.execute({
      sql: 'INSERT INTO moderator_actions (mod_id, action, target_user_id, room_id) VALUES (?, ?, ?, ?)',
      args: [requestingUser.id, 'unban_user', targetUserId, roomId],
    });
    return { message: 'User unbanned' };
  },

  async getEmojiFavorites(userId) {
    const result = await db.execute({
      sql: 'SELECT emoji, count FROM user_emoji_favorites WHERE user_id = ? ORDER BY count DESC, last_used DESC LIMIT ?',
      args: [userId, config.limits.emojiLimit],
    });
    return { favorites: result.rows.map(r => r.emoji) };
  },

  async trackEmojiFavorite(userId, emoji) {
    await db.execute({
      sql: `INSERT INTO user_emoji_favorites (user_id, emoji, count, last_used)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, emoji) DO UPDATE SET count = count + 1, last_used = CURRENT_TIMESTAMP`,
      args: [userId, emoji],
    });
    return { message: 'Emoji favorite tracked' };
  },

  async getAuditLog(roomId, requestingUser) {
    const userRole = await db.execute({
      sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
      args: [requestingUser.id, roomId],
    });
    const isMod = requestingUser.isAdmin || (userRole.rows.length && (userRole.rows[0].role === 'owner' || userRole.rows[0].role === 'mod'));
    if (!isMod) throw new AuthorizationError('Only mods/owners can view audit log');

    const result = await db.execute({
      sql: `SELECT ma.id, ma.mod_id, u1.name as mod_name, ma.action, ma.target_user_id, u2.name as target_name,
                   ma.details, ma.created_at
            FROM moderator_actions ma
            LEFT JOIN users u1 ON ma.mod_id = u1.id
            LEFT JOIN users u2 ON ma.target_user_id = u2.id
            WHERE ma.room_id = ?
            ORDER BY ma.created_at DESC LIMIT ?`,
      args: [roomId, config.limits.auditLogLimit],
    });
    return { actions: result.rows };
  },
};
