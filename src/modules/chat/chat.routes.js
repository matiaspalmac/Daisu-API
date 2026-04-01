// src/modules/chat/chat.routes.js
import express from 'express';
import { auth, adminOnly } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createRoomSchema, editMessageSchema } from './chat.schemas.js';
import { ChatService } from './chat.service.js';

const router = express.Router();

// GET /api/rooms
router.get('/rooms', auth, async (req, res, next) => {
  try { res.json(await ChatService.listRooms(req.query)); } catch (err) { next(err); }
});

// GET /api/rooms/:id
router.get('/rooms/:id', auth, async (req, res, next) => {
  try { res.json(await ChatService.getRoomById(req.params.id)); } catch (err) { next(err); }
});

// POST /api/rooms
router.post('/rooms', auth, validate(createRoomSchema), async (req, res, next) => {
  try { res.status(201).json(await ChatService.createRoom(req.body)); } catch (err) { next(err); }
});

// PATCH /api/rooms/:id — admin only
router.patch('/rooms/:id', auth, adminOnly, async (req, res, next) => {
  try { res.json(await ChatService.updateRoom(req.params.id, req.body)); } catch (err) { next(err); }
});

// DELETE /api/rooms/:id — admin only
router.delete('/rooms/:id', auth, adminOnly, async (req, res, next) => {
  try { res.json(await ChatService.deleteRoom(req.params.id)); } catch (err) { next(err); }
});

// GET /api/chats
router.get('/chats', auth, async (req, res, next) => {
  try { res.json(await ChatService.listMessages(req.query)); } catch (err) { next(err); }
});

// GET /api/stats
router.get('/stats', auth, async (req, res, next) => {
  try { res.json(await ChatService.getGlobalStats()); } catch (err) { next(err); }
});

// GET /api/rooms/:roomId/pinned
router.get('/rooms/:roomId/pinned', auth, async (req, res, next) => {
  try { res.json(await ChatService.getPinnedMessages(req.params.roomId)); } catch (err) { next(err); }
});

// POST /api/messages/:messageId/pin
router.post('/messages/:messageId/pin', auth, async (req, res, next) => {
  try { res.json(await ChatService.pinMessage(req.params.messageId, req.body?.roomId, req.user)); } catch (err) { next(err); }
});

// DELETE /api/messages/:messageId/pin/:roomId
router.delete('/messages/:messageId/pin/:roomId', auth, async (req, res, next) => {
  try { res.json(await ChatService.unpinMessage(req.params.messageId, req.params.roomId, req.user)); } catch (err) { next(err); }
});

// POST /api/messages/:messageId/mention
router.post('/messages/:messageId/mention', auth, async (req, res, next) => {
  try { res.json(await ChatService.createMention(req.params.messageId, req.body?.userId)); } catch (err) { next(err); }
});

// PATCH /api/messages/:messageId — edit message
router.patch('/messages/:messageId', auth, validate(editMessageSchema), async (req, res, next) => {
  try { res.json(await ChatService.editMessage(req.params.messageId, req.body.content, req.user)); } catch (err) { next(err); }
});

// DELETE /api/messages/:messageId — soft-delete
router.delete('/messages/:messageId', auth, async (req, res, next) => {
  try { res.json(await ChatService.deleteMessage(req.params.messageId, req.user)); } catch (err) { next(err); }
});

export default router;
