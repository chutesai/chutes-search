import { z } from 'zod';

export const CHUTES_IDP_AUTHORIZATION_ENDPOINT =
  process.env.CHUTES_IDP_AUTHORIZATION_ENDPOINT ||
  'https://api.chutes.ai/idp/authorize';
export const CHUTES_IDP_TOKEN_ENDPOINT =
  process.env.CHUTES_IDP_TOKEN_ENDPOINT || 'https://api.chutes.ai/idp/token';
export const CHUTES_IDP_USERINFO_ENDPOINT =
  process.env.CHUTES_IDP_USERINFO_ENDPOINT || 'https://api.chutes.ai/idp/userinfo';

export const CHUTES_IDP_DEFAULT_SCOPES =
  process.env.CHUTES_IDP_SCOPES || 'openid profile chutes:invoke';

const chutesIdpAppsListSchema = z.object({
  items: z.array(
    z.object({
      app_id: z.string(),
      client_id: z.string(),
      name: z.string().optional(),
      redirect_uris: z.array(z.string()).optional(),
      updated_at: z.string().optional(),
    }),
  ),
});

const chutesIdpAppByIdSchema = z.object({
  app_id: z.string(),
  client_id: z.string(),
  name: z.string().optional(),
  redirect_uris: z.array(z.string()).optional(),
});

let cachedClientId: { value: string; expiresAtMs: number } | null = null;

async function listIdpApps(apiKey: string) {
  const res = await fetch('https://api.chutes.ai/idp/apps', {
    headers: { authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  const raw = await readJsonOrText(res);
  if (!res.ok) {
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    throw new Error(`Failed to list IDP apps (${res.status}): ${msg}`);
  }
  return chutesIdpAppsListSchema.parse(raw).items;
}

async function getIdpAppById(apiKey: string, appId: string) {
  const res = await fetch(`https://api.chutes.ai/idp/apps/${appId}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  const raw = await readJsonOrText(res);
  if (!res.ok) {
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    throw new Error(`Failed to fetch IDP app (${res.status}): ${msg}`);
  }
  return chutesIdpAppByIdSchema.parse(raw);
}

async function discoverClientId(params: { redirectUri?: string } = {}) {
  if (cachedClientId && cachedClientId.expiresAtMs > Date.now()) {
    return cachedClientId.value;
  }

  const apiKey = process.env.CHUTES_API_KEY;
  if (!apiKey) {
    throw new Error(
      'CHUTES_IDP_CLIENT_ID is not set and CHUTES_API_KEY is unavailable for auto-discovery',
    );
  }

  const appId = process.env.CHUTES_IDP_APP_ID;
  if (appId) {
    const app = await getIdpAppById(apiKey, appId);
    cachedClientId = { value: app.client_id, expiresAtMs: Date.now() + 5 * 60 * 1000 };
    return app.client_id;
  }

  const apps = await listIdpApps(apiKey);
  const desiredName = process.env.CHUTES_IDP_APP_NAME || 'Chutes Search';

  const matchByRedirect = params.redirectUri
    ? apps.find((a) => (a.redirect_uris || []).includes(params.redirectUri!))
    : undefined;
  const matchByName = apps.find((a) => a.name === desiredName);

  const chosen = matchByRedirect || matchByName || apps[0];
  if (!chosen?.client_id) {
    throw new Error('Unable to discover IDP client_id');
  }

  cachedClientId = { value: chosen.client_id, expiresAtMs: Date.now() + 5 * 60 * 1000 };
  return chosen.client_id;
}

export async function getChutesIdpClientCredentials(params: {
  redirectUri?: string;
} = {}) {
  const clientSecret = process.env.CHUTES_IDP_CLIENT_SECRET || undefined;
  const clientId =
    process.env.CHUTES_IDP_CLIENT_ID || (await discoverClientId(params));
  if (!clientId) throw new Error('Unable to resolve CHUTES IDP client_id');
  return { clientId, clientSecret };
}

export type ChutesIdpTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

export type ChutesIdpUserInfo = {
  sub: string;
  username?: string;
  created_at?: string;
};

const userInfoSchema = z.object({
  sub: z.string(),
  username: z.string().optional(),
  created_at: z.string().optional(),
});

export function buildChutesAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL(CHUTES_IDP_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function readJsonOrText(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

export async function exchangeChutesAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
}): Promise<ChutesIdpTokenResponse> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', params.code);
  body.set('redirect_uri', params.redirectUri);
  body.set('client_id', params.clientId);
  if (params.clientSecret) body.set('client_secret', params.clientSecret);
  body.set('code_verifier', params.codeVerifier);

  const res = await fetch(CHUTES_IDP_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const raw = await readJsonOrText(res);
  if (!res.ok) {
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    throw new Error(`Token exchange failed (${res.status}): ${msg}`);
  }
  return tokenResponseSchema.parse(raw);
}

export async function refreshChutesAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<ChutesIdpTokenResponse> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', params.refreshToken);
  body.set('client_id', params.clientId);
  if (params.clientSecret) body.set('client_secret', params.clientSecret);

  const res = await fetch(CHUTES_IDP_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const raw = await readJsonOrText(res);
  if (!res.ok) {
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    throw new Error(`Token refresh failed (${res.status}): ${msg}`);
  }
  return tokenResponseSchema.parse(raw);
}

export async function fetchChutesUserInfo(
  accessToken: string,
): Promise<ChutesIdpUserInfo> {
  const res = await fetch(CHUTES_IDP_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const raw = await readJsonOrText(res);
  if (!res.ok) {
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    throw new Error(`Userinfo failed (${res.status}): ${msg}`);
  }
  return userInfoSchema.parse(raw);
}
