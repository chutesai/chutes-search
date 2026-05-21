import { getAuthSession } from '@/lib/auth/cookieSession';
import handleVideoSearch from '@/lib/chains/videoSearchAgent';
import {
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
  getModelRouterApiUrl,
  getModelRouterModelName,
} from '@/lib/config';
import {
  buildChutesCandidates,
  runWithLlmCandidates,
} from '@/lib/llm/fallbacks';
import { getAvailableChatModelProviders } from '@/lib/providers';
import { AUXILIARY_LLM_MODELS } from '@/lib/searchModeModels';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { cookies } from 'next/headers';

interface ChatModel {
  provider: string;
  model: string;
}

interface VideoSearchBody {
  query: string;
  chatHistory: any[];
  chatModel?: ChatModel;
}

export const POST = async (req: Request) => {
  try {
    const cookieStore = await cookies();
    const authSession = await getAuthSession(cookieStore);
    const scopeStr = authSession?.scope?.trim() || '';
    const hasInvoke =
      !scopeStr || scopeStr.split(/\s+/).includes('chutes:invoke');
    const tokenExpiry = authSession?.accessTokenExpiresAt ?? null;
    const tokenValid = tokenExpiry
      ? tokenExpiry > Math.floor(Date.now() / 1000) + 30
      : true;

    const body: VideoSearchBody = await req.json();

    const chatHistory = body.chatHistory
      .map((msg: any) => {
        if (msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
          return new AIMessage(msg.content);
        }
      })
      .filter((msg) => msg !== undefined) as BaseMessage[];

    const chatModelProviders = await getAvailableChatModelProviders();

    const chatModelProvider =
      chatModelProviders[
        body.chatModel?.provider || Object.keys(chatModelProviders)[0]
      ];
    const chatModel =
      chatModelProvider[
        body.chatModel?.model || Object.keys(chatModelProvider)[0]
      ];

    let llm: BaseChatModel | undefined;

    if (body.chatModel?.provider === 'custom_openai') {
      if (!authSession?.accessToken || !hasInvoke || !tokenValid) {
        return Response.json(
          {
            message: 'Sign in with Chutes to search videos',
            error: 'AUTH_REQUIRED',
          },
          { status: 401 },
        );
      }
      const candidates = buildChutesCandidates({
        modelNames: [
          body.chatModel?.model || getCustomOpenaiModelName(),
          ...AUXILIARY_LLM_MODELS,
        ],
        apiKey: authSession.accessToken,
        baseURL: getCustomOpenaiApiUrl(),
        modelRouterBaseURL: getModelRouterApiUrl(),
        modelRouterModelName: getModelRouterModelName(),
      });

      const videos = await runWithLlmCandidates(
        candidates,
        (candidate) =>
          handleVideoSearch(
            {
              chat_history: chatHistory,
              query: body.query,
            },
            candidate.model,
          ),
        (_err, candidate, nextCandidate) => {
          console.warn(
            `[videos] LLM candidate ${candidate.name} failed, retrying with ${nextCandidate.name}`,
          );
        },
      );

      return Response.json({ videos }, { status: 200 });
    } else if (chatModelProvider && chatModel) {
      llm = chatModel.model;
    }

    if (!llm) {
      return Response.json({ error: 'Invalid chat model' }, { status: 400 });
    }

    const videos = await handleVideoSearch(
      {
        chat_history: chatHistory,
        query: body.query,
      },
      llm,
    );

    return Response.json({ videos }, { status: 200 });
  } catch (err) {
    console.error(`An error occurred while searching videos: ${err}`);
    return Response.json(
      { message: 'An error occurred while searching videos' },
      { status: 500 },
    );
  }
};
