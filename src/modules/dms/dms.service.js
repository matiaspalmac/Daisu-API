import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError, AuthorizationError } from '../../errors/index.js';
import { createNotification } from '../notifications/notifications.service.js';

async function isBlocked(userA, userB) {
  const result = await db.execute({
    sql: `SELECT 1 FROM user_blocks
          WHERE is_active = 1
            AND ((user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?))
          LIMIT 1`,
    args: [userA, userB, userB, userA],
  });
  return result.rows.length > 0;
}

async function getConversationForUser(conversationId, userId) {
  const result = await db.execute({ sql: 'SELECT * FROM dm_conversations WHERE id = ?', args: [conversationId] });
  if (!result.rows.length) return null;
  const conv = result.rows[0];
  if (String(conv.user1_id) !== String(userId) && String(conv.user2_id) !== String(userId)) return null;
  return conv;
}

function getUserPosition(conv, userId) {
  return String(conv.user1_id) === String(userId) ? 'user1' : 'user2';
}

function getOtherUserId(conv, userId) {
  return String(conv.user1_id) === String(userId) ? conv.user2_id : conv.user1_id;
}

export const DMsService = {
  async listConversations(userId) {
    const result = await db.execute({
      sql: `SELECT c.id, c.user1_id, c.user2_id, c.last_message_at, c.last_message_preview,
              c.user1_unread_count, c.user2_unread_count, c.created_at,
              u1.name AS user1_name, u1.image AS user1_image,
              u2.name AS user2_name, u2.image AS user2_image
            FROM dm_conversations c
            JOIN users u1 ON c.user1_id = u1.id
            JOIN users u2 ON c.user2_id = u2.id
            WHERE c.user1_id = ? OR c.user2_id = ?
            ORDER BY c.last_message_at DESC`,
      args: [userId, userId],
    });
    return result.rows.map((c) => {
      const position = getUserPosition(c, userId);
      const isUser1 = position === 'user1';
      return {
        id: c.id,
        otherUser: { id: isUser1 ? c.user2_id : c.user1_id, name: isUser1 ? c.user2_name : c.user1_name, image: isUser1 ? c.user2_image : c.user1_image },
        lastMessageAt: c.last_message_at, lastMessagePreview: c.last_message_preview,
        unreadCount: isUser1 ? c.user1_unread_count : c.user2_unread_count, createdAt: c.created_at,
      };
    });
  },

  async startConversation(userId, otherUserId) {
    if (!otherUserId) throw new ValidationError('userId is required');
    if (String(otherUserId) === String(userId)) throw new ValidationError('Cannot start a conversation with yourself');
    if (await isBlocked(userId, otherUserId)) throw new AuthorizationError('Cannot start conversation due to a block between users');

    const userCheck = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [otherUserId] });
    if (!userCheck.rows.length) throw new NotFoundError('User not found');

    const user1 = Math.min(Number(userId), Number(otherUserId));
    const user2 = Math.max(Number(userId), Number(otherUserId));
    await db.execute({ sql: 'INSERT OR IGNORE INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)', args: [user1, user2] });

    const result = await db.execute({
      sql: `SELECT c.id, c.user1_id, c.user2_id, c.last_message_at, c.last_message_preview,
              c.user1_unread_count, c.user2_unread_count, c.created_at,
              u.name AS other_name, u.image AS other_image
            FROM dm_conversations c JOIN users u ON u.id = ?
            WHERE c.user1_id = ? AND c.user2_id = ?`,
      args: [otherUserId, user1, user2],
    });
    const c = result.rows[0];
    const position = getUserPosition(c, userId);
    return {
      id: c.id,
      otherUser: { id: Number(otherUserId), name: c.other_name, image: c.other_image },
      lastMessageAt: c.last_message_at, lastMessagePreview: c.last_message_preview,
      unreadCount: position === 'user1' ? c.user1_unread_count : c.user2_unread_count, createdAt: c.created_at,
    };
  },

  async getMessages(userId, conversationId, { limit: rawLimit, offset: rawOffset }) {
    const limit = Math.min(Math.max(parseInt(rawLimit) || config.limits.messageHistoryDefault, 1), config.limits.paginationMax);
    const offset = Math.max(parseInt(rawOffset) || 0, 0);
    const conv = await getConversationForUser(conversationId, userId);
    if (!conv) throw new NotFoundError('Conversation not found');

    const result = await db.execute({
      sql: `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.message_type, m.edited_at, m.sent_at,
              u.name AS sender_name, u.image AS sender_image
            FROM dm_messages m JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = ? AND m.deleted_at IS NULL ORDER BY m.sent_at DESC LIMIT ? OFFSET ?`,
      args: [conversationId, limit, offset],
    });

    const position = getUserPosition(conv, userId);
    const unreadColumn = position === 'user1' ? 'user1_unread_count' : 'user2_unread_count';
    await db.execute({ sql: `UPDATE dm_conversations SET ${unreadColumn} = 0 WHERE id = ?`, args: [conversationId] });
    return result.rows;
  },

  async sendMessage(userId, conversationId, { content, messageType }) {
    if (!content?.trim()) throw new ValidationError('Message content is required');
    const conv = await getConversationForUser(conversationId, userId);
    if (!conv) throw new NotFoundError('Conversation not found');

    const otherUserId = getOtherUserId(conv, userId);
    if (await isBlocked(userId, otherUserId)) throw new AuthorizationError('Cannot send message due to a block between users');

    const trimmedContent = content.trim();
    const type = messageType || 'text';
    const preview = trimmedContent.length > 100 ? trimmedContent.slice(0, 100) + '...' : trimmedContent;

    const insertResult = await db.execute({
      sql: 'INSERT INTO dm_messages (conversation_id, sender_id, content, message_type) VALUES (?, ?, ?, ?)',
      args: [conversationId, userId, trimmedContent, type],
    });

    const position = getUserPosition(conv, userId);
    const otherUnreadColumn = position === 'user1' ? 'user2_unread_count' : 'user1_unread_count';
    await db.execute({
      sql: `UPDATE dm_conversations SET last_message_at = CURRENT_TIMESTAMP, last_message_preview = ?, ${otherUnreadColumn} = ${otherUnreadColumn} + 1 WHERE id = ?`,
      args: [preview, conversationId],
    });

    const msgResult = await db.execute({
      sql: `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.message_type, m.edited_at, m.sent_at,
              u.name AS sender_name, u.image AS sender_image
            FROM dm_messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`,
      args: [insertResult.lastInsertRowid],
    });

    // Fire-and-forget notification
    const senderName = msgResult.rows[0]?.sender_name || 'Someone';
    createNotification(otherUserId, 'dm_invite', 'New direct message', `${senderName} sent you a message`, { conversationId: Number(conversationId), senderName }).catch(console.error);

    return msgResult.rows[0];
  },

  async editMessage(userId, conversationId, messageId, content) {
    if (!content?.trim()) throw new ValidationError('Message content is required');
    const conv = await getConversationForUser(conversationId, userId);
    if (!conv) throw new NotFoundError('Conversation not found');

    const msgCheck = await db.execute({
      sql: 'SELECT id, sender_id FROM dm_messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL',
      args: [messageId, conversationId],
    });
    if (!msgCheck.rows.length) throw new NotFoundError('Message not found');
    if (String(msgCheck.rows[0].sender_id) !== String(userId)) throw new AuthorizationError('You can only edit your own messages');

    await db.execute({ sql: 'UPDATE dm_messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?', args: [content.trim(), messageId] });

    const result = await db.execute({
      sql: `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.message_type, m.edited_at, m.sent_at,
              u.name AS sender_name, u.image AS sender_image
            FROM dm_messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`,
      args: [messageId],
    });
    return result.rows[0];
  },

  async deleteMessage(userId, conversationId, messageId) {
    const conv = await getConversationForUser(conversationId, userId);
    if (!conv) throw new NotFoundError('Conversation not found');

    const msgCheck = await db.execute({
      sql: 'SELECT id, sender_id FROM dm_messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL',
      args: [messageId, conversationId],
    });
    if (!msgCheck.rows.length) throw new NotFoundError('Message not found');
    if (String(msgCheck.rows[0].sender_id) !== String(userId)) throw new AuthorizationError('You can only delete your own messages');

    await db.execute({ sql: 'UPDATE dm_messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', args: [messageId] });
    return { message: 'Message deleted' };
  },

  async markAsRead(userId, conversationId) {
    const conv = await getConversationForUser(conversationId, userId);
    if (!conv) throw new NotFoundError('Conversation not found');

    const position = getUserPosition(conv, userId);
    const unreadColumn = position === 'user1' ? 'user1_unread_count' : 'user2_unread_count';
    await db.execute({ sql: `UPDATE dm_conversations SET ${unreadColumn} = 0 WHERE id = ?`, args: [conversationId] });
    return { message: 'Conversation marked as read' };
  },
};
