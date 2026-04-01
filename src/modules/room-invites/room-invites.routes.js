// src/modules/room-invites/room-invites.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { RoomInvitesService } from './room-invites.service.js';

const router = express.Router();

router.post('/rooms/:roomId/invite', auth, async (req, res, next) => {
  try { res.status(201).json(await RoomInvitesService.sendInvite(Number(req.params.roomId), req.user.id, req.body.userId)); } catch (err) { next(err); }
});
router.get('/rooms/:roomId/invites', auth, async (req, res, next) => {
  try { res.json(await RoomInvitesService.getRoomInvites(Number(req.params.roomId), req.user)); } catch (err) { next(err); }
});
router.get('/invites', auth, async (req, res, next) => {
  try { res.json(await RoomInvitesService.getUserInvites(req.user.id)); } catch (err) { next(err); }
});
router.post('/invites/:id/accept', auth, async (req, res, next) => {
  try { res.json(await RoomInvitesService.acceptInvite(Number(req.params.id), req.user.id)); } catch (err) { next(err); }
});
router.post('/invites/:id/decline', auth, async (req, res, next) => {
  try { res.json(await RoomInvitesService.declineInvite(Number(req.params.id), req.user.id)); } catch (err) { next(err); }
});
router.get('/rooms/:roomId/members', auth, async (req, res, next) => {
  try { res.json(await RoomInvitesService.getRoomMembers(Number(req.params.roomId))); } catch (err) { next(err); }
});
router.post('/rooms/:roomId/join', auth, async (req, res, next) => {
  try { res.json(await RoomInvitesService.joinRoom(Number(req.params.roomId), req.user.id)); } catch (err) { next(err); }
});
router.post('/rooms/:roomId/leave', auth, async (req, res, next) => {
  try { res.json(await RoomInvitesService.leaveRoom(Number(req.params.roomId), req.user.id)); } catch (err) { next(err); }
});

export default router;
