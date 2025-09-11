'use client';

import { useState, useRef } from 'react';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';

interface TTSPlayerProps {
  text: string;
  voice?: string;
  className?: string;
}

export function TTSPlayer({ text, voice = 'af_heart', className = '' }: TTSPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const generateSpeech = async () => {
    if (audioUrl) {
      // If we already have audio, just play it
      playAudio();
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice
        }),
      });

      const data = await response.json();

      if (data.success && data.audioUrl) {
        setAudioUrl(data.audioUrl);
        playAudio();
      } else {
        console.error('TTS failed:', data.error);
      }
    } catch (error) {
      console.error('TTS error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const playAudio = () => {
    if (audioRef.current && audioUrl) {
      audioRef.current.src = audioUrl;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  return (
    <div className={`inline-flex items-center ${className}`}>
      <button
        onClick={generateSpeech}
        disabled={isLoading}
        className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Listen to this message"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isPlaying ? (
          <Volume2 className="w-4 h-4 text-green-600" />
        ) : (
          <VolumeX className="w-4 h-4 text-gray-500" />
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
