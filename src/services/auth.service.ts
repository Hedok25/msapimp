import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import config from '../config/index.js';

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  private db = getDatabase();

  async login(email: string, password: string): Promise<TokenPair> {
    const stmt = this.db.prepare('SELECT * FROM clients WHERE email = ? AND is_active = 1');
    const client = stmt.get(email) as { client_id: string; password_hash: string; role: string; rate_tier: string } | undefined;

    if (!client) {
      throw new Error('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, client.password_hash);
    if (!validPassword) {
      throw new Error('Invalid credentials');
    }

    const refreshToken = uuidv4();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const insertToken = this.db.prepare(`
      INSERT INTO refresh_tokens (client_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `);
    insertToken.run(client.client_id, refreshTokenHash, expiresAt);

    const accessToken = await this.generateAccessToken(client.client_id, client.role, client.rate_tier);

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600
    };
  }

  async generateAccessToken(clientId: string, role: string, rateTier: string): Promise<string> {
    const jti = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;

    const payload = {
      sub: clientId,
      iss: config.jwt.issuer,
      aud: config.jwt.audience,
      iat: now,
      exp,
      jti,
      scope: ['proxy:read', 'proxy:write'],
      rate_tier: rateTier,
      role
    };

    // Простая реализация JWT подписи
    const header = { alg: 'HS256', typ: 'JWT' };
    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const crypto = await import('crypto');
    const signature = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');

    return `${base64Header}.${base64Payload}.${signature}`;
  }

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    const tokens = this.db.prepare('SELECT * FROM refresh_tokens WHERE is_revoked = 0').all() as { id: number; client_id: string; token_hash: string; expires_at: string }[];
    
    let validToken = null;
    for (const token of tokens) {
      const match = await bcrypt.compare(refreshToken, token.token_hash);
      if (match && new Date(token.expires_at) > new Date()) {
        validToken = token;
        break;
      }
    }

    if (!validToken) {
      throw new Error('Invalid or expired refresh token');
    }

    const client = this.db.prepare('SELECT * FROM clients WHERE client_id = ? AND is_active = 1').get(validToken.client_id) as { role: string; rate_tier: string } | undefined;

    if (!client) {
      throw new Error('Client not found');
    }

    // Отзыв старого refresh token
    this.db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?').run(validToken.id);

    // Генерация новой пары токенов
    const newRefreshToken = uuidv4();
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO refresh_tokens (client_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).run(validToken.client_id, newRefreshTokenHash, expiresAt);

    const accessToken = await this.generateAccessToken(validToken.client_id, client.role, client.rate_tier);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 3600
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokens = this.db.prepare('SELECT * FROM refresh_tokens WHERE is_revoked = 0').all() as { id: number; token_hash: string }[];
    
    for (const token of tokens) {
      const match = await bcrypt.compare(refreshToken, token.token_hash);
      if (match) {
        this.db.prepare('UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?').run(token.id);
        break;
      }
    }
  }

  async blacklistJwt(jti: string, exp: number): Promise<void> {
    const expiresAt = new Date(exp * 1000).toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO jwt_blacklist (jti, expires_at)
      VALUES (?, ?)
    `).run(jti, expiresAt);
  }

  isJwtBlacklisted(jti: string): boolean {
    const result = this.db.prepare('SELECT id FROM jwt_blacklist WHERE jti = ?').get(jti);
    return !!result;
  }

  getClientByClientId(clientId: string) {
    return this.db.prepare('SELECT * FROM clients WHERE client_id = ? AND is_active = 1').get(clientId);
  }
}

export const authService = new AuthService();
