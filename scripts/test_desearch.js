const axios = require('axios');

(async () => {
  try {
    const apiKey = process.env.DESEARCH_API_KEY;
    if (!apiKey) {
      console.error('DESEARCH_API_KEY env var is required');
      process.exit(1);
    }

    const r = await axios.get('https://api.desearch.ai/web', {
      params: { query: 'who is sam altman' },
      headers: {
        Authorization: apiKey,
        accept: 'application/json',
      },
      timeout: 15000,
    });

    const results = r.data?.data || r.data?.results || [];
    console.log('desearch status', r.status, 'results', results.length);
    if (results[0]) {
      console.log('first', results[0].title, results[0].url || results[0].link);
    }
  } catch (e) {
    console.error(
      'desearch test error',
      e?.response?.status,
      e?.response?.data?.error || e?.message,
    );
    process.exit(1);
  }
})();
