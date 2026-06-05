import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { getDB } from '@/lib/db';

export async function GET() {
  const userId = getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const db = await getDB();
    const user = await db.get('SELECT id, email, created_at FROM users WHERE id = ?', [userId]);

    if (!user) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at
      }
    });

  } catch (error: any) {
    console.error('Session validation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
