// src/modules/quizzes/quizzes.routes.js
import express from 'express';
import { auth, adminOnly } from '../../middleware/auth.js';
import { QuizzesService } from './quizzes.service.js';

const router = express.Router();

router.get('/quizzes/daily', auth, async (req, res, next) => {
  try { res.json(await QuizzesService.getDailyQuiz(req.user.id, req.query.language)); } catch (err) { next(err); }
});

router.post('/quizzes/:id/attempt', auth, async (req, res, next) => {
  try { res.json(await QuizzesService.submitAttempt(req.user.id, Number(req.params.id), req.body.answers)); } catch (err) { next(err); }
});

router.get('/quizzes/:id/results', auth, async (req, res, next) => {
  try { res.json(await QuizzesService.getResults(req.user.id, Number(req.params.id))); } catch (err) { next(err); }
});

router.get('/quizzes/history', auth, async (req, res, next) => {
  try { res.json(await QuizzesService.getHistory(req.user.id)); } catch (err) { next(err); }
});

router.get('/quizzes', auth, async (req, res, next) => {
  try { res.json(await QuizzesService.listQuizzes(req.query)); } catch (err) { next(err); }
});

router.post('/quizzes', auth, adminOnly, async (req, res, next) => {
  try { res.status(201).json(await QuizzesService.createQuiz(req.user.id, req.body)); } catch (err) { next(err); }
});

export default router;
