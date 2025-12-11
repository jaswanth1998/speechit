class PCMWorkletProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (!input || !input[0]) return true;
  
      const channelData = input[0];
      const pcm = new Int16Array(channelData.length);
  
      for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
  
      this.port.postMessage(pcm.buffer);
  
      return true; // keep alive
    }
  }
  
  registerProcessor('pcm-worklet', PCMWorkletProcessor);