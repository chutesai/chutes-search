const assert = require('node:assert');
const { test } = require('node:test');
const MetaSearchAgent = require('./metaSearchAgent').default;
const EventEmitter = require('events');

const baseConfig = {
  searchWeb: false,
  rerank: false,
  summarizer: false,
  rerankThreshold: 0,
  queryGeneratorPrompt: '',
  responsePrompt: '',
  activeEngines: [],
};

test('handleStream emits error and end when stream throws', async () => {
  const agent = new MetaSearchAgent(baseConfig);
  const emitter = new EventEmitter();
  const events = [];

  emitter.on('error', (d) => events.push(['error', d]));
  emitter.on('end', () => events.push(['end']));

  const throwingStream = (async function* () {
    throw new Error('boom');
  })();

  await agent.handleStream(throwingStream, emitter);

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
