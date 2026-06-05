import { getStore } from '@netlify/blobs';
import fs from 'fs';
import path from 'path';

// Local dev fallback DB
const LOCAL_JSON_DB = path.resolve(process.cwd(), 'local_db.json');

function readLocalDB() {
  if (!fs.existsSync(LOCAL_JSON_DB)) {
    return { users: {} as Record<string, any>, emails: {} as Record<string, any>, history: {} as Record<string, any[]> };
  }
  try {
    return JSON.parse(fs.readFileSync(LOCAL_JSON_DB, 'utf-8'));
  } catch {
    return { users: {}, emails: {}, history: {} };
  }
}

function writeLocalDB(data: any) {
  fs.writeFileSync(LOCAL_JSON_DB, JSON.stringify(data, null, 2));
}

// Check if running on Netlify (production, preview, or netlify dev CLI)
const isNetlify = !!(
  process.env.NETLIFY ||
  process.env.NETLIFY_LOCAL ||
  process.env.NETLIFY_BLOBS_CONTEXT ||
  process.env.NETLIFY_IMAGES_CDN_DOMAIN
);

class NetlifyBlobsDB {
  async get(query: string, params: any[]): Promise<any> {
    const q = query.trim().toLowerCase();
    
    // Pattern 1: SELECT * FROM users WHERE email = ?
    if (q.includes('select * from users where email =')) {
      const email = params[0].toLowerCase().trim();
      if (isNetlify) {
        const store = getStore('users');
        const userId = await store.get(`email:${email}`);
        if (!userId) return null;
        const user = await store.getJSON(`user:${userId}`);
        return user || null;
      } else {
        const local = readLocalDB();
        const userId = local.emails[email];
        if (!userId) return null;
        return local.users[userId] || null;
      }
    }
    
    // Pattern 2: SELECT id FROM users WHERE email = ?
    if (q.includes('select id from users where email =')) {
      const email = params[0].toLowerCase().trim();
      if (isNetlify) {
        const store = getStore('users');
        const userId = await store.get(`email:${email}`);
        if (!userId) return null;
        return { id: Number(userId) };
      } else {
        const local = readLocalDB();
        const userId = local.emails[email];
        if (!userId) return null;
        return { id: Number(userId) };
      }
    }

    // Pattern 3: SELECT id, email, created_at FROM users WHERE id = ?
    if (q.includes('select id, email, created_at from users where id =')) {
      const userId = params[0];
      if (isNetlify) {
        const store = getStore('users');
        const user: any = await store.getJSON(`user:${userId}`);
        if (!user) return null;
        return { id: user.id, email: user.email, created_at: user.created_at };
      } else {
        const local = readLocalDB();
        const user = local.users[userId];
        if (!user) return null;
        return { id: user.id, email: user.email, created_at: user.created_at };
      }
    }

    return null;
  }

  async all(query: string, params: any[]): Promise<any[]> {
    const q = query.trim().toLowerCase();
    // Pattern: SELECT url, title, book_title as bookTitle... WHERE user_id = ?
    if (q.includes('select url, title, book_title') && q.includes('where user_id =')) {
      const userId = params[0];
      let historyItems: any[] = [];
      if (isNetlify) {
        const store = getStore('history');
        historyItems = (await store.getJSON(`history:${userId}`)) || [];
      } else {
        const local = readLocalDB();
        historyItems = local.history[userId] || [];
      }
      return historyItems
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20)
        .map(h => ({
          url: h.url,
          title: h.title,
          bookTitle: h.book_title || h.bookTitle || '通天仙录',
          timestamp: h.timestamp
        }));
    }
    return [];
  }

  async run(query: string, params: any[]): Promise<any> {
    const q = query.trim().toLowerCase();

    // Pattern 1: INSERT INTO users (email, password) VALUES (?, ?)
    if (q.includes('insert into users')) {
      const email = params[0].toLowerCase().trim();
      const password = params[1];
      const userId = Math.floor(Math.random() * 100000000);
      const user = {
        id: userId,
        email,
        password,
        created_at: new Date().toISOString()
      };

      if (isNetlify) {
        const store = getStore('users');
        await store.set(`email:${email}`, String(userId));
        await store.setJSON(`user:${userId}`, user);
      } else {
        const local = readLocalDB();
        local.emails[email] = userId;
        local.users[userId] = user;
        writeLocalDB(local);
      }

      return { lastID: userId };
    }

    // Pattern 2: INSERT INTO reading_history (user_id, url, title, book_title, timestamp) ON CONFLICT...
    if (q.includes('insert into reading_history')) {
      const [userId, url, title, bookTitle, timestamp] = params;
      if (isNetlify) {
        const store = getStore('history');
        const history: any[] = (await store.getJSON(`history:${userId}`)) || [];
        const existingIdx = history.findIndex(h => h.url === url);
        if (existingIdx > -1) {
          history[existingIdx] = {
            ...history[existingIdx],
            title,
            book_title: bookTitle,
            timestamp
          };
        } else {
          history.push({
            user_id: userId,
            url,
            title,
            book_title: bookTitle,
            timestamp
          });
        }
        await store.setJSON(`history:${userId}`, history);
      } else {
        const local = readLocalDB();
        if (!local.history[userId]) {
          local.history[userId] = [];
        }
        const history = local.history[userId];
        const existingIdx = history.findIndex((h: any) => h.url === url);
        if (existingIdx > -1) {
          history[existingIdx] = {
            ...history[existingIdx],
            title,
            book_title: bookTitle,
            timestamp
          };
        } else {
          history.push({
            user_id: userId,
            url,
            title,
            book_title: bookTitle,
            timestamp
          });
        }
        writeLocalDB(local);
      }
      return { lastID: 1 };
    }

    return { lastID: null };
  }

  async exec(query: string): Promise<void> {
    // No-op compatibility wrapper
  }
}

const dbInstance = new NetlifyBlobsDB();

export async function getDB(): Promise<any> {
  return dbInstance;
}
