import { Document } from '@langchain/core/documents';
import { runWebSearch } from './runWebSearch';
import { anonymizeLogText, logEvent, serializeError } from '@/lib/eventLog';
import {
  createSandbox,
  execInSandbox,
  getSandboxStatus,
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
  runId: string;
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
  runId?: string;
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

type CollectorLogContext = {
  correlationId?: string;
  agentApiKey?: string;
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

const normalizeHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

const getPathname = (url: string) => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
};

const tokenizeForScore = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const QUERY_FACET_LIMIT = 12;
const LOW_SIGNAL_HOST_RE =
  /(^|\.)((facebook|instagram|linkedin|x|twitter|youtube|tiktok|pinterest|reddit)\.com)$/i;
const LOW_SIGNAL_PATH_RE =
  /\/(login|signup|register|privacy|terms|cookies?|search|tag|tags|category|categories|account|checkout|cart|wp-admin)\b/i;
const EVIDENCE_TEXT_RE =
  /\b(data|evidence|official|methodology|report|analysis|research|study|paper|survey|dataset|guideline|findings)\b/i;

const keywordOverlapScore = (queryTokens: string[], text: string) => {
  if (queryTokens.length === 0 || !text) return 0;
  const textTokens = new Set(tokenizeForScore(text));
  if (textTokens.size === 0) return 0;
  let matches = 0;
  queryTokens.forEach((token) => {
    if (textTokens.has(token)) matches += 1;
  });
  return matches / queryTokens.length;
};

const rankSeedSources = (
  query: string,
  sources: Array<{ title?: string; url: string; content?: string }>,
  limit: number,
  mode: DeepResearchMode,
) => {
  const queryTokens = tokenizeForScore(query);
  const coverageTargets = queryTokens.slice(0, QUERY_FACET_LIMIT);
  const bestByUrl = new Map<
    string,
    { title: string; url: string; host: string; score: number; coverage: string[] }
  >();

  for (const source of sources) {
    const normalized = sanitizeUrl(source.url);
    if (!normalized) continue;
    const key = normalized.replace(/\/$/, '');
    const title = normalizeQuery(source.title || source.url || normalized);
    const snippet = normalizeQuery(source.content || '');
    const host = normalizeHost(normalized);
    const path = getPathname(normalized);
    const fullText = `${title} ${snippet}`;
    const relevance = keywordOverlapScore(queryTokens, fullText);
    const textTokens = new Set(tokenizeForScore(fullText));
    const coverage = coverageTargets.filter((token) => textTokens.has(token));

    let score = relevance * 5.5;
    score += Math.min(2.2, snippet.length / 280);
    if (EVIDENCE_TEXT_RE.test(title) || EVIDENCE_TEXT_RE.test(snippet)) {
      score += 0.9;
    }
    if (!snippet) score -= 0.45;
    if (LOW_SIGNAL_PATH_RE.test(path)) score -= 1.4;
    if (LOW_SIGNAL_HOST_RE.test(host)) score -= 1.0;
    score -= Math.min(1.2, Math.max(0, path.split('/').filter(Boolean).length - 6) * 0.25);

    const existing = bestByUrl.get(key);
    if (!existing || score > existing.score) {
      bestByUrl.set(key, { title, url: normalized, host, score, coverage });
    }
  }

  const sorted = Array.from(bestByUrl.values()).sort((a, b) => b.score - a.score);
  const hostCap = mode === 'max' ? 3 : 2;
  const selected: { title: string; url: string }[] = [];
  const selectedSet = new Set<string>();
  const hostCounts = new Map<string, number>();
  const coveredFacets = new Set<string>();

  if (coverageTargets.length > 0) {
    for (const source of sorted) {
      if (selected.length >= limit) break;
      const hostKey = source.host || '';
      const hostCount = hostCounts.get(hostKey) || 0;
      if (hostKey && hostCount >= hostCap) continue;
      const freshCoverage = source.coverage.filter((token) => !coveredFacets.has(token));
      if (freshCoverage.length === 0) continue;
      selected.push({ title: source.title, url: source.url });
      selectedSet.add(source.url.replace(/\/$/, ''));
      if (hostKey) hostCounts.set(hostKey, hostCount + 1);
      freshCoverage.forEach((token) => coveredFacets.add(token));
    }
  }

  for (const source of sorted) {
    if (selected.length >= limit) break;
    const hostKey = source.host || '';
    const hostCount = hostCounts.get(hostKey) || 0;
    if (hostKey && hostCount >= hostCap) continue;
    selected.push({ title: source.title, url: source.url });
    selectedSet.add(source.url.replace(/\/$/, ''));
    if (hostKey) hostCounts.set(hostKey, hostCount + 1);
  }

  if (selected.length < limit) {
    for (const source of sorted) {
      if (selected.length >= limit) break;
      const key = source.url.replace(/\/$/, '');
      if (selectedSet.has(key)) continue;
      selected.push({ title: source.title, url: source.url });
      selectedSet.add(key);
    }
  }

  return dedupeSources(selected).slice(0, limit);
};

const rankCollectedSources = (
  query: string,
  sources: DeepResearchSource[],
  limit: number,
  mode: DeepResearchMode,
) => {
  const queryTokens = tokenizeForScore(query);
  const coverageTargets = queryTokens.slice(0, QUERY_FACET_LIMIT);
  const bestByUrl = new Map<
    string,
    DeepResearchSource & { __host: string; __score: number; __coverage: string[] }
  >();

  for (const source of sources) {
    const normalized = sanitizeUrl(source.url);
    if (!normalized) continue;
    const key = normalized.replace(/\/$/, '');
    const title = normalizeQuery(source.title || normalized);
    const description = normalizeQuery(source.description || '');
    const content = normalizeQuery(source.content || '');
    const host = normalizeHost(normalized);
    const path = getPathname(normalized);
    const fullText = `${title} ${description} ${content.slice(0, 2800)}`;
    const relevance = keywordOverlapScore(
      queryTokens,
      fullText,
    );
    const textTokens = new Set(tokenizeForScore(fullText));
    const coverage = coverageTargets.filter((token) => textTokens.has(token));

    let score = relevance * 6.5;
    score += Math.min(3.2, content.length / 1800);
    score += Math.min(1.2, description.length / 360);
    if (source.status === 'ok') score += 1.5;
    if (source.status === 'fallback') score += 0.5;
    if (source.status === 'error') score -= 3.0;
    if (!content) score -= 1.8;
    if (content.length > 0 && content.length < 350) score -= 0.8;
    if (EVIDENCE_TEXT_RE.test(title) || EVIDENCE_TEXT_RE.test(description)) {
      score += 0.9;
    }
    if (LOW_SIGNAL_PATH_RE.test(path)) score -= 1.6;
    if (LOW_SIGNAL_HOST_RE.test(host)) score -= 1.1;

    const candidate: DeepResearchSource & {
      __host: string;
      __score: number;
      __coverage: string[];
    } = {
      ...source,
      title,
      url: normalized,
      __host: host,
      __score: score,
      __coverage: coverage,
    };

    const existing = bestByUrl.get(key);
    if (!existing || candidate.__score > existing.__score) {
      bestByUrl.set(key, candidate);
    }
  }

  const sorted = Array.from(bestByUrl.values()).sort((a, b) => b.__score - a.__score);
  const hostCap = mode === 'max' ? 4 : 3;
  const selected: Array<
    DeepResearchSource & { __host: string; __score: number; __coverage: string[] }
  > = [];
  const selectedSet = new Set<string>();
  const hostCounts = new Map<string, number>();
  const coveredFacets = new Set<string>();

  if (coverageTargets.length > 0) {
    for (const source of sorted) {
      if (selected.length >= limit) break;
      const key = source.url.replace(/\/$/, '');
      const host = source.__host;
      const hostCount = hostCounts.get(host) || 0;
      if (host && hostCount >= hostCap) continue;
      if (source.status === 'error') continue;
      const freshCoverage = source.__coverage.filter((token) => !coveredFacets.has(token));
      if (freshCoverage.length === 0) continue;
      selected.push(source);
      selectedSet.add(key);
      if (host) hostCounts.set(host, hostCount + 1);
      freshCoverage.forEach((token) => coveredFacets.add(token));
    }
  }

  for (const source of sorted) {
    if (selected.length >= limit) break;
    const key = source.url.replace(/\/$/, '');
    const host = source.__host;
    const hostCount = hostCounts.get(host) || 0;
    if (host && hostCount >= hostCap) continue;
    if (source.status === 'error') continue;
    selected.push(source);
    selectedSet.add(key);
    if (host) hostCounts.set(host, hostCount + 1);
  }

  if (selected.length < limit) {
    for (const source of sorted) {
      if (selected.length >= limit) break;
      const key = source.url.replace(/\/$/, '');
      if (selectedSet.has(key)) continue;
      selected.push(source);
      selectedSet.add(key);
    }
  }

  return selected
    .slice(0, limit)
    .map(
      ({
        __host: _ignoredHost,
        __score: _ignoredScore,
        __coverage: _ignoredCoverage,
        ...source
      }) => source,
    );
};

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
    'const stripHtml = (html) => {',
    '  if (!html) return "";',
    '  const withoutScripts = html',
    '    .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, " ")',
    '    .replace(/<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>/gi, " ");',
    '  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");',
    '  return cleanText(withoutTags);',
    '};',
    '',
    'const extractMeta = (html, pattern) => {',
    '  const match = html.match(pattern);',
    '  return cleanText(match?.[1] || "");',
    '};',
    '',
    'const fetchPageContent = async (url, maxChars) => {',
    '  const res = await fetch(url, {',
    '    redirect: "follow",',
    '    headers: {',
    '      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",',
    '      "accept-language": "en-US,en;q=0.9",',
    '    },',
    '  });',
    '  if (!res.ok) {',
    '    throw new Error(`HTTP ${res.status}`);',
    '  }',
    '  const contentType = (res.headers.get("content-type") || "").toLowerCase();',
    '  if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml+xml")) {',
    '    throw new Error(`Unsupported content type: ${contentType}`);',
    '  }',
    '  const html = await res.text();',
    '  const title =',
    '    extractMeta(html, /<title[^>]*>([\\s\\S]*?)<\\/title>/i) ||',
    '    extractMeta(html, /<meta[^>]+property=["\\\']og:title["\\\'][^>]+content=["\\\']([\\s\\S]*?)["\\\']/i);',
    '  const description =',
    '    extractMeta(html, /<meta[^>]+name=["\\\']description["\\\'][^>]+content=["\\\']([\\s\\S]*?)["\\\']/i) ||',
    '    extractMeta(html, /<meta[^>]+property=["\\\']og:description["\\\'][^>]+content=["\\\']([\\s\\S]*?)["\\\']/i);',
    '  const bodyText = stripHtml(html);',
    '  return {',
    '    title: cleanText(title),',
    '    description: cleanText(description),',
    '    content: truncateText(bodyText, maxChars),',
    '  };',
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
	    '  let browser;',
	    '  let context;',
	    '  let page;',
	    '',
	    '  try {',
	    '    logProgress({ stage: "browser", status: "running", message: "Launching browser" });',
	    '    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });',
	    '    context = await browser.newContext({',
	    '      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",',
	    '      viewport: { width: 1365, height: 768 },',
	    '    });',
	    '    page = await context.newPage();',
	    '    await page.route(/.*/, (route) => {',
	    '      const type = route.request().resourceType();',
	    '      if (["image", "media", "font"].includes(type)) {',
	    '        route.abort();',
	    '        return;',
	    '      }',
	    '      route.continue();',
	    '    });',
	    '    logProgress({ stage: "browser", status: "complete", message: "Browser ready" });',
	    '',
	    '    while (queue.length > 0 && results.length < maxPages) {',
	    '      if (Date.now() - startTime > totalTimeoutMs) {',
	    '        errors.push("Time limit reached before visiting all pages.");',
	    '        break;',
	    '      }',
	    '      const current = queue.shift();',
	    '      if (!current) break;',
	    '      const host = getHostname(current.url);',
	    '      if (!host) continue;',
	    '      const hostCount = hostCounts.get(host) || 0;',
	    '      if (hostCount >= maxPagesPerHost) {',
	    '        continue;',
	    '      }',
	    '      hostCounts.set(host, hostCount + 1);',
	    '      const step = results.length + 1;',
	    '      logProgress({ stage: "crawl", status: "running", current: step, total: maxPages, url: current.url });',
	    '      try {',
	    '        await page.goto(current.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });',
	    '        await page.waitForTimeout(1200);',
	    '        await autoScroll(page);',
	    '        const { title, description, bodyText } = await extractContent(page);',
	    '        let normalizedContent = truncateText(cleanText(bodyText), maxChars);',
	    '        let normalizedTitle = cleanText(title || current.seedTitle || current.url);',
	    '        let normalizedDescription = cleanText(description);',
	    '',
	    '        if (!normalizedContent || normalizedContent.length < 320) {',
	    '          try {',
	    '            const fetched = await fetchPageContent(current.url, maxChars);',
	    '            if (fetched.content && fetched.content.length > normalizedContent.length) {',
	    '              normalizedContent = fetched.content;',
	    '              normalizedTitle = cleanText(fetched.title || normalizedTitle || current.url);',
	    '              normalizedDescription = cleanText(fetched.description || normalizedDescription);',
	    '            }',
	    '          } catch {',
	    '            // Ignore fetch fallback errors here; we still keep browser extraction.',
	    '          }',
	    '        }',
	    '',
	    '        results.push({',
	    '          title: normalizedTitle,',
	    '          url: current.url,',
	    '          description: normalizedDescription,',
	    '          content: normalizedContent,',
	    '          status: "ok",',
	    '        });',
	    '',
	    '        if (current.depth < maxDepth && results.length < maxPages) {',
	    '          const rawLinks = await extractLinks(page);',
	    '          const uniqueLinks = Array.from(new Set(rawLinks));',
	    '          const filteredLinks = uniqueLinks',
	    '            .map((link) => normalizeUrl(link))',
	    '            .filter((link) => link && isSameHost(link, current.rootHost) && !isSkippableUrl(link));',
	    '          const remainingSlots = maxPages - (results.length + queue.length);',
	    '          const maxNewLinks = Math.min(maxLinksPerPage, remainingSlots);',
	    '          for (let i = 0; i < filteredLinks.length && i < maxNewLinks; i += 1) {',
	    '            enqueue(filteredLinks[i], current.depth + 1, current.rootHost, title);',
	    '          }',
	    '        }',
	    '      } catch (err) {',
	    '        const message = err && err.message ? err.message : String(err);',
	    '        try {',
	    '          const fetched = await fetchPageContent(current.url, maxChars);',
	    '          if (fetched.content) {',
	    '            results.push({',
	    '              title: cleanText(fetched.title || current.seedTitle || current.url),',
	    '              url: current.url,',
	    '              description: cleanText(fetched.description),',
	    '              content: fetched.content,',
	    '              status: "ok",',
	    '            });',
	    '            errors.push(`${current.url}: Browser navigation failed (${message}); recovered via HTTP fetch.`);',
	    '            continue;',
	    '          }',
	    '        } catch (fetchErr) {',
	    '          const fetchMessage = fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr);',
	    '          errors.push(`${current.url}: Browser navigation failed (${message}); HTTP fetch failed (${fetchMessage}).`);',
	    '        }',
	    '        errors.push(`${current.url}: ${message}`);',
	    '        results.push({',
	    '          title: current.seedTitle || current.url,',
	    '          url: current.url,',
	    '          content: "",',
	    '          status: "error",',
	    '          error: message,',
	    '        });',
	    '      }',
	    '    }',
	    '  } catch (err) {',
	    '    const message = err && err.message ? err.message : String(err);',
	    '    errors.push(message);',
	    '  } finally {',
	    '    const safeClose = async (name, fn) => {',
	    '      try {',
	    '        await fn();',
	    '      } catch (err) {',
	    '        const message = err && err.message ? err.message : String(err);',
	    '        errors.push(`${name}: ${message}`);',
	    '      }',
	    '    };',
	    '    if (page) await safeClose("page.close", () => page.close());',
	    '    if (context) await safeClose("context.close", () => context.close());',
	    '    if (browser) await safeClose("browser.close", () => browser.close());',
	    '  }',
	    '',
	    '  logProgress({ stage: "crawl", status: "complete", message: "Crawl complete" });',
	    '',
	    '  const output = {',
	    '    runId: input.runId || "",',
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
  // Use `test -s ${doneFile}` to detect completion, so we can keep the file
  // empty while running and avoid relying on `rm` (which can fail under heavy load).
  const run = `nohup sh -c ': > ${doneFile}; ${safeCommand}; echo $? > ${doneFile}' > ${outputFile} 2>&1 & echo $! > ${pidFile}`;
  const result = await execInSandbox(sandboxId, run, env, 10000);
  if (result.exitCode !== 0) {
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(
      combined
        ? `Failed to start crawler process: ${combined}`
        : 'Failed to start crawler process',
    );
  }
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
    `test -s ${doneFile} && echo "done" || echo "running"`,
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
  ctx: CollectorLogContext = {},
): Promise<{ docs: Document[]; sources: DeepResearchSource[] }> => {
  const correlationId = ctx.correlationId;
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
      maxPages: 44,
      maxDepth: 2,
      maxLinksPerPage: 10,
      maxPagesPerHost: 6,
      relatedQueries: 4,
      summaryLimit: 18,
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
    agentModel: process.env.SANDY_AGENT_MODEL,
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
  const rankedSources = rankSeedSources(
    query,
    combinedResults.map((result) => ({
      title: result.title || result.url,
      url: result.url,
      content: result.content,
    })),
    options.maxSources,
    deepResearchMode,
  );

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
  const fallbackByUrl = new Map<string, (typeof combinedResults)[number]>();
  for (const result of combinedResults) {
    const normalized = sanitizeUrl(result.url);
    if (!normalized) continue;
    const key = normalized.replace(/\/$/, '');
    if (!fallbackByUrl.has(key)) {
      fallbackByUrl.set(key, result);
    }
  }
  const fallbackPriority = [
    ...rankedSources
      .map((source) => fallbackByUrl.get(source.url.replace(/\/$/, '')))
      .filter((item): item is (typeof combinedResults)[number] => Boolean(item)),
    ...combinedResults,
  ];
  const fallbackSeen = new Set<string>();
  for (const result of fallbackPriority) {
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

    const warmupAttempts = 5;
    for (let attempt = 1; attempt <= warmupAttempts; attempt += 1) {
      try {
        onProgress({
          id: 'sandbox',
          label: 'Preparing sandbox',
          status: 'running',
          detail: `Warming up (${attempt}/${warmupAttempts})`,
        });
        // First check sandbox health via API
        const { healthy } = await getSandboxStatus(sandboxId);
        if (!healthy && attempt < warmupAttempts) {
          throw new Error('Sandbox not ready yet');
        }
        // Then verify we can execute commands
        await execInSandbox(sandboxId, 'true', {}, 30000);
        break;
      } catch (error: any) {
        const is502 = error?.message?.includes('502') || error?.message?.includes('Upstream error');
        if (attempt === warmupAttempts) {
          const errorMsg = is502
            ? 'Sandy sandbox is not responding (502). The server may be under heavy load.'
            : error?.message || 'Unknown error';
          throw new Error(`Sandbox warmup failed: ${errorMsg}`);
        }
        // Exponential backoff with jitter
        const baseDelay = 2000 * attempt;
        const jitter = Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
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
      label: 'Installing Browser',
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
        label: 'Installing Browser',
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
          label: 'Installing Browser',
          status: 'error',
          detail:
            'Browser dependencies failed to install. Using search snippets instead.',
        });
        const docs = buildDocuments(fallbackSources);
        return { docs, sources: fallbackSources };
      }

      browserInstallResult = await installChromium();
      if (browserInstallResult.exitCode !== 0) {
        onProgress({
          id: 'setup',
          label: 'Installing Browser',
          status: 'error',
          detail: 'Browser download failed. Using search snippets instead.',
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
      label: 'Installing Browser',
      status: 'running',
      detail: 'Verifying browser launch.',
    });

    let verifyResult = await verifyBrowserLaunch();

    if (verifyResult.exitCode !== 0 && usePreinstalledPlaywright) {
      onProgress({
        id: 'setup',
        label: 'Installing Browser',
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
        label: 'Installing Browser',
        status: 'error',
        detail: 'Browser launch failed. Using search snippets instead.',
      });
      const docs = buildDocuments(fallbackSources);
      return { docs, sources: fallbackSources };
    }

    onProgress({
      id: 'setup',
      label: 'Installing Browser',
      status: 'complete',
    });

    const collectorRunId =
      correlationId ??
      `collector_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const input: ResearchInput = {
      runId: collectorRunId,
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

    const runCommand = `cd ${workingDir} && : > ${outputPath} && node ${escapeShellArg(scriptPath)} ${escapeShellArg(inputPath)} ${escapeShellArg(outputPath)}`;
    await startBackgroundCommand(
      sandboxId,
      runCommand,
      sandboxCommand.outputFile,
      sandboxCommand.doneFile,
      sandboxCommand.pidFile,
      playwrightEnv,
    );

    let offset = 0;
    let crawlTimedOut = false;
    const counts = { current: 0, total: options.maxPages };
    const start = Date.now();
    const crawlerLogTail: string[] = [];
    const pushCrawlerLogTail = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('__PROGRESS__')) return;
      crawlerLogTail.push(trimmed.slice(0, 400));
      const maxLines = 80;
      if (crawlerLogTail.length > maxLines) {
        crawlerLogTail.splice(0, crawlerLogTail.length - maxLines);
      }
    };

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
        for (const line of lines) pushCrawlerLogTail(line);
      }
      if (Date.now() - start > options.maxDurationMs) {
        crawlTimedOut = true;
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
    // Read any remaining crawler log output after the process exits.
    try {
      const { content, newOffset } = await readOutputFromOffset(
        sandboxId,
        sandboxCommand.outputFile,
        offset,
      );
      offset = newOffset;
      if (content) {
        const lines = content.split('\n');
        parseProgressLines(lines, onProgress, counts);
        for (const line of lines) pushCrawlerLogTail(line);
      }
    } catch {
      // Ignore tail read failures.
    }

    const getFileSize = async (path: string) => {
      const result = await execInSandbox(
        activeSandboxId,
        `wc -c < ${path} 2>/dev/null || echo 0`,
        {},
        15000,
      );
      const parsed = parseInt(result.stdout.trim(), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const readFileChunked = async (path: string, size: number) => {
      const chunkSize = 48 * 1024;
      let offset = 0;
      let raw = '';

      while (offset < size) {
        const count = Math.min(chunkSize, size - offset);
        const chunk = await execInSandbox(
          activeSandboxId,
          `dd if=${path} bs=1 skip=${offset} count=${count} 2>/dev/null`,
          {},
          20000,
        );
        if (chunk.exitCode !== 0) {
          const combined = `${chunk.stdout || ''}\n${chunk.stderr || ''}`.trim();
          throw new Error(
            combined
              ? `Failed to read sandbox file chunk: ${combined}`
              : 'Failed to read sandbox file chunk',
          );
        }
        raw += chunk.stdout || '';
        offset += count;
        if (!chunk.stdout) break;
      }

      return raw;
    };

    let outputRaw = '';
    let outputReadError: unknown = null;
    let outputReadFailed = false;
    let outputParseFailed = false;
    let outputNonJson = false;
    try {
      outputRaw = await readSandboxFile(sandboxId, outputPath);
    } catch (err) {
      outputReadError = err;
      outputReadFailed = true;

      let outputFileSize = 0;
      try {
        outputFileSize = await getFileSize(outputPath);
      } catch {
        outputFileSize = 0;
      }

      // Fallback: read the file via the exec endpoint (sometimes more reliable than files/read).
      try {
        if (outputFileSize > 0) {
          outputRaw = await readFileChunked(outputPath, outputFileSize);
        } else {
          const cat = await execInSandbox(
            sandboxId,
            `cat ${outputPath} 2>/dev/null || true`,
            {},
            20000,
          );
          if (cat.stdout?.trim()) {
            outputRaw = cat.stdout;
          }
        }
      } catch {
        // ignore
      }

      if (!outputRaw?.trim()) {
        onProgress({
          id: 'crawl',
          label: 'Crawling pages',
          status: 'error',
          detail: 'Crawler output was unavailable. Using fallback extracts.',
        });
      }

      // Emit anonymized diagnostic info for debugging.
      if (correlationId) {
        let workspaceListing = '';
        try {
          const listing = await execInSandbox(
            sandboxId,
            `ls -la ${workingDir} 2>/dev/null | tail -n 200`,
            {},
            20000,
          );
          workspaceListing = listing.stdout || '';
        } catch {
          // ignore
        }

        logEvent({
          level: 'error',
          event: 'deep_research.crawl_output_read_failed',
          correlationId,
          metadata: {
            exitCode,
            crawled: counts.current,
            planned: counts.total,
            recoveredViaExec: Boolean(outputRaw),
            error: serializeError(outputReadError),
            workspace: workspaceListing
              ? anonymizeLogText(workspaceListing)
              : undefined,
          },
        });
      }
    }
    let outputParsedOk = false;
    let output: ResearchOutput = {
      query,
      collectedAt: new Date().toISOString(),
      sources: [],
    };
    if (outputRaw) {
      let parsed: ResearchOutput | null = null;
      let parseError: unknown = null;

      const trimmedRaw = outputRaw.trimStart();
      if (!trimmedRaw.startsWith('{')) {
        outputNonJson = true;
        parseError = new Error('Crawler output did not contain JSON');
      } else {
        try {
          parsed = JSON.parse(outputRaw) as ResearchOutput;
        } catch (err) {
          outputParseFailed = true;
          parseError = err;
        }
      }

      if (!parsed) {
        // The Sandy files API sometimes truncates larger files. If parsing fails,
        // attempt a chunked read via exec and parse again.
        try {
          const outputFileSize = await getFileSize(outputPath);
          if (outputFileSize > 0) {
            const chunked = await readFileChunked(outputPath, outputFileSize);
            parsed = JSON.parse(chunked) as ResearchOutput;
            outputRaw = chunked;
          }
        } catch (err) {
          outputParseFailed = true;
          parseError = parseError ?? err;
        }
      }

      if (parsed) {
        output = parsed;
        outputParsedOk = true;
      } else {
        outputParseFailed = true;
        onProgress({
          id: 'crawl',
          label: 'Crawling pages',
          status: 'error',
          detail: 'Crawler output was not readable. Using fallback extracts.',
        });

        if (correlationId) {
          let fileSize = 0;
          try {
            fileSize = await getFileSize(outputPath);
          } catch {
            fileSize = 0;
          }

          logEvent({
            level: 'error',
            event: 'deep_research.crawl_output_parse_failed',
            correlationId,
            metadata: {
              exitCode,
              crawled: counts.current,
              planned: counts.total,
              fileSize,
              rawLength: outputRaw.length,
              error: serializeError(parseError),
            },
          });
        }
      }
    }

    if (outputParsedOk && output.runId !== collectorRunId) {
      outputParseFailed = true;
      if (correlationId) {
        let fileSize = 0;
        try {
          fileSize = await getFileSize(outputPath);
        } catch {
          fileSize = 0;
        }

        logEvent({
          level: 'error',
          event: 'deep_research.crawl_output_runid_mismatch',
          correlationId,
          metadata: {
            exitCode,
            crawled: counts.current,
            planned: counts.total,
            fileSize,
            expectedRunId: collectorRunId,
            outputRunId: output.runId ?? null,
          },
        });
      }

      outputParsedOk = false;
      output = {
        query,
        collectedAt: new Date().toISOString(),
        sources: [],
      };
    }
    sources = output.sources || [];
    const rankedCollectedSources = rankCollectedSources(
      query,
      sources,
      Math.max(4, options.maxSources),
      deepResearchMode,
    );
    if (rankedCollectedSources.length > 0) {
      sources = rankedCollectedSources;
    }

    // Diagnostic: log content lengths from crawler output.
    if (correlationId) {
      const contentLengths = sources.map((s) => ({
        url: s.url?.slice(0, 60),
        status: s.status,
        contentLen: (s.content || '').length,
        descLen: (s.description || '').length,
      }));
      logEvent({
        level: 'info',
        event: 'deep_research.crawl_content_diagnostic',
        correlationId,
        metadata: {
          sourcesCount: sources.length,
          exitCode,
          outputRawLen: outputRaw.length,
          outputParsedOk,
          contentLengths,
        },
      });
    }

    const usedFallback =
      sources.length === 0 && fallbackSources.length > 0;
    if (usedFallback) {
      const rankedFallbackSources = rankCollectedSources(
        query,
        fallbackSources,
        Math.max(4, options.maxSources),
        deepResearchMode,
      );
      sources =
        rankedFallbackSources.length > 0 ? rankedFallbackSources : fallbackSources;
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
      const detail = usedFallback
        ? 'Crawler failed, using search snippets.'
        : counts.current > 0 && counts.current < counts.total
          ? 'Crawler returned partial results.'
          : undefined;
      onProgress({
        id: 'crawl',
        label: 'Crawling pages',
        status: 'complete',
        ...(detail ? { detail } : {}),
      });
    }

    const crawlHadIssue =
      crawlTimedOut ||
      exitCode !== 0 ||
      usedFallback ||
      outputReadFailed ||
      outputParseFailed ||
      outputNonJson;

    if (correlationId && crawlHadIssue && crawlerLogTail.length > 0) {
      logEvent({
        level: outputReadFailed || outputParseFailed || outputNonJson ? 'error' : 'warn',
        event: 'deep_research.crawl_log_tail',
        correlationId,
        metadata: {
          timedOut: crawlTimedOut,
          exitCode,
          usedFallback,
          outputReadFailed,
          outputParseFailed,
          outputNonJson,
          crawled: counts.current,
          planned: counts.total,
          tail: crawlerLogTail.map((line) => anonymizeLogText(line)),
        },
      });
    }

    let summarizedSources: { sources?: Array<{ url: string; summary?: string }> } | null = null;
    const agentApiKey = ctx.agentApiKey;
    const agentRouterUrl =
      process.env.SANDY_AGENT_API_BASE_URL ||
      process.env.SANDY_AGENT_ROUTER_URL ||
      process.env.JANUS_ROUTER_URL;
    const agentModel = (options.agentModel?.trim() ||
      (agentRouterUrl ? 'janus-router' : '')) as string;
    const agentSystemPrompt =
      process.env.SANDY_AGENT_SYSTEM_PROMPT ||
      process.env.JANUS_SYSTEM_PROMPT;
    // If no summarizer is configured, keep the progress UI user-facing (no env var names).
    const summarySkipDetail =
      !agentApiKey || !agentModel ? 'Using raw extracts.' : null;

    if (sources.length > 0 && summarySkipDetail) {
      onProgress({
        id: 'analysis',
        label: 'Synthesizing notes',
        status: 'complete',
        detail: summarySkipDetail,
      });
    }

    if (sources.length > 0 && agentApiKey && agentModel) {
      onProgress({
        id: 'analysis',
        label: 'Synthesizing notes',
        status: 'running',
      });

      try {
        const agentPrompt = buildAgentPrompt(
          query,
          sources,
          Math.min(options.summaryLimit, sources.length),
        );
        const promptPath = `${workingDir}/agent-prompt.txt`;
        const agentOutputPath = `${workingDir}/agent-output.txt`;
        const agentScriptPath = `${workingDir}/run-agent.sh`;
        const systemPromptPath = agentSystemPrompt
          ? `${workingDir}/agent-system-prompt.txt`
          : null;

        await writeSandboxFile(sandboxId, promptPath, agentPrompt);
        if (systemPromptPath && agentSystemPrompt) {
          await writeSandboxFile(
            sandboxId,
            systemPromptPath,
            agentSystemPrompt,
          );
        }
        const agentScript = [
          '#!/bin/sh',
          'set -e',
          'PROMPT="$(cat ' + promptPath + ')"',
          `claude -p --output-format text --no-session-persistence --model "${agentModel}" ${
            systemPromptPath
              ? `--append-system-prompt-file "${systemPromptPath}" `
              : ''
          }"$PROMPT" > ${agentOutputPath}`,
          '',
        ].join('\n');
        await writeSandboxFile(sandboxId, agentScriptPath, agentScript);
        const normalizedRouterUrl = agentRouterUrl
          ? agentRouterUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
          : null;

        const agentRun = await execInSandbox(
          sandboxId,
          `chmod +x ${agentScriptPath} && ${agentScriptPath}`,
          {
            ANTHROPIC_BASE_URL: normalizedRouterUrl || 'https://claude.chutes.ai',
            ANTHROPIC_AUTH_TOKEN: agentApiKey,
            ANTHROPIC_API_KEY: agentApiKey,
            API_TIMEOUT_MS: '600000',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            NO_COLOR: '1',
            TERM: 'dumb',
          },
          4 * 60 * 1000,
        );

        if (agentRun.exitCode !== 0) {
          const combined = `${agentRun.stdout || ''}\n${agentRun.stderr || ''}`.trim();
          const detail = combined.includes('not found')
            ? 'Summary model not available, using raw extracts.'
            : 'Summary unavailable, using raw extracts.';

          if (correlationId) {
            logEvent({
              level: 'warn',
              event: 'deep_research.agent_run_failed',
              correlationId,
              metadata: {
                exitCode: agentRun.exitCode,
                output: combined ? anonymizeLogText(combined) : undefined,
              },
            });
          }

          onProgress({
            id: 'analysis',
            label: 'Synthesizing notes',
            status: 'error',
            detail,
          });
        } else {
          let agentOutput = '';
          try {
            agentOutput = await readSandboxFile(sandboxId, agentOutputPath);
          } catch (err) {
            if (correlationId) {
              logEvent({
                level: 'warn',
                event: 'deep_research.agent_output_read_failed',
                correlationId,
                metadata: { error: serializeError(err) },
              });
            }
            agentOutput = '';
          }

          summarizedSources = extractJson(agentOutput) as {
            sources?: Array<{ url: string; summary?: string }>;
          } | null;

          const summaryErrorDetail = agentOutput.includes('not found')
            ? 'Summary model not available, using raw extracts.'
            : 'Summary unavailable, using raw extracts.';

          if (!summarizedSources && correlationId) {
            logEvent({
              level: 'warn',
              event: 'deep_research.agent_output_unavailable',
              correlationId,
              metadata: {
                outputPreview: agentOutput
                  ? anonymizeLogText(agentOutput.slice(0, 800))
                  : undefined,
              },
            });
          }

          onProgress({
            id: 'analysis',
            label: 'Synthesizing notes',
            status: summarizedSources ? 'complete' : 'error',
            detail: summarizedSources ? undefined : summaryErrorDetail,
          });
        }
      } catch (err) {
        if (correlationId) {
          logEvent({
            level: 'error',
            event: 'deep_research.agent_summary_error',
            correlationId,
            metadata: { error: serializeError(err) },
          });
        }

        onProgress({
          id: 'analysis',
          label: 'Synthesizing notes',
          status: 'error',
          detail: 'Agent summary unavailable, using raw extracts.',
        });
      }
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
