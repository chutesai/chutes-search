'use client';

import { useState, useRef } from 'react';
import { Volume2, Loader2 } from 'lucide-react';

interface TTSPlayerProps {
  text: string;
  voice?: string;
  className?: string;
}

export function TTSPlayer({ text, voice = 'af_heart', className = '' }: TTSPlayerProps) {
  // Toggle to re-enable temporary download of the first audio chunk for debugging
  const DEBUG_TTS_DOWNLOAD = false;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrls, setAudioUrls] = useState<string[]>([]); // Blob/object URLs
  const [audioDataUrls, setAudioDataUrls] = useState<string[]>([]); // Base64 data URLs
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isPlayingRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const externalAudioRef = useRef<HTMLAudioElement | null>(null);

  type PlaybackMode = 1 | 2 | 3 | 4 | 5;
  const [playbackMode] = useState<PlaybackMode>(1); // hide selector, default to Mode 1
  const [showPlayModal, setShowPlayModal] = useState(false);
  const [modalState, setModalState] = useState<'loading' | 'ready'>('loading');
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [generatedChunks, setGeneratedChunks] = useState<number>(0);

  const startPlaying = () => {
    isPlayingRef.current = true;
    setIsPlaying(true);
  };

  const stopPlaying = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  // Sanitize text: strip anchor citations and generic HTML tags/attributes
  const sanitizeTextForTTS = (raw: string): string => {
    try {
      let t = raw;
      // Remove inline anchor citation pills like <a ...>1</a>
      t = t.replace(/<a\b[^>]*>\s*\d+\s*<\/a>/gi, '');
      // Strip all other anchor tags but keep inner text (if any)
      t = t.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1');
      // Markdown: remove headings like #, ##, ### at line start
      t = t.replace(/^\s*#{1,6}\s+/gm, '');
      // Markdown: remove fenced code blocks ``` ```
      t = t.replace(/```[\s\S]*?```/g, '');
      // Markdown: inline code `code`
      t = t.replace(/`([^`]+)`/g, '$1');
      // Markdown: images ![alt](url)
      t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
      // Markdown: links [text](url) -> keep text
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
      // Markdown emphasis **bold**, *italic*, __bold__, _italic_
      t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
      t = t.replace(/__([^_]+)__/g, '$1');
      t = t.replace(/\*([^*]+)\*/g, '$1');
      t = t.replace(/_([^_]+)_/g, '$1');
      // Markdown: lists and blockquotes
      t = t.replace(/^\s*[-*+]\s+/gm, '');
      t = t.replace(/^\s*\d+\.\s+/gm, '');
      t = t.replace(/^\s*>\s+/gm, '');
      // Strip any remaining HTML tags
      t = t.replace(/<[^>]+>/g, '');
      // Collapse excessive whitespace
      t = t.replace(/[\t\r]+/g, ' ');
      t = t.replace(/\s{2,}/g, ' ').trim();
      return t;
    } catch {
      return raw;
    }
  };

  // Function to split text into chunks by paragraphs or newlines
  const splitTextIntoChunks = (text: string, maxLength: number = 1800): string[] => {
    const chunks: string[] = [];

    // First try to split by paragraphs (double newlines)
    const paragraphs = text.split(/\n\s*\n/);

    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // If adding this paragraph would exceed the limit, save current chunk
      if (currentChunk.length + paragraph.length > maxLength && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    // Add the last chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // If we still have chunks that are too long, split by sentences
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length <= maxLength) {
        finalChunks.push(chunk);
      } else {
        // Split by sentences as fallback
        const sentences = chunk.split(/(?<=[.!?])\s+/);
        let sentenceChunk = '';

        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length > maxLength && sentenceChunk.length > 0) {
            finalChunks.push(sentenceChunk.trim());
            sentenceChunk = sentence;
          } else {
            sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
          }
        }

        if (sentenceChunk.trim()) {
          finalChunks.push(sentenceChunk.trim());
        }
      }
    }

    return finalChunks;
  };

  // Browser TTS fallback
  const speakWithBrowserTTS = (textToSpeak: string) => {
    return new Promise<void>((resolve) => {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve(); // Still resolve on error to continue

        window.speechSynthesis.speak(utterance);
      } else {
        resolve(); // No TTS available
      }
    });
  };

  // Prime/unlock audio playback within the user gesture
  const primePlayback = async () => {
    try {
      if (!audioRef.current) return;
      const audio = audioRef.current;
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = audioCtxRef.current || new Ctor();
      audioCtxRef.current = ctx;
      await ctx.resume();

      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0.000001; // practically silent
      osc.connect(g).connect(dest);
      osc.start();

      (audio as any).playsInline = true;
      audio.preload = 'auto';
      audio.muted = true; // ensure silence
      (audio as any).srcObject = dest.stream;
      try { await audio.play(); } catch (e) { /* ignore */ }

      // Stop the priming after a brief moment
      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
          g.disconnect();
          audio.pause();
          (audio as any).srcObject = null;
          audio.muted = false; // unmute for real playback
        } catch {}
      }, 150);
    } catch {
      // ignore
    }
  };

  // Convert a data URL (base64) to a Blob-backed object URL for more reliable playback
  const dataUrlToObjectUrl = (dataUrl: string): string => {
    try {
      const parts = dataUrl.split(',');
      const header = parts[0] || '';
      const base64 = parts[1] || '';
      const mimeMatch = header.match(/data:(.*?);base64/);
      const mime = (mimeMatch && mimeMatch[1]) || 'audio/wav';
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error('Failed converting data URL to object URL:', e);
      return dataUrl; // Fallback to original
    }
  };

  // Convert data URL to ArrayBuffer (for Web Audio decoding)
  const dataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer => {
    const parts = dataUrl.split(',');
    const base64 = parts[1] || '';
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };

  // Temporary download function to debug audio
  const downloadFirstChunk = async () => {
    if (!DEBUG_TTS_DOWNLOAD) return; // Hidden behind flag entirely
    try {
      console.log('Downloading first chunk for debugging...');
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text.substring(0, 100), // First 100 chars for testing
          voice
        }),
      });

      const data = await response.json();

      if (data.success && data.audioUrl) {
        console.log('Audio URL received:', data.audioUrl.substring(0, 100) + '...');
        // Create download link (debug only)
        const link = document.createElement('a');
        link.href = data.audioUrl;
        link.download = 'tts-debug-audio.wav';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('Download triggered for debugging');
      } else {
        console.error('Download failed:', data.error);
      }
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const generateSpeech = async () => {
    if (audioUrls.length > 0) {
      // If we already have audio chunks, just play them
      playAudioChunks();
      return;
    }

    setIsLoading(true);
    try {
      // Show modal immediately and unlock audio within click stack
      setShowPlayModal(true);
      setModalState('loading');
      setTotalChunks(0);
      setGeneratedChunks(0);
      // Unlock audio immediately within click stack
      await primePlayback();

      // Sanitize and split text into chunks
      const sanitized = sanitizeTextForTTS(text);
      console.log('[TTS] Sanitized length:', sanitized.length);
      const chunks = splitTextIntoChunks(sanitized);
      setTotalChunks(chunks.length);

      if (chunks.length === 0) {
        console.error('No text chunks to process');
        setIsLoading(false);
        return;
      }

      console.log(`Processing ${chunks.length} text chunks for TTS`);

      // Generate audio for each chunk and start playing as soon as first chunk is ready
      const urls: string[] = [];
      const dataUrls: string[] = [];
      let hasErrors = false;
      let firstChunkReady = false;

      for (let i = 0; i < chunks.length; i++) {
        try {
          console.log(`Generating audio for chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

          const response = await fetch('/api/tts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: chunks[i],
              voice
            }),
          });

          const data = await response.json();

          if (data.success && data.audioUrl) {
            const objectUrl = dataUrlToObjectUrl(data.audioUrl);
            urls.push(objectUrl);
            dataUrls.push(data.audioUrl);
            console.log(`Chunk ${i + 1} audio generated successfully`);
            setGeneratedChunks(prev => Math.min(prev + 1, chunks.length));

            // Download first chunk only when debug flag is enabled
            if (i === 0 && DEBUG_TTS_DOWNLOAD) {
              downloadFirstChunk();
            }

            // Start playing as soon as we have the first chunk ready
            if (!firstChunkReady) {
              firstChunkReady = true;
              setAudioUrls([...urls]);
              setAudioDataUrls([...dataUrls]);
              setIsLoading(false); // Allow user to stop while more chunks are loading
              // Switch modal to ready state (Play button enabled)
              setModalState('ready');

              // Continue loading remaining chunks in background
              continue;
            }

            // Update audioUrls for subsequent chunks
            setAudioUrls([...urls]);
            setAudioDataUrls([...dataUrls]);
          } else {
            console.warn(`TTS chunk ${i + 1} failed:`, data.error);
            hasErrors = true;
            break;
          }
        } catch (error) {
          console.warn(`TTS chunk ${i + 1} error:`, error);
          hasErrors = true;
          break;
        }
      }

      if (hasErrors && urls.length === 0) {
        // Fallback to browser TTS for the entire text
        console.log('Using browser TTS fallback');
        setShowPlayModal(false);
        setIsLoading(false);
        await speakWithBrowserTTS(text);
        return;
      }

      // If we had some chunks but others failed, continue with what we have
      if (hasErrors && urls.length > 0) {
        console.log(`Continuing with ${urls.length} successful chunks`);
      }

    } catch (error) {
      console.error('TTS error:', error);
      // Fallback to browser TTS
      setShowPlayModal(false);
      setIsLoading(false);
      await speakWithBrowserTTS(text);
    }
  };

  const playAudioChunks = async () => {
    if (audioUrls.length === 0) return;

    console.log('[TTS] Starting playback with mode', playbackMode);
    startPlaying();
    setCurrentChunkIndex(0);

    for (let i = 0; i < audioUrls.length; i++) {
      if (!isPlayingRef.current) break; // Stop if user clicked stop

      setCurrentChunkIndex(i);

      try {
        await new Promise<void>((resolve, reject) => {
          console.log(`[TTS] Preparing chunk ${i + 1} with mode ${playbackMode}`);
          const dataUrl = audioDataUrls[i];
          const objUrl = audioUrls[i];

          // Mode 1: HTMLAudioElement + Blob URL (default)
          const playWithAudioElementBlob = () => {
            if (!audioRef.current) { resolve(); return; }
            const audio = audioRef.current;
            const cleanup = () => {
              audio.oncanplay = null;
              audio.oncanplaythrough = null;
              audio.onloadeddata = null;
              audio.onloadedmetadata = null;
              audio.onplay = null;
              audio.onplaying = null;
              (audio as any).ontimeupdate = null;
              audio.onpause = null;
              audio.onended = null;
              audio.onerror = null;
            };
            const tryPlay = async () => {
              try {
                console.log(`[TTS] play() called for chunk ${i + 1}`);
                audio.muted = false;
                audio.volume = 1.0;
                await audio.play();
                console.log(`[TTS] play() promise resolved for chunk ${i + 1}`);
              } catch (e) {
                console.error('[TTS] play() failed:', e);
                cleanup();
                reject(e);
              }
            };
            audio.oncanplaythrough = tryPlay;
            audio.oncanplay = tryPlay;
            audio.onloadeddata = () => { console.log('[TTS] onloadeddata'); if (audio.paused) tryPlay(); };
            audio.onloadedmetadata = () => { console.log('[TTS] onloadedmetadata'); if (audio.paused) tryPlay(); };
            audio.onplay = () => console.log('[TTS] onplay');
            audio.onplaying = () => console.log('[TTS] onplaying');
            (audio as any).ontimeupdate = () => console.log('[TTS] ontimeupdate', audio.currentTime.toFixed(2));
            audio.onpause = () => console.log('[TTS] onpause');
            audio.onended = () => {
              console.log(`{[TTS]} onended chunk ${i + 1}`);
              try { if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src); } catch {}
              cleanup();
              resolve();
            };
            audio.onerror = () => {
              console.error('[TTS] onerror', audio.error);
              try { if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src); } catch {}
              cleanup();
              reject(new Error('Audio playback failed'));
            };
            try {
              audio.pause();
              audio.currentTime = 0;
              audio.preload = 'auto';
              (audio as any).playsInline = true;
            } catch {}
            audio.src = objUrl;
            audio.load();
          };

          // Mode 2: Web Audio API (decode and play buffer)
          const playWithWebAudio = async () => {
            try {
              const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
              const ctx: AudioContext = audioCtxRef.current || new Ctor();
              audioCtxRef.current = ctx;
              await ctx.resume();
              const arr = dataUrlToArrayBuffer(dataUrl);
              const buffer = await new Promise<AudioBuffer>((resolve, reject) =>
                ctx.decodeAudioData(arr.slice(0), resolve, reject)
              );
              const source = ctx.createBufferSource();
              currentSourceRef.current = source;
              const gain = gainRef.current || ctx.createGain();
              gainRef.current = gain;
              gain.gain.value = 1.0;
              source.buffer = buffer;
              source.connect(gain).connect(ctx.destination);
              source.onended = () => { console.log(`[TTS] WebAudio ended chunk ${i + 1}`); currentSourceRef.current = null; resolve(); };
              console.log('[TTS] WebAudio start');
              source.start(0);
            } catch (e) {
              console.error('[TTS] WebAudio error', e);
              reject(e);
            }
          };

          // Mode 3: HTMLAudioElement + data URL
          const playWithAudioElementDataUrl = () => {
            if (!audioRef.current) { resolve(); return; }
            const audio = audioRef.current;
            const cleanup = () => {
              audio.oncanplay = null;
              audio.oncanplaythrough = null;
              audio.onloadeddata = null;
              audio.onloadedmetadata = null;
              audio.onplay = null;
              audio.onplaying = null;
              (audio as any).ontimeupdate = null;
              audio.onpause = null;
              audio.onended = null;
              audio.onerror = null;
            };
            const tryPlay = async () => {
              try {
                console.log(`[TTS] (dataURL) play() called for chunk ${i + 1}`);
                audio.muted = false;
                audio.volume = 1.0;
                await audio.play();
                console.log(`[TTS] (dataURL) play() resolved for chunk ${i + 1}`);
              } catch (e) {
                console.error('[TTS] (dataURL) play() failed:', e);
                cleanup();
                reject(e);
              }
            };
            audio.oncanplaythrough = tryPlay;
            audio.oncanplay = tryPlay;
            audio.onloadeddata = () => { console.log('[TTS] (dataURL) onloadeddata'); if (audio.paused) tryPlay(); };
            audio.onloadedmetadata = () => { console.log('[TTS] (dataURL) onloadedmetadata'); if (audio.paused) tryPlay(); };
            audio.onplay = () => console.log('[TTS] (dataURL) onplay');
            audio.onplaying = () => console.log('[TTS] (dataURL) onplaying');
            (audio as any).ontimeupdate = () => console.log('[TTS] (dataURL) ontimeupdate', audio.currentTime.toFixed(2));
            audio.onpause = () => console.log('[TTS] (dataURL) onpause');
            audio.onended = () => { console.log(`[TTS] (dataURL) onended chunk ${i + 1}`); cleanup(); resolve(); };
            audio.onerror = () => { console.error('[TTS] (dataURL) onerror', audio.error); cleanup(); reject(new Error('Audio playback failed')); };
            try {
              audio.pause();
              audio.currentTime = 0;
              audio.preload = 'auto';
              (audio as any).playsInline = true;
            } catch {}
            audio.src = dataUrl;
            audio.load();
          };

          // Mode 4: New ephemeral Audio element with Blob URL
          const playWithNewAudio = () => {
            try {
              const el = new Audio();
              externalAudioRef.current = el;
              el.preload = 'auto';
              (el as any).playsInline = true;
              el.muted = false;
              el.volume = 1.0;
              el.oncanplaythrough = async () => {
                try {
                  console.log('[TTS] new Audio play');
                  await el.play();
                } catch (e) {
                  console.error('[TTS] new Audio play() failed', e);
                  reject(e);
                }
              };
              el.onended = () => { console.log('[TTS] new Audio ended'); try { if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src); } catch {} resolve(); };
              el.onerror = () => { console.error('[TTS] new Audio error', el.error); try { if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src); } catch {} reject(new Error('Audio playback failed')); };
              el.src = objUrl;
              el.load();
            } catch (e) {
              reject(e);
            }
          };

          // Mode 5: Web Audio -> MediaStreamDestination -> HTMLAudioElement
          const playWithWebAudioToMedia = async () => {
            if (!audioRef.current) { resolve(); return; }
            try {
              const audio = audioRef.current;
              const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
              const ctx: AudioContext = audioCtxRef.current || new Ctor();
              audioCtxRef.current = ctx;
              await ctx.resume();
              const arr = dataUrlToArrayBuffer(dataUrl);
              const buffer = await new Promise<AudioBuffer>((resolve2, reject2) =>
                ctx.decodeAudioData(arr.slice(0), resolve2, reject2)
              );
              const source = ctx.createBufferSource();
              currentSourceRef.current = source;
              const dest = mediaDestRef.current || ctx.createMediaStreamDestination();
              mediaDestRef.current = dest;
              const gain = gainRef.current || ctx.createGain();
              gainRef.current = gain;
              gain.gain.value = 1.0;
              source.buffer = buffer;
              source.connect(gain).connect(dest);
              (audio as any).srcObject = dest.stream;
              source.onended = () => { console.log('[TTS] WebAudio->Media ended'); currentSourceRef.current = null; resolve(); };
              console.log('[TTS] WebAudio->Media start');
              try { await audio.play(); } catch {}
              source.start(0);
            } catch (e) {
              console.error('[TTS] WebAudio->Media error', e);
              reject(e);
            }
          };

          switch (playbackMode) {
            case 1: return playWithAudioElementBlob();
            case 2: return void playWithWebAudio();
            case 3: return playWithAudioElementDataUrl();
            case 4: return playWithNewAudio();
            case 5: return void playWithWebAudioToMedia();
            default: return playWithAudioElementBlob();
          }
        });

        // Check if more chunks are available now
        if (i + 1 >= audioUrls.length) {
          // Wait a bit to see if more chunks become available
          let waitCount = 0;
          while (i + 1 >= audioUrls.length && waitCount < 50 && isPlayingRef.current) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
          }
        }

        // Add pause between chunks (0.3 seconds) if there are more chunks
        if (i + 1 < audioUrls.length && isPlayingRef.current) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (error) {
        console.error('Error playing chunk:', error);
        // Continue with next chunk instead of stopping entirely
      }
    }

    stopPlaying();
    setCurrentChunkIndex(0);
  };

  const stopPlayback = () => {
    stopPlaying();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      try {
        if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(audioRef.current.src);
          audioRef.current.src = '';
        }
      } catch {}
    }
    if (externalAudioRef.current) {
      try {
        externalAudioRef.current.pause();
        if (externalAudioRef.current.src && externalAudioRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(externalAudioRef.current.src);
        }
      } catch {}
      externalAudioRef.current = null;
    }
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(0); } catch {}
      try { currentSourceRef.current.disconnect(); } catch {}
      currentSourceRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.suspend(); } catch {}
    }
    // Stop browser TTS if it's speaking
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleAudioEnded = () => {
    // Don't automatically stop - let playAudioChunks handle the flow
  };

  return (
    <div className={`inline-flex items-center ${className}`}>
      <button
        onClick={isPlaying ? stopPlayback : generateSpeech}
        disabled={isLoading}
        className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={isPlaying ? "Stop listening" : "Listen to this message"}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Volume2 className={`w-4 h-4 ${isPlaying ? 'text-green-600' : 'text-gray-500'}`} />
        )}
      </button>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        className="hidden"
        controls={false}
      />

      {showPlayModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
          <div className="bg-white dark:bg-gray-900 border border-black/5 dark:border-white/10 rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-black dark:text-white font-semibold">Text to Speech</div>
            </div>
            {modalState === 'loading' ? (
              <div className="flex items-center space-x-3 text-black dark:text-white">
                <Loader2 className="w-5 h-5 animate-spin text-[#24A0ED]" />
                <div className="text-sm">
                  Generating audio{totalChunks > 0 ? ` (${generatedChunks}/${totalChunks})` : ''}...
                </div>
              </div>
            ) : (
              <>
                <div className="text-sm text-black/80 dark:text-white/80 mb-4">
                  Audio is ready. Press Play to start the narration.
                </div>
                <div className="flex items-center justify-end space-x-2">
                  <button
                    className="px-3 py-1.5 rounded-md text-sm bg-gray-200 dark:bg-gray-800 text-black dark:text-white"
                    onClick={() => setShowPlayModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-md text-sm bg-[#24A0ED] hover:brightness-110 text-white"
                    onClick={() => { setShowPlayModal(false); playAudioChunks(); }}
                  >
                    Play
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
