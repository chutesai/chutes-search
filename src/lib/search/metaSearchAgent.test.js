const assert = require('node:assert');
const { test } = require('node:test');
const MetaSearchAgent = require('./metaSearchAgent').default;

const baseConfig = {
  searchWeb: false,
  rerank: false,
  summarizer: false,
  rerankThreshold: 0,
  queryGeneratorPrompt: '',
  responsePrompt: '',
  activeEngines: [],
};

test('searchAndAnswer emits error and end when stream throws', async () => {
  const agent = new MetaSearchAgent(baseConfig);
  const events = [];

  agent.createAnsweringChain = async () => ({
    streamEvents: () =>
      (async function* () {
        throw new Error('boom');
      })(),
  });

  const streamEmitter = await agent.searchAndAnswer(
    'test',
    [],
    {},
    {},
    'speed',
    [],
    '',
  );

  streamEmitter.on('error', (d) => events.push(['error', d]));
  streamEmitter.on('end', () => events.push(['end']));

  await new Promise((resolve) => streamEmitter.on('end', resolve));

  assert.deepEqual(events, [
    [
      'error',
      JSON.stringify({
        type: 'error',
        data: 'boom',
      }),
    ],
    ['end'],
  ]);
});
