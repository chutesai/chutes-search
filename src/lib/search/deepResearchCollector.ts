import { Document } from '@langchain/core/documents';
import { runWebSearch } from './runWebSearch';
import {
  createSandbox,
  execInSandbox,
  readSandboxFile,
  terminateSandbox,
  writeSandboxFile,
} from '../sandy';

export type DeepResearchProgress = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  detail?: string;
  percent?: number;
};

export type DeepResearchMode = 'light' | 'max';

export type DeepResearchSource = {
  title: string;
  url: string;
  content: string;
  description?: string;
  status?: string;
  error?: string;
};

type DeepResearchOptions = {
  maxSources: number;
  maxCharsPerSource: number;
  maxDurationMs: number;
  maxPages: number;
  maxDepth: number;
  maxLinksPerPage: number;
  maxPagesPerHost: number;
  relatedQueries: number;
  summaryLimit: number;
  agentModel?: string;
};

type ResearchInput = {
  query: string;
  sources: { title: string; url: string }[];
  maxChars: number;
  timeoutMs: number;
  totalTimeoutMs: number;
  maxPages: number;
  maxDepth: number;
  maxLinksPerPage: number;
  maxPagesPerHost: number;
};

type ResearchOutput = {
  query: string;
  collectedAt: string;
  sources: DeepResearchSource[];
  errors?: string[];
};

type ProgressHandler = (progress: DeepResearchProgress) => void;

type SandboxCommand = {
  outputFile: string;
  doneFile: string;
  pidFile: string;
};

const DEFAULT_MAX_DURATION_MS = 8 * 60 * 1000;

const sanitizeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
};

const dedupeSources = (sources: { title: string; url: string }[]) => {
  const seen = new Set<string>();
  const deduped: { title: string; url: string }[] = [];

  for (const source of sources) {
    const normalized = sanitizeUrl(source.url);
    if (!normalized) continue;
    const key = normalized.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ title: source.title, url: normalized });
  }

  return deduped;
};

const normalizeQuery = (value: string) => value.trim().replace(/\s+/g, ' ');

const buildRelatedQueries = (
  query: string,
  suggestions: string[],
  extraCount: number,
) => {
  if (extraCount <= 0) return [];
  const normalizedQuery = normalizeQuery(query);
  const seen = new Set([normalizedQuery.toLowerCase()]);
  const related: string[] = [];

  const add = (candidate: string) => {
    const trimmed = normalizeQuery(candidate);
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    related.push(trimmed);
  };

  for (const suggestion of suggestions) {
    if (related.length >= extraCount) break;
    add(suggestion);
  }

  const fallbackModifiers = [
    'overview',
    'analysis',
    'latest report',
    'statistics',
    'case study',
    'timeline',
    'trends',
  ];

  for (const modifier of fallbackModifiers) {
    if (related.length >= extraCount) break;
    add(`${normalizedQuery} ${modifier}`);
  }

  return related;
};

const buildResearchScript = () => {
  return [
    "import fs from 'node:fs/promises';",
    "import { chromium } from 'playwright';",
    '',
    'const inputPath = process.argv[2];',
    'const outputPath = process.argv[3] || "deep-research-output.json";',
    '',
    'const logProgress = (payload) => {',
    '  process.stdout.write(`__PROGRESS__${JSON.stringify(payload)}\\n`);',
    '};',
    '',
    'const cleanText = (value) => {',
    '  if (!value) return "";',
    '  return value.replace(/\\s+/g, " ").trim();',
    '};',
    '',
    'const truncateText = (value, maxChars) => {',
    '  if (!value) return "";',
    '  if (value.length <= maxChars) return value;',
    '  return value.slice(0, maxChars) + "...";',
    '};',
    '',
    'const normalizeUrl = (value) => {',
    '  try {',
    '    const parsed = new URL(value);',
    '    if (!["http:", "https:"].includes(parsed.protocol)) return null;',
    '    parsed.hash = "";',
    '    return parsed.toString();',
    '  } catch {',
    '    return null;',
    '  }',
    '};',
    '',
    'const isSkippableUrl = (value) =>',
    '  /\\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|7z|exe|dmg|mp4|mp3|wav|avi|mov|mkv|css|js|json|xml|rss|ics|csv|xls|xlsx|doc|docx|ppt|pptx)$/i.test(value);',
    '',
    'const getHostname = (value) => {',
    '  try {',
    '    return new URL(value).hostname;',
    '  } catch {',
    '    return "";',
    '  }',
    '};',
    '',
    'const isSameHost = (value, rootHost) => {',
    '  const host = getHostname(value);',
    '  if (!host || !rootHost) return false;',
    '  return host === rootHost || host.endsWith(`.${rootHost}`);',
    '};',
    '',
    'const autoScroll = async (page) => {',
    '  await page.evaluate(async () => {',
    '    await new Promise((resolve) => {',
    '      let totalHeight = 0;',
    '      const distance = 400;',
    '      const maxIterations = 25;',
    '      const maxDuration = 12000;',
    '      const start = Date.now();',
    '      let iterations = 0;',
    '      const timer = setInterval(() => {',
    '        const scrollHeight = document.body.scrollHeight;',
    '        window.scrollBy(0, distance);',
    '        totalHeight += distance;',
    '        iterations += 1;',
    '        if (totalHeight >= scrollHeight || iterations >= maxIterations || Date.now() - start > maxDuration) {',
    '          clearInterval(timer);',
    '          resolve(undefined);',
    '        }',
    '      }, 100);',
    '    });',
    '  });',
    '};',
    '',
    'const extractLinks = async (page) => {',
    '  return page.evaluate(() => {',
    '    return Array.from(document.querySelectorAll("a[href]"))',
    '      .map((link) => link.href)',
    '      .filter(Boolean);',
    '  });',
    '};',
    '',
    'const extractContent = async (page) => {',
    '  return page.evaluate(() => {',
    '    const title = document.title || "";',
    '    const description = document.querySelector("meta[name=description]")?.getAttribute("content") || "";',
    '    const bodyText = document.body ? document.body.innerText : "";',
    '    return { title, description, bodyText };',
    '  });',
    '};',
    '',
    'const run = async () => {',
    '  if (!inputPath) {',
    '    throw new Error("Missing input path");',
    '  }',
    '  const inputRaw = await fs.readFile(inputPath, "utf-8");',
    '  const input = JSON.parse(inputRaw);',
    '  const sources = Array.isArray(input.sources) ? input.sources : [];',
    '  const maxChars = Number.isFinite(input.maxChars) ? input.maxChars : 10000;',
    '  const timeoutMs = Number.isFinite(input.timeoutMs) ? input.timeoutMs : 45000;',
    '  const totalTimeoutMs = Number.isFinite(input.totalTimeoutMs) ? input.totalTimeoutMs : 480000;',
    '  const maxPages = Number.isFinite(input.maxPages) ? input.maxPages : sources.length;',
    '  const maxDepth = Number.isFinite(input.maxDepth) ? input.maxDepth : 1;',
    '  const maxLinksPerPage = Number.isFinite(input.maxLinksPerPage) ? input.maxLinksPerPage : 8;',
    '  const maxPagesPerHost = Number.isFinite(input.maxPagesPerHost) ? input.maxPagesPerHost : 6;',
    '  const results = [];',
    '  const errors = [];',
    '  const visited = new Set();',
    '  const hostCounts = new Map();',
    '  const queue = [];',
    '  const startTime = Date.now();',
    '',
    '  const enqueue = (value, depth, rootHost, seedTitle) => {',
    '    const normalized = normalizeUrl(value);',
    '    if (!normalized) return;',
    '    if (isSkippableUrl(normalized)) return;',
    '    const key = normalized.replace(/\\/$/, "");',
    '    if (visited.has(key)) return;',
    '    visited.add(key);',
    '    queue.push({ url: normalized, depth, rootHost, seedTitle });',
    '  };',
    '',
    '  for (const source of sources) {',
    '    const normalized = normalizeUrl(source.url);',
    '    if (!normalized) continue;',
    '    const rootHost = getHostname(normalized);',
    '    enqueue(normalized, 0, rootHost, source.title || "");',
    '  }',
    '',
    '  logProgress({ stage: "browser", status: "running", message: "Launching browser" });',
    '  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });',
    '  const context = await browser.newContext({',
    '    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",',
    '    viewport: { width: 1365, height: 768 },',
    '  });',
    '  const page = await context.newPage();',
    '  await page.route(/.*/, (route) => {',
    '    const type = route.request().resourceType();',
    '    if (["image", "media", "font"].includes(type)) {',
    '      route.abort();',
    '      return;',
    '    }',
    '    route.continue();',
    '  });',
    '  logProgress({ stage: "browser", status: "complete", message: "Browser ready" });',
    '',
    '  while (queue.length > 0 && results.length < maxPages) {',
    '    if (Date.now() - startTime > totalTimeoutMs) {',
    '      errors.push("Time limit reached before visiting all pages.");',
    '      break;',
    '    }',
    '    const current = queue.shift();',
    '    if (!current) break;',
    '    const host = getHostname(current.url);',
    '    if (!host) continue;',
    '    const hostCount = hostCounts.get(host) || 0;',
    '    if (hostCount >= maxPagesPerHost) {',
    '      continue;',
    '    }',
    '    hostCounts.set(host, hostCount + 1);',
    '    const step = results.length + 1;',
    '    logProgress({ stage: "crawl", status: "running", current: step, total: maxPages, url: current.url });',
    '    try {',
    '      await page.goto(current.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });',
    '      await page.waitForTimeout(1200);',
    '      await autoScroll(page);',
    '      const { title, description, bodyText } = await extractContent(page);',
    '      results.push({',
    '        title: cleanText(title || current.seedTitle || current.url),',
    '        url: current.url,',
    '        description: cleanText(description),',
    '        content: truncateText(cleanText(bodyText), maxChars),',
    '        status: "ok",',
    '      });',
    '',
    '      if (current.depth < maxDepth && results.length < maxPages) {',
    '        const rawLinks = await extractLinks(page);',
    '        const uniqueLinks = Array.from(new Set(rawLinks));',
    '        const filteredLinks = uniqueLinks',
    '          .map((link) => normalizeUrl(link))',
    '          .filter((link) => link && isSameHost(link, current.rootHost) && !isSkippableUrl(link));',
    '        const remainingSlots = maxPages - (results.length + queue.length);',
    '        const maxNewLinks = Math.min(maxLinksPerPage, remainingSlots);',
    '        for (let i = 0; i < filteredLinks.length && i < maxNewLinks; i += 1) {',
    '          enqueue(filteredLinks[i], current.depth + 1, current.rootHost, title);',
    '        }',
    '      }',
    '    } catch (err) {',
    '      const message = err && err.message ? err.message : String(err);',
    '      errors.push(`${current.url}: ${message}`);',
    '      results.push({',
    '        title: current.seedTitle || current.url,',
    '        url: current.url,',
    '        content: "",',
    '        status: "error",',
    '        error: message,',
    '      });',
    '    }',
    '  }',
    '',
    '  await page.close();',
    '  await context.close();',
    '  await browser.close();',
    '',
    '  logProgress({ stage: "crawl", status: "complete", message: "Crawl complete" });',
    '',
    '  const output = {',
    '    query: input.query || "",',
    '    collectedAt: new Date().toISOString(),',
    '    sources: results,',
    '    errors,',
    '  };',
    '  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");',
    '};',
    '',
    'run().catch((err) => {',
    '  const message = err && err.message ? err.message : String(err);',
    '  process.stderr.write(message);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
};

const escapeShellArg = (value: string) => {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
  return `"${escaped}"`;
};

const startBackgroundCommand = async (
  sandboxId: string,
  command: string,
  outputFile: string,
  doneFile: string,
  pidFile: string,
  env: Record<string, string> = {},
) => {
  const safeCommand = command.replace(/'/g, "'\\''");
  const run = `rm -f ${doneFile}; nohup sh -c '${safeCommand}; echo $? > ${doneFile}' > ${outputFile} 2>&1 & echo $! > ${pidFile}`;
  await execInSandbox(sandboxId, run, env, 10000);
};

const readOutputFromOffset = async (
  sandboxId: string,
  outputFile: string,
  offset: number,
) => {
  const separator = '__SANDY_OFFSET__';
  const result = await execInSandbox(
    sandboxId,
    `tail -c +${offset + 1} ${outputFile} 2>/dev/null; echo "${separator}"; wc -c < ${outputFile} 2>/dev/null`,
    {},
    5000,
  );
  const [contentPart, sizePart] = result.stdout.split(separator);
  const newOffset = sizePart ? parseInt(sizePart.trim(), 10) || offset : offset;
  return { content: contentPart || '', newOffset };
};

const isProcessRunning = async (sandboxId: string, doneFile: string) => {
  const result = await execInSandbox(
    sandboxId,
    `test -f ${doneFile} && echo "done" || echo "running"`,
    {},
    5000,
  );
  return result.stdout.trim() === 'running';
};

const getExitCode = async (sandboxId: string, doneFile: string) => {
  const result = await execInSandbox(
    sandboxId,
    `cat ${doneFile} 2>/dev/null || echo "1"`,
    {},
    5000,
  );
  return parseInt(result.stdout.trim(), 10) || 1;
};

const parseProgressLines = (
  lines: string[],
  onProgress: ProgressHandler,
  latestCounts: { current: number; total: number },
) => {
  const progressPrefix = '__PROGRESS__';
  for (const line of lines) {
    if (!line.trim().startsWith(progressPrefix)) continue;
    const payloadRaw = line.trim().slice(progressPrefix.length);
    try {
      const payload = JSON.parse(payloadRaw) as {
        stage?: string;
        status?: string;
        message?: string;
        current?: number;
        total?: number;
        url?: string;
      };
      if (payload.stage === 'crawl' && payload.current && payload.total) {
        latestCounts.current = payload.current;
        latestCounts.total = payload.total;
        const percent = Math.round((payload.current / payload.total) * 100);
        let detail: string | undefined;
        if (payload.url) {
          try {
            const hostname = new URL(payload.url).hostname;
            detail = `${hostname} (${payload.current}/${payload.total})`;
          } catch {
            detail = `Processing ${payload.current}/${payload.total}`;
          }
        } else {
          detail = `Processing ${payload.current}/${payload.total}`;
        }
        onProgress({
          id: 'crawl',
          label: 'Crawling pages',
          status: payload.status === 'complete' ? 'complete' : 'running',
          detail,
          percent,
        });
        continue;
      }
      if (payload.stage === 'browser') {
        onProgress({
          id: 'browser',
          label: 'Launching browser',
          status: payload.status === 'complete' ? 'complete' : 'running',
          detail: payload.message,
        });
      }
    } catch {
      continue;
    }
  }
};

const buildAgentPrompt = (
  query: string,
  sources: DeepResearchSource[],
  limit: number,
) => {
  const trimmedSources = sources
    .filter((source) => source.content)
    .slice(0, limit)
    .map((source) => {
      const trimmed = source.content.slice(0, 2000);
      return {
        title: source.title,
        url: source.url,
        content: trimmed,
      };
    });

  return [
    'You are a research analyst. Summarize the sources for the query below.',
    'Return ONLY valid JSON with this shape:',
    '{ "sources": [{ "title": string, "url": string, "summary": string, "keyPoints": string[] }], "overallInsights": string[] }',
    'Keep each summary under 120 words. Keep keyPoints to 3-5 bullets.',
    'Do not use tools or modify files. Do not include markdown fences.',
    '',
    `Query: ${query}`,
    '',
    'Sources:',
    JSON.stringify(trimmedSources, null, 2),
  ].join('\n');
};

const extractJson = (value: string) => {
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }
  const raw = value.slice(first, last + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const buildDocuments = (
  sources: DeepResearchSource[],
  summarizedSources?: { sources?: Array<{ url: string; summary?: string }> },
) => {
  const summaryMap = new Map<string, string>();
  summarizedSources?.sources?.forEach((item) => {
    if (item.url && item.summary) {
      summaryMap.set(item.url, item.summary);
    }
  });

  return sources
    .filter((source) => source.content || summaryMap.has(source.url))
    .map((source) => {
      const summary = summaryMap.get(source.url);
      const content = summary || source.content || '';
      return new Document({
        pageContent: `${source.title}\n${source.description || ''}\n${content}`.trim(),
        metadata: {
          title: source.title,
          url: source.url,
        },
      });
    });
};

export const runDeepResearchCollector = async (
  query: string,
  optimizationMode: 'speed' | 'balanced' | 'quality',
  deepResearchMode: DeepResearchMode,
  onProgress: ProgressHandler,
): Promise<{ docs: Document[]; sources: DeepResearchSource[] }> => {
  const modeDefaults = {
    light: {
      maxSources: 10,
      maxCharsPerSource: 8000,
      maxDurationMs: 12 * 60 * 1000,
      maxPages: 22,
      maxDepth: 1,
      maxLinksPerPage: 8,
      maxPagesPerHost: 4,
      relatedQueries: 1,
      summaryLimit: 12,
    },
    max: {
      maxSources: 18,
      maxCharsPerSource: 12000,
      maxDurationMs: 18 * 60 * 1000,
      maxPages: 48,
      maxDepth: 2,
      maxLinksPerPage: 12,
      maxPagesPerHost: 8,
      relatedQueries: 3,
      summaryLimit: 20,
    },
  } as const;

  const base = modeDefaults[deepResearchMode] ?? modeDefaults.light;
  const scale =
    optimizationMode === 'speed'
      ? 0.7
      : optimizationMode === 'quality'
        ? 1
        : 0.85;
  const durationScale =
    optimizationMode === 'speed'
      ? 0.7
      : optimizationMode === 'quality'
        ? 1.1
        : 0.9;
  const charsScale =
    optimizationMode === 'speed'
      ? 0.8
      : optimizationMode === 'quality'
        ? 1.1
        : 1;

  const scaleInt = (value: number, min: number) =>
    Math.max(min, Math.round(value * scale));

  const options: DeepResearchOptions = {
    maxSources: scaleInt(base.maxSources, 4),
    maxCharsPerSource: Math.max(
      4000,
      Math.round(base.maxCharsPerSource * charsScale),
    ),
    maxDurationMs: Math.max(
      DEFAULT_MAX_DURATION_MS,
      Math.round(base.maxDurationMs * durationScale),
    ),
    maxPages: scaleInt(base.maxPages, 8),
    maxDepth: Math.max(1, Math.round(base.maxDepth * scale)),
    maxLinksPerPage: scaleInt(base.maxLinksPerPage, 6),
    maxPagesPerHost: scaleInt(base.maxPagesPerHost, 3),
    relatedQueries: Math.max(0, Math.round(base.relatedQueries * scale)),
    summaryLimit: scaleInt(base.summaryLimit, 6),
    agentModel: process.env.SANDY_AGENT_MODEL || process.env.CHUTES_MODEL_NAME,
  };

  if (options.maxPages < options.maxSources) {
    options.maxPages = options.maxSources + 4;
  }

  onProgress({
    id: 'search',
    label: 'Finding sources',
    status: 'running',
    detail: 'Running initial search',
  });

  const searchRuns = [] as Awaited<ReturnType<typeof runWebSearch>>[];
  const primarySearch = await runWebSearch(query, []);
  searchRuns.push(primarySearch);

  const relatedQueries = buildRelatedQueries(
    query,
    primarySearch.suggestions || [],
    options.relatedQueries,
  );

  for (let i = 0; i < relatedQueries.length; i += 1) {
    onProgress({
      id: 'search',
      label: 'Finding sources',
      status: 'running',
      detail: `Running related search ${i + 1}/${relatedQueries.length}`,
    });
    const relatedSearch = await runWebSearch(relatedQueries[i], []);
    searchRuns.push(relatedSearch);
  }

  const combinedResults = searchRuns.flatMap((run) => run.results || []);
  const rankedSources = dedupeSources(
    combinedResults.map((result) => ({
      title: result.title || result.url,
      url: result.url,
    })),
  ).slice(0, options.maxSources);

  if (rankedSources.length === 0) {
    const searchError = searchRuns.map((run) => run.error).find(Boolean);
    onProgress({
      id: 'search',
      label: 'Finding sources',
      status: 'error',
      detail: searchError || 'No sources returned from search.',
    });
    return { docs: [], sources: [] };
  }

  onProgress({
    id: 'search',
    label: 'Finding sources',
    status: 'complete',
    detail: `${rankedSources.length} sources from ${searchRuns.length} searches`,
  });

  const fallbackSources: DeepResearchSource[] = [];
  const fallbackSeen = new Set<string>();
  for (const result of combinedResults) {
    const normalized = sanitizeUrl(result.url);
    if (!normalized) continue;
    const key = normalized.replace(/\/$/, '');
    if (fallbackSeen.has(key)) continue;
    fallbackSeen.add(key);
    fallbackSources.push({
      title: result.title || result.url,
      url: normalized,
      content: result.content || '',
      description: result.content || '',
      status: 'fallback',
    });
    if (fallbackSources.length >= options.maxSources) break;
  }

  let sandboxId: string | null = null;
  let sources: DeepResearchSource[] = [];

  try {
    onProgress({
      id: 'sandbox',
      label: 'Preparing sandbox',
      status: 'running',
    });

    const sandbox = await createSandbox();
    sandboxId = sandbox.sandboxId;
    if (!sandboxId) {
      throw new Error('Sandbox creation failed');
    }
    const activeSandboxId = sandboxId;

    const workingDir = '/workspace/deep-research';
    const cacheDir = `${workingDir}/.cache`;
    const localBrowserPath = `${cacheDir}/ms-playwright`;
    const basePlaywrightEnv = {
      XDG_CACHE_HOME: cacheDir,
      HOME: '/workspace',
    };
    const scriptPath = `${workingDir}/deep-research-runner.mjs`;
    const inputPath = `${workingDir}/input.json`;
    const outputPath = `${workingDir}/output.json`;

    const warmupAttempts = 4;
    for (let attempt = 1; attempt <= warmupAttempts; attempt += 1) {
      try {
        onProgress({
          id: 'sandbox',
          label: 'Preparing sandbox',
          status: 'running',
          detail: `Warming up (${attempt}/${warmupAttempts})`,
        });
        await execInSandbox(sandboxId, 'true', {}, 20000);
        break;
      } catch (error) {
        if (attempt === warmupAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }

    onProgress({
      id: 'sandbox',
      label: 'Preparing sandbox',
      status: 'complete',
    });

    await execInSandbox(
      sandboxId,
      `mkdir -p ${workingDir} ${cacheDir}`,
      {},
      10000,
    );

    let usePreinstalledPlaywright = false;
    let preinstalledBrowserPath = '';
    try {
      const envProbe = await execInSandbox(
        sandboxId,
        'printf "%s\\n%s\\n" "${SANDY_PLAYWRIGHT_READY:-}" "${SANDY_PLAYWRIGHT_BROWSERS_PATH:-}"',
        {},
        5000,
      );
      const [readyRaw, pathRaw] = envProbe.stdout.split('\n');
      if (readyRaw?.trim() === '1' && pathRaw?.trim()) {
        usePreinstalledPlaywright = true;
        preinstalledBrowserPath = pathRaw.trim();
      }
    } catch {
      // Ignore env probe failures and proceed with local installs.
    }

    const buildPlaywrightEnv = (browserPath: string, skipDownload: boolean) => ({
      ...basePlaywrightEnv,
      PLAYWRIGHT_BROWSERS_PATH: browserPath,
      ...(skipDownload ? { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } : {}),
    });

    let playwrightEnv = buildPlaywrightEnv(
      usePreinstalledPlaywright ? preinstalledBrowserPath : localBrowserPath,
      usePreinstalledPlaywright,
    );

    onProgress({
      id: 'setup',
      label: 'Installing Playwright',
      status: 'running',
      detail: usePreinstalledPlaywright
        ? 'Using preinstalled browser runtime.'
        : 'Installing browser dependencies.',
    });

    await execInSandbox(
      sandboxId,
      `cd ${workingDir} && if [ ! -f package.json ]; then npm init -y >/dev/null 2>&1; fi`,
      {},
      20000,
    );

    await execInSandbox(
      sandboxId,
      `cd ${workingDir} && if ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then npm install --no-audit --no-fund playwright@1.46.0; fi`,
      playwrightEnv,
      6 * 60 * 1000,
    );

    const attemptPlaywrightInstall = async (command: string) => {
      return execInSandbox(
        activeSandboxId,
        `cd ${workingDir} && ${command}`,
        playwrightEnv,
        6 * 60 * 1000,
      );
    };

    const depsPackages = [
      'libnss3',
      'libnspr4',
      'libdbus-1-3',
      'libatk1.0-0',
      'libatk-bridge2.0-0',
      'libcups2',
      'libdrm2',
      'libxkbcommon0',
      'libatspi2.0-0',
      'libxcomposite1',
      'libxdamage1',
      'libxfixes3',
      'libxrandr2',
      'libgbm1',
      'libasound2',
    ];

    const aptEnv = {
      DEBIAN_FRONTEND: 'noninteractive',
    };

    const runDepsInstall = async () =>
      execInSandbox(
        activeSandboxId,
        [
          'apt-get -o Dpkg::Lock::Timeout=120 update',
          `apt-get -o Dpkg::Lock::Timeout=120 install -y --no-install-recommends ${depsPackages.join(' ')}`,
        ].join(' && '),
        { ...playwrightEnv, ...aptEnv },
        10 * 60 * 1000,
      );

    const lockPattern = /lock-frontend|dpkg frontend lock|Unable to acquire the dpkg/i;
    const depsInstallAttempts = 3;

    const installPlaywrightDependencies = async () => {
      let depsInstallResult = await runDepsInstall();

      for (let attempt = 2; attempt <= depsInstallAttempts; attempt += 1) {
        if (depsInstallResult.exitCode === 0) break;
        const output = `${depsInstallResult.stdout || ''}\n${depsInstallResult.stderr || ''}`;
        if (!lockPattern.test(output)) break;
        await new Promise((resolve) => setTimeout(resolve, 20000 * attempt));
        depsInstallResult = await runDepsInstall();
      }

      return depsInstallResult;
    };

    const installChromium = async () => {
      onProgress({
        id: 'setup',
        label: 'Installing Playwright',
        status: 'running',
        detail: 'Downloading Chromium.',
      });

      return attemptPlaywrightInstall('npx playwright install chromium');
    };

    let depsInstallResult = { exitCode: 0 } as { exitCode: number };
    let browserInstallResult = { exitCode: 0 } as { exitCode: number };

    if (!usePreinstalledPlaywright) {
      depsInstallResult = await installPlaywrightDependencies();
      if (depsInstallResult.exitCode !== 0) {
        onProgress({
          id: 'setup',
          label: 'Installing Playwright',
          status: 'error',
          detail: 'Playwright dependencies failed to install. Using search snippets instead.',
        });
        const docs = buildDocuments(fallbackSources);
        return { docs, sources: fallbackSources };
      }

      browserInstallResult = await installChromium();
      if (browserInstallResult.exitCode !== 0) {
        onProgress({
          id: 'setup',
          label: 'Installing Playwright',
          status: 'error',
          detail: 'Playwright browser download failed. Using search snippets instead.',
        });
        const docs = buildDocuments(fallbackSources);
        return { docs, sources: fallbackSources };
      }
    }

    const verifyBrowserLaunch = async () =>
      execInSandbox(
        activeSandboxId,
        `cd ${workingDir} && node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true, args: ['--no-sandbox'] }).then(async b => { await b.close(); }).catch(err => { console.error(err.message); process.exit(1); })"`,
        playwrightEnv,
        120000,
      );

    onProgress({
      id: 'setup',
      label: 'Installing Playwright',
      status: 'running',
      detail: 'Verifying browser launch.',
    });

    let verifyResult = await verifyBrowserLaunch();

    if (verifyResult.exitCode !== 0 && usePreinstalledPlaywright) {
      onProgress({
        id: 'setup',
        label: 'Installing Playwright',
        status: 'running',
        detail: 'Preinstalled browser failed. Downloading a local copy.',
      });
      usePreinstalledPlaywright = false;
      playwrightEnv = buildPlaywrightEnv(localBrowserPath, false);

      depsInstallResult = await installPlaywrightDependencies();
      if (depsInstallResult.exitCode === 0) {
        browserInstallResult = await installChromium();
        if (browserInstallResult.exitCode === 0) {
          verifyResult = await verifyBrowserLaunch();
        }
      }
    }

    if (verifyResult.exitCode !== 0) {
      onProgress({
        id: 'setup',
        label: 'Installing Playwright',
        status: 'error',
        detail: 'Playwright browser launch failed. Using search snippets instead.',
      });
      const docs = buildDocuments(fallbackSources);
      return { docs, sources: fallbackSources };
    }

    onProgress({
      id: 'setup',
      label: 'Installing Playwright',
      status: 'complete',
    });

    const input: ResearchInput = {
      query,
      sources: rankedSources,
      maxChars: options.maxCharsPerSource,
      timeoutMs: 45000,
      totalTimeoutMs: Math.max(60000, options.maxDurationMs - 30000),
      maxPages: options.maxPages,
      maxDepth: options.maxDepth,
      maxLinksPerPage: options.maxLinksPerPage,
      maxPagesPerHost: options.maxPagesPerHost,
    };

    await writeSandboxFile(sandboxId, scriptPath, buildResearchScript());
    await writeSandboxFile(sandboxId, inputPath, JSON.stringify(input, null, 2));

    onProgress({
      id: 'crawl',
      label: 'Crawling pages',
      status: 'running',
    });

    const sandboxCommand: SandboxCommand = {
      outputFile: `${workingDir}/research.log`,
      doneFile: `${workingDir}/research.done`,
      pidFile: `${workingDir}/research.pid`,
    };

    const runCommand = `cd ${workingDir} && node ${escapeShellArg(scriptPath)} ${escapeShellArg(inputPath)} ${escapeShellArg(outputPath)}`;
    await startBackgroundCommand(
      sandboxId,
      runCommand,
      sandboxCommand.outputFile,
      sandboxCommand.doneFile,
      sandboxCommand.pidFile,
      playwrightEnv,
    );

    let offset = 0;
    const counts = { current: 0, total: options.maxPages };
    const start = Date.now();

    while (await isProcessRunning(sandboxId, sandboxCommand.doneFile)) {
      const { content, newOffset } = await readOutputFromOffset(
        sandboxId,
        sandboxCommand.outputFile,
        offset,
      );
      offset = newOffset;
      if (content) {
        const lines = content.split('\n');
        parseProgressLines(lines, onProgress, counts);
      }
      if (Date.now() - start > options.maxDurationMs) {
        onProgress({
          id: 'crawl',
          label: 'Crawling pages',
          status: 'error',
          detail: 'Research timed out. Returning partial results.',
        });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    const exitCode = await getExitCode(sandboxId, sandboxCommand.doneFile);

    let outputRaw = '';
    try {
      outputRaw = await readSandboxFile(sandboxId, outputPath);
    } catch {
      onProgress({
        id: 'crawl',
        label: 'Crawling pages',
        status: 'error',
        detail: 'Crawler output was unavailable. Using fallback extracts.',
      });
    }
    let output: ResearchOutput = {
      query,
      collectedAt: new Date().toISOString(),
      sources: [],
    };
    try {
      if (outputRaw) {
        output = JSON.parse(outputRaw) as ResearchOutput;
      }
    } catch {
      onProgress({
        id: 'crawl',
        label: 'Crawling pages',
        status: 'error',
        detail: 'Crawler output was not readable. Using fallback extracts.',
      });
    }
    sources = output.sources || [];
    const usedFallback =
      sources.length === 0 && fallbackSources.length > 0;
    if (usedFallback) {
      sources = fallbackSources;
    }

    if (exitCode !== 0) {
      const detail =
        sources.length > 0
          ? usedFallback
            ? 'Crawler failed, using search snippets.'
            : 'Crawler returned partial results.'
          : `Crawler exited with code ${exitCode}.`;
      onProgress({
        id: 'crawl',
        label: 'Crawling pages',
        status: sources.length > 0 ? 'complete' : 'error',
        detail,
      });
    } else {
      onProgress({
        id: 'crawl',
        label: 'Crawling pages',
        status: 'complete',
      });
    }

    let summarizedSources: { sources?: Array<{ url: string; summary?: string }> } | null = null;
    const agentApiKey = process.env.CHUTES_API_KEY;
    const agentModel = options.agentModel?.trim();
    const summarySkipReason = !agentApiKey
      ? 'Missing CHUTES_API_KEY'
      : !agentModel
        ? 'Missing SANDY_AGENT_MODEL'
        : null;

    if (sources.length > 0 && summarySkipReason) {
      onProgress({
        id: 'analysis',
        label: 'Synthesizing notes',
        status: 'complete',
        detail: `Skipped: ${summarySkipReason}.`,
      });
    }

    if (sources.length > 0 && agentApiKey && agentModel) {
      onProgress({
        id: 'analysis',
        label: 'Synthesizing notes',
        status: 'running',
      });

      const agentPrompt = buildAgentPrompt(
        query,
        sources,
        Math.min(options.summaryLimit, sources.length),
      );
      const promptPath = `${workingDir}/agent-prompt.txt`;
      const agentOutputPath = `${workingDir}/agent-output.txt`;
      const agentScriptPath = `${workingDir}/run-agent.sh`;

      await writeSandboxFile(sandboxId, promptPath, agentPrompt);
      const agentScript = [
        '#!/bin/sh',
        'set -e',
        'PROMPT="$(cat ' + promptPath + ')"',
        `claude -p --output-format text --no-session-persistence --model "${agentModel}" "$PROMPT" > ${agentOutputPath}`,
        '',
      ].join('\n');
      await writeSandboxFile(sandboxId, agentScriptPath, agentScript);
      await execInSandbox(
        sandboxId,
        `chmod +x ${agentScriptPath} && ${agentScriptPath}`,
        {
          ANTHROPIC_BASE_URL: 'https://claude.chutes.ai',
          ANTHROPIC_AUTH_TOKEN: agentApiKey,
          ANTHROPIC_API_KEY: agentApiKey,
          API_TIMEOUT_MS: '600000',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          NO_COLOR: '1',
          TERM: 'dumb',
        },
        4 * 60 * 1000,
      );

      const agentOutput = await readSandboxFile(sandboxId, agentOutputPath);
      summarizedSources = extractJson(agentOutput) as {
        sources?: Array<{ url: string; summary?: string }>;
      } | null;

      const summaryErrorDetail = agentOutput.includes('not found')
        ? 'Agent model not available. Check SANDY_AGENT_MODEL.'
        : 'Agent summary unavailable, using raw extracts.';

      onProgress({
        id: 'analysis',
        label: 'Synthesizing notes',
        status: summarizedSources ? 'complete' : 'error',
        detail: summarizedSources ? undefined : summaryErrorDetail,
      });
    }

    const docs = buildDocuments(sources, summarizedSources || undefined);

    return { docs, sources };
  } finally {
    if (sandboxId) {
      onProgress({
        id: 'cleanup',
        label: 'Cleaning up sandbox',
        status: 'running',
      });
      await terminateSandbox(sandboxId).catch(() => undefined);
      onProgress({
        id: 'cleanup',
        label: 'Cleaning up sandbox',
        status: 'complete',
      });
    }
  }
};
