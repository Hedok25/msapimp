import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import config from '../config/index.js';

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenData {
  accessToken: string;
  expiresIn: number;
  jti: string;
}

export class AuthService {
  private db = getDatabase();

  async login(email: string, password: string): Promise<TokenData> {
    const stmt = this.db.prepare('SELECT * FROM clients WHERE email = ? AND is_active = 1');
    const client = stmt.get(email) as { client_id: string; password_hash: string; role: string; rate_tier: string } | undefined;

    if (!client) {
      throw new Error('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, client.password_hash);
    if (!validPassword) {
      throw new Error('Invalid credentials');
    }

    // Генерация токена с хранением в БД
    const jti = uuidv4();
    const accessToken = await this.generateAccessToken(client.client_id, client.role, client.rate_tier, jti);
    
    // Сохраняем хеш токена в БД для возможности отзыва
    const tokenHash = await bcrypt.hash(accessToken, 10);
    const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

    const insertToken = this.db.prepare(`
      INSERT INTO access_tokens (client_id, token_hash, jti, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    insertToken.run(client.client_id, tokenHash, jti, expiresAt);

    return {
      accessToken,
      expiresIn: 180 * 24 * 60 * 60,  // 180 дней в секундах
      jti
    };
  }

  async generateAccessToken(clientId: string, role: string, rateTier: string, jti: string): Promise<string> {
    // 180 дней в секундах
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (180 * 24 * 60 * 60);

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

  async logout(accessToken: string): Promise<void> {
    // Находим токен в БД и отзываем его
    const tokens = this.db.prepare('SELECT * FROM access_tokens WHERE is_revoked = 0').all() as { id: number; token_hash: string }[];

    for (const token of tokens) {
      const match = await bcrypt.compare(accessToken, token.token_hash);
      if (match) {
        this.db.prepare('UPDATE access_tokens SET is_revoked = 1 WHERE id = ?').run(token.id);
        break;
      }
    }
  }

  async revokeTokenByJti(jti: string): Promise<void> {
    this.db.prepare('UPDATE access_tokens SET is_revoked = 1 WHERE jti = ?').run(jti);
  }

  async revokeAllClientTokens(clientId: string): Promise<void> {
    this.db.prepare('UPDATE access_tokens SET is_revoked = 1 WHERE client_id = ?').run(clientId);
  }

  isTokenRevoked(jti: string): boolean {
    const result = this.db.prepare('SELECT id FROM access_tokens WHERE jti = ? AND is_revoked = 1').get(jti);
    return !!result;
  }

  getClientByClientId(clientId: string) {
    return this.db.prepare('SELECT * FROM clients WHERE client_id = ? AND is_active = 1').get(clientId);
  }

  getAllTokens() {
    return this.db.prepare(`
      SELECT at.id, at.client_id, at.jti, at.expires_at, at.is_revoked, at.created_at, c.email
      FROM access_tokens at
      JOIN clients c ON at.client_id = c.client_id
      ORDER BY at.created_at DESC
    `).all();
  }

  deleteToken(tokenId: number) {
    this.db.prepare('DELETE FROM access_tokens WHERE id = ?').run(tokenId);
  }
}

export const authService = new AuthService();
