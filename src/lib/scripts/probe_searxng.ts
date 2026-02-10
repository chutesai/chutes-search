import axios from 'axios';
import fs from 'fs';
import path from 'path';

const listPath = path.join(process.cwd(), 'tmp', 'searxng_instances.json');
const parsed = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
const candidates: string[] = (parsed.instances || []).map((u: string) => u.replace(/\/$/, ''));

async function check(url: string) {
  const u = `${url}/search?format=json&q=hello`;
  const t0 = Date.now();
  try {
    const r = await axios.get(u, { timeout: 8000 });
    const ms = Date.now() - t0;
    const ok = Array.isArray(r.data?.results);
    return { url, ok, ms, results: (r.data?.results || []).length };
  } catch (e: any) {
    return { url, ok: false, ms: Date.now() - t0, error: e?.message };
  }
}

(async () => {
  const checks = await Promise.all(candidates.map(check));
  checks.forEach((c) => console.log(JSON.stringify(c)));
})();


