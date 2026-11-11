/// <reference types="vite/client" />
import { MusicSynth } from './music';
import { SpeechQueue, type SpeechGroup, type SpeechLine } from './speechQueue';
import type { Lang, MusicState } from './types';

// Voice queue (Vietnamese and Chinese), quiz sounds and background music. Only the ?view=stage page calls enable(); the dashboard stays silent.
export class SoundEngine {
  private enabled = false;
  private speech = new SpeechQueue();
  private building: SpeechGroup | null = null;
  private preloaded: { line: SpeechLine; el: HTMLAudioElement } | null = null;
  private cancelCurrent: (() => void) | null = null;
  private retryLine: SpeechLine | null = null;
  private playing = false;
  private ctx: AudioContext | null = null;
  channelName = 'Lớp Tiếng Trung Online';

  private music: MusicState = { on: true, volume: 0.1, style: 'files' };
  private musicGain: GainNode | null = null;
  private synth: MusicSynth | null = null;
  private track: HTMLAudioElement | null = null;
  private playlist: string[] | null = null;
  private trackIdx = 0;
  private musicVersion = 0;
  private clearTrack: (() => void) | null = null;
  private playlistRequest: Promise<string[]> | null = null;
  private playlistAbort: AbortController | null = null;
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
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
    this.channel.postMessage({ hello: this.id });
    this.tryClaim(400);
  }

  private pageHide = () => { this.release(); this.becomeSilent(); };
  private pageShow = () => {
    if (!this.channel || this.holder) return;
    this.channel.postMessage({ hello: this.id });
    this.tryClaim(400);
  };

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
    window.removeEventListener('pagehide', this.pageHide);
    window.removeEventListener('pageshow', this.pageShow);
  }

  // Stops every sound this engine started
  private stopAll() {
    this.holder = false;
    this.enabled = false;
    this.setBlocked(false);
    this.musicVersion++;
    this.playlistAbort?.abort();
    this.playlistAbort = null;
    this.playlistRequest = null;
    this.clearTrack?.();
    this.synth?.stop();
    this.synth = null;
    this.cancelCurrent?.();
    this.dropPreload();
    this.retryLine = null;
    this.speech.clear();
    this.playing = false;
    this.ducked = false;
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.claimTimer = null;
    if (this.mimicTimer) clearTimeout(this.mimicTimer);
    this.mimicTimer = null;
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

  // Assemble all Vietnamese/Chinese segments before admitting the message.
  group(run: () => void, question?: number) {
    if (this.building) {
      if (question !== undefined) this.building.question = question;
      run();
      return;
    }
    const group: SpeechGroup = { lines: [], urgent: false, question };
    this.building = group;
    try { run(); } finally {
      this.building = null;
      this.speech.add(group);
      this.next();
    }
  }

  setQuestion(question: number | null) {
    if (this.speech.setQuestion(question)) {
      this.cancelCurrent?.();
      this.retryLine = null;
    }
    this.refreshPreload();
    // The new question's message is still being assembled by group(). Don't
    // start a gift from the old backlog before that message is admitted.
    if (!this.building) this.next();
  }

  say(text: string, urgent = false, onStart?: () => void, lang: Lang = 'vi') {
    if (!this.enabled || !text.trim()) {
      onStart?.();
      if (text.trim()) this.mimic({ text, lang });
      return;
    }
    const line: SpeechLine = { text, onStart, lang };
    if (this.building) {
      this.building.lines.push(line);
      this.building.urgent ||= urgent;
    } else {
      this.speech.add({ lines: [line], urgent });
      this.next();
    }
  }

  private disposeAudio(el: HTMLAudioElement) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  private dropPreload() {
    if (this.preloaded) this.disposeAudio(this.preloaded.el);
    this.preloaded = null;
  }

  private makeAudio(line: SpeechLine) {
    const el = new Audio(`/api/tts?lang=${line.lang}&text=${encodeURIComponent(line.text)}`);
    el.preload = 'auto';
    return el;
  }

  private refreshPreload() {
    const line = this.retryLine ?? this.speech.peek();
    if (this.preloaded?.line === line) return;
    this.dropPreload();
    if (this.enabled && !this.blocked && line) this.preloaded = { line, el: this.makeAudio(line) };
  }

  private next() {
    if (!this.enabled || this.blocked) return;
    if (this.playing) { this.refreshPreload(); return; }
    const line = this.retryLine ?? this.speech.take();
    this.retryLine = null;
    if (!line) { this.dropPreload(); this.duck(false); return; }
    const el = this.preloaded?.line === line ? this.preloaded.el : this.makeAudio(line);
    if (this.preloaded?.el === el) this.preloaded = null;
    else this.dropPreload();
    this.playing = true;
    this.duck(true);
    this.current = el;
    let started = false;
    let done = false;
    const start = () => {
      if (started || done) return;
      started = true;
      line.onStart?.();
      this.notify({ text: line.text, lang: line.lang });
    };
    const cleanup = () => {
      done = true;
      clearTimeout(guard);
      el.removeEventListener('playing', start);
      el.removeEventListener('ended', finish);
      el.removeEventListener('error', finish);
      this.disposeAudio(el);
      this.current = null;
      this.cancelCurrent = null;
      this.playing = false;
      this.notify(null);
    };
    const finish = () => {
      if (done) return;
      cleanup();
      this.next();
    };
    const guard = setTimeout(finish, 30000);
    this.cancelCurrent = cleanup;
    el.addEventListener('playing', start);
    el.addEventListener('ended', finish);
    el.addEventListener('error', finish);
    this.refreshPreload();
    el.play().catch((err) => {
      if (done) return;
      if (err?.name !== 'NotAllowedError') { finish(); return; }
      cleanup();
      this.retryLine = line;
      this.dropPreload();
      this.setBlocked(true);
    });
  }

  stats() {
    return { ...this.speech.stats(), activeAudio: this.current ? 1 : 0, preloadedAudio: this.preloaded ? 1 : 0, blocked: this.blocked };
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
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
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
    this.musicVersion++;
    this.clearTrack?.();
    this.trackIdx++;
    this.synth?.stop();
    this.synth = null;
    void this.applyMusic();
  }

  private async loadPlaylist(refresh = false): Promise<string[]> {
    if (this.playlistRequest) return this.playlistRequest;
    if (this.playlist && !refresh) return this.playlist;
    const controller = new AbortController();
    this.playlistAbort = controller;
    const request = fetch('/api/music', { signal: controller.signal })
      .then((r) => r.json()).then((list: unknown) => {
        const files = Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
        if (!controller.signal.aborted) this.playlist = files;
        return files;
      }).catch(() => this.playlist || []).finally(() => {
        if (this.playlistRequest === request) {
          this.playlistRequest = null;
          this.playlistAbort = null;
        }
      });
    this.playlistRequest = request;
    return request;
  }

  private async applyMusic() {
    const version = ++this.musicVersion;
    if (!this.enabled) return;
    let want: 'off' | 'files' | 'ballad' | 'vui' = this.music.on ? this.music.style : 'off';
    if (want === 'files' && (await this.loadPlaylist()).length === 0) want = 'vui';
    if (!this.enabled || version !== this.musicVersion) return;
    if (want !== 'files') this.clearTrack?.();
    if (this.synth && this.synth.style !== want) {
      this.synth.stop();
      this.synth = null;
    }
    if (want === 'files' && !this.track) void this.playTrack(version);
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

  private async playTrack(version: number) {
    const list = await this.loadPlaylist(this.trackIdx % Math.max(1, this.playlist?.length || 1) === 0);
    if (!this.enabled || version !== this.musicVersion || !list.length || this.track || !this.music.on || this.music.style !== 'files') return;
    const el = new Audio(list[this.trackIdx % list.length]);
    let retry: ReturnType<typeof setTimeout> | undefined;
    this.track = el;
    const cleanup = () => {
      clearTimeout(retry);
      el.removeEventListener('ended', advance);
      el.removeEventListener('error', error);
      this.disposeAudio(el);
      if (this.track === el) { this.track = null; this.clearTrack = null; }
    };
    const advance = () => {
      if (this.track !== el || !this.enabled) return;
      cleanup();
      this.trackIdx++;
      void this.playTrack(this.musicVersion);
    };
    const error = () => { if (!retry) retry = setTimeout(advance, 2000); };
    this.clearTrack = cleanup;
    el.addEventListener('ended', advance);
    el.addEventListener('error', error);
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

export type Speaking = { text: string; lang: Lang };

export const sound = new SoundEngine();

// A hot reload creates a fresh engine; the old one must stop or its song keeps playing underneath
import.meta.hot?.dispose(() => sound.shutdown());
