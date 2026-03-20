import { z } from 'zod';

// Reports
export const reportSchema = z.object({
  messageId: z.union([z.string(), z.number()]).transform(String),
  reason: z.string().min(1).max(500).trim(),
});
