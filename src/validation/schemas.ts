import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().uuid('Invalid refresh token format')
});

export const proxyOptionsSchema = z.object({
  check_struct: z.boolean().optional(),
  logging: z.enum(['minimal', 'verbose', 'debug']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  webhook_url: z.string().url().optional(),
  timeout_override: z.number().max(60000).optional(),
  response_format: z.enum(['wrapped', 'raw']).optional(),
  idempotency_key: z.string().uuid().optional(),
  cache_ttl: z.number().min(0).optional(),
  retry_disabled: z.boolean().optional(),
  skip_validation: z.boolean().optional()
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ProxyOptions = z.infer<typeof proxyOptionsSchema>;
