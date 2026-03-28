import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

export const logoutSchema = z.object({
  access_token: z.string().min(1, 'Access token is required'),
  jti: z.string().optional()
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
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ProxyOptions = z.infer<typeof proxyOptionsSchema>;
