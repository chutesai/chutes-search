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

    // Limit text length to prevent abuse
    if (body.text.length > 5000) {
      return NextResponse.json(
        { error: 'Text is too long (max 5000 characters)' },
        { status: 400 }
      );
    }

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
