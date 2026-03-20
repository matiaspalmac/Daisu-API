import { z } from 'zod';

// Auth
export const createUserSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).trim().toLowerCase(),
  password: z.string().min(6).max(128),
  image: z.string().max(500000).optional().default(''),  // base64 can be large
});

export const loginSchema = z.object({
  email: z.string().email().max(255).trim().toLowerCase(),
  password: z.string().min(1).max(128),
});
