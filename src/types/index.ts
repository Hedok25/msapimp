export interface JwtPayload {
  sub: string;          // client_id
  iss: string;          // issuer
  aud: string;          // audience
  iat: number;          // issued at
  exp: number;          // expiration
  jti: string;          // jwt id
  scope: string[];      // права доступа
  rate_tier: string;    // тариф
  role: string;         // роль
}

export interface Client {
  id: number;
  client_id: string;
  email: string;
  password_hash: string;
  role: 'client' | 'admin';
  rate_tier: 'basic' | 'premium' | 'enterprise';
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RefreshToken {
  id: number;
  client_id: string;
  token_hash: string;
  expires_at: string;
  is_revoked: number;
  created_at: string;
}

export interface RequestQueue {
  id: number;
  uuid: string;
  client_id: string;
  marketplace_id: string;
  method: string;
  url: string;
  headers: string | null;
  body: string | null;
  status: RequestStatus;
  response_status: number | null;
  response_headers: string | null;
  response_body: string | null;
  error_message: string | null;
  attempts: number;
  priority: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type RequestStatus =
  | 'accepted'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'dead_letter'
  | 'circuit_open'
  | 'rate_limited';

export interface ProxyOptions {
  check_struct?: boolean;
  logging?: 'minimal' | 'verbose' | 'debug';
  priority?: 'low' | 'normal' | 'high' | 'critical';
  webhook_url?: string;
  timeout_override?: number;
  response_format?: 'wrapped' | 'raw';
  idempotency_key?: string;
  cache_ttl?: number;
  retry_disabled?: boolean;
  skip_validation?: boolean;
}

export interface MarketplaceConfig {
  id: string;
  name: string;
  baseUrl: string;
  version: string;
  rateLimits: {
    requests: number;
    windowMs: number;
    burst: number;
    concurrent: number;
  };
  endpoints: Record<string, {
    url: string;
    timeout: number;
  }>;
  defaults: {
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
}

export interface RateLimitTier {
  requestsPerMin: number;
  concurrent: number;
  burst: number;
}

export const RATE_LIMIT_TIERS: Record<string, RateLimitTier> = {
  basic: { requestsPerMin: 30, concurrent: 2, burst: 5 },
  premium: { requestsPerMin: 100, concurrent: 5, burst: 15 },
  enterprise: { requestsPerMin: 500, concurrent: 20, burst: 50 }
};
