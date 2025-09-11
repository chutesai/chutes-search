'use client';

import { useState, useRef } from 'react';
import { Volume2, Loader2 } from 'lucide-react';

interface TTSPlayerProps {
  text: string;
  voice?: string;
  className?: string;
}

export function TTSPlayer({ text, voice = 'af_heart', className = '' }: TTSPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

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

  const generateSpeech = async () => {
    if (audioUrls.length > 0) {
      // If we already have audio chunks, just play them
      playAudioChunks();
      return;
    }

    setIsLoading(true);
    try {
      // Split text into chunks
      const chunks = splitTextIntoChunks(text);

      if (chunks.length === 0) {
        console.error('No text chunks to process');
        setIsLoading(false);
        return;
      }

      console.log(`Processing ${chunks.length} text chunks for TTS`);

      // Generate audio for each chunk and start playing as soon as first chunk is ready
      const urls: string[] = [];
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
            urls.push(data.audioUrl);
            console.log(`Chunk ${i + 1} audio generated successfully`);

            // Start playing as soon as we have the first chunk ready
            if (!firstChunkReady) {
              firstChunkReady = true;
              setAudioUrls([...urls]);
              setIsLoading(false); // Allow user to stop while more chunks are loading
              playAudioChunks();

              // Continue loading remaining chunks in background
              continue;
            }

            // Update audioUrls for subsequent chunks
            setAudioUrls([...urls]);
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
      setIsLoading(false);
      await speakWithBrowserTTS(text);
    }
  };

  const playAudioChunks = async () => {
    if (audioUrls.length === 0) return;

    setIsPlaying(true);
    setCurrentChunkIndex(0);

    for (let i = 0; i < audioUrls.length; i++) {
      if (!isPlaying) break; // Stop if user clicked stop

      setCurrentChunkIndex(i);

      try {
        await new Promise<void>((resolve, reject) => {
          if (!audioRef.current) {
            resolve();
            return;
          }

          const audio = audioRef.current;

          // Set up event handlers
          const cleanup = () => {
            audio.oncanplay = null;
            audio.onended = null;
            audio.onerror = null;
          };

          audio.oncanplay = async () => {
            try {
              console.log(`Playing chunk ${i + 1}/${audioUrls.length}`);
              await audio.play();
              console.log(`Chunk ${i + 1} started playing`);
            } catch (playError) {
              console.error('Audio play failed:', playError);
              cleanup();
              reject(playError);
            }
          };

          audio.onended = () => {
            console.log(`Chunk ${i + 1} ended`);
            cleanup();
            resolve();
          };

          audio.onerror = (error) => {
            console.error('Audio error:', error);
            cleanup();
            reject(new Error('Audio playback failed'));
          };

          // Load the audio source
          audio.src = audioUrls[i];
          audio.load();
        });

        // Check if more chunks are available now
        if (i + 1 >= audioUrls.length) {
          // Wait a bit to see if more chunks become available
          let waitCount = 0;
          while (i + 1 >= audioUrls.length && waitCount < 50 && isPlaying) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
          }
        }

        // Add pause between chunks (0.3 seconds) if there are more chunks
        if (i + 1 < audioUrls.length && isPlaying) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (error) {
        console.error('Error playing chunk:', error);
        // Continue with next chunk instead of stopping entirely
      }
    }

    setIsPlaying(false);
    setCurrentChunkIndex(0);
  };

  const stopPlayback = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
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
      />
    </div>
  );
}
