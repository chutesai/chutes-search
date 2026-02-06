import { ChevronDown, Microscope } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { useChat } from '@/lib/hooks/useChat';

const options = [
  {
    key: 'off',
    title: 'Off',
    description: 'Use standard web search without live browsing.',
  },
  {
    key: 'light',
    title: 'Deep Research light',
    description: 'Multi-source browsing with citations and summaries.',
  },
  {
    key: 'max',
    title: 'Deep Research MAX',
    description: 'Multi-level crawl that follows links for maximum depth.',
  },
] as const;

type OptionKey = (typeof options)[number]['key'];

const DeepResearchToggle = ({
  compact = false,
  align = 'right',
  panelDirection = 'down',
}: {
  compact?: boolean;
  align?: 'left' | 'right';
  panelDirection?: 'up' | 'down';
}) => {
  const { focusMode, setFocusMode, deepResearchMode, setDeepResearchMode } =
    useChat();
  const isActive = focusMode === 'deepResearch';
  const activeMode: OptionKey = isActive ? deepResearchMode : 'off';
  const activeLabel =
    activeMode === 'max'
      ? 'Deep Research MAX'
      : activeMode === 'light'
        ? 'Deep Research light'
        : 'Deep Research';
  const badgeLabel =
    activeMode === 'max' ? 'MAX' : activeMode === 'light' ? 'LIGHT' : '';

  const handleSelect = (mode: OptionKey) => {
    if (mode === 'off') {
      setFocusMode('webSearch');
      return;
    }
    setDeepResearchMode(mode);
    setFocusMode('deepResearch');
  };

  return (
    <Popover className={cn('relative w-auto')}>
      <PopoverButton
        type="button"
        aria-label={`Deep research mode: ${activeLabel}`}
        className={cn(
          'flex items-center gap-2 rounded-xl transition duration-200 active:scale-95',
          compact ? 'p-2' : 'px-3 py-2',
          isActive
            ? 'bg-[#24A0ED]/10 text-[#0b66a8] dark:text-[#9fd3ff]'
            : 'text-black/50 dark:text-white/50 hover:bg-light-secondary dark:hover:bg-dark-secondary hover:text-black dark:hover:text-white',
        )}
      >
        <Microscope size={18} />
        {!compact && (
          <span className="text-xs font-medium">{activeLabel}</span>
        )}
        {badgeLabel && (
          <span
            className={cn(
              'text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5',
              activeMode === 'max'
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'bg-light-200 text-black/70 dark:bg-dark-200 dark:text-white/70',
            )}
          >
            {badgeLabel}
          </span>
        )}
        <ChevronDown size={14} className="opacity-70" />
      </PopoverButton>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-150"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <PopoverPanel
          className={cn(
            'absolute z-10 w-64',
            align === 'left' ? 'left-0' : 'right-0',
            panelDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          <div className="flex flex-col gap-2 bg-light-primary dark:bg-dark-primary border rounded-lg border-light-200 dark:border-dark-200 w-full p-4">
            {options.map((option) => (
              <PopoverButton
                key={option.key}
                onClick={() => handleSelect(option.key)}
                className={cn(
                  'p-2 rounded-lg flex flex-col items-start justify-start text-start space-y-1 duration-200 cursor-pointer transition',
                  activeMode === option.key
                    ? 'bg-light-secondary dark:bg-dark-secondary'
                    : 'hover:bg-light-secondary dark:hover:bg-dark-secondary',
                )}
              >
                <div className="flex flex-row items-center space-x-2 text-black dark:text-white">
                  <Microscope size={16} />
                  <p className="text-sm font-medium">{option.title}</p>
                </div>
                <p className="text-black/70 dark:text-white/70 text-xs">
                  {option.description}
                </p>
              </PopoverButton>
            ))}
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
};

export default DeepResearchToggle;
