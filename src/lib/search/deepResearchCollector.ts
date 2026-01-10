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
  agentModel?: string;
};

type ResearchInput = {
  query: string;
  sources: { title: string; url: string }[];
  maxChars: number;
  timeoutMs: number;
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
const DEFAULT_MAX_CHARS = 10000;

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

const buildResearchScript = () => {
  return [
    "import fs from 'node:fs/promises';",
    "import { chromium } from 'playwright';",
    '',
    'const inputPath = process.argv[2];',
    'const outputPath = process.argv[3] || \"deep-research-output.json\";',
    '',
    'const logProgress = (payload) => {',
    '  process.stdout.write(`__PROGRESS__${JSON.stringify(payload)}\\n`);',
    '};',
    '',
    'const cleanText = (value) => {',
    '  if (!value) return \"\";',
    '  return value.replace(/\s+/g, \" \" ).trim();',
    '};',
    '',
    'const truncateText = (value, maxChars) => {',
    '  if (!value) return \"\";',
    '  if (value.length <= maxChars) return value;',
    '  return value.slice(0, maxChars) + \"...\";',
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
    'const extractContent = async (page) => {',
    '  return page.evaluate(() => {',
    '    const title = document.title || \"\";',
    '    const description = document.querySelector(\"meta[name=description]\")?.getAttribute(\"content\") || \"\";',
    '    const bodyText = document.body ? document.body.innerText : \"\";',
    '    return { title, description, bodyText };',
    '  });',
    '};',
    '',
    'const run = async () => {',
    '  if (!inputPath) {',
    '    throw new Error(\"Missing input path\");',
    '  }',
    '  const inputRaw = await fs.readFile(inputPath, \"utf-8\");',
    '  const input = JSON.parse(inputRaw);',
    '  const sources = Array.isArray(input.sources) ? input.sources : [];',
    '  const maxChars = Number.isFinite(input.maxChars) ? input.maxChars : 10000;',
    '  const timeoutMs = Number.isFinite(input.timeoutMs) ? input.timeoutMs : 45000;',
    '  const results = [];',
    '  const errors = [];',
    '',
    '  logProgress({ stage: \"browser\", status: \"running\", message: \"Launching browser\" });',
    '  const browser = await chromium.launch({ headless: true, args: [\"--no-sandbox\"] });',
    '  const context = await browser.newContext({',
    '    userAgent: \"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\",',
    '    viewport: { width: 1365, height: 768 },',
    '  });',
    '  const page = await context.newPage();',
    '  await page.route(/.*/, (route) => {',
    '    const type = route.request().resourceType();',
    '    if ([\"image\", \"media\", \"font\"].includes(type)) {',
    '      route.abort();',
    '      return;',
    '    }',
    '    route.continue();',
    '  });',
    '  logProgress({ stage: \"browser\", status: \"complete\", message: \"Browser ready\" });',
    '',
    '  for (let i = 0; i < sources.length; i += 1) {',
    '    const source = sources[i];',
    '    const step = i + 1;',
    '    logProgress({ stage: \"crawl\", status: \"running\", current: step, total: sources.length, url: source.url });',
    '    try {',
    '      await page.goto(source.url, { waitUntil: \"domcontentloaded\", timeout: timeoutMs });',
    '      await page.waitForTimeout(1200);',
    '      await autoScroll(page);',
    '      const { title, description, bodyText } = await extractContent(page);',
    '      results.push({',
    '        title: cleanText(title || source.title || source.url),',
    '        url: source.url,',
    '        description: cleanText(description),',
    '        content: truncateText(cleanText(bodyText), maxChars),',
    '        status: \"ok\",',
    '      });',
    '    } catch (err) {',
    '      const message = err && err.message ? err.message : String(err);',
    '      errors.push(`${source.url}: ${message}`);',
    '      results.push({',
    '        title: source.title || source.url,',
    '        url: source.url,',
    '        content: \"\",',
    '        status: \"error\",',
    '        error: message,',
    '      });',
    '    }',
    '  }',
    '',
    '  await page.close();',
    '  await context.close();',
    '  await browser.close();',
    '',
    '  logProgress({ stage: \"crawl\", status: \"complete\", message: \"Crawl complete\" });',
    '',
    '  const output = {',
    '    query: input.query || \"\",',
    '    collectedAt: new Date().toISOString(),',
    '    sources: results,',
    '    errors,',
    '  };',
    '  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), \"utf-8\");',
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
        onProgress({
          id: 'crawl',
          label: 'Visiting sources',
          status: payload.status === 'complete' ? 'complete' : 'running',
          detail: payload.url
            ? `Processing ${payload.current}/${payload.total}`
            : undefined,
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

const buildAgentPrompt = (query: string, sources: DeepResearchSource[]) => {
  const trimmedSources = sources
    .filter((source) => source.content)
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
  onProgress: ProgressHandler,
): Promise<{ docs: Document[]; sources: DeepResearchSource[] }> => {
  const maxSourcesByMode = {
    speed: 4,
    balanced: 6,
    quality: 8,
  } as const;
  const maxCharsByMode = {
    speed: 6000,
    balanced: 9000,
    quality: 12000,
  } as const;

  const options: DeepResearchOptions = {
    maxSources: maxSourcesByMode[optimizationMode] ?? 6,
    maxCharsPerSource: maxCharsByMode[optimizationMode] ?? DEFAULT_MAX_CHARS,
    maxDurationMs: DEFAULT_MAX_DURATION_MS,
    agentModel: process.env.SANDY_AGENT_MODEL || process.env.CHUTES_MODEL_NAME,
  };

  onProgress({
    id: 'search',
    label: 'Finding sources',
    status: 'running',
  });

  const searchResults = await runWebSearch(query, []);
  const rankedSources = dedupeSources(
    (searchResults.results || []).map((result) => ({
      title: result.title || result.url,
      url: result.url,
    })),
  ).slice(0, options.maxSources);

  if (rankedSources.length === 0) {
    onProgress({
      id: 'search',
      label: 'Finding sources',
      status: 'error',
      detail: searchResults.error || 'No sources returned from search.',
    });
    return { docs: [], sources: [] };
  }

  onProgress({
    id: 'search',
    label: 'Finding sources',
    status: 'complete',
    detail: `${rankedSources.length} sources selected`,
  });

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
        const fallbackSources = (searchResults.results || [])
          .slice(0, options.maxSources)
          .map((result) => ({
            title: result.title || result.url,
            url: result.url,
            content: result.content || '',
            description: result.content || '',
            status: 'fallback',
          }));
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
        const fallbackSources = (searchResults.results || [])
          .slice(0, options.maxSources)
          .map((result) => ({
            title: result.title || result.url,
            url: result.url,
            content: result.content || '',
            description: result.content || '',
            status: 'fallback',
          }));
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
      const fallbackSources = (searchResults.results || [])
        .slice(0, options.maxSources)
        .map((result) => ({
          title: result.title || result.url,
          url: result.url,
          content: result.content || '',
          description: result.content || '',
          status: 'fallback',
        }));
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
    };

    await writeSandboxFile(sandboxId, scriptPath, buildResearchScript());
    await writeSandboxFile(sandboxId, inputPath, JSON.stringify(input, null, 2));

    onProgress({
      id: 'crawl',
      label: 'Visiting sources',
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
    const counts = { current: 0, total: rankedSources.length };
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
          label: 'Visiting sources',
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
        label: 'Visiting sources',
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
        label: 'Visiting sources',
        status: 'error',
        detail: 'Crawler output was not readable. Using fallback extracts.',
      });
    }
    sources = output.sources || [];

    if (exitCode !== 0) {
      onProgress({
        id: 'crawl',
        label: 'Visiting sources',
        status: sources.length > 0 ? 'complete' : 'error',
        detail:
          sources.length > 0
            ? 'Crawler returned partial results.'
            : `Crawler exited with code ${exitCode}.`,
      });
    } else {
      onProgress({
        id: 'crawl',
        label: 'Visiting sources',
        status: 'complete',
      });
    }
    if (sources.length === 0 && (searchResults.results || []).length > 0) {
      sources = (searchResults.results || []).slice(0, options.maxSources).map((result) => ({
        title: result.title || result.url,
        url: result.url,
        content: result.content || '',
        description: result.content || '',
        status: 'fallback',
      }));
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

      const agentPrompt = buildAgentPrompt(query, sources);
      const promptPath = `${workingDir}/agent-prompt.txt`;
      const agentOutputPath = `${workingDir}/agent-output.txt`;
      const agentScriptPath = `${workingDir}/run-agent.sh`;

      await writeSandboxFile(sandboxId, promptPath, agentPrompt);
      const agentScript = [
        '#!/bin/sh',
        'set -e',
        'PROMPT="$(cat ' + promptPath + ')"',
        `claude -p --output-format text --no-session-persistence --model \"${agentModel}\" \"$PROMPT\" > ${agentOutputPath}`,
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
