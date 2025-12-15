'use client';

import {
  Description,
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback, useMemo } from 'react';
import { Lock, LogIn } from 'lucide-react';
import { useChat } from '@/lib/hooks/useChat';

export default function FreeSearchGateDialog() {
  const { freeSearchGate } = useChat();

  const isOpen = Boolean(freeSearchGate?.open);
  const count = freeSearchGate?.count ?? 0;
  const limit = freeSearchGate?.limit ?? 3;

  const title = 'Sign in to keep searching';
  const body = `You’ve used ${count}/${limit} free searches today. Sign in with your Chutes account to continue searching.`;

  const onSignIn = useCallback(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    if (freeSearchGate?.pendingQuery) {
      url.searchParams.set('q', freeSearchGate.pendingQuery);
    }
    const returnTo = url.pathname + url.search;
    window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  }, [freeSearchGate?.pendingQuery]);

  const onClose = useMemo(() => () => {}, []);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <DialogBackdrop className="fixed inset-0 bg-black/50" />
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-100"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-md transform rounded-2xl bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-light-secondary dark:bg-dark-secondary p-2 border border-light-200 dark:border-dark-200">
                    <Lock size={18} className="text-black/70 dark:text-white/70" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-lg font-semibold text-black dark:text-white">
                      {title}
                    </DialogTitle>
                    <Description className="mt-1 text-sm text-black/70 dark:text-white/70">
                      {body}
                    </Description>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    onClick={onSignIn}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#24A0ED] px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                  >
                    <LogIn size={16} />
                    Sign in with Chutes
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
