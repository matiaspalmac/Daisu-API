// src/modules/users/users.routes.js
import express from 'express';
import { auth, adminOnly, ownerOrAdmin } from '../../middleware/auth.js';
import { UsersService } from './users.service.js';

const router = express.Router();

// GET /api/users/online — authenticated
router.get('/users/online', auth, async (req, res, next) => {
  try {
    const result = await UsersService.getOnlineUsers();
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/users/:id — authenticated
router.get('/users/:id', auth, async (req, res, next) => {
  try {
    const result = await UsersService.getById(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/users/:id/presence — authenticated
router.get('/users/:id/presence', auth, async (req, res, next) => {
  try {
    const result = await UsersService.getPresence(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/updateuser — authenticated, owner or admin
router.put('/updateuser', auth, async (req, res, next) => {
  try {
    const result = await UsersService.update(req.body.id, req.body, req.user);
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/deleteuser/:id — admin only (soft delete)
router.delete('/deleteuser/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const result = await UsersService.softDelete(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /api/users/:id/admin — admin only
router.patch('/users/:id/admin', auth, adminOnly, async (req, res, next) => {
  try {
    const result = await UsersService.setAdmin(req.params.id, req.body.isAdmin);
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /api/users/:id/ban — admin only
router.patch('/users/:id/ban', auth, adminOnly, async (req, res, next) => {
  try {
    const result = await UsersService.setBan(req.params.id, req.body.ban);
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH /api/users/:id/targetlang — owner or admin
router.patch('/users/:id/targetlang', auth, ownerOrAdmin, async (req, res, next) => {
  try {
    const result = await UsersService.setTargetLang(req.params.id, req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/getusers — authenticated
router.get('/getusers', auth, async (req, res, next) => {
  try {
    const result = await UsersService.list(req.query.search);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/users/:id/export — owner or admin (GDPR data export)
router.get('/users/:id/export', auth, ownerOrAdmin, async (req, res, next) => {
  try {
    const result = await UsersService.exportData(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
