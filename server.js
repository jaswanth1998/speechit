require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!ELEVENLABS_API_KEY });
});

// WebSocket connection handler
wss.on('connection', (clientWs) => {
  console.log('Client connected');
  
  let elevenLabsWs = null;
  let isConnected = false;

  // Handle messages from client
  clientWs.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'start') {
        // Connect to ElevenLabs WebSocket
        const wsUrl = new URL(ELEVENLABS_WS_URL);
        wsUrl.searchParams.set('model_id', 'scribe_v2_realtime');
        wsUrl.searchParams.set('language_code', data.language || 'en');
        wsUrl.searchParams.set('include_timestamps', 'true');
        wsUrl.searchParams.set('commit_strategy', 'vad'); // Voice Activity Detection
        wsUrl.searchParams.set('vad_silence_threshold_secs', '1.0');
        wsUrl.searchParams.set('vad_threshold', '0.3');
        wsUrl.searchParams.set('min_speech_duration_ms', '100');
        wsUrl.searchParams.set('min_silence_duration_ms', '1500');

        elevenLabsWs = new WebSocket(wsUrl.toString(), {
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY
          }
        });

        elevenLabsWs.on('open', () => {
          console.log('Connected to ElevenLabs');
          isConnected = true;
          clientWs.send(JSON.stringify({ type: 'connected' }));
        });

        elevenLabsWs.on('message', (msg) => {
          try {
            const response = JSON.parse(msg.toString());
            
            // Forward transcription events to client
            if (response.message_type === 'session_started') {
              clientWs.send(JSON.stringify({
                type: 'session_started',
                session_id: response.session_id,
                config: response.config
              }));
            } else if (response.message_type === 'partial_transcript') {
              clientWs.send(JSON.stringify({
                type: 'partial',
                text: response.text
              }));
            } else if (response.message_type === 'committed_transcript') {
              clientWs.send(JSON.stringify({
                type: 'final',
                text: response.text
              }));
            } else if (response.message_type === 'committed_transcript_with_timestamps') {
              clientWs.send(JSON.stringify({
                type: 'final_with_timestamps',
                text: response.text,
                language_code: response.language_code,
                words: response.words
              }));
            } else if (response.message_type && response.message_type.includes('error')) {
              clientWs.send(JSON.stringify({
                type: 'error',
                message: response.message || response.message_type
              }));
            }
          } catch (e) {
            console.error('Error parsing ElevenLabs message:', e);
          }
        });

        elevenLabsWs.on('error', (error) => {
          console.error('ElevenLabs WebSocket error:', error);
          clientWs.send(JSON.stringify({
            type: 'error',
            message: 'Connection error with transcription service'
          }));
        });

        elevenLabsWs.on('close', () => {
          console.log('ElevenLabs connection closed');
          isConnected = false;
          clientWs.send(JSON.stringify({ type: 'disconnected' }));
        });

      } else if (data.type === 'audio') {
        // Forward audio data to ElevenLabs
        if (elevenLabsWs && isConnected && elevenLabsWs.readyState === WebSocket.OPEN) {
          const audioMessage = {
            message_type: 'input_audio_chunk',
            audio_base_64: data.audio,
            sample_rate: data.sampleRate || 16000
          };
          elevenLabsWs.send(JSON.stringify(audioMessage));
        }
      } else if (data.type === 'commit') {
        // Manually commit transcription
        if (elevenLabsWs && isConnected && elevenLabsWs.readyState === WebSocket.OPEN) {
          elevenLabsWs.send(JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: '',
            commit: true
          }));
        }
      } else if (data.type === 'stop') {
        // Close ElevenLabs connection
        if (elevenLabsWs) {
          elevenLabsWs.close();
          elevenLabsWs = null;
          isConnected = false;
        }
      }
    } catch (e) {
      console.error('Error processing client message:', e);
    }
  });

  clientWs.on('close', () => {
    console.log('Client disconnected');
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
  });

  clientWs.on('error', (error) => {
    console.error('Client WebSocket error:', error);
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎤 SpeechIt server running at http://localhost:${PORT}`);
  console.log(`📝 Real-time transcription powered by ElevenLabs Scribe-v2`);
});
