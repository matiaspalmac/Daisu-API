// routes/dms.js — Direct Messages
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { startDMSchema, sendDMSchema } from './dms.schemas.js';
import { createNotification } from '../notifications/notifications.service.js';

const router = express.Router();

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

/** Check if a block exists in either direction between two users. */
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

/** Fetch a conversation and verify the current user is a participant. */
async function getConversationForUser(conversationId, userId) {
    const result = await db.execute({
        sql: 'SELECT * FROM dm_conversations WHERE id = ?',
        args: [conversationId],
    });
    if (!result.rows.length) return null;
    const conv = result.rows[0];
    if (String(conv.user1_id) !== String(userId) && String(conv.user2_id) !== String(userId)) return null;
    return conv;
}

/** Determine whether the current user is user1 or user2. */
function getUserPosition(conv, userId) {
    return String(conv.user1_id) === String(userId) ? 'user1' : 'user2';
}

/** Get the other user's id from the conversation. */
function getOtherUserId(conv, userId) {
    return String(conv.user1_id) === String(userId) ? conv.user2_id : conv.user1_id;
}

// ────────────────────────────────────────────
// GET /api/dms — List conversations for current user
// ────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await db.execute({
            sql: `SELECT c.id, c.user1_id, c.user2_id,
                    c.last_message_at, c.last_message_preview,
                    c.user1_unread_count, c.user2_unread_count,
                    c.created_at,
                    u1.name AS user1_name, u1.image AS user1_image,
                    u2.name AS user2_name, u2.image AS user2_image
                  FROM dm_conversations c
                  JOIN users u1 ON c.user1_id = u1.id
                  JOIN users u2 ON c.user2_id = u2.id
                  WHERE c.user1_id = ? OR c.user2_id = ?
                  ORDER BY c.last_message_at DESC`,
            args: [userId, userId],
        });

        const conversations = result.rows.map((c) => {
            const position = getUserPosition(c, userId);
            const isUser1 = position === 'user1';
            return {
                id: c.id,
                otherUser: {
                    id: isUser1 ? c.user2_id : c.user1_id,
                    name: isUser1 ? c.user2_name : c.user1_name,
                    image: isUser1 ? c.user2_image : c.user1_image,
                },
                lastMessageAt: c.last_message_at,
                lastMessagePreview: c.last_message_preview,
                unreadCount: isUser1 ? c.user1_unread_count : c.user2_unread_count,
                createdAt: c.created_at,
            };
        });

        res.json(conversations);
    } catch (e) {
        console.error('GET /api/dms error:', e);
        res.status(500).json({ error: 'Error fetching conversations' });
    }
});

// ────────────────────────────────────────────
// POST /api/dms — Start or get existing conversation
// ────────────────────────────────────────────
router.post('/', auth, validate(startDMSchema), async (req, res) => {
    const userId = req.user.id;
    const { userId: otherUserId } = req.body;

    if (!otherUserId) return res.status(400).json({ error: 'userId is required' });
    if (String(otherUserId) === String(userId)) return res.status(400).json({ error: 'Cannot start a conversation with yourself' });

    try {
        // Check blocks in both directions
        if (await isBlocked(userId, otherUserId)) {
            return res.status(403).json({ error: 'Cannot start conversation due to a block between users' });
        }

        // Verify other user exists
        const userCheck = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [otherUserId] });
        if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });

        // Canonical ordering: lower id = user1, higher id = user2
        const user1 = Math.min(Number(userId), Number(otherUserId));
        const user2 = Math.max(Number(userId), Number(otherUserId));

        // Insert or ignore if already exists
        await db.execute({
            sql: 'INSERT OR IGNORE INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
            args: [user1, user2],
        });

        // Fetch the conversation
        const result = await db.execute({
            sql: `SELECT c.id, c.user1_id, c.user2_id, c.last_message_at, c.last_message_preview,
                    c.user1_unread_count, c.user2_unread_count, c.created_at,
                    u.name AS other_name, u.image AS other_image
                  FROM dm_conversations c
                  JOIN users u ON u.id = ?
                  WHERE c.user1_id = ? AND c.user2_id = ?`,
            args: [otherUserId, user1, user2],
        });

        const c = result.rows[0];
        const position = getUserPosition(c, userId);

        res.status(201).json({
            id: c.id,
            otherUser: {
                id: Number(otherUserId),
                name: c.other_name,
                image: c.other_image,
            },
            lastMessageAt: c.last_message_at,
            lastMessagePreview: c.last_message_preview,
            unreadCount: position === 'user1' ? c.user1_unread_count : c.user2_unread_count,
            createdAt: c.created_at,
        });
    } catch (e) {
        console.error('POST /api/dms error:', e);
        res.status(500).json({ error: 'Error creating conversation' });
    }
});

// ────────────────────────────────────────────
// GET /api/dms/:conversationId/messages — Get messages
// ────────────────────────────────────────────
router.get('/:conversationId/messages', auth, async (req, res) => {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    try {
        const conv = await getConversationForUser(conversationId, userId);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        // Fetch messages (excluding soft-deleted)
        const result = await db.execute({
            sql: `SELECT m.id, m.conversation_id, m.sender_id, m.content,
                    m.message_type, m.edited_at, m.sent_at,
                    u.name AS sender_name, u.image AS sender_image
                  FROM dm_messages m
                  JOIN users u ON m.sender_id = u.id
                  WHERE m.conversation_id = ? AND m.deleted_at IS NULL
                  ORDER BY m.sent_at DESC
                  LIMIT ? OFFSET ?`,
            args: [conversationId, limit, offset],
        });

        // Mark as read: reset unread count for current user
        const position = getUserPosition(conv, userId);
        const unreadColumn = position === 'user1' ? 'user1_unread_count' : 'user2_unread_count';
        await db.execute({
            sql: `UPDATE dm_conversations SET ${unreadColumn} = 0 WHERE id = ?`,
            args: [conversationId],
        });

        res.json(result.rows);
    } catch (e) {
        console.error('GET /api/dms/:id/messages error:', e);
        res.status(500).json({ error: 'Error fetching messages' });
    }
});

// ────────────────────────────────────────────
// POST /api/dms/:conversationId/messages — Send message
// ────────────────────────────────────────────
router.post('/:conversationId/messages', auth, validate(sendDMSchema), async (req, res) => {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { content, messageType } = req.body;

    if (!content || !content.trim()) return res.status(400).json({ error: 'Message content is required' });

    try {
        const conv = await getConversationForUser(conversationId, userId);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        // Check blocks
        const otherUserId = getOtherUserId(conv, userId);
        if (await isBlocked(userId, otherUserId)) {
            return res.status(403).json({ error: 'Cannot send message due to a block between users' });
        }

        const trimmedContent = content.trim();
        const type = messageType || 'text';
        const preview = trimmedContent.length > 100 ? trimmedContent.slice(0, 100) + '...' : trimmedContent;

        // Insert message
        const insertResult = await db.execute({
            sql: 'INSERT INTO dm_messages (conversation_id, sender_id, content, message_type) VALUES (?, ?, ?, ?)',
            args: [conversationId, userId, trimmedContent, type],
        });

        // Update conversation: last_message_at, preview, increment other user's unread count
        const position = getUserPosition(conv, userId);
        const otherUnreadColumn = position === 'user1' ? 'user2_unread_count' : 'user1_unread_count';
        await db.execute({
            sql: `UPDATE dm_conversations
                  SET last_message_at = CURRENT_TIMESTAMP,
                      last_message_preview = ?,
                      ${otherUnreadColumn} = ${otherUnreadColumn} + 1
                  WHERE id = ?`,
            args: [preview, conversationId],
        });

        // Fetch the inserted message
        const msgResult = await db.execute({
            sql: `SELECT m.id, m.conversation_id, m.sender_id, m.content,
                    m.message_type, m.edited_at, m.sent_at,
                    u.name AS sender_name, u.image AS sender_image
                  FROM dm_messages m
                  JOIN users u ON m.sender_id = u.id
                  WHERE m.id = ?`,
            args: [insertResult.lastInsertRowid],
        });

        // Fire-and-forget notification to the other user
        const senderName = msgResult.rows[0]?.sender_name || 'Someone';
        createNotification(
            otherUserId,
            'dm_invite',
            'New direct message',
            `${senderName} sent you a message`,
            { conversationId: Number(conversationId), senderName }
        ).catch(console.error);

        res.status(201).json(msgResult.rows[0]);
    } catch (e) {
        console.error('POST /api/dms/:id/messages error:', e);
        res.status(500).json({ error: 'Error sending message' });
    }
});

// ────────────────────────────────────────────
// PUT /api/dms/:conversationId/messages/:messageId — Edit message
// ────────────────────────────────────────────
router.put('/:conversationId/messages/:messageId', auth, async (req, res) => {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) return res.status(400).json({ error: 'Message content is required' });

    try {
        const conv = await getConversationForUser(conversationId, userId);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        // Verify sender owns the message
        const msgCheck = await db.execute({
            sql: 'SELECT id, sender_id FROM dm_messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL',
            args: [messageId, conversationId],
        });
        if (!msgCheck.rows.length) return res.status(404).json({ error: 'Message not found' });
        if (String(msgCheck.rows[0].sender_id) !== String(userId)) return res.status(403).json({ error: 'You can only edit your own messages' });

        const trimmedContent = content.trim();
        await db.execute({
            sql: 'UPDATE dm_messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
            args: [trimmedContent, messageId],
        });

        // Fetch updated message
        const result = await db.execute({
            sql: `SELECT m.id, m.conversation_id, m.sender_id, m.content,
                    m.message_type, m.edited_at, m.sent_at,
                    u.name AS sender_name, u.image AS sender_image
                  FROM dm_messages m
                  JOIN users u ON m.sender_id = u.id
                  WHERE m.id = ?`,
            args: [messageId],
        });

        res.json(result.rows[0]);
    } catch (e) {
        console.error('PUT /api/dms/:id/messages/:mid error:', e);
        res.status(500).json({ error: 'Error editing message' });
    }
});

// ────────────────────────────────────────────
// DELETE /api/dms/:conversationId/messages/:messageId — Soft delete
// ────────────────────────────────────────────
router.delete('/:conversationId/messages/:messageId', auth, async (req, res) => {
    const userId = req.user.id;
    const { conversationId, messageId } = req.params;

    try {
        const conv = await getConversationForUser(conversationId, userId);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        // Verify sender owns the message
        const msgCheck = await db.execute({
            sql: 'SELECT id, sender_id FROM dm_messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL',
            args: [messageId, conversationId],
        });
        if (!msgCheck.rows.length) return res.status(404).json({ error: 'Message not found' });
        if (String(msgCheck.rows[0].sender_id) !== String(userId)) return res.status(403).json({ error: 'You can only delete your own messages' });

        await db.execute({
            sql: 'UPDATE dm_messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
            args: [messageId],
        });

        res.json({ message: 'Message deleted' });
    } catch (e) {
        console.error('DELETE /api/dms/:id/messages/:mid error:', e);
        res.status(500).json({ error: 'Error deleting message' });
    }
});

// ────────────────────────────────────────────
// POST /api/dms/:conversationId/read — Mark conversation as read
// ────────────────────────────────────────────
router.post('/:conversationId/read', auth, async (req, res) => {
    const userId = req.user.id;
    const { conversationId } = req.params;

    try {
        const conv = await getConversationForUser(conversationId, userId);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const position = getUserPosition(conv, userId);
        const unreadColumn = position === 'user1' ? 'user1_unread_count' : 'user2_unread_count';
        await db.execute({
            sql: `UPDATE dm_conversations SET ${unreadColumn} = 0 WHERE id = ?`,
            args: [conversationId],
        });

        res.json({ message: 'Conversation marked as read' });
    } catch (e) {
        console.error('POST /api/dms/:id/read error:', e);
        res.status(500).json({ error: 'Error marking conversation as read' });
    }
});

export default router;
