// src/modules/vocabulary/vocabulary.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { addVocabularySchema } from './vocabulary.schemas.js';
import { VocabularyService } from './vocabulary.service.js';

const router = express.Router();

router.get('/vocabulary', auth, async (req, res, next) => {
  try { res.json(await VocabularyService.list(req.user.id, req.query)); } catch (err) { next(err); }
});

router.get('/vocabulary/review', auth, async (req, res, next) => {
  try { res.json(await VocabularyService.getReviewWords(req.user.id)); } catch (err) { next(err); }
});

router.get('/vocabulary/stats', auth, async (req, res, next) => {
  try { res.json(await VocabularyService.getStats(req.user.id)); } catch (err) { next(err); }
});

router.post('/vocabulary', auth, validate(addVocabularySchema), async (req, res, next) => {
  try { res.status(201).json(await VocabularyService.addWord(req.user.id, req.body)); } catch (err) { next(err); }
});

router.put('/vocabulary/:id', auth, async (req, res, next) => {
  try { res.json(await VocabularyService.updateWord(req.user.id, req.params.id, req.body)); } catch (err) { next(err); }
});

router.delete('/vocabulary/:id', auth, async (req, res, next) => {
  try { res.json(await VocabularyService.deleteWord(req.user.id, req.params.id)); } catch (err) { next(err); }
});

router.post('/vocabulary/:id/review', auth, async (req, res, next) => {
  try { res.json(await VocabularyService.reviewWord(req.user.id, req.params.id, req.body.correct)); } catch (err) { next(err); }
});

export default router;
