import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { getDB } from '@/lib/db';

// Retrieve reading history from SQLite
export async function GET() {
  const userId = getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = await getDB();
    const history = await db.all(
      'SELECT url, title, book_title as bookTitle, timestamp FROM reading_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20',
      [userId]
    );

    return NextResponse.json({ history });
  } catch (error: any) {
    console.error('History retrieval error:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}

// Save or update reading history in SQLite
export async function POST(request: Request) {
  const userId = getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url, title, bookTitle } = await request.json();

    if (!url || !title) {
      return NextResponse.json({ error: 'URL and Title are required' }, { status: 400 });
    }

    const db = await getDB();
    
    // UPSERT pattern for SQLite (using INSERT OR REPLACE or custom logic since we added idx_user_url constraint)
    await db.run(`
      INSERT INTO reading_history (user_id, url, title, book_title, timestamp)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, url) DO UPDATE SET
        title = excluded.title,
        book_title = excluded.book_title,
        timestamp = excluded.timestamp
    `, [userId, url, title, bookTitle || '通天仙录', Date.now()]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('History saving error:', error);
    return NextResponse.json({ error: 'Failed to save history' }, { status: 500 });
  }
}
