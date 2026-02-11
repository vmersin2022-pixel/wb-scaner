class AudioService {
  private ctx: AudioContext | null = null;

  constructor() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  private playTone(freq: number, type: OscillatorType, duration: number, startTime: number = 0) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);
    
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime + startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(this.ctx.currentTime + startTime);
    osc.stop(this.ctx.currentTime + startTime + duration);
  }

  // Short high beep for Order Scan
  public playScanSuccess() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this.playTone(1200, 'sine', 0.1);
  }

  // Double major beep for KIZ Link (Success)
  public playTaskComplete() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this.playTone(880, 'sine', 0.1, 0);       // A5
    this.playTone(1108, 'sine', 0.2, 0.15);   // C#6
  }

  // Low buzz for Error
  public playError() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this.playTone(150, 'sawtooth', 0.4);
  }
}

export const audioService = new AudioService();