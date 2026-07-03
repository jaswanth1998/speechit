class InterviewAssistantApp {
  constructor() {
    this.ws = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.processor = null;
    this.analyser = null;
    this.isRecording = false;
    this.startTime = null;
    this.durationInterval = null;
    this.currentQuestion = '';
    this.selectedMicrophoneId = null;
    this.audioDevices = [];
    this.audioSource = 'microphone'; // Default to microphone (more reliable)
    this.systemAudioStream = null;
    this.questionCount = 0;
    this.questionDetectionTimeout = null;
    this.isGeneratingAnswer = false;
    this.answerHistory = [];
    this.currentStreamingAnswer = '';
    this.showAnswerQuestions = true;
    this.conversationHistory = []; // Track Q&A for context

    this.pcmBuffer = [];                  // temp buffer for PCM samples
    this.PCM_SAMPLES_PER_CHUNK = 1600; 
    // Interview context
    this.interviewContext = {
      jobRole: '',
      company: '',
      techStack: '', 
      experience: 'mid',
      resumeContext: ''
    };

    // DOM elements
    this.recordBtn = document.getElementById('recordBtn');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.transcript = document.getElementById('transcript');
    this.partialText = document.getElementById('partialText');
    this.languageSelect = document.getElementById('language');
    this.microphoneSelect = document.getElementById('microphone');
    this.audioSourceSelect = document.getElementById('audioSource');
    this.answerPanel = document.getElementById('answerPanel');
    this.answerStatus = document.getElementById('answerStatus');
    this.clearTranscriptBtn = document.getElementById('clearTranscriptBtn');
    this.clearAnswerBtn = document.getElementById('clearAnswerBtn');
    this.copyAnswerBtn = document.getElementById('copyAnswerBtn');
    this.regenerateBtn = document.getElementById('regenerateBtn');
    this.questionCountEl = document.getElementById('questionCount');
    this.duration = document.getElementById('duration');
    this.interviewStatusEl = document.getElementById('interviewStatus');
    this.visualizer = document.getElementById('visualizer');
    this.canvasCtx = this.visualizer.getContext('2d');
    this.microphoneContainer = document.getElementById('microphoneContainer');

    // Setup fields
    this.jobRoleInput = document.getElementById('jobRole');
    this.companyInput = document.getElementById('company');
    this.techStackInput = document.getElementById('techStack');
    this.experienceSelect = document.getElementById('experience');
    this.resumeContextInput = document.getElementById('resumeContext');

    // Expand/resize elements
    this.answerContainer = document.getElementById('answerContainer');
    this.expandAnswerBtn = document.getElementById('expandAnswerBtn');
    this.resizeHandle = document.getElementById('resizeHandle');
    this.isExpanded = false;
    this.isResizing = false;
    this.overlay = null;

    // Manual input elements
    this.manualQuestionInput = document.getElementById('manualQuestionInput');
    this.imageUpload = document.getElementById('imageUpload');
    this.imagePreview = document.getElementById('imagePreview');
    this.previewImg = document.getElementById('previewImg');
    this.removeImageBtn = document.getElementById('removeImage');
    this.submitManualQuestionBtn = document.getElementById('submitManualQuestion');
    this.uploadedImageData = null;

    this.init();
  }

  async init() {
    // Main controls
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.clearTranscriptBtn.addEventListener('click', () => this.clearQuestion());
    this.clearAnswerBtn.addEventListener('click', () => this.clearAnswer());
    this.copyAnswerBtn.addEventListener('click', () => this.copyAnswer());
    this.regenerateBtn.addEventListener('click', () => this.regenerateAnswer());
    this.microphoneSelect.addEventListener('change', (e) => this.onMicrophoneChange(e));
    this.audioSourceSelect.addEventListener('change', (e) => this.onAudioSourceChange(e));
    
    // Manual input controls
    this.submitManualQuestionBtn.addEventListener('click', () => this.submitManualQuestion());
    this.imageUpload.addEventListener('change', (e) => this.handleImageUpload(e));
    this.removeImageBtn.addEventListener('click', () => this.removeImage());
    this.manualQuestionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitManualQuestion();
      }
    });
    
    // Handle paste for images
    this.manualQuestionInput.addEventListener('paste', (e) => this.handlePaste(e));
    document.addEventListener('paste', (e) => {
      // Only handle paste if textarea is focused or no other input is focused
      if (document.activeElement === this.manualQuestionInput || 
          !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        this.handlePaste(e);
      }
    });
    
    // Expand/resize controls
    this.expandAnswerBtn.addEventListener('click', () => this.toggleExpand());
    this.initResize();
    
    // Setup fields listeners
    this.jobRoleInput.addEventListener('input', () => this.updateInterviewContext());
    this.companyInput.addEventListener('input', () => this.updateInterviewContext());
    this.techStackInput.addEventListener('input', () => this.updateInterviewContext());
    this.experienceSelect.addEventListener('change', () => this.updateInterviewContext());
    this.resumeContextInput.addEventListener('input', () => this.updateInterviewContext());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
    
    // Load available microphones
    await this.loadAudioDevices();
    
    // Update audio source UI
    this.onAudioSourceChange({ target: this.audioSourceSelect });
    
    // Resize canvas
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Draw initial visualizer
    this.drawIdleVisualizer();

    // Load saved context from localStorage
    this.loadSavedContext();
  }

  updateInterviewContext() {
    this.interviewContext = {
      jobRole: this.jobRoleInput.value,
      company: this.companyInput.value,
      techStack: this.techStackInput.value,
      experience: this.experienceSelect.value,
      resumeContext: this.resumeContextInput.value
    };
    
    // Save to localStorage
    localStorage.setItem('interviewContext', JSON.stringify(this.interviewContext));
  }

  loadSavedContext() {
    const saved = localStorage.getItem('interviewContext');
    if (saved) {
      try {
        this.interviewContext = JSON.parse(saved);
        this.jobRoleInput.value = this.interviewContext.jobRole || '';
        this.companyInput.value = this.interviewContext.company || '';
        this.techStackInput.value = this.interviewContext.techStack || '';
        this.experienceSelect.value = this.interviewContext.experience || 'mid';
        this.resumeContextInput.value = this.interviewContext.resumeContext || '';
      } catch (e) {
        console.log('Could not load saved context');
      }
    }
  }

  resizeCanvas() {
    const container = this.visualizer.parentElement;
    this.visualizer.width = container.clientWidth - 32;
    this.visualizer.height = 80;
    if (!this.isRecording) {
      this.drawIdleVisualizer();
    }
  }

  drawIdleVisualizer() {
    const width = this.visualizer.width;
    const height = this.visualizer.height;
    
    this.canvasCtx.fillStyle = '#1e293b';
    this.canvasCtx.fillRect(0, 0, width, height);
    
    this.canvasCtx.strokeStyle = '#334155';
    this.canvasCtx.lineWidth = 2;
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(0, height / 2);
    this.canvasCtx.lineTo(width, height / 2);
    this.canvasCtx.stroke();
  }

  async toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    try {
      // Get audio stream based on selected source
      if (this.audioSource === 'system') {
        await this.captureSystemAudio();
      } else if (this.audioSource === 'both') {
        await this.captureBothAudio();
      } else {
        await this.captureMicrophoneAudio();
      }

      // Connect to WebSocket server
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

      this.ws.onopen = () => {
        console.log('Connected to server');
        this.ws.send(JSON.stringify({
          type: 'start',
          language: this.languageSelect.value
        }));
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.showToast('Connection error. Please try again.');
        this.stopRecording();
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        if (this.isRecording) {
          this.stopRecording();
        }
      };

    } catch (error) {
      console.error('Error starting recording:', error);
      this.showToast(error.message || 'Could not access audio. Please grant permission.');
    }
  }

  handleMessage(data) {
    
    switch (data.type) {
      case 'connected':
        this.updateStatus('Connected', 'connected');
        break;

        case 'session_started':
          console.log('Session started:', data.session_id, '(Electron debug)');
          this.isRecording = true;
          this.interviewStatusEl.textContent = 'Listening...';

          try {
            this.updateUI();
            this.startDurationTimer();
            this.startAudioProcessing();
          } catch (err) {
            console.error('Error in session_started handler:', err);
            this.showToast?.('Error starting audio: ' + (err.message || 'Unknown error'));
            this.stopRecording?.();
          }

          break;

      case 'partial':
        this.partialText.textContent = data.text;
        break;

      case 'final':
        console.log('Final transcription received:1', data.text);
        this.addQuestion(data.text);
        this.partialText.textContent = '';
        break;

      // case 'final_with_timestamps':
      //   console.log('Final transcription received:2', data.text);
      //   this.addQuestion(data.text);
      //   this.partialText.textContent = '';
      //   break;

      case 'error':
        console.error('Transcription error:', data.message);
        this.showToast(`Error: ${data.message}`);
        break;

      case 'disconnected':
        this.updateStatus('Disconnected', '');
        break;
    }
  }

  addQuestion(text) {
    if (!text || !text.trim()) return;

    // Remove placeholder if exists
    const placeholder = this.transcript.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }
    console.log('Adding question:', text, this.currentQuestion);
    // Append to current question
    if (this.currentQuestion) {
      this.currentQuestion += ' ' + text;
    } else {
      this.currentQuestion = text;
    }
    
    // Update display with highlighting
    this.transcript.innerHTML = `<p class="question-text">${this.currentQuestion}</p>`;
    // this.transcript.scrollTop = this.transcript.scrollHeight;

    // Detect question completion and auto-generate answer
    this.detectQuestionComplete(text);
  }

  detectQuestionComplete(text) {
    // Clear previous timeout
    if (this.questionDetectionTimeout) {
      clearTimeout(this.questionDetectionTimeout);
    }

    // Wait for pause in speech to consider question complete
    this.questionDetectionTimeout = setTimeout(() => {
      const question = this.currentQuestion.trim();
      
      // Check if it looks like a question or statement requiring response
      const isQuestion = question.endsWith('?') || 
                        /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|tell|describe|explain|walk|give)/i.test(question)
                        || question.split('.').length >= 3
                        || question.split(' ').length >= 25
                        
                        ; // Heuristic: if it's a longer statement, it might still need an answer
      console.log('Detecting question completion. Is question:', isQuestion, '| Question:', question);
      if (isQuestion && question.split(' ').length >= 3 && !this.isGeneratingAnswer) {
        this.questionCount++;
        this.questionCountEl.textContent = this.questionCount;
        
        // Store the question and clear for next one
        const questionToAnswer = question;
        this.currentQuestion = ''; // Clear for next question
        
        this.getInterviewAnswer(questionToAnswer);
      }
    }, 1000); // Wait 1 second of silence
  }

  // Save question to Firebase (non-blocking, errors won't affect ChatGPT)
  async saveQuestionToFirebase(question, hasImage = false) {
    try {
      // Check if Firebase is available
      if (typeof db !== 'undefined') {
        await db.collection('interviewQuestions').add({
          question: question,
          hasImage: hasImage,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });
        console.log('Question saved to Firebase');
      }
    } catch (error) {
      // Log error but don't throw - this should not affect ChatGPT flow
      console.error('Failed to save question to Firebase (non-critical):', error);
    }
  }

  async getInterviewAnswer(question, imageData = null) {
    if (this.isGeneratingAnswer) return;
    
    try {
      this.isGeneratingAnswer = true;
      this.currentStreamingAnswer = '';
      this.answerStatus.textContent = '🤔 Generating answer...';
      this.answerStatus.className = 'answer-status generating';
      this.interviewStatusEl.textContent = 'Generating...';

      // Create placeholder for streaming answer
      this.createStreamingAnswerElement(question);

      // Save question to Firebase in parallel (non-blocking)
      this.saveQuestionToFirebase(question, !!imageData);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question,
          imageData,
          interviewContext: this.interviewContext,
          conversationHistory: this.conversationHistory.slice(-10) // Last 10 exchanges for context
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              // Streaming complete
              this.finalizeStreamingAnswer(question);
            } else {
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  this.currentStreamingAnswer += parsed.content;
                  this.updateStreamingAnswer();
                }
              } catch (e) {
                // Ignore parse errors for incomplete JSON
              }
            }
          }
        }
      }

      this.answerStatus.textContent = '✅ Answer ready - Use as reference';
      this.answerStatus.className = 'answer-status ready';
      this.interviewStatusEl.textContent = 'Listening...';

    } catch (error) {
      console.error('Error getting answer:', error);
      this.answerStatus.textContent = `❌ Error: ${error.message}`;
      this.answerStatus.className = 'answer-status error';
      this.showToast(`Failed to get answer: ${error.message}`);
    } finally {
      this.isGeneratingAnswer = false;
    }
  }

  createStreamingAnswerElement(question) {
    // Add new answer card at the top
    const answerCard = document.createElement('div');
    answerCard.className = 'answer-card streaming';
    answerCard.id = 'current-streaming-answer';
    answerCard.innerHTML = `
      <div class="answer-card-header">
        <span class="answer-number">#${this.questionCount}</span>
        <span class="answer-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="answer-question"><strong>Q:</strong> ${this.escapeHtml(question)}</div>
      <div class="answer-text streaming-text"><span class="typing-cursor"></span></div>
    `;

    // Remove placeholder if exists
    const placeholder = this.answerPanel.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    // Insert at the beginning
    this.answerPanel.insertBefore(answerCard, this.answerPanel.firstChild);
  }

  updateStreamingAnswer() {
    const streamingText = document.querySelector('#current-streaming-answer .streaming-text');
    if (streamingText) {
      const formattedAnswer = this.formatAnswer(this.currentStreamingAnswer);
      streamingText.innerHTML = formattedAnswer + '<span class="typing-cursor"></span>';
      
      // Auto-scroll to show latest content
      const answerCard = document.getElementById('current-streaming-answer');
      if (answerCard) {
        // answerCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  finalizeStreamingAnswer(question) {
    const answerCard = document.getElementById('current-streaming-answer');
    if (answerCard) {
      answerCard.classList.remove('streaming');
      answerCard.id = '';
      
      const streamingText = answerCard.querySelector('.streaming-text');
      if (streamingText) {
        streamingText.classList.remove('streaming-text');
        streamingText.innerHTML = this.formatAnswer(this.currentStreamingAnswer);
      }
    }

    // Add to conversation history for context in follow-up questions
    this.conversationHistory.push({
      role: 'user',
      content: question
    });
    this.conversationHistory.push({
      role: 'assistant', 
      content: this.currentStreamingAnswer
    });

    // Keep only last 10 exchanges (20 messages)
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    // Add to answer history for display
    this.answerHistory.unshift({
      question,
      answer: this.currentStreamingAnswer,
      time: new Date().toLocaleTimeString(),
      number: this.questionCount
    });

    // Keep only last 20 answers
    if (this.answerHistory.length > 20) {
      this.answerHistory.pop();
    }
  }

  displayAnswer(question, answer) {
    // Legacy method - now handled by streaming
    // Keeping for manual regeneration
    const formattedAnswer = this.formatAnswer(answer);
    
    const answerCard = document.createElement('div');
    answerCard.className = 'answer-card';
    answerCard.innerHTML = `
      <div class="answer-card-header">
        <span class="answer-number">#${this.questionCount}</span>
        <span class="answer-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="answer-question"><strong>Q:</strong> ${this.escapeHtml(question)}</div>
      <div class="answer-text">${formattedAnswer}</div>
    `;

    // Remove placeholder if exists
    const placeholder = this.answerPanel.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    // Insert at the beginning
    this.answerPanel.insertBefore(answerCard, this.answerPanel.firstChild);
  }

  formatAnswer(answer) {
    // First, extract and preserve code blocks
    const codeBlocks = [];
    const inlineCodes = [];
    let processed = answer;
    
    // Handle fenced code blocks with language (```javascript ... ```)
    processed = processed.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const index = codeBlocks.length;
      codeBlocks.push({ lang: lang || 'code', code: code.trim() });
      return `__CODE_BLOCK_${index}__`;
    });
    
    // Extract and preserve inline code (`code`) before escaping
    processed = processed.replace(/`([^`]+)`/g, (match, code) => {
      const index = inlineCodes.length;
      inlineCodes.push(code);
      return `__INLINE_CODE_${index}__`;
    });
    
    // Escape HTML for non-code content
    let formatted = this.escapeHtml(processed);
    
    // Bold text
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Numbered lists (1. 2. 3.)
    formatted = formatted.replace(/^(\d+)\.\s+(.*)$/gm, '<li class="numbered">$2</li>');
    
    // Bullet points
    formatted = formatted.replace(/^[•\-\*]\s+(.*)$/gm, '<li>$1</li>');
    
    // Wrap consecutive list items
    formatted = formatted.replace(/((?:<li[^>]*>.*<\/li>\s*)+)/g, '<ul>$1</ul>');
    
    // Line breaks
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Wrap in paragraph
    formatted = `<p>${formatted}</p>`;
    
    // Clean up nested p tags
    formatted = formatted.replace(/<p><\/p>/g, '');
    
    // Restore inline code (content was already extracted, just needs HTML escaping)
    inlineCodes.forEach((code, index) => {
      formatted = formatted.replace(`__INLINE_CODE_${index}__`, `<code class="inline-code">${this.escapeHtml(code)}</code>`);
    });
    
    // Restore code blocks with proper formatting
    codeBlocks.forEach((block, index) => {
      const codeHtml = `
        <div class="code-block">
          <div class="code-header">
            <span class="code-lang">${block.lang}</span>
            <button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.closest('.code-block').querySelector('code').textContent).then(() => { this.textContent = '✓ Copied!'; setTimeout(() => this.textContent = 'Copy', 2000); })">
              Copy
            </button>
          </div>
          <pre><code class="language-${block.lang}">${this.escapeHtml(block.code)}</code></pre>
        </div>
      `;
      formatted = formatted.replace(`__CODE_BLOCK_${index}__`, codeHtml);
    });
    
    return formatted;
  }

  async startAudioProcessing() {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextCtor({ sampleRate: 16000 });
      console.log('AudioContext created, sampleRate =', this.audioContext.sampleRate);
  
      await this.audioContext.audioWorklet.addModule('audio-worklet-processor.js');
      console.log('Worklet loaded');
  
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      console.log('MediaStreamSource created');

      // Create analyser for visualizer
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      console.log('Analyser created');
  
      const workletNode = new AudioWorkletNode(this.audioContext, 'pcm-worklet');
      console.log('WorkletNode created');
  
      // Connect: source -> analyser -> workletNode
      source.connect(this.analyser);
      this.analyser.connect(workletNode);

      // Start visualizer animation
      this.drawVisualizer();
  
      // reset buffer whenever we start
      this.pcmBuffer = [];
  
      workletNode.port.onmessage = (event) => {
        try {
          if (!this.isRecording || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
  
          const buffer = event.data;
          if (!buffer) return;
  
          // we expect the worklet to send Int16 PCM
          const samples = new Int16Array(buffer);
  
          // accumulate samples
          for (let i = 0; i < samples.length; i++) {
            this.pcmBuffer.push(samples[i]);
          }
  
          // while we have enough for ~100ms, send a chunk
          while (this.pcmBuffer.length >= this.PCM_SAMPLES_PER_CHUNK) {
            const chunk = new Int16Array(
              this.pcmBuffer.splice(0, this.PCM_SAMPLES_PER_CHUNK)
            );
  
            const base64Audio = this.arrayBufferToBase64(chunk.buffer);
  
            this.ws.send(JSON.stringify({
              type: 'audio',
              audio: base64Audio,
              sampleRate: 16000
            }));
          }
        } catch (err) {
          console.error('Error in worklet onmessage:', err);
        }
      };
  
      console.log('AudioWorklet pipeline initialized');
    } catch (err) {
      console.error('AudioWorklet error:', err);
      this.showToast?.('Failed to start recording: ' + err.message);
    }
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  drawVisualizer() {
    if (!this.isRecording) {
      this.drawIdleVisualizer();
      return;
    }

    requestAnimationFrame(() => this.drawVisualizer());

    const width = this.visualizer.width;
    const height = this.visualizer.height;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    this.analyser.getByteFrequencyData(dataArray);

    this.canvasCtx.fillStyle = '#1e293b';
    this.canvasCtx.fillRect(0, 0, width, height);

    const barWidth = (width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height * 0.8;
      
      const gradient = this.canvasCtx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#22c55e');
      gradient.addColorStop(1, '#4ade80');
      
      this.canvasCtx.fillStyle = gradient;
      this.canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
      
      x += barWidth;
    }
  }

  stopRecording() {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.systemAudioStream) {
      this.systemAudioStream.getTracks().forEach(track => track.stop());
      this.systemAudioStream = null;
    }

    if (this.ws) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
      this.ws.close();
      this.ws = null;
    }

    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }

    this.updateUI();
    this.drawIdleVisualizer();
    this.updateStatus('Ready', '');
    this.interviewStatusEl.textContent = 'Stopped';
  }

  updateUI() {
    if (this.isRecording) {
      this.recordBtn.classList.add('recording');
      this.recordBtn.querySelector('.btn-text').textContent = 'Stop Interview';
      this.statusDot.classList.add('recording');
      this.updateStatus('Interview Mode Active', 'recording');
      this.languageSelect.disabled = true;
      this.audioSourceSelect.disabled = true;
      this.microphoneSelect.disabled = true;
    } else {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.querySelector('.btn-text').textContent = 'Start Interview Mode';
      this.statusDot.classList.remove('recording', 'connected');
      this.languageSelect.disabled = false;
      this.audioSourceSelect.disabled = false;
      this.microphoneSelect.disabled = false;
    }
  }

  updateStatus(text, className) {
    this.statusText.textContent = text;
    this.statusDot.className = 'status-dot';
    if (className) {
      this.statusDot.classList.add(className);
    }
  }

  startDurationTimer() {
    this.startTime = Date.now();
    this.durationInterval = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      this.duration.textContent = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  clearQuestion() {
    this.currentQuestion = '';
    this.transcript.innerHTML = '<p class="placeholder">Interviewer\'s questions will appear here...<br><small>📡 Listening for audio from your meeting</small></p>';
    this.partialText.textContent = '';
    this.showToast('Question cleared');
  }

  clearAnswer() {
    this.answerPanel.innerHTML = '<p class="placeholder">Your suggested answers will appear here...<br><small>⌨️ Press Ctrl/Cmd+Enter to manually get answer</small></p>';
    this.answerStatus.textContent = '';
    this.showToast('Answer cleared');
  }

  copyAnswer() {
    const answerText = this.answerPanel.querySelector('.answer-text');
    if (answerText) {
      const text = answerText.innerText;
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('Answer copied to clipboard!');
      }).catch(() => {
        this.showToast('Failed to copy');
      });
    } else {
      this.showToast('No answer to copy');
    }
  }

  regenerateAnswer() {
    if (!this.currentQuestion.trim()) {
      this.showToast('No question to regenerate answer for');
      return;
    }
    this.getInterviewAnswer(this.currentQuestion.trim());
  }

  async submitManualQuestion() {
    const question = this.manualQuestionInput.value.trim();
    
    if (!question && !this.uploadedImageData) {
      this.showToast('Please enter a question or upload an image');
      return;
    }

    // Update the transcript display
    this.transcript.innerHTML = '';
    const questionEl = document.createElement('p');
    questionEl.textContent = question || '[Image question]';
    this.transcript.appendChild(questionEl);
    
    // If there's an image, show it in transcript
    if (this.uploadedImageData) {
      const imgEl = document.createElement('img');
      imgEl.src = this.uploadedImageData;
      imgEl.style.maxWidth = '100%';
      imgEl.style.marginTop = '10px';
      imgEl.style.borderRadius = '8px';
      this.transcript.appendChild(imgEl);
    }

    this.currentQuestion = question || 'What is shown in this image?';
    this.questionCount++;
    this.questionCountEl.textContent = this.questionCount;

    // Get answer with optional image
    await this.getInterviewAnswer(this.currentQuestion, this.uploadedImageData);

    // Clear input
    this.manualQuestionInput.value = '';
    this.removeImage();
  }

  handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.showToast('Please upload an image file');
      return;
    }

    this.processImageFile(file);
  }

  handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let item of items) {
      if (item.type.indexOf('image') !== -1) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          this.processImageFile(file);
          this.showToast('📷 Image pasted successfully');
        }
        break;
      }
    }
  }

  processImageFile(file) {
    const maxSize = 5 * 1024 * 1024; // 5MB limit
    
    if (file.size > maxSize) {
      this.showToast('⚠️ Image too large. Compressing...');
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Compress and resize image
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Resize if too large (max 1024px on longest side)
        const maxDimension = 1024;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Compress to JPEG with quality 0.8
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // Calculate compressed size
        const sizeKB = Math.round((compressedDataUrl.length * 3/4) / 1024);
        
        this.uploadedImageData = compressedDataUrl;
        this.previewImg.src = compressedDataUrl;
        this.imagePreview.style.display = 'block';
        
        // Show image info
        const imageInfo = document.getElementById('imageInfo');
        if (imageInfo) {
          imageInfo.textContent = `${width}×${height}px • ${sizeKB}KB`;
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  removeImage() {
    this.uploadedImageData = null;
    this.previewImg.src = '';
    this.imagePreview.style.display = 'none';
    this.imageUpload.value = '';
    
    const imageInfo = document.getElementById('imageInfo');
    if (imageInfo) {
      imageInfo.textContent = '';
    }
  }

  async loadAudioDevices() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter(device => device.kind === 'audioinput');
      
      this.microphoneSelect.innerHTML = '';
      
      if (this.audioDevices.length === 0) {
        this.microphoneSelect.innerHTML = '<option value="">No microphones found</option>';
        return;
      }
      
      this.audioDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        this.microphoneSelect.appendChild(option);
      });
      
      if (this.audioDevices.length > 0) {
        this.selectedMicrophoneId = this.audioDevices[0].deviceId;
      }
      
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.loadAudioDevices();
      });
      
    } catch (error) {
      console.error('Error loading audio devices:', error);
      this.microphoneSelect.innerHTML = '<option value="">Microphone access denied</option>';
    }
  }

  onMicrophoneChange(event) {
    this.selectedMicrophoneId = event.target.value;
  }

  onAudioSourceChange(event) {
    this.audioSource = event.target.value;
    
    // Show/hide microphone selector
    if (this.audioSource === 'system') {
      this.microphoneContainer.style.display = 'none';
    } else {
      this.microphoneContainer.style.display = 'flex';
    }
  }

  async captureMicrophoneAudio() {
    const audioConstraints = {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true
    };
    
    if (this.selectedMicrophoneId) {
      audioConstraints.deviceId = { exact: this.selectedMicrophoneId };
    }
    
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });
  }

  async captureSystemAudio() {
    try {
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      const videoTrack = this.mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        this.mediaStream.removeTrack(videoTrack);
      }

      const audioTracks = this.mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track. Make sure to check "Share audio" when selecting the tab/window.');
      }

    } catch (error) {
      console.error('Error capturing system audio:', error);
      throw new Error('Could not capture system audio. Select a tab and check "Share audio".');
    }
  }

  async captureBothAudio() {
    try {
      const audioConstraints = {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      };
      
      if (this.selectedMicrophoneId) {
        audioConstraints.deviceId = { exact: this.selectedMicrophoneId };
      }
      
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });

      this.systemAudioStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      const videoTrack = this.systemAudioStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        this.systemAudioStream.removeTrack(videoTrack);
      }

      const systemAudioTracks = this.systemAudioStream.getAudioTracks();
      if (systemAudioTracks.length === 0) {
        this.systemAudioStream.getTracks().forEach(track => track.stop());
        this.systemAudioStream = null;
        this.showToast('No system audio detected. Using microphone only.');
        this.mediaStream = micStream;
        return;
      }

      const audioContext = new AudioContext({ sampleRate: 16000 });
      const destination = audioContext.createMediaStreamDestination();

      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain);
      micGain.connect(destination);

      const systemSource = audioContext.createMediaStreamSource(this.systemAudioStream);
      const systemGain = audioContext.createGain();
      systemGain.gain.value = 1.0;
      systemSource.connect(systemGain);
      systemGain.connect(destination);

      this.mediaStream = destination.stream;

    } catch (error) {
      console.error('Error capturing both audio sources:', error);
      throw new Error('Could not capture audio. Make sure to grant all permissions.');
    }
  }

  handleKeyboardShortcuts(event) {
    // Escape: Close expanded panel
    if (event.key === 'Escape' && this.isExpanded) {
      event.preventDefault();
      this.toggleExpand();
      return;
    }

    // Ctrl/Cmd + Enter: Manual answer generation
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.regenerateAnswer();
    }
    
    // Ctrl/Cmd + K: Clear answer
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.clearAnswer();
    }
    
    // Ctrl/Cmd + Shift + C: Copy answer
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'C') {
      event.preventDefault();
      this.copyAnswer();
    }

    // Ctrl/Cmd + Shift + W: Toggle question visibility in answer cards
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      this.toggleAnswerQuestionVisibility();
    }

    // Ctrl/Cmd + E: Toggle expand
    if ((event.ctrlKey || event.metaKey) && event.key === 'e') {
      event.preventDefault();
      this.toggleExpand();
    }
  }

  // Expand/Popout functionality
  toggleExpand() {
    this.isExpanded = !this.isExpanded;
    
    if (this.isExpanded) {
      // Create overlay
      this.overlay = document.createElement('div');
      this.overlay.className = 'overlay';
      this.overlay.addEventListener('click', () => this.toggleExpand());
      document.body.appendChild(this.overlay);
      
      // Expand the container
      this.answerContainer.classList.add('expanded');
      this.expandAnswerBtn.innerHTML = '✕';
      this.expandAnswerBtn.title = 'Close (Esc)';
      
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    } else {
      // Remove overlay
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
      
      // Collapse the container
      this.answerContainer.classList.remove('expanded');
      this.expandAnswerBtn.innerHTML = '⛶';
      this.expandAnswerBtn.title = 'Expand (Ctrl+E)';
      
      // Restore body scroll
      document.body.style.overflow = '';
    }
  }

  // Resize functionality
  initResize() {
    let startY, startHeight;

    const onMouseDown = (e) => {
      if (this.isExpanded) return; // Don't resize when expanded
      
      this.isResizing = true;
      startY = e.clientY;
      startHeight = this.answerContainer.offsetHeight;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      
      // Prevent text selection during resize
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!this.isResizing) return;
      
      const deltaY = e.clientY - startY;
      const newHeight = Math.max(200, Math.min(800, startHeight + deltaY));
      
      this.answerContainer.style.height = `${newHeight}px`;
      this.answerPanel.style.maxHeight = `${newHeight - 120}px`;
    };

    const onMouseUp = () => {
      this.isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
    };

    this.resizeHandle.addEventListener('mousedown', onMouseDown);
    
    // Touch support
    this.resizeHandle.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      onMouseDown({ clientY: touch.clientY, preventDefault: () => {} });
    });
  }

  showToast(message) {
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  toggleAnswerQuestionVisibility() {
    this.showAnswerQuestions = !this.showAnswerQuestions;
    this.answerPanel.classList.toggle('hide-answer-questions', !this.showAnswerQuestions);
    this.showToast(this.showAnswerQuestions ? 'Questions shown' : 'Questions hidden');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Electron integration
class ElectronControls {
  constructor() {
    this.isElectron = window.electronAPI?.isElectron || false;
    this.isStealthMode = true;
    this.currentOpacity = 1.0;
    
    if (this.isElectron) {
      this.init();
    }
  }
  
  init() {
    // Add electron class to body
    document.body.classList.add('electron-app');
    
    // Get control elements
    this.stealthBtn = document.getElementById('stealthBtn');
    this.opacitySlider = document.getElementById('opacitySlider');
    this.opacityValue = document.getElementById('opacityValue');
    this.minimizeBtn = document.getElementById('minimizeBtn');
    this.stealthIndicator = document.getElementById('stealthIndicator');
    
    // Bind events
    if (this.stealthBtn) {
      this.stealthBtn.addEventListener('click', () => this.toggleStealth());
    }
    
    if (this.opacitySlider) {
      this.opacitySlider.addEventListener('input', (e) => this.handleOpacityChange(e));
    }
    
    if (this.minimizeBtn) {
      this.minimizeBtn.addEventListener('click', () => {
        // Trigger the global shortcut behavior (hide window)
        window.electronAPI?.setOpacity(0);
        setTimeout(() => window.electronAPI?.setOpacity(this.currentOpacity), 100);
      });
    }
    
    console.log('🕵️ Electron Stealth Mode Active');
  }
  
  async toggleStealth() {
    if (window.electronAPI) {
      this.isStealthMode = await window.electronAPI.toggleStealth();
      this.updateStealthIndicator();
    }
  }
  
  updateStealthIndicator() {
    if (this.stealthIndicator) {
      if (this.isStealthMode) {
        this.stealthIndicator.textContent = '🕵️ Stealth ON';
        this.stealthIndicator.classList.remove('off');
      } else {
        this.stealthIndicator.textContent = '⚠️ Stealth OFF';
        this.stealthIndicator.classList.add('off');
      }
    }
  }
  
  handleOpacityChange(event) {
    if (window.electronAPI) {
      const opacityPercent = parseInt(event.target.value);
      this.currentOpacity = opacityPercent / 100;
      window.electronAPI.setOpacity(this.currentOpacity);
      
      if (this.opacityValue) {
        this.opacityValue.textContent = opacityPercent + '%';
      }
    }
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new InterviewAssistantApp();
  new ElectronControls();
});
