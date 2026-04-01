// src/modules/resources/resources.routes.js
import express from 'express';
import { auth, adminOnly } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createResourceSchema } from './resources.schemas.js';
import { ResourcesService } from './resources.service.js';

const router = express.Router();

router.get('/resources/saved', auth, async (req, res, next) => {
  try { res.json(await ResourcesService.listSaved(req.user.id, req.query)); } catch (err) { next(err); }
});
router.get('/resources', auth, async (req, res, next) => {
  try { res.json(await ResourcesService.list(req.user.id, req.query)); } catch (err) { next(err); }
});
router.get('/resources/:id', auth, async (req, res, next) => {
  try { res.json(await ResourcesService.getById(req.params.id)); } catch (err) { next(err); }
});
router.post('/resources', auth, adminOnly, validate(createResourceSchema), async (req, res, next) => {
  try { res.status(201).json(await ResourcesService.create(req.user.id, req.body)); } catch (err) { next(err); }
});
router.put('/resources/:id', auth, adminOnly, async (req, res, next) => {
  try { res.json(await ResourcesService.update(req.params.id, req.body)); } catch (err) { next(err); }
});
router.delete('/resources/:id', auth, adminOnly, async (req, res, next) => {
  try { res.json(await ResourcesService.remove(req.params.id)); } catch (err) { next(err); }
});
router.post('/resources/:id/save', auth, async (req, res, next) => {
  try { res.json(await ResourcesService.save(req.user.id, req.params.id)); } catch (err) { next(err); }
});
router.delete('/resources/:id/save', auth, async (req, res, next) => {
  try { res.json(await ResourcesService.unsave(req.user.id, req.params.id)); } catch (err) { next(err); }
});

export default router;
