const axios = require('axios');
(async () => {
  try {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) { console.error('SERPER_API_KEY env var is required'); process.exit(1); }
    const r = await axios.post('https://google.serper.dev/search', { q: 'who is sam altman' }, { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 });
    const organic = Array.isArray(r.data?.organic) ? r.data.organic : [];
    let count = organic.length;
    if (count === 0 && r.data?.knowledgeGraph?.title) count = 1;
    if (count === 0 && Array.isArray(r.data?.topStories) && r.data.topStories.length > 0) count = r.data.topStories.length;
    console.log('results_count=', count);
    process.exit(0);
  } catch (e) { console.error('serper test error', e?.response?.status, e?.message); process.exit(1); }
})();
