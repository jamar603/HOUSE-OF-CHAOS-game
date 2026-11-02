/**
 * Synthesized sound effects (Web Audio). No audio files are needed for v0.1;
 * real recorded sounds can replace these later without touching gameplay code.
 */
export type SoundName =
  | 'swing'
  | 'hit'
  | 'bong'
  | 'pillow'
  | 'glass'
  | 'pickup'
  | 'drop'
  | 'wood'
  | 'down'
  | 'revive'
  | 'eliminated'
  | 'phase'
  | 'click'
  | 'victory'
  | 'defeat';

export class SoundEffects {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (!this.context) {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.context.destination);
      const length = this.context.sampleRate * 0.5;
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, slideTo?: number, delay = 0): void {
    if (!this.context || !this.master) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, filterFrequency: number, filterType: BiquadFilterType = 'lowpass'): void {
    if (!this.context || !this.master || !this.noiseBuffer) return;
    const start = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + duration);
  }

  /** volume: 0..1, already attenuated by distance. */
  play(name: SoundName, volume = 1): void {
    if (!this.context || this.muted || volume <= 0.02) return;
    const v = Math.min(1, volume);
    switch (name) {
      case 'swing':
        this.noise(0.12, 0.25 * v, 1800, 'bandpass');
        return;
      case 'hit':
        this.tone(160, 0.12, 'square', 0.25 * v, 60);
        this.noise(0.08, 0.35 * v, 900);
        return;
      case 'bong':
        this.tone(420, 0.6, 'triangle', 0.45 * v, 380);
        this.tone(845, 0.4, 'sine', 0.2 * v, 830);
        return;
      case 'pillow':
        this.noise(0.15, 0.3 * v, 500);
        return;
      case 'glass':
        this.noise(0.25, 0.3 * v, 5000, 'highpass');
        this.tone(2400, 0.15, 'sine', 0.12 * v, 1800);
        return;
      case 'pickup':
        this.tone(520, 0.08, 'square', 0.12 * v, 780);
        return;
      case 'drop':
        this.tone(300, 0.1, 'square', 0.1 * v, 180);
        return;
      case 'wood':
        this.tone(110, 0.18, 'sawtooth', 0.2 * v, 70);
        this.noise(0.12, 0.3 * v, 700);
        return;
      case 'down':
        this.tone(320, 0.5, 'sawtooth', 0.22 * v, 70);
        return;
      case 'revive':
        this.tone(440, 0.12, 'sine', 0.2 * v);
        this.tone(660, 0.12, 'sine', 0.2 * v, undefined, 0.1);
        this.tone(880, 0.2, 'sine', 0.2 * v, undefined, 0.2);
        return;
      case 'eliminated':
        this.tone(220, 0.25, 'square', 0.18 * v, 200);
        this.tone(165, 0.4, 'square', 0.18 * v, 120, 0.22);
        return;
      case 'phase':
        this.tone(98, 1.2, 'sawtooth', 0.3 * v, 92);
        this.tone(147, 1.2, 'sawtooth', 0.2 * v, 140);
        this.noise(0.6, 0.2 * v, 400);
        return;
      case 'click':
        this.tone(880, 0.05, 'square', 0.08 * v);
        return;
      case 'victory':
        [523, 659, 784, 1046].forEach((frequency, index) => this.tone(frequency, 0.3, 'triangle', 0.25 * v, undefined, index * 0.14));
        return;
      case 'defeat':
        [392, 330, 262, 196].forEach((frequency, index) => this.tone(frequency, 0.35, 'triangle', 0.22 * v, undefined, index * 0.18));
        return;
    }
  }
}
