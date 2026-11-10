/// <reference types="vite/client" />
import { MusicSynth } from './music';
import type { Lang, MusicState } from './types';

// Voice queue (Vietnamese and Chinese), quiz sounds and background music. Only the ?view=stage page calls enable(); the dashboard stays silent.
class SoundEngine {
  private enabled = false;
  private queue: Line[] = [];
  private priority: Line[] = [];
  private playing = false;
  private ctx: AudioContext | null = null;
  channelName = 'Lớp Tiếng Trung Online';

  private music: MusicState = { on: true, volume: 0.1, style: 'files' };
  private musicGain: GainNode | null = null;
  private synth: MusicSynth | null = null;
  private track: HTMLAudioElement | null = null;
  private playlist: string[] | null = null;
  private trackIdx = 0;
  private ducked = false;

  private current: HTMLAudioElement | null = null;
  private channel: BroadcastChannel | null = null;
  private readonly id = Math.random().toString(36).slice(2);

  // One stage page per browser holds the sound: the first one opened keeps it, later ones (such as the preview in
  // LIVE Studio's Link settings) stay silent, and when the holder closes one of the others takes over
  private holder = false;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;

  enable() {
    if (this.channel) return;
    this.channel = new BroadcastChannel('hoc-tieng-trung-sound');
    this.channel.onmessage = (e) => {
      const m = e.data || {};
      if (m.hello && this.holder) this.channel?.postMessage({ holder: this.id });
      else if (m.holder && m.holder !== this.id) {
        if (this.claimTimer) clearTimeout(this.claimTimer);
        this.claimTimer = null;
        if (this.holder) this.becomeSilent();
      } else if (m.release && !this.holder) this.tryClaim(100 + Math.random() * 400);
    };
    window.addEventListener('pagehide', () => this.release());
    this.channel.postMessage({ hello: this.id });
    this.tryClaim(400);
  }

  private tryClaim(waitMs: number) {
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      if (!this.channel || this.holder) return;
      this.channel.postMessage({ holder: this.id });
      this.becomeHolder();
    }, waitMs);
  }

  private release() {
    if (this.holder) this.channel?.postMessage({ release: this.id });
  }

  private resumeBound = () => this.resumeAfterClick();
  private becomeHolder() {
    this.holder = true;
    this.enabled = true;
    // Normal browsers block audio until the first click; LIVE Studio plays right away
    window.addEventListener('pointerdown', this.resumeBound);
    window.addEventListener('keydown', this.resumeBound);
    this.applyMusic();
  }

  private becomeSilent() {
    this.stopAll();
    window.removeEventListener('pointerdown', this.resumeBound);
    window.removeEventListener('keydown', this.resumeBound);
  }

  private resumeAfterClick() {
    this.audio()?.resume();
    if (this.track?.paused) this.track.play().catch(() => {});
    if (this.blocked) {
      this.setBlocked(false);
      this.next();
    }
  }

  // Used when the module hot-reloads: hand the sound to another page (or the fresh engine) and stop for good
  shutdown() {
    this.release();
    this.becomeSilent();
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.claimTimer = null;
    this.channel?.close();
    this.channel = null;
  }

  // Stops every sound this engine started
  private stopAll() {
    this.holder = false;
    this.enabled = false;
    this.setBlocked(false);
    this.track?.pause();
    this.track = null;
    this.synth?.stop();
    this.synth = null;
    this.current?.pause();
    this.current = null;
    for (const line of [...this.priority, ...this.queue]) line.el.src = '';
    this.priority = [];
    this.queue = [];
    this.playing = false;
    this.ctx?.close();
    this.ctx = null;
    this.musicGain = null;
    this.notify(null);
  }

  // The stage animates the teacher and shows captions from this
  private listeners = new Set<(line: Speaking | null) => void>();
  onSpeaking(fn: (line: Speaking | null) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private notify(line: Speaking | null) {
    for (const fn of this.listeners) fn(line);
  }
  // Silent pages (dashboard preview) still show the teacher talking, for roughly as long as the line would take
  private mimicTimer: ReturnType<typeof setTimeout> | null = null;
  private mimic(line: Speaking) {
    if (this.mimicTimer) clearTimeout(this.mimicTimer);
    this.notify(line);
    const ms = Math.min(8000, 600 + line.text.length * (line.lang === 'zh' ? 350 : 70));
    this.mimicTimer = setTimeout(() => this.notify(null), ms);
  }

  setChannelName(name: string) {
    if (name.trim()) this.channelName = name.trim();
  }

  // onStart fires when the line actually starts playing (or right away when sound is off), to sync visuals
  say(text: string, urgent = false, onStart?: () => void, lang: Lang = 'vi') {
    if (!this.enabled || !text.trim()) {
      onStart?.();
      if (text.trim()) this.mimic({ text, lang });
      return;
    }
    // Start downloading right away, so the line is ready the moment the previous one ends
    const el = new Audio(`/api/tts?lang=${lang}&text=${encodeURIComponent(text)}`);
    el.preload = 'auto';
    const line: Line = { text, onStart, lang, el };
    if (urgent) this.priority.push(line);
    else {
      // Never let a backlog build up: drop the oldest ordinary line
      if (this.queue.length >= 6) this.queue.shift()?.onStart?.();
      this.queue.push(line);
    }
    this.next();
  }

  private next() {
    if (this.playing) return;
    const line = this.priority.shift() ?? this.queue.shift();
    if (!line) {
      this.duck(false);
      return;
    }
    this.playing = true;
    this.duck(true);
    const el = line.el;
    this.current = el;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      line.onStart?.();
      this.notify({ text: line.text, lang: line.lang });
    };
    el.addEventListener('playing', start);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      start();
      clearTimeout(guard);
      this.playing = false;
      this.notify(null);
      this.next();
    };
    const guard = setTimeout(finish, 30000);
    el.addEventListener('ended', finish);
    el.addEventListener('error', finish);
    el.play().catch((err) => {
      if (err?.name !== 'NotAllowedError') return finish();
      // Autoplay blocked: keep the line and wait for a click instead of silently skipping it
      done = true;
      clearTimeout(guard);
      this.playing = false;
      this.priority.unshift(line);
      // Only the most recent few lines are worth reading once sound is unlocked
      this.priority.splice(3);
      this.queue.splice(0, Math.max(0, this.queue.length - 2));
      this.setBlocked(true);
    });
  }

  blocked = false;
  private blockedListeners = new Set<(blocked: boolean) => void>();
  onBlocked(fn: (blocked: boolean) => void) {
    this.blockedListeners.add(fn);
    return () => {
      this.blockedListeners.delete(fn);
    };
  }
  private setBlocked(b: boolean) {
    if (this.blocked === b) return;
    this.blocked = b;
    for (const fn of this.blockedListeners) fn(b);
  }

  private audio() {
    if (!this.enabled) return null;
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private tone(freqs: number[], at: number, length: number, volume: number, type: OscillatorType = 'sine') {
    const ctx = this.audio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + at;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + length + 0.05);
    }
  }

  // Rising two-note chime when the right answer is shown
  ding() {
    this.tone([1046.5, 1568], 0, 0.5, 0.12);
    this.tone([1318.5, 2093], 0.12, 0.7, 0.12);
  }

  // School bell when time is up
  bell() {
    for (let i = 0; i < 3; i++) this.tone([880, 1760, 2637], i * 0.14, 0.35, 0.07, 'triangle');
  }

  // Soft tick for the last seconds of the countdown
  tick() {
    this.tone([1200], 0, 0.06, 0.05, 'square');
  }

  // Short pop when someone answers
  pop() {
    this.tone([660 + Math.random() * 200], 0, 0.08, 0.04);
  }

  // ---------- Background music ----------
  setMusic(state: MusicState) {
    this.music = state;
    this.applyMusic();
  }

  nextTrack() {
    if (this.track) {
      this.track.pause();
      this.track = null;
      this.trackIdx++;
      this.playTrack();
    } else if (this.synth) {
      // Restart the generated music so it begins a fresh phrase
      this.synth.stop();
      this.synth = null;
      this.applyMusic();
    }
  }

  // Songs play in turn and loop; the list is re-read each round so newly added files join in
  private async loadPlaylist(refresh = false) {
    if (this.playlist && !refresh) return this.playlist;
    try {
      this.playlist = (await (await fetch('/api/music')).json()) as string[];
    } catch {
      this.playlist = this.playlist || [];
    }
    return this.playlist;
  }

  private async applyMusic() {
    if (!this.enabled) return;
    let want: 'off' | 'files' | 'ballad' | 'vui' = this.music.on ? this.music.style : 'off';
    // No files in public/music: fall back to the generated music
    if (want === 'files' && (await this.loadPlaylist()).length === 0) want = 'vui';

    if (want !== 'files' && this.track) {
      this.track.pause();
      this.track = null;
    }
    if (this.synth && this.synth.style !== want) {
      this.synth.stop();
      this.synth = null;
    }
    if (want === 'files' && !this.track) this.playTrack();
    if ((want === 'ballad' || want === 'vui') && !this.synth) {
      const ctx = this.audio()!;
      if (!this.musicGain) {
        this.musicGain = ctx.createGain();
        this.musicGain.connect(ctx.destination);
      }
      this.synth = new MusicSynth(ctx, this.musicGain, want);
      this.synth.start();
    }
    this.updateVolume();
  }

  private async playTrack() {
    const list = await this.loadPlaylist(this.trackIdx % Math.max(1, this.playlist?.length || 1) === 0);
    if (!this.enabled || !list.length || this.track || !this.music.on || this.music.style !== 'files') return;
    const el = new Audio(list[this.trackIdx % list.length]);
    this.track = el;
    const advance = () => {
      if (this.track !== el) return;
      this.track = null;
      this.trackIdx++;
      this.playTrack();
    };
    el.addEventListener('ended', advance);
    el.addEventListener('error', () => setTimeout(advance, 2000));
    this.updateVolume();
    el.play().catch(() => {});
  }

  private duck(on: boolean) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.updateVolume();
  }

  private updateVolume() {
    // Music drops while the voice is talking so names stay clear
    const v = this.music.volume * (this.ducked ? 0.25 : 1);
    if (this.track) this.track.volume = Math.min(1, v);
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.25);
  }
}

type Line = { text: string; onStart?: () => void; lang: Lang; el: HTMLAudioElement };
export type Speaking = { text: string; lang: Lang };

export const sound = new SoundEngine();

// A hot reload creates a fresh engine; the old one must stop or its song keeps playing underneath
import.meta.hot?.dispose(() => sound.shutdown());
