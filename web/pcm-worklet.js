// Copies raw microphone samples (mono, Float32) to the page while recording is on.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') this.on = true;
      if (e.data === 'stop') this.on = false;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch && ch.length) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
