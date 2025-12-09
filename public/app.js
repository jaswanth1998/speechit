class SpeechItApp {
  constructor() {
    this.ws = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.processor = null;
    this.analyser = null;
    this.isRecording = false;
    this.startTime = null;
    this.durationInterval = null;
    this.fullTranscript = '';
    this.selectedMicrophoneId = null;
    this.audioDevices = [];
    this.audioSource = 'microphone';
    this.systemAudioStream = null;
    this.aiResponseEnabled = false;
    this.conversationHistory = [];
    this.lastTranscript = '';
    this.questionDetectionTimeout = null;

    // DOM elements
    this.recordBtn = document.getElementById('recordBtn');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.transcript = document.getElementById('transcript');
    this.partialText = document.getElementById('partialText');
    this.languageSelect = document.getElementById('language');
    this.microphoneSelect = document.getElementById('microphone');
    this.audioSourceSelect = document.getElementById('audioSource');
    this.aiResponseToggle = document.getElementById('aiResponseToggle');
    this.aiResponseContainer = document.getElementById('aiResponseContainer');
    this.aiResponses = document.getElementById('aiResponses');
    this.clearAiBtn = document.getElementById('clearAiBtn');
    this.copyBtn = document.getElementById('copyBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.wordCount = document.getElementById('wordCount');
    this.duration = document.getElementById('duration');
    this.detectedLang = document.getElementById('detectedLang');
    this.visualizer = document.getElementById('visualizer');
    this.canvasCtx = this.visualizer.getContext('2d');

    this.init();
  }

  async init() {
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.copyBtn.addEventListener('click', () => this.copyTranscript());
    this.clearBtn.addEventListener('click', () => this.clearTranscript());
    this.microphoneSelect.addEventListener('change', (e) => this.onMicrophoneChange(e));
    this.audioSourceSelect.addEventListener('change', (e) => this.onAudioSourceChange(e));
    this.aiResponseToggle.addEventListener('change', (e) => this.onAiToggleChange(e));
    this.clearAiBtn.addEventListener('click', () => this.clearAiResponses());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
    
    // Load available microphones
    await this.loadAudioDevices();
    
    // Resize canvas
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Draw initial visualizer
    this.drawIdleVisualizer();
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
    
    // Draw a flat line
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
        // Send start message with selected language
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
      this.showToast('Could not access microphone. Please grant permission.');
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'connected':
        this.updateStatus('Connected', 'connected');
        break;

      case 'session_started':
        console.log('Session started:', data.session_id);
        this.isRecording = true;
        this.updateUI();
        this.startAudioProcessing();
        this.startDurationTimer();
        break;

      case 'partial':
        this.partialText.textContent = data.text;
        break;

      case 'final':
        this.addFinalText(data.text);
        this.partialText.textContent = '';
        break;

      case 'final_with_timestamps':
        this.addFinalText(data.text);
        this.partialText.textContent = '';
        if (data.language_code) {
          this.detectedLang.textContent = data.language_code.toUpperCase();
        }
        break;

      case 'error':
        console.error('Transcription error:', data.message);
        this.showToast(`Error: ${data.message}`);
        break;

      case 'disconnected':
        this.updateStatus('Disconnected', '');
        break;
    }
  }

  startAudioProcessing() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    
    // Create analyser for visualization
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    // Create script processor for sending audio
    const bufferSize = 4096;
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.processor.onaudioprocess = (event) => {
      if (!this.isRecording || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputData = event.inputBuffer.getChannelData(0);
      
      // Convert float32 to int16
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Convert to base64
      const base64Audio = this.arrayBufferToBase64(pcmData.buffer);

      // Send audio chunk to server
      this.ws.send(JSON.stringify({
        type: 'audio',
        audio: base64Audio,
        sampleRate: 16000
      }));
    };

    // Start visualization
    this.drawVisualizer();
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
      
      // Gradient color based on height
      const gradient = this.canvasCtx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#6366f1');
      gradient.addColorStop(1, '#818cf8');
      
      this.canvasCtx.fillStyle = gradient;
      this.canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
      
      x += barWidth;
    }
  }

  stopRecording() {
    this.isRecording = false;

    // Stop audio processing
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Stop system audio stream
    if (this.systemAudioStream) {
      this.systemAudioStream.getTracks().forEach(track => track.stop());
      this.systemAudioStream = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
      this.ws.close();
      this.ws = null;
    }

    // Stop duration timer
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }

    this.updateUI();
    this.drawIdleVisualizer();
    this.updateStatus('Ready', '');
  }

  updateUI() {
    if (this.isRecording) {
      this.recordBtn.classList.add('recording');
      this.recordBtn.querySelector('.btn-text').textContent = 'Stop Recording';
      this.statusDot.classList.add('recording');
      this.updateStatus('Recording...', 'recording');
      this.languageSelect.disabled = true;
      this.microphoneSelect.disabled = true;
      this.audioSourceSelect.disabled = true;
    } else {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.querySelector('.btn-text').textContent = 'Start Recording';
      this.statusDot.classList.remove('recording', 'connected');
      this.languageSelect.disabled = false;
      this.microphoneSelect.disabled = false;
      this.audioSourceSelect.disabled = false;
    }
  }

  updateStatus(text, className) {
    this.statusText.textContent = text;
    this.statusDot.className = 'status-dot';
    if (className) {
      this.statusDot.classList.add(className);
    }
  }

  addFinalText(text) {
    // Remove placeholder if exists
    const placeholder = this.transcript.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    // Add text to full transcript
    if (this.fullTranscript) {
      this.fullTranscript += ' ' + text;
    } else {
      this.fullTranscript = text;
    }

    // Update display
    this.transcript.innerHTML = `<p class="final-text">${this.fullTranscript}</p>`;
    
    // Update word count
    const words = this.fullTranscript.trim().split(/\s+/).filter(w => w.length > 0);
    this.wordCount.textContent = words.length;

    // Scroll to bottom
    this.transcript.scrollTop = this.transcript.scrollHeight;

    // Check if AI response is enabled and detect questions
    if (this.aiResponseEnabled && text.trim()) {
      this.detectAndRespondToQuestion(text);
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

  copyTranscript() {
    if (this.fullTranscript) {
      navigator.clipboard.writeText(this.fullTranscript).then(() => {
        this.showToast('Transcript copied to clipboard!');
      }).catch(() => {
        this.showToast('Failed to copy transcript');
      });
    } else {
      this.showToast('Nothing to copy');
    }
  }

  clearTranscript() {
    this.fullTranscript = '';
    this.transcript.innerHTML = '<p class="placeholder">Your transcription will appear here...</p>';
    this.partialText.textContent = '';
    this.wordCount.textContent = '0';
    this.duration.textContent = '00:00';
    this.detectedLang.textContent = '-';
    this.showToast('Transcript cleared');
  }

  showToast(message) {
    // Remove existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }

    // Create and show new toast
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  async loadAudioDevices() {
    try {
      // Request permission first
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      
      // Get all audio input devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter(device => device.kind === 'audioinput');
      
      // Populate the dropdown
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
      
      // Set the first device as default
      if (this.audioDevices.length > 0) {
        this.selectedMicrophoneId = this.audioDevices[0].deviceId;
      }
      
      // Listen for device changes
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
    console.log('Selected microphone:', this.selectedMicrophoneId);
    
    // If currently recording, stop and restart with the new microphone
    if (this.isRecording) {
      this.showToast('Switching microphone...');
      this.stopRecording();
      setTimeout(() => {
        this.startRecording();
      }, 500);
    }
  }

  onAudioSourceChange(event) {
    this.audioSource = event.target.value;
    console.log('Selected audio source:', this.audioSource);
    
    // Update UI based on source
    if (this.audioSource === 'system' || this.audioSource === 'both') {
      this.microphoneSelect.disabled = this.audioSource === 'system';
    } else {
      this.microphoneSelect.disabled = false;
    }
    
    // If currently recording, stop and restart with the new source
    if (this.isRecording) {
      this.showToast('Switching audio source...');
      this.stopRecording();
      setTimeout(() => {
        this.startRecording();
      }, 500);
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
      // Use getDisplayMedia to capture tab/window audio
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required for getDisplayMedia
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      // Stop the video track immediately (we only want audio)
      const videoTrack = this.mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        this.mediaStream.removeTrack(videoTrack);
      }

      // Check if audio was captured
      const audioTracks = this.mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track in the selected source. Please select a tab/window with audio.');
      }

    } catch (error) {
      console.error('Error capturing system audio:', error);
      throw new Error('Could not capture system audio. Make sure to select "Share audio" when choosing a tab/window.');
    }
  }

  async captureBothAudio() {
    try {
      // Capture microphone
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

      // Capture system audio
      this.systemAudioStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      // Stop the video track
      const videoTrack = this.systemAudioStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        this.systemAudioStream.removeTrack(videoTrack);
      }

      // Check if system audio was captured
      const systemAudioTracks = this.systemAudioStream.getAudioTracks();
      if (systemAudioTracks.length === 0) {
        this.systemAudioStream.getTracks().forEach(track => track.stop());
        this.systemAudioStream = null;
        this.showToast('No system audio detected. Using microphone only.');
        this.mediaStream = micStream;
        return;
      }

      // Create audio context to mix both streams
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const destination = audioContext.createMediaStreamDestination();

      // Connect microphone
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain);
      micGain.connect(destination);

      // Connect system audio
      const systemSource = audioContext.createMediaStreamSource(this.systemAudioStream);
      const systemGain = audioContext.createGain();
      systemGain.gain.value = 1.0;
      systemSource.connect(systemGain);
      systemGain.connect(destination);

      // Use the mixed stream
      this.mediaStream = destination.stream;

    } catch (error) {
      console.error('Error capturing both audio sources:', error);
      throw new Error('Could not capture both audio sources. Make sure to grant all permissions.');
    }
  }

  onAiToggleChange(event) {
    this.aiResponseEnabled = event.target.checked;
    
    if (this.aiResponseEnabled) {
      this.aiResponseContainer.style.display = 'block';
      this.showToast('AI Auto-Reply enabled');
    } else {
      this.aiResponseContainer.style.display = 'none';
      this.showToast('AI Auto-Reply disabled');
    }
  }

  detectAndRespondToQuestion(text) {
    // Clear previous timeout
    if (this.questionDetectionTimeout) {
      clearTimeout(this.questionDetectionTimeout);
    }

    // Wait a bit to see if more text comes in
    this.questionDetectionTimeout = setTimeout(() => {
      const trimmedText = text.trim();
      
      // Check if the text is a question
      const isQuestion = trimmedText.endsWith('?') || 
                        /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will)/i.test(trimmedText);
      
      if (isQuestion) {
        this.getAiResponse(trimmedText);
      }
    }, 1500); // Wait 1.5 seconds after the last transcript
  }

  async getAiResponse(question) {
    try {
      this.showToast('Getting AI response...');
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question,
          conversationHistory: this.conversationHistory
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to get AI response`);
      }

      const data = await response.json();
      
      if (!data.answer) {
        throw new Error('No answer received from AI');
      }
      
      this.displayAiResponse(question, data.answer);
      
      // Update conversation history
      this.conversationHistory.push(
        { role: 'user', content: question },
        { role: 'assistant', content: data.answer }
      );
      
      // Keep only last 10 messages to avoid token limits
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

    } catch (error) {
      console.error('Error getting AI response:', error);
      this.showToast(`AI Error: ${error.message}`);
    }
  }

  displayAiResponse(question, answer) {
    // Remove placeholder
    const placeholder = this.aiResponses.querySelector('.placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    // Create response element
    const responseEl = document.createElement('div');
    responseEl.className = 'ai-response-item';
    responseEl.innerHTML = `
      <div class="ai-question"><strong>Q:</strong> ${this.escapeHtml(question)}</div>
      <div class="ai-answer"><strong>A:</strong> ${this.escapeHtml(answer)}</div>
      <div class="ai-timestamp">${new Date().toLocaleTimeString()}</div>
    `;

    this.aiResponses.appendChild(responseEl);
    
    // Scroll to bottom
    this.aiResponses.scrollTop = this.aiResponses.scrollHeight;
  }

  clearAiResponses() {
    this.aiResponses.innerHTML = '<p class="placeholder">AI responses will appear here...</p>';
    this.conversationHistory = [];
    this.showToast('AI responses cleared');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  handleKeyboardShortcuts(event) {
    // Ctrl/Cmd + Enter: Manually get AI response for current transcript
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.manualAiResponse();
    }
    
    // Ctrl/Cmd + K: Clear AI responses
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      if (this.aiResponseEnabled) {
        this.clearAiResponses();
      }
    }
    
    // Ctrl/Cmd + Shift + A: Toggle AI auto-reply
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'A') {
      event.preventDefault();
      this.aiResponseToggle.checked = !this.aiResponseToggle.checked;
      this.onAiToggleChange({ target: this.aiResponseToggle });
    }
  }

  manualAiResponse() {
    if (!this.fullTranscript || !this.fullTranscript.trim()) {
      this.showToast('No transcript available. Please record some audio first.');
      return;
    }

    // Get the last sentence or the full transcript
    const sentences = this.fullTranscript.trim().split(/[.!?]+/).filter(s => s.trim());
    const lastSentence = sentences[sentences.length - 1].trim();
    
    if (!lastSentence) {
      this.showToast('No valid text to send to AI.');
      return;
    }

    // Show AI container if not visible
    if (!this.aiResponseEnabled) {
      this.aiResponseContainer.style.display = 'block';
    }

    this.showToast(`Sending to AI: "${lastSentence.substring(0, 50)}${lastSentence.length > 50 ? '...' : ''}"`);
    this.getAiResponse(lastSentence);
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SpeechItApp();
});
