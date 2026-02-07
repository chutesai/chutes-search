import { ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import Optimization from './MessageInputActions/Optimization';
import Attach from './MessageInputActions/Attach';
import DeepResearchToggle from './MessageInputActions/DeepResearch';
import { useChat } from '@/lib/hooks/useChat';
import { useAuthMe } from '@/lib/hooks/useAuthMe';

const EmptyChatMessageInput = ({
  onFocusChange,
}: {
  onFocusChange?: (focused: boolean) => void;
}) => {
  const { sendMessage, focusMode, deepResearchMode, loading } = useChat();
  const { me, loading: authLoading } = useAuthMe();
  const isSignedIn = Boolean(me?.user);

  /* const [copilotEnabled, setCopilotEnabled] = useState(false); */
  const [message, setMessage] = useState('');
  const isDeepResearch = focusMode === 'deepResearch';
  const deepResearchLabel =
    deepResearchMode === 'max' ? 'Deep Research MAX' : 'Deep Research light';
  const deepResearchRequiresSignIn =
    isDeepResearch && !authLoading && !isSignedIn;
  const canSend =
    message.trim().length > 0 && !loading && !deepResearchRequiresSignIn;

  const [returnTo, setReturnTo] = useState('/');
  useEffect(() => {
    setReturnTo(window.location.pathname + window.location.search);
  }, []);

  const loginHref = useMemo(
    () => `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    [returnTo],
  );

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;

      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.hasAttribute('contenteditable');

      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    const isCoarsePointer =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches;

    const textarea = inputRef.current;
    const handleFocus = () => {
      if (!isCoarsePointer) return;
      onFocusChange?.(true);
      setTimeout(() => {
        textarea?.scrollIntoView({ block: 'center' });
      }, 50);
    };
    const handleBlur = () => {
      if (!isCoarsePointer) return;
      onFocusChange?.(false);
    };

    textarea?.addEventListener('focus', handleFocus);
    textarea?.addEventListener('blur', handleBlur);

    if (!isCoarsePointer) {
      inputRef.current?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      textarea?.removeEventListener('focus', handleFocus);
      textarea?.removeEventListener('blur', handleBlur);
    };
  }, [onFocusChange]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (loading || deepResearchRequiresSignIn) return;
        sendMessage(message);
        setMessage('');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (loading || deepResearchRequiresSignIn) return;
          sendMessage(message);
          setMessage('');
        }
      }}
      className="w-full"
    >
      <div className="flex flex-col bg-light-secondary dark:bg-dark-secondary px-5 pt-5 pb-2 rounded-lg w-full border border-light-200 dark:border-dark-200">
        <TextareaAutosize
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          minRows={2}
          className="bg-transparent placeholder:text-black/50 dark:placeholder:text-white/50 text-sm text-black dark:text-white resize-none focus:outline-none w-full max-h-24 lg:max-h-36 xl:max-h-48"
          placeholder="Ask anything..."
        />
        <div className="flex flex-row items-center justify-between mt-4">
          <div className="flex flex-row flex-wrap items-center gap-2 min-w-0">
            <div className="sm:hidden">
              <Attach />
            </div>
            <div className="hidden sm:block">
              <Attach showText />
            </div>
            <span className="hidden sm:inline text-xs text-black/50 dark:text-white/50">
              Start typing to search
            </span>
          </div>
          <div className="flex flex-row items-center gap-1 sm:gap-4 flex-shrink-0">
            <div className="sm:hidden">
              <Optimization compact align="right" />
            </div>
            <div className="hidden sm:block">
              <Optimization align="right" />
            </div>
            <div className="sm:hidden">
              <DeepResearchToggle compact align="right" />
            </div>
            <div className="hidden sm:block">
              <DeepResearchToggle align="right" />
            </div>
            <button
              disabled={!canSend}
              className="bg-[#24A0ED] text-white disabled:text-black/50 dark:disabled:text-white/50 disabled:bg-[#e0e0dc] dark:disabled:bg-[#ececec21] hover:bg-opacity-85 transition duration-100 rounded-full p-2 flex-shrink-0"
            >
              <ArrowRight className="bg-background" size={17} />
            </button>
          </div>
        </div>
        {deepResearchRequiresSignIn && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Deep Research is available after signing in.{' '}
            <a href={loginHref} className="underline underline-offset-2">
              Sign in with Chutes
            </a>{' '}
            to enable {deepResearchLabel}.
          </div>
        )}
        {isDeepResearch && !deepResearchRequiresSignIn && (
          <div className="mt-3 rounded-lg border border-[#24A0ED]/30 bg-[#24A0ED]/10 px-3 py-2 text-xs text-[#0b66a8] dark:text-[#9fd3ff]">
            {deepResearchLabel} uses a live browser to visit sources. Expect
            longer runtimes for richer answers.
          </div>
        )}
      </div>
    </form>
  );
};

export default EmptyChatMessageInput;
