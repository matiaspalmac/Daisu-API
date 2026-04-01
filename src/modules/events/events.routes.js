// src/modules/events/events.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createEventSchema } from './events.schemas.js';
import { EventsService } from './events.service.js';

const router = express.Router();

router.get('/events/my', auth, async (req, res, next) => {
  try { res.json(await EventsService.listMyEvents(req.user.id)); } catch (err) { next(err); }
});

router.get('/events', auth, async (req, res, next) => {
  try { res.json(await EventsService.list(req.query)); } catch (err) { next(err); }
});

router.get('/events/:id', auth, async (req, res, next) => {
  try { res.json(await EventsService.getById(req.params.id)); } catch (err) { next(err); }
});

router.post('/events', auth, validate(createEventSchema), async (req, res, next) => {
  try { res.status(201).json(await EventsService.create(req.user.id, req.body)); } catch (err) { next(err); }
});

router.put('/events/:id', auth, async (req, res, next) => {
  try { res.json(await EventsService.update(req.params.id, req.body, req.user)); } catch (err) { next(err); }
});

router.delete('/events/:id', auth, async (req, res, next) => {
  try { res.json(await EventsService.cancel(req.params.id, req.user)); } catch (err) { next(err); }
});

router.post('/events/:id/register', auth, async (req, res, next) => {
  try { res.status(201).json(await EventsService.register(req.user.id, req.params.id)); } catch (err) { next(err); }
});

router.post('/events/:id/unregister', auth, async (req, res, next) => {
  try { res.json(await EventsService.unregister(req.user.id, req.params.id)); } catch (err) { next(err); }
});

export default router;
