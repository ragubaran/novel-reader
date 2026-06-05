import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

const JWT_SECRET = process.env.JWT_SECRET || 'novel-translator-super-secret-key-2026';
const COOKIE_NAME = 'novel_session';

export interface JWTPayload {
  userId: number;
  email: string;
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (e) {
    return null;
  }
}

export function getUserIdFromRequest(request?: Request): number | null {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    
    if (!token) return null;
    
    const payload = verifyToken(token);
    return payload ? payload.userId : null;
  } catch (e) {
    console.error('Failed to parse auth session cookie:', e);
    return null;
  }
}
