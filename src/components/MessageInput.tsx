import { cn } from '@/lib/utils';
import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import AttachSmall from './MessageInputActions/AttachSmall';
import Optimization from './MessageInputActions/Optimization';
import DeepResearchToggle from './MessageInputActions/DeepResearch';
import { useChat } from '@/lib/hooks/useChat';
import { useAuthMe } from '@/lib/hooks/useAuthMe';

const MessageInput = () => {
  const { loading, sendMessage, focusMode, deepResearchMode } = useChat();
  const { me, loading: authLoading } = useAuthMe();
  const isSignedIn = Boolean(me?.user);

  const [message, setMessage] = useState('');
  const [textareaRows, setTextareaRows] = useState(1);
  const [mode, setMode] = useState<'multi' | 'single'>('single');
  const isDeepResearch = focusMode === 'deepResearch';
  const deepResearchLabel =
    deepResearchMode === 'max' ? 'Deep Research MAX' : 'Deep Research light';
  const deepResearchRequiresSignIn =
    isDeepResearch && !authLoading && !isSignedIn;
  const canSend = message.trim().length > 0 && !loading && !deepResearchRequiresSignIn;

  useEffect(() => {
    if (textareaRows >= 2 && message && mode === 'single') {
      setMode('multi');
    } else if (!message && mode === 'multi') {
      setMode('single');
    }
  }, [textareaRows, mode, message]);

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

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <form
      onSubmit={(e) => {
        if (loading) return;
        e.preventDefault();
        if (deepResearchRequiresSignIn) return;
        sendMessage(message);
        setMessage('');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !loading) {
          e.preventDefault();
          if (deepResearchRequiresSignIn) return;
          sendMessage(message);
          setMessage('');
        }
      }}
      className={cn(
        'bg-light-secondary dark:bg-dark-secondary p-4 flex items-center border border-light-200 dark:border-dark-200',
        mode === 'multi' ? 'flex-col rounded-lg' : 'flex-row rounded-full',
      )}
    >
      {mode === 'single' && (
        <div className="flex flex-row items-center gap-1 pr-1">
          <Optimization compact align="left" panelDirection="up" />
          <AttachSmall />
        </div>
      )}
      <TextareaAutosize
        ref={inputRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onHeightChange={(height, props) => {
          setTextareaRows(Math.ceil(height / props.rowHeight));
        }}
        className="transition bg-transparent dark:placeholder:text-white/50 placeholder:text-sm text-sm dark:text-white resize-none focus:outline-none w-full px-2 max-h-24 lg:max-h-36 xl:max-h-48 flex-grow flex-shrink"
        placeholder="Ask a follow-up"
      />
      {mode === 'single' && (
        <div className="flex flex-row items-center space-x-4">
          <DeepResearchToggle compact align="right" panelDirection="up" />
          <button
            disabled={!canSend}
            className="bg-[#24A0ED] text-white disabled:text-black/50 dark:disabled:text-white/50 hover:bg-opacity-85 transition duration-100 disabled:bg-[#e0e0dc79] dark:disabled:bg-[#ececec21] rounded-full p-2"
          >
            <ArrowUp className="bg-background" size={17} />
          </button>
        </div>
      )}
      {mode === 'multi' && (
        <div className="flex flex-row items-center justify-between w-full pt-2">
          <div className="flex flex-row items-center gap-1">
            <Optimization compact align="left" panelDirection="up" />
            <AttachSmall />
          </div>
          <div className="flex flex-row items-center space-x-4">
            <DeepResearchToggle compact align="right" panelDirection="up" />
            <button
              disabled={!canSend}
              className="bg-[#24A0ED] text-white text-black/50 dark:disabled:text-white/50 hover:bg-opacity-85 transition duration-100 disabled:bg-[#e0e0dc79] dark:disabled:bg-[#ececec21] rounded-full p-2"
            >
              <ArrowUp className="bg-background" size={17} />
            </button>
          </div>
        </div>
      )}
      {isDeepResearch && mode === 'multi' && !deepResearchRequiresSignIn && (
        <div className="mt-2 text-xs text-[#24A0ED]">
          {deepResearchLabel} can take longer while we browse sources.
        </div>
      )}
      {deepResearchRequiresSignIn && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Deep Research is available after signing in with Chutes.
        </div>
      )}
    </form>
  );
};

export default MessageInput;
