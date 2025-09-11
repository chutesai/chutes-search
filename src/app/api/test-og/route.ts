import { fetchOGImage } from '@/lib/og-image';

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url).searchParams.get('url');
    if (!url) {
      return Response.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    console.log(`[test-og] Testing OG image fetch for: ${url}`);
    const image = await fetchOGImage(url);

    return Response.json({
      url,
      image,
      success: !!image
    });
  } catch (error: any) {
    console.error('[test-og] Error:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
};



