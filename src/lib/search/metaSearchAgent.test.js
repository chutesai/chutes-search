const assert = require('node:assert');
const { test } = require('node:test');
const {
  default: MetaSearchAgent,
  extractStreamText,
} = require('./metaSearchAgent');

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

test('extractStreamText normalizes string and structured chunks', () => {
  assert.equal(extractStreamText('plain'), 'plain');
  assert.equal(extractStreamText({ content: 'content' }), 'content');
  assert.equal(
    extractStreamText({
      content: [
        { type: 'text', text: 'hello' },
        ' ',
        { content: 'world' },
      ],
    }),
    'hello world',
  );
  assert.equal(extractStreamText({ content: [] }), '');
  assert.equal(extractStreamText(null), '');
});

test('searchAndAnswer ignores empty response chunks and retries next candidate', async () => {
  const agent = new MetaSearchAgent(baseConfig);
  const events = [];
  let attempts = 0;

  agent.createAnsweringChain = async () => {
    attempts += 1;
    const attempt = attempts;
    return {
      streamEvents: () =>
        (async function* () {
          yield {
            event: 'on_chain_stream',
            name: 'FinalResponseGenerator',
            data: { chunk: attempt === 1 ? '' : { content: 'ok' } },
          };
          yield {
            event: 'on_chain_end',
            name: 'FinalResponseGenerator',
            data: {},
          };
        })(),
    };
  };

  const streamEmitter = await agent.searchAndAnswer(
    'test',
    [],
    {},
    {},
    'speed',
    [],
    '',
    undefined,
    [
      { name: 'empty/model', model: {} },
      { name: 'working/model', model: {} },
    ],
  );

  streamEmitter.on('data', (d) => events.push(['data', JSON.parse(d)]));
  streamEmitter.on('error', (d) => events.push(['error', d]));
  streamEmitter.on('end', () => events.push(['end']));

  await new Promise((resolve) => streamEmitter.on('end', resolve));

  assert.equal(attempts, 2);
  assert.deepEqual(events, [
    ['data', { type: 'response', data: 'ok' }],
    ['end'],
  ]);
});
