import { NextRequest, NextResponse } from 'next/server';
import { generateSpeech, TTSRequest } from '@/lib/tts';

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

    const result = await generateSpeech(body);

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
