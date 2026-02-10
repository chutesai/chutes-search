import { getClientIp, getRateLimitInfo } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/rate-limit
 * Returns the current rate limit status for the requesting IP
 */
export const GET = async (req: Request) => {
  try {
    const clientIp = getClientIp(req);
    const rateLimitInfo = await getRateLimitInfo(clientIp);

    return Response.json({
      ...rateLimitInfo,
    });
  } catch (err) {
    console.error('Error getting rate limit info:', err);
    return Response.json(
      { message: 'Error getting rate limit info' },
      { status: 500 },
    );
  }
};

