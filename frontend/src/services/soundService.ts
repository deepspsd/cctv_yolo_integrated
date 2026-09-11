/**
 * Audio Synthesizer Service for Tactical Surveillance Terminal
 * Generates tactile mechanical shutter and interface beeps using Web Audio API
 * No external mp3/wav files required, zero latency, zero bandwidth overhead.
 */

class SoundService {
  private ctx: AudioContext | null = null;
  private soundEnabled: boolean = true;

  constructor() {
    // Check localStorage preference
    const stored = localStorage.getItem('cameye_sound_effects');
    if (stored !== null) {
      this.soundEnabled = stored === 'true';
    }
  }

  private initCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isEnabled(): boolean {
    return this.soundEnabled;
  }

  public toggleSound(): boolean {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem('cameye_sound_effects', String(this.soundEnabled));
    if (this.soundEnabled) {
      this.playTactileBlip(800, 0.04);
    }
    return this.soundEnabled;
  }

  /**
   * Realistic synthesized camera shutter sound (mechanical click + release)
   */
  public playShutterSound() {
    if (!this.soundEnabled) return;
    try {
      const ctx = this.initCtx();
      if (!ctx) return;

      const now = ctx.currentTime;

      // 1. High frequency mechanical metallic click
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'square';
      osc1.frequency.setValueAtTime(2400, now);
      osc1.frequency.exponentialRampToValueAtTime(300, now + 0.035);

      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.045);

      // 2. Secondary shutter curtain release (delayed by 50ms)
      const releaseTime = now + 0.05;
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1400, releaseTime);
      osc2.frequency.exponentialRampToValueAtTime(180, releaseTime + 0.05);

      gain2.gain.setValueAtTime(0.15, releaseTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, releaseTime + 0.06);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(releaseTime);
      osc2.stop(releaseTime + 0.065);
    } catch {
      // Audio autoplay policy might restrict until user interaction
    }
  }

  /**
   * Subtle tactile click for UI buttons, view mode switches, and filter clicks
   */
  public playTactileBlip(freq: number = 600, duration: number = 0.03) {
    if (!this.soundEnabled) return;
    try {
      const ctx = this.initCtx();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + duration);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Ignore
    }
  }
}

export const soundService = new SoundService();
