// src/modules/dms/dms.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { startDMSchema, sendDMSchema } from './dms.schemas.js';
import { DMsService } from './dms.service.js';

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try { res.json(await DMsService.listConversations(req.user.id)); } catch (err) { next(err); }
});

router.post('/', auth, validate(startDMSchema), async (req, res, next) => {
  try { res.status(201).json(await DMsService.startConversation(req.user.id, req.body.userId)); } catch (err) { next(err); }
});

router.get('/:conversationId/messages', auth, async (req, res, next) => {
  try { res.json(await DMsService.getMessages(req.user.id, req.params.conversationId, req.query)); } catch (err) { next(err); }
});

router.post('/:conversationId/messages', auth, validate(sendDMSchema), async (req, res, next) => {
  try { res.status(201).json(await DMsService.sendMessage(req.user.id, req.params.conversationId, req.body)); } catch (err) { next(err); }
});

router.put('/:conversationId/messages/:messageId', auth, async (req, res, next) => {
  try { res.json(await DMsService.editMessage(req.user.id, req.params.conversationId, req.params.messageId, req.body.content)); } catch (err) { next(err); }
});

router.delete('/:conversationId/messages/:messageId', auth, async (req, res, next) => {
  try { res.json(await DMsService.deleteMessage(req.user.id, req.params.conversationId, req.params.messageId)); } catch (err) { next(err); }
});

router.post('/:conversationId/read', auth, async (req, res, next) => {
  try { res.json(await DMsService.markAsRead(req.user.id, req.params.conversationId)); } catch (err) { next(err); }
});

export default router;
