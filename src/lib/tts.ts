import axios from 'axios';

export interface TTSRequest {
  text: string;
  voice?: string;
}

export interface TTSResponse {
  success: boolean;
  audioUrl?: string;
  error?: string;
}

const KOKORO_API_URL = 'https://chutes-kokoro.chutes.ai/speak';

export async function generateSpeech(
  request: TTSRequest,
  apiKey: string,
): Promise<TTSResponse> {
  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const body = {
      text: request.text,
      voice: request.voice || 'af_heart' // Default voice
    };

    console.log(`[tts] Generating speech (chars=${request.text.length})`);

    const response = await axios.post(KOKORO_API_URL, body, {
      headers,
      responseType: 'arraybuffer', // Get binary data for audio
      timeout: 45000 // 45 second timeout for TTS generation
    });

    if (response.status === 200) {
      // Convert the audio buffer to a base64 string for easy transmission
      const audioBuffer = Buffer.from(response.data);
      const audioBase64 = audioBuffer.toString('base64');

      // Check if the base64 string is too large (> 10MB)
      if (audioBase64.length > 10 * 1024 * 1024) {
        return {
          success: false,
          error: 'Generated audio is too large'
        };
      }

      // Prefer returning as data URL; the client will convert to Blob URL for playback
      return {
        success: true,
        audioUrl: `data:audio/wav;base64,${audioBase64}`
      };
    } else {
      return {
        success: false,
        error: `TTS API returned status ${response.status}`
      };
    }
  } catch (error: any) {
    console.error('TTS generation error:', error);
    return {
      success: false,
      error: error.message || 'Failed to generate speech'
    };
  }
}

export const AVAILABLE_VOICES = [
  { id: 'af_heart', name: 'Heart (Female)', language: 'English' },
  // Add more voices as they become available from the API
];
