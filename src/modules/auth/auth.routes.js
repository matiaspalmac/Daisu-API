// src/modules/auth/auth.routes.js
import express from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createUserSchema, loginSchema } from './auth.schemas.js';
import { AuthService } from './auth.service.js';

const router = express.Router();

// POST /api/createuser — public
router.post('/createuser', validate(createUserSchema), async (req, res, next) => {
  try {
    const result = await AuthService.createUser(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/login — public
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const result = await AuthService.login(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/forgot-password — public
router.post('/forgot-password', async (req, res, next) => {
  try {
    const result = await AuthService.forgotPassword(req.body.email);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/reset-password — public
router.post('/reset-password', async (req, res, next) => {
  try {
    const result = await AuthService.resetPassword(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/change-password — authenticated
router.post('/change-password', auth, async (req, res, next) => {
  try {
    const result = await AuthService.changePassword(req.user.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
