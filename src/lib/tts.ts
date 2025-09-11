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

export async function generateSpeech(request: TTSRequest): Promise<TTSResponse> {
  try {
    const apiKey = process.env.CHUTES_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        error: 'CHUTES_API_KEY environment variable not set'
      };
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const body = {
      text: request.text,
      voice: request.voice || 'af_heart' // Default voice
    };

    console.log('Generating speech for text:', request.text.substring(0, 100) + '...');

    const response = await axios.post(KOKORO_API_URL, body, {
      headers,
      responseType: 'arraybuffer', // Get binary data for audio
      timeout: 30000 // 30 second timeout
    });

    if (response.status === 200) {
      // Convert the audio buffer to a base64 string for easy transmission
      const audioBuffer = Buffer.from(response.data);
      const audioBase64 = audioBuffer.toString('base64');

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
// Force redeploy
