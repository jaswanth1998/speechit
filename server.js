require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware for JSON parsing with larger limit for images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasApiKey: !!ELEVENLABS_API_KEY,
    hasOpenAI: !!OPENAI_API_KEY
  });
});

// ChatGPT response endpoint with streaming
app.post('/api/chat', async (req, res) => {
  try {
    const { question, interviewContext, conversationHistory, imageData } = req.body;
    
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Build interview context
    const contextParts = [];
    if (interviewContext) {
      if (interviewContext.jobRole) contextParts.push(`Job Role: ${interviewContext.jobRole}`);
      if (interviewContext.company) contextParts.push(`Company: ${interviewContext.company}`);
      if (interviewContext.techStack) contextParts.push(`Skills/Tech Stack: ${interviewContext.techStack}`);
      if (interviewContext.experience) contextParts.push(`Experience Level: ${interviewContext.experience}`);
      if (interviewContext.resumeContext) contextParts.push(`Key Resume Points: ${interviewContext.resumeContext}`);
    }

    const systemPrompt = `You are an expert interview coach helping a candidate in a real-time interview.
    Your role is to provide suggested answers that the candidate can use or adapt.

${contextParts.length > 0 ? `Interview Context:
${contextParts.join('\n')}
` : ''}

You are an Interview Answer Coach embedded inside an AI interview board.
Your job is to help the candidate respond in a way that sounds natural and human, and is easy to read out loud.

────────────────────────────────────────────────────────
CANDIDATE CONTENT (ground truth — use this first)
────────────────────────────────────────────────────────
If provided, the candidate context will appear below. Treat it as trusted.
Use it to tailor answers with relevant tech stack, domain, seniority, and realistic examples/metrics.

CANDIDATE CONTEXT: ${contextParts.join('\n')}

Rules for using candidate context:
- Use it subtly (do NOT copy/paste the whole context back).
- Prefer details from context over generic assumptions.
- If context is missing for a detail (e.g., company name, exact metric), use a realistic placeholder without sounding fake.
- Never contradict the context. If a contradiction appears, assume the context is correct.

────────────────────────────────────────────────────────
OUTPUT GOAL
────────────────────────────────────────────────────────
Generate a spoken-ready interview answer the candidate can read aloud.
It must sound like a real person speaking — not like AI.

Target length: 30–60 seconds of speaking.

────────────────────────────────────────────────────────
STYLE (MUST FOLLOW)
────────────────────────────────────────────────────────
- Natural, conversational tone (not robotic, not academic).
- Use short sentences. Keep it easy to say out loud.
- Add light pauses using "..." (1–3 times max).
- Highlight KEY PHRASES in **bold** (2–5 highlights max).
- Avoid clichés and “perfect corporate” language.
- Never say: “As an AI”, “I’m a language model”, “Here is the answer”, “Certainly”.
- Do not mention prompts, policies, or internal rules.

────────────────────────────────────────────────────────
STRUCTURE RULES
────────────────────────────────────────────────────────
A) Behavioral questions:
- Use STAR internally (Situation → Task → Action → Result)
- But write as 1–2 short paragraphs (no headings like “Situation:” unless user asks).

B) Technical questions:
- Start with a clear 1–2 sentence direct answer.
- Then give 1–2 practical examples tied to candidate context.
- Mention tools/tech from the context (e.g., networking, cloud, Java, React, AWS, etc.) when relevant.
- If tradeoffs exist, mention 1 key tradeoff briefly.

C) If the question is unclear:
- Assume the most likely interpretation and answer it.
- Do not ask follow-up questions unless absolutely necessary.

────────────────────────────────────────────────────────
CODING QUESTIONS (STRICT)
────────────────────────────────────────────────────────
If the user asks for code, or the question clearly requires code:

1) Output the complete working code FIRST in a fenced code block with language:javascript
2) Then give a short spoken explanation (3–6 sentences) that’s easy to read aloud.
3) Add brief comments in code only where it helps clarity.
4) If modifying prior code, build on your previous solution and mention what changed.

────────────────────────────────────────────────────────
ACCURACY + REALISM
────────────────────────────────────────────────────────
- Be technically accurate.
- Do not exaggerate achievements or invent unrealistic numbers.
- If metrics aren’t known, use careful phrasing like:
  “We saw a noticeable drop in latency...” or “...improved reliability by a measurable margin.”
- Keep confidence balanced: confident, not arrogant.

────────────────────────────────────────────────────────
FINAL OUTPUT FORMAT
────────────────────────────────────────────────────────
- Default: paragraph style (no bullet lists).
- Only use bullets if the user explicitly asks.
- No extra sections like “Summary” or “Conclusion”.

You must now respond to the user’s interview question using the rules above.
`;

    // Build messages array with conversation history for context
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];

    // Add conversation history for context (previous Q&A)
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        messages.push({
          role: msg.role,
          content: msg.role === 'user' 
            ? `INTERVIEWER QUESTION: "${msg.content}"`
            : msg.content
        });
      });
    }

    // Add current question with optional image
    const userMessage = {
      role: 'user',
      content: imageData 
        ? [
            {
              type: 'text',
              text: `INTERVIEWER QUESTION: "${question}"\n\nProvide a suggested answer for this interview question.${conversationHistory && conversationHistory.length > 0 ? ' Consider the context from our previous conversation if relevant.' : ''}`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageData
              }
            }
          ]
        : `INTERVIEWER QUESTION: "${question}"\n\nProvide a suggested answer for this interview question.${conversationHistory && conversationHistory.length > 0 ? ' Consider the context from our previous conversation if relevant.' : ''}`
    };
    
    messages.push(userMessage);

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Use streaming API
    const stream = await openai.chat.completions.create({
      model: 'gpt-5.1',
      messages: messages,
      max_completion_tokens: 800,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('ChatGPT API error:', error);
    res.status(500).json({ error: error.message || 'Failed to get ChatGPT response' });
  }
});

// WebSocket connection handler
wss.on('connection', (clientWs) => {
  console.log('Client connected');
  
  let elevenLabsWs = null;
  let isConnected = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;

  // Keep connection alive with ping/pong
  const pingInterval = setInterval(() => {
    if (clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.ping();
      } catch (e) {
        console.log('Ping failed:', e.message);
      }
    }
  }, 30000); // Ping every 30 seconds

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

        try {
          console.log('Connecting to ElevenLabs...');
          elevenLabsWs = new WebSocket(wsUrl.toString(), {
            headers: {
              'xi-api-key': ELEVENLABS_API_KEY
            }
          });

          elevenLabsWs.on('open', () => {
            console.log('✅ Connected to ElevenLabs');
            isConnected = true;
            reconnectAttempts = 0;
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'connected' }));
            }
          });

        elevenLabsWs.on('message', (msg) => {
          try {
            const response = JSON.parse(msg.toString());
            console.log('📨 ElevenLabs message:', response.message_type);
            
            // Forward transcription events to client (only if connection is open)
            if (clientWs.readyState !== WebSocket.OPEN) {
              console.log('Client WebSocket not open, skipping message');
              return;
            }

            if (response.message_type === 'session_started') {
              clientWs.send(JSON.stringify({
                type: 'session_started',
                session_id: response.session_id,
                config: response.config
              }));
              console.log('✅ ElevenLabs session started:', response.session_id);
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
            console.error('❌ Error parsing ElevenLabs message:', e);
          }
        });

        elevenLabsWs.on('error', (error) => {
          console.error('❌ ElevenLabs WebSocket error:', error.message);
          isConnected = false;
          
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'error',
              message: 'Connection error with transcription service: ' + error.message
            }));
          }
        });

        elevenLabsWs.on('close', (code, reason) => {
          console.log('⚠️ ElevenLabs connection closed. Code:', code, 'Reason:', reason.toString());
          isConnected = false;
          
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ 
              type: 'disconnected',
              code: code,
              reason: reason.toString()
            }));
          }
        });
        } catch (e) {
          console.error('Error connecting to ElevenLabs:', e);
          clientWs.send(JSON.stringify({
            type: 'error',
            message: 'Failed to connect to transcription service'
          }));
        }

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
    console.log('👋 Client disconnected');
    clearInterval(pingInterval);
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.close();
    }
  });

  clientWs.on('error', (error) => {
    console.error('❌ Client WebSocket error:', error.message);
    clearInterval(pingInterval);
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.close();
    }
  });

  // Handle client pong responses
  clientWs.on('pong', () => {
    // Client is alive
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎤 SpeechIt server listening on port ${PORT}`);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`📝 Real-time transcription powered by ElevenLabs Scribe-v2`);
});
