// src/modules/social/social.routes.js
import express from 'express';
import { auth, adminOnly, ownerOrAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { reportSchema } from './social.schemas.js';
import { SocialService } from './social.service.js';

const router = express.Router();

router.post('/report', auth, validate(reportSchema), async (req, res, next) => {
  try { res.status(201).json(await SocialService.createReport(req.user.id, req.body)); } catch (err) { next(err); }
});

router.get('/reports', auth, adminOnly, async (req, res, next) => {
  try { res.json(await SocialService.listReports(req.query.status)); } catch (err) { next(err); }
});

router.patch('/reports/:id', auth, adminOnly, async (req, res, next) => {
  try { res.json(await SocialService.updateReport(req.params.id, req.body)); } catch (err) { next(err); }
});

router.get('/match', auth, async (req, res, next) => {
  try { res.json(await SocialService.findMatch(req.user.id)); } catch (err) { next(err); }
});

router.get('/users/:id/followers', auth, async (req, res, next) => {
  try { res.json(await SocialService.getFollowers(req.params.id)); } catch (err) { next(err); }
});

router.get('/users/:id/following', auth, async (req, res, next) => {
  try { res.json(await SocialService.getFollowing(req.params.id)); } catch (err) { next(err); }
});

router.get('/users/:id/follow-status', auth, async (req, res, next) => {
  try { res.json(await SocialService.getFollowStatus(req.params.id, req.query.viewerId || req.user.id)); } catch (err) { next(err); }
});

router.post('/users/:id/follow', auth, async (req, res, next) => {
  try { res.json(await SocialService.follow(req.user.id, req.params.id)); } catch (err) { next(err); }
});

router.post('/users/:id/unfollow', auth, async (req, res, next) => {
  try { res.json(await SocialService.unfollow(req.user.id, req.params.id)); } catch (err) { next(err); }
});

router.get('/users/:id/blocked', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await SocialService.getBlocked(req.params.id)); } catch (err) { next(err); }
});

router.post('/users/:id/unblock', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await SocialService.unblock(req.params.id, req.body.blockedUserId)); } catch (err) { next(err); }
});

router.get('/users/:id/profile-views', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await SocialService.getProfileViews(req.params.id)); } catch (err) { next(err); }
});

router.patch('/users/:id/privacy', auth, ownerOrAdmin, async (req, res, next) => {
  try { res.json(await SocialService.updatePrivacy(req.params.id, req.body)); } catch (err) { next(err); }
});

export default router;
