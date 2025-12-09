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

    // DOM elements
    this.recordBtn = document.getElementById('recordBtn');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.transcript = document.getElementById('transcript');
    this.partialText = document.getElementById('partialText');
    this.languageSelect = document.getElementById('language');
    this.microphoneSelect = document.getElementById('microphone');
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
      // Request microphone access with selected device
      const audioConstraints = {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      };
      
      // If a specific microphone is selected, use it
      if (this.selectedMicrophoneId) {
        audioConstraints.deviceId = { exact: this.selectedMicrophoneId };
      }
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });

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
    } else {
      this.recordBtn.classList.remove('recording');
      this.recordBtn.querySelector('.btn-text').textContent = 'Start Recording';
      this.statusDot.classList.remove('recording', 'connected');
      this.languageSelect.disabled = false;
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
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SpeechItApp();
});
