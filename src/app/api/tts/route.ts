import { getAuthSession } from '@/lib/auth/cookieSession';
import { NextRequest, NextResponse } from 'next/server';
import { generateSpeech, TTSRequest } from '@/lib/tts';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as TTSRequest;

    if (!body.text || typeof body.text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required and must be a string' },
        { status: 400 }
      );
    }

    // Limit text length to prevent abuse and long processing times
    // Allow longer chunks since frontend handles splitting
    if (body.text.length > 2500) {
      return NextResponse.json(
        { error: 'Text chunk is too long (max 2500 characters)' },
        { status: 400 }
      );
    }

    console.log(`TTS request: ${body.text.length} chars, voice: ${body.voice || 'default'}`);

    const cookieStore = await cookies();
    const authSession = await getAuthSession(cookieStore);
    const scopeStr = authSession?.scope?.trim() || '';
    const hasInvoke =
      !scopeStr || scopeStr.split(/\s+/).includes('chutes:invoke');
    const tokenExpiry = authSession?.accessTokenExpiresAt ?? null;
    const tokenValid = tokenExpiry
      ? tokenExpiry > Math.floor(Date.now() / 1000) + 30
      : true;

    if (!authSession?.accessToken || !hasInvoke || !tokenValid) {
      return NextResponse.json(
        { error: 'Sign in with Chutes to use text-to-speech' },
        { status: 401 },
      );
    }

    const result = await generateSpeech(body, authSession.accessToken);

    if (result.success) {
      return NextResponse.json({
        success: true,
        audioUrl: result.audioUrl
      });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to generate speech' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('TTS API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'TTS API endpoint',
    usage: 'POST with { "text": "your text here", "voice": "optional voice" }'
  });
}
