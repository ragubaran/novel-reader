import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  
  // Clear cookie by setting expiration to past date
  response.cookies.set('novel_session', '', {
    httpOnly: true,
    expires: new Date(0),
    path: '/'
  });

  return response;
}
