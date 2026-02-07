import { NextRequest, NextResponse } from 'next/server';
import { searchImagesSafe, ImageSearchRequest } from '@/lib/imageSearch';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ImageSearchRequest;

    if (!body.query || typeof body.query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    // Limit query length to prevent abuse
    if (body.query.length > 200) {
      return NextResponse.json(
        { error: 'Query is too long (max 200 characters)' },
        { status: 400 }
      );
    }

    // Limit number of results
    const num = Math.min(body.num || 10, 50); // Max 50 results

    console.log(
      `[images] Searching images (queryLen=${body.query.length}, num=${num})`,
    );

    const images = await searchImagesSafe({
      query: body.query,
      num: num
    });

    return NextResponse.json({
      success: true,
      query: body.query,
      count: images.length,
      images: images
    });
  } catch (error: any) {
    console.error('Images API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required' },
      { status: 400 }
    );
  }

  try {
    const images = await searchImagesSafe({
      query: query,
      num: 10
    });

    return NextResponse.json({
      success: true,
      query: query,
      count: images.length,
      images: images
    });
  } catch (error: any) {
    console.error('Images API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
