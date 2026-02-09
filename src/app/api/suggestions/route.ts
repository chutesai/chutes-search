import generateSuggestions from '@/lib/chains/suggestionGeneratorAgent';
import {
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { getAvailableChatModelProviders } from '@/lib/providers';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { refreshAuthSessionIfNeeded } from '@/lib/auth/session';

interface ChatModel {
  provider: string;
  model: string;
}

interface SuggestionsGenerationBody {
  chatHistory: any[];
  chatModel?: ChatModel;
}

export const POST = async (req: Request) => {
  try {
    const cookieStore = await cookies();
    const authSessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
    const authSession = authSessionId
      ? await refreshAuthSessionIfNeeded(authSessionId)
      : null;
    const scopeStr = authSession?.scope?.trim() || '';
    const hasInvoke =
      !scopeStr || scopeStr.split(/\s+/).includes('chutes:invoke');
    const tokenExpiry = authSession?.accessTokenExpiresAt ?? null;
    const tokenValid = tokenExpiry
      ? tokenExpiry > Math.floor(Date.now() / 1000) + 30
      : true;

    const body: SuggestionsGenerationBody = await req.json();

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
            message: 'Sign in with Chutes to use suggestions',
            error: 'AUTH_REQUIRED',
          },
          { status: 401 },
        );
      }
      llm = new ChatOpenAI({
        apiKey: authSession.accessToken,
        modelName: getCustomOpenaiModelName(),
        temperature: 0.7,
        configuration: {
          baseURL: getCustomOpenaiApiUrl(),
          defaultHeaders: {
            'X-Identifier': 'chutes-search',
          },
        },
      }) as unknown as BaseChatModel;
    } else if (chatModelProvider && chatModel) {
      llm = chatModel.model;
    }

    if (!llm) {
      return Response.json({ error: 'Invalid chat model' }, { status: 400 });
    }

    const suggestions = await generateSuggestions(
      {
        chat_history: chatHistory,
      },
      llm,
    );

    return Response.json({ suggestions }, { status: 200 });
  } catch (err) {
    console.error(`An error occurred while generating suggestions: ${err}`);
    return Response.json(
      { message: 'An error occurred while generating suggestions' },
      { status: 500 },
    );
  }
};
