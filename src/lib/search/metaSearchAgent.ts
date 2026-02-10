import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  PromptTemplate,
} from '@langchain/core/prompts';
import {
  RunnableLambda,
  RunnableMap,
  RunnableSequence,
} from '@langchain/core/runnables';
import { BaseMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import LineListOutputParser from '../outputParsers/listLineOutputParser';
import LineOutputParser from '../outputParsers/lineOutputParser';
import { getDocumentsFromLinks } from '../utils/documents';
import { Document } from 'langchain/document';
import path from 'node:path';
import fs from 'node:fs';
import computeSimilarity from '../utils/computeSimilarity';
import formatChatHistoryAsString from '../utils/formatHistory';
import eventEmitter from 'events';
import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { runWebSearch } from './runWebSearch';
import { isRateLimitError, isRetryableUpstreamError, LlmCandidate } from '@/lib/llm/fallbacks';

// Timing utility for performance debugging
const createTimer = (prefix: string) => {
  const start = Date.now();
  return (step: string) => {
    console.log(`[${prefix}] ${new Date().toISOString()} | +${Date.now() - start}ms | ${step}`);
  };
};

export type SearchRequestContext = {
  userAccessToken?: string;
};

export interface MetaSearchAgentType {
  searchAndAnswer: (
    message: string,
    history: BaseMessage[],
    llm: BaseChatModel,
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    fileIds: string[],
    systemInstructions: string,
    deepResearchMode?: 'light' | 'max',
    llmCandidates?: LlmCandidate[],
    requestContext?: SearchRequestContext,
  ) => Promise<eventEmitter>;
}

interface Config {
  searchWeb: boolean;
  rerank: boolean;
  summarizer: boolean;
  rerankThreshold: number;
  queryGeneratorPrompt: string;
  responsePrompt: string;
  activeEngines: string[];
}

type BasicChainInput = {
  chat_history: BaseMessage[];
  query: string;
};

class MetaSearchAgent implements MetaSearchAgentType {
  private config: Config;
  private strParser = new StringOutputParser();

  constructor(config: Config) {
    this.config = config;
  }

  private async createSearchRetrieverChain(llm: BaseChatModel) {
    (llm as unknown as ChatOpenAI).temperature = 0;

    return RunnableSequence.from([
      PromptTemplate.fromTemplate(this.config.queryGeneratorPrompt),
      llm, // Note: We can't easily wrap this in a RunnableSequence, but the logs below will show the timing
      this.strParser,
      RunnableLambda.from(async (input: string) => {
        const timer = createTimer('retriever');
        timer('LLM query analysis complete, parsing result');
        
        const linksOutputParser = new LineListOutputParser({
          key: 'links',
        });

        const questionOutputParser = new LineOutputParser({
          key: 'question',
        });

        const links = await linksOutputParser.parse(input);
        let question = this.config.summarizer
          ? await questionOutputParser.parse(input)
          : input;

        timer(`Parsed query (len=${question.length}), links: ${links.length}`);

        if (question === 'not_needed') {
          timer('Query not needed, returning empty');
          return { query: '', docs: [] };
        }

        if (links.length > 0) {
          timer(`Processing ${links.length} links`);
          if (question.length === 0) {
            question = 'summarize';
          }

          let docs: Document[] = [];

          timer('Fetching documents from links');
          const linkDocs = await getDocumentsFromLinks({ links });
          timer(`Got ${linkDocs.length} documents from links`);

          const docGroups: Document[] = [];

          linkDocs.map((doc) => {
            const URLDocExists = docGroups.find(
              (d) =>
                d.metadata.url === doc.metadata.url &&
                d.metadata.totalDocs < 10,
            );

            if (!URLDocExists) {
              docGroups.push({
                ...doc,
                metadata: {
                  ...doc.metadata,
                  totalDocs: 1,
                },
              });
            }

            const docIndex = docGroups.findIndex(
              (d) =>
                d.metadata.url === doc.metadata.url &&
                d.metadata.totalDocs < 10,
            );

            if (docIndex !== -1) {
              docGroups[docIndex].pageContent =
                docGroups[docIndex].pageContent + `\n\n` + doc.pageContent;
              docGroups[docIndex].metadata.totalDocs += 1;
            }
          });

          timer(`Summarizing ${docGroups.length} document groups`);
          await Promise.all(
            docGroups.map(async (doc) => {
              const res = await llm.invoke(`
            You are a web search summarizer, tasked with summarizing a piece of text retrieved from a web search. Your job is to summarize the 
            text into a detailed, 2-4 paragraph explanation that captures the main ideas and provides a comprehensive answer to the query.
            If the query is \"summarize\", you should provide a detailed summary of the text. If the query is a specific question, you should answer it in the summary.
            
            - **Journalistic tone**: The summary should sound professional and journalistic, not too casual or vague.
            - **Thorough and detailed**: Ensure that every key point from the text is captured and that the summary directly answers the query.
            - **Not too lengthy, but detailed**: The summary should be informative but not excessively long. Focus on providing detailed information in a concise format.

            The text will be shared inside the \`text\` XML tag, and the query inside the \`query\` XML tag.

            <example>
            1. \`<text>
            Docker is a set of platform-as-a-service products that use OS-level virtualization to deliver software in packages called containers. 
            It was first released in 2013 and is developed by Docker, Inc. Docker is designed to make it easier to create, deploy, and run applications 
            by using containers.
            </text>

            <query>
            What is Docker and how does it work?
            </query>

            Response:
            Docker is a revolutionary platform-as-a-service product developed by Docker, Inc., that uses container technology to make application 
            deployment more efficient. It allows developers to package their software with all necessary dependencies, making it easier to run in 
            any environment. Released in 2013, Docker has transformed the way applications are built, deployed, and managed.
            \`
            2. \`<text>
            The theory of relativity, or simply relativity, encompasses two interrelated theories of Albert Einstein: special relativity and general
            relativity. However, the word "relativity" is sometimes used in reference to Galilean invariance. The term "theory of relativity" was based
            on the expression "relative theory" used by Max Planck in 1906. The theory of relativity usually encompasses two interrelated theories by
            Albert Einstein: special relativity and general relativity. Special relativity applies to all physical phenomena in the absence of gravity.
            General relativity explains the law of gravitation and its relation to other forces of nature. It applies to the cosmological and astrophysical
            realm, including astronomy.
            </text>

            <query>
            summarize
            </query>

            Response:
            The theory of relativity, developed by Albert Einstein, encompasses two main theories: special relativity and general relativity. Special
            relativity applies to all physical phenomena in the absence of gravity, while general relativity explains the law of gravitation and its
            relation to other forces of nature. The theory of relativity is based on the concept of "relative theory," as introduced by Max Planck in
            1906. It is a fundamental theory in physics that has revolutionized our understanding of the universe.
            \`
            </example>

            Everything below is the actual data you will be working with. Good luck!

            <query>
            ${question}
            </query>

            <text>
            ${doc.pageContent}
            </text>

            Make sure to answer the query in the summary.
          `);

              const document = new Document({
                pageContent: res.content as string,
                metadata: {
                  title: doc.metadata.title,
                  url: doc.metadata.url,
                },
              });

              docs.push(document);
            }),
          );

          timer('Document summarization complete');
          return { query: question, docs: docs };
        } else {
          question = question.replace(/<think>.*?<\/think>/g, '');

          timer(`Starting web search (len=${question.length})`);
          const res = await runWebSearch(question, this.config.activeEngines);
          timer(`Web search complete: ${res.results?.length || 0} results, engine: ${res.engine}`);

          if (res.error && (res.results?.length ?? 0) === 0) {
            throw new Error(res.error);
          }

          const documents =
            res.results.length === 0 && res.error
              ? [
                  new Document({
                    pageContent: res.error,
                    metadata: {
                      title: 'Search unavailable',
                      url: '',
                    },
                  }),
                ]
              : (res.results || []).map(
                  (result) =>
                    new Document({
                      pageContent:
                        result.content ||
                        (this.config.activeEngines.includes('youtube')
                          ? result.title
                          : '') /* Todo: Implement transcript grabbing using Youtubei (source: https://www.npmjs.com/package/youtubei) */,
                      metadata: {
                        title: result.title,
                        url: result.url,
                      },
                    }),
                );

          timer(`Created ${documents.length} document objects`);
          return { query: question, docs: documents };
        }
      }),
    ]);
  }

  private async createAnsweringChain(
    llm: BaseChatModel,
    fileIds: string[],
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    systemInstructions: string,
  ) {
    return RunnableSequence.from([
      RunnableLambda.from(async (input: BasicChainInput) => {
        const timer = createTimer('answering');
        timer('Starting context retrieval');

        const processedHistory = formatChatHistoryAsString(input.chat_history);

        let docs: Document[] | null = null;
        let query = input.query;

        if (this.config.searchWeb) {
          timer('Creating search retriever chain');
          const searchRetrieverChain =
            await this.createSearchRetrieverChain(llm);

          timer(
            'Invoking search retriever chain (includes LLM query analysis + web search)',
          );
          const searchRetrieverResult = await searchRetrieverChain.invoke({
            chat_history: processedHistory,
            query,
          });
          timer(
            `Search retriever complete: ${searchRetrieverResult.docs?.length || 0} docs`,
          );

          query = searchRetrieverResult.query;
          docs = searchRetrieverResult.docs;
        }

        timer(
          `Starting rerank with ${docs?.length || 0} docs, mode: ${optimizationMode}`,
        );
        const sortedDocs = await this.rerankDocs(
          query,
          docs ?? [],
          fileIds,
          embeddings,
          optimizationMode,
        );
        timer(`Rerank complete: ${sortedDocs.length} docs after filtering`);

        return {
          systemInstructions,
          query,
          chat_history: input.chat_history,
          date: new Date().toISOString(),
          context: this.processDocs(sortedDocs),
          sources: sortedDocs,
        };
      }).withConfig({
        runName: 'FinalSourceRetriever',
      }),
      ChatPromptTemplate.fromMessages([
        ['system', this.config.responsePrompt],
        new MessagesPlaceholder('chat_history'),
        ['user', '{query}'],
      ]),
      llm,
      this.strParser,
    ]).withConfig({
      runName: 'FinalResponseGenerator',
    });
  }

  private async rerankDocs(
    query: string,
    docs: Document[],
    fileIds: string[],
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
  ) {
    if (docs.length === 0 && fileIds.length === 0) {
      return docs;
    }

    const filesData = fileIds
      .map((file) => {
        const filePath = path.join(process.cwd(), 'uploads', file);

        const contentPath = filePath + '-extracted.json';
        const embeddingsPath = filePath + '-embeddings.json';

        const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
        const embeddings = JSON.parse(fs.readFileSync(embeddingsPath, 'utf8'));

        const fileSimilaritySearchObject = content.contents.map(
          (c: string, i: number) => {
            return {
              fileName: content.title,
              content: c,
              embeddings: embeddings.embeddings[i],
            };
          },
        );

        return fileSimilaritySearchObject;
      })
      .flat();

    if (query.toLocaleLowerCase() === 'summarize') {
      return docs.slice(0, 15);
    }

    const docsWithContent = docs.filter(
      (doc) => doc.pageContent && doc.pageContent.length > 0,
    );

    if (optimizationMode === 'speed' || this.config.rerank === false) {
      if (filesData.length > 0) {
        const [queryEmbedding] = await Promise.all([
          embeddings.embedQuery(query),
        ]);

        const fileDocs = filesData.map((fileData) => {
          return new Document({
            pageContent: fileData.content,
            metadata: {
              title: fileData.fileName,
              url: `File`,
            },
          });
        });

        const similarity = filesData.map((fileData, i) => {
          const sim = computeSimilarity(queryEmbedding, fileData.embeddings);

          return {
            index: i,
            similarity: sim,
          };
        });

        let sortedDocs = similarity
          .filter(
            (sim) => sim.similarity > (this.config.rerankThreshold ?? 0.3),
          )
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 15)
          .map((sim) => fileDocs[sim.index]);

        sortedDocs =
          docsWithContent.length > 0 ? sortedDocs.slice(0, 8) : sortedDocs;

        return [
          ...sortedDocs,
          ...docsWithContent.slice(0, 15 - sortedDocs.length),
        ];
      } else {
        return docsWithContent.slice(0, 15);
      }
    } else if (optimizationMode === 'balanced') {
      const [docEmbeddings, queryEmbedding] = await Promise.all([
        embeddings.embedDocuments(
          docsWithContent.map((doc) => doc.pageContent),
        ),
        embeddings.embedQuery(query),
      ]);

      docsWithContent.push(
        ...filesData.map((fileData) => {
          return new Document({
            pageContent: fileData.content,
            metadata: {
              title: fileData.fileName,
              url: `File`,
            },
          });
        }),
      );

      docEmbeddings.push(...filesData.map((fileData) => fileData.embeddings));

      const similarity = docEmbeddings.map((docEmbedding, i) => {
        const sim = computeSimilarity(queryEmbedding, docEmbedding);

        return {
          index: i,
          similarity: sim,
        };
      });

      const sortedDocs = similarity
        .filter((sim) => sim.similarity > (this.config.rerankThreshold ?? 0.3))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 15)
        .map((sim) => docsWithContent[sim.index]);

      return sortedDocs;
    }

    return [];
  }

  private processDocs(docs: Document[]) {
    return docs
      .map(
        (_, index) =>
          `${index + 1}. ${docs[index].metadata.title} ${docs[index].pageContent}`,
      )
      .join('\n');
  }

  private async streamChainEvents(
    stream: AsyncGenerator<StreamEvent, any, any>,
    emitter: eventEmitter,
    state: { hasResponse: boolean; completed: boolean; sourcesEmitted: boolean; sourcesCount: number },
  ) {
    for await (const event of stream) {
      if (
        event.event === 'on_chain_end' &&
        event.name === 'FinalSourceRetriever'
      ) {
        const sources =
          event?.data?.output && Array.isArray(event.data.output.sources)
            ? event.data.output.sources
            : [];
        emitter.emit(
          'data',
          JSON.stringify({ type: 'sources', data: sources }),
        );
        state.sourcesEmitted = true;
        state.sourcesCount = sources.length;
      }
      if (
        event.event === 'on_chain_stream' &&
        event.name === 'FinalResponseGenerator'
      ) {
        emitter.emit(
          'data',
          JSON.stringify({ type: 'response', data: event.data.chunk }),
        );
        state.hasResponse = true;
      }
      if (event.event === 'on_chain_end' && event.name === 'FinalResponseGenerator') {
        state.completed = true;
        return;
      }
    }
  }

  async searchAndAnswer(
    message: string,
    history: BaseMessage[],
    llm: BaseChatModel,
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    fileIds: string[],
    systemInstructions: string,
    _deepResearchMode?: 'light' | 'max',
    llmCandidates?: LlmCandidate[],
    _requestContext?: SearchRequestContext,
  ) {
    const emitter = new eventEmitter();
    const timer = createTimer('searchAndAnswer');
    const candidates =
      llmCandidates && llmCandidates.length > 0
        ? llmCandidates
        : [{ name: 'primary', model: llm }];

    const run = async () => {
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const state = { hasResponse: false, completed: false, sourcesEmitted: false, sourcesCount: 0 };

        try {
          timer(`Creating answering chain (${candidate.name})`);
          const answeringChain = await this.createAnsweringChain(
            candidate.model,
            fileIds,
            embeddings,
            optimizationMode,
            systemInstructions,
          );
          timer(`Answering chain created (${candidate.name})`);

          timer(`Starting stream events (${candidate.name})`);
          const stream = answeringChain.streamEvents(
            {
              chat_history: history,
              query: message,
            },
            {
              version: 'v1',
            },
          );
          timer(`Stream events started (${candidate.name})`);

          await this.streamChainEvents(stream, emitter, state);
          emitter.emit('end');
          return;
        } catch (err: any) {
          const canRetry =
            (isRateLimitError(err) || isRetryableUpstreamError(err)) &&
            !state.hasResponse &&
            i < candidates.length - 1;
          if (canRetry) {
            timer(
              `Retryable upstream error on ${candidate.name}, retrying with ${candidates[i + 1].name}`,
            );
            continue;
          }

          timer(`Error: ${err?.message}`);
          emitter.emit(
            'error',
            JSON.stringify({
              type: 'error',
              data: err?.message || 'Search failed',
            }),
          );
          emitter.emit('end');
          return;
        }
      }
    };

    setImmediate(() => void run());

    return emitter;
  }
}

export default MetaSearchAgent;
