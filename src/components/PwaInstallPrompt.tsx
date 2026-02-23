'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, X } from 'lucide-react';

const PWA_DISMISS_KEY = 'pwa-install-dismissed';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Don't show if already installed as standalone PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Don't show if recently dismissed
    const dismissed = localStorage.getItem(PWA_DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < DISMISS_DURATION_MS) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!deferredPrompt) return;

    const toastId = toast(
      <div className="flex items-center gap-3 w-full">
        <Download className="w-5 h-5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">Install Chutes Search</p>
          <p className="text-xs opacity-70">
            Add to your home screen for quick access
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#10a37f] text-white hover:bg-[#0d8c6d] transition-colors"
            onClick={async () => {
              await deferredPrompt.prompt();
              const { outcome } = await deferredPrompt.userChoice;
              if (outcome === 'accepted') {
                setDeferredPrompt(null);
              }
              toast.dismiss(toastId);
            }}
          >
            Install
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            onClick={() => {
              localStorage.setItem(PWA_DISMISS_KEY, String(Date.now()));
              setDeferredPrompt(null);
              toast.dismiss(toastId);
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>,
      {
        duration: Infinity,
        id: 'pwa-install',
      },
    );
  }, [deferredPrompt]);

  return null;
}
