import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_COUNT = 3;        // Increased for better 502 handling
const DEFAULT_RETRY_DELAY_MS = 1500;  // Slightly longer initial delay

export type SandySandbox = {
  sandboxId: string;
  url?: string;
  createdAt?: string;
  timeoutAt?: string;
};

type SandyRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

const getSandyConfig = () => {
  const baseUrl = process.env.SANDY_BASE_URL;
  const apiKey = process.env.SANDY_API_KEY;

  if (!baseUrl) {
    throw new Error('SANDY_BASE_URL is not configured');
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
  };
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
};

const shouldRetry = (status?: number, errorText?: string) => {
  if (!status) return true;
  // Always retry 5xx errors (server errors, including 502 Bad Gateway)
  if (status >= 500) return true;
  // Retry 429 rate limit errors
  if (status === 429) return true;
  // Check error text for known transient errors
  if (errorText?.includes('Upstream error')) return true;
  return false;
};

export const sandyRequest = async <T>(
  path: string,
  options: RequestInit = {},
  config: SandyRequestOptions = {},
): Promise<T> => {
  const { baseUrl, apiKey } = getSandyConfig();
  const url = `${baseUrl}${path}`;
  const retries = config.retries ?? DEFAULT_RETRY_COUNT;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = new Headers(options.headers || {});
      if (apiKey) {
        headers.set('Authorization', `Bearer ${apiKey}`);
      }

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(
          `Sandy API error ${response.status}: ${errorText || response.statusText}`,
        );
        if (attempt < retries && shouldRetry(response.status, errorText)) {
          lastError = error;
          console.log(`[Sandy] Retrying request to ${path} (attempt ${attempt + 1}/${retries + 1}, status ${response.status})`);
          await sleep(retryDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }

      return await parseJsonResponse<T>(response);
    } catch (error: any) {
      clearTimeout(timeout);
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      if (attempt < retries) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('Sandy API request failed');
};

export const createSandbox = async (): Promise<SandySandbox> => {
  return sandyRequest<SandySandbox>('/api/sandboxes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      priority: 1,         // HIGH priority for user-facing search
      preemptable: false,  // Don't preempt user sessions
      flavor: 'agent-ready', // Use agent-ready flavor for Playwright/browser support
    }),
  }, {
    retries: 4,  // Extra retries for sandbox creation (502 errors common during startup)
    retryDelayMs: 2000,
  });
};

export const getSandboxStatus = async (sandboxId: string): Promise<{ status: string; healthy: boolean }> => {
  try {
    const result = await sandyRequest<{ sandboxId: string; status?: string }>(`/api/sandboxes/${sandboxId}`, {
      method: 'GET',
    }, { retries: 1, retryDelayMs: 500 });
    return { status: result.status || 'unknown', healthy: !!result.sandboxId };
  } catch {
    return { status: 'error', healthy: false };
  }
};

export const terminateSandbox = async (sandboxId: string): Promise<void> => {
  await sandyRequest(`/api/sandboxes/${sandboxId}/terminate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
};

export const execInSandbox = async (
  sandboxId: string,
  command: string,
  env: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const sanitizedCommand = command.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  return sandyRequest(`/api/sandboxes/${sandboxId}/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      command: sanitizedCommand,
      cwd: '/workspace',
      env,
      timeoutMs,
    }),
  }, { timeoutMs: Math.max(timeoutMs + 5000, 30000) });
};

export const writeSandboxFile = async (
  sandboxId: string,
  path: string,
  content: string,
): Promise<void> => {
  await sandyRequest(`/api/sandboxes/${sandboxId}/files/write`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, content }),
  });
};

export const readSandboxFile = async (
  sandboxId: string,
  path: string,
): Promise<string> => {
  const encodedPath = encodeURIComponent(path);
  const result = await sandyRequest<{ content: string }>(
    `/api/sandboxes/${sandboxId}/files/read?path=${encodedPath}`,
    {
      method: 'GET',
    },
  );

  return result.content ?? '';
};

export const listSandboxFiles = async (
  sandboxId: string,
  path?: string,
): Promise<string[]> => {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const result = await sandyRequest<{ files: string[] }>(
    `/api/sandboxes/${sandboxId}/files/list${query}`,
    {
      method: 'GET',
    },
  );

  return result.files ?? [];
};
