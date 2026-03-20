import { z } from 'zod';

// Messages
export const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000).trim(),
});

export const editMessageSchema = z.object({
  content: z.string().min(1).max(5000).trim(),
});

// Rooms
export const createRoomSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional().default(''),
  language: z.string().max(10).optional().default(''),
  level: z.string().max(10).optional().default(''),
  type: z.enum(['public', 'private']).optional().default('public'),
});
