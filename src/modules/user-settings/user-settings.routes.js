// src/modules/user-settings/user-settings.routes.js
import express from 'express';
import { auth, ownerOrAdmin } from '../../middleware/auth.js';
import { UserSettingsService } from './user-settings.service.js';

const router = express.Router();

// GET /api/users/:id/chat-settings
router.get('/users/:id/chat-settings', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await UserSettingsService.getChatSettings(req.params.id)); } catch (err) { next(err); }
});

// PUT /api/users/:id/chat-settings
router.put('/users/:id/chat-settings', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await UserSettingsService.updateChatSettings(req.params.id, req.body)); } catch (err) { next(err); }
});

// GET /api/users/:id/moderation
router.get('/users/:id/moderation', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await UserSettingsService.getModeration(req.params.id)); } catch (err) { next(err); }
});

// PUT /api/users/:id/moderation/:targetId
router.put('/users/:id/moderation/:targetId', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await UserSettingsService.updateModeration(req.params.id, req.params.targetId, req.body || {})); } catch (err) { next(err); }
});

// GET /api/users/:id/room-role/:roomId
router.get('/users/:id/room-role/:roomId', auth, async (req, res, next) => {
  try { res.json(await UserSettingsService.getRoomRole(req.params.id, req.params.roomId)); } catch (err) { next(err); }
});

// PUT /api/users/:id/room-role/:roomId
router.put('/users/:id/room-role/:roomId', auth, async (req, res, next) => {
  try { res.json(await UserSettingsService.setRoomRole(req.params.id, req.params.roomId, req.body?.role, req.user)); } catch (err) { next(err); }
});

// GET /api/users/:id/mentions
router.get('/users/:id/mentions', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await UserSettingsService.getMentions(req.params.id)); } catch (err) { next(err); }
});

// POST /api/users/:id/mentions/mark-read
router.post('/users/:id/mentions/mark-read', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await UserSettingsService.markMentionsRead(req.params.id, req.body?.mentionIds)); } catch (err) { next(err); }
});

// POST /api/users/:id/ban — ban from room
router.post('/users/:id/ban', auth, async (req, res, next) => {
  try { res.json(await UserSettingsService.banFromRoom(req.params.id, req.body || {}, req.user)); } catch (err) { next(err); }
});

// DELETE /api/users/:id/ban/:roomId — unban from room
router.delete('/users/:id/ban/:roomId', auth, async (req, res, next) => {
  try { res.json(await UserSettingsService.unbanFromRoom(req.params.id, req.params.roomId, req.user)); } catch (err) { next(err); }
});

// GET /api/users/:id/emoji-favorites
router.get('/users/:id/emoji-favorites', auth, async (req, res, next) => {
  try { res.json(await UserSettingsService.getEmojiFavorites(req.params.id)); } catch (err) { next(err); }
});

// POST /api/users/:id/emoji-favorites/:emoji
router.post('/users/:id/emoji-favorites/:emoji', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await UserSettingsService.trackEmojiFavorite(req.params.id, req.params.emoji)); } catch (err) { next(err); }
});

// GET /api/users/:id/audit-log/:roomId
router.get('/users/:id/audit-log/:roomId', auth, async (req, res, next) => {
  try { res.json(await UserSettingsService.getAuditLog(req.params.roomId, req.user)); } catch (err) { next(err); }
});

export default router;
