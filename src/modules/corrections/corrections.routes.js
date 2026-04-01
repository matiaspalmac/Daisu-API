// src/modules/corrections/corrections.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { CorrectionsService } from './corrections.service.js';

const router = express.Router();

router.post('/messages/:messageId/correct', auth, async (req, res, next) => {
  try { res.status(201).json(await CorrectionsService.create(req.user.id, req.params.messageId, req.body)); } catch (err) { next(err); }
});
router.get('/messages/:messageId/corrections', auth, async (req, res, next) => {
  try { res.json(await CorrectionsService.listForMessage(req.params.messageId)); } catch (err) { next(err); }
});
router.post('/corrections/:id/helpful', auth, async (req, res, next) => {
  try { res.json(await CorrectionsService.toggleHelpful(req.user.id, req.params.id)); } catch (err) { next(err); }
});
router.get('/users/:id/corrections-given', auth, async (req, res, next) => {
  try { res.json(await CorrectionsService.getGiven(req.params.id, req.query.offset)); } catch (err) { next(err); }
});
router.get('/users/:id/corrections-received', auth, async (req, res, next) => {
  try { res.json(await CorrectionsService.getReceived(req.params.id, req.query.offset)); } catch (err) { next(err); }
});

export default router;
