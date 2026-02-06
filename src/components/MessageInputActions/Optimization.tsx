import { ChevronDown, Star, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { useChat } from '@/lib/hooks/useChat';

const OptimizationModes = [
  {
    key: 'speed',
    title: 'Speed',
    description: 'Prioritize speed and get the quickest possible answer.',
    icon: <Zap size={20} className="text-[#FF9800]" />,
    model: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
  },
  {
    key: 'balanced', // keep identifier as 'balanced' but label it as Quality
    title: 'Quality',
    description: 'Highest possible quality and depth.',
    icon: (
      <Star
        size={16}
        className="text-[#2196F3] dark:text-[#BBDEFB] fill-[#BBDEFB] dark:fill-[#2196F3]"
      />
    ),
    model: 'moonshotai/Kimi-K2.5-TEE',
  },
];

const Optimization = ({
  compact = false,
  align = 'right',
  panelDirection = 'down',
}: {
  compact?: boolean;
  align?: 'left' | 'right';
  panelDirection?: 'up' | 'down';
}) => {
  const { optimizationMode, setOptimizationMode } = useChat();

  return (
    <Popover
      className={cn(
        'relative w-auto',
      )}
    >
      <PopoverButton
        type="button"
        aria-label={`Response mode: ${OptimizationModes.find((mode) => mode.key === optimizationMode)?.title ?? 'Speed'}`}
        className={cn(
          'text-black/50 dark:text-white/50 rounded-xl hover:bg-light-secondary dark:hover:bg-dark-secondary active:scale-95 transition duration-200 hover:text-black dark:hover:text-white',
          compact ? 'p-2' : 'p-2',
        )}
      >
        <div className="flex flex-row items-center space-x-1">
          {
            OptimizationModes.find((mode) => mode.key === optimizationMode)
              ?.icon
          }
          {!compact && (
            <>
              <p className="text-xs font-medium">
                {
                  OptimizationModes.find((mode) => mode.key === optimizationMode)
                    ?.title
                }
              </p>
              <ChevronDown size={20} />
            </>
          )}
        </div>
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
            'absolute z-10 w-64 md:w-[250px]',
            align === 'left' ? 'left-0' : 'right-0',
            panelDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          <div className="flex flex-col gap-2 bg-light-primary dark:bg-dark-primary border rounded-lg border-light-200 dark:border-dark-200 w-full p-4 max-h-[200px] md:max-h-none overflow-y-auto">
            {OptimizationModes.map((mode, i) => (
              <PopoverButton
                onClick={() => setOptimizationMode(mode.key)}
                key={i}
                className={cn(
                  'p-2 rounded-lg flex flex-col items-start justify-start text-start space-y-1 duration-200 cursor-pointer transition',
                  optimizationMode === mode.key
                    ? 'bg-light-secondary dark:bg-dark-secondary'
                    : 'hover:bg-light-secondary dark:hover:bg-dark-secondary',
                )}
              >
                <div className="flex flex-row items-center space-x-1 text-black dark:text-white">
                  {mode.icon}
                  <p className="text-sm font-medium">{mode.title}</p>
                </div>
                <p className="text-black/70 dark:text-white/70 text-xs">
                  {mode.description}
                </p>
              </PopoverButton>
            ))}
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
};

export default Optimization;
