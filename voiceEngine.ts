import { AudioCache, TtsBusyError, TtsService } from './ttsCache';
import type { Lang } from './src/types';
import type { Teacher } from './src/teacher';
import { DEFAULT_VOICE_SETTINGS, validVoiceSettings, type VoiceOption, type VoiceSettings, type VoiceState } from './src/voiceSettings';

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
type VoiceAudio = { audio: Buffer; contentType: 'audio/wav' | 'audio/mpeg'; provider: 'vieneu' | 'edge' };

// The upstream streaming API may leave WAV sizes unknown. We buffer for the bounded
// cache, then finalize the header so browsers can determine duration and finish playback.
export function finalizeWav(input: Buffer): Buffer {
  if (input.length < 44 || input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV');
  const audio = Buffer.from(input);
  audio.writeUInt32LE(audio.length - 8, 4);
  for (let offset = 12; offset + 8 <= audio.length;) {
    const tag = audio.toString('ascii', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    if (tag === 'data') {
      if (audio.length - offset - 8 < 2 || size === 0) throw new Error('Empty WAV');
      if (size === 0xffffffff) audio.writeUInt32LE(audio.length - offset - 8, offset + 4);
      else if (size > audio.length - offset - 8) throw new Error('Truncated WAV');
      return audio;
    }
    if (size > audio.length - offset - 8) break;
    offset += 8 + size + (size % 2);
  }
  throw new Error('Missing WAV data');
}

export class VoiceEngine {
  private settings: VoiceSettings;
  private voices: VoiceOption[] = [];
  private status: VoiceState['status'] = 'unchecked';
  private revision = 0;
  private retryAt = 0;
  private discovery: Promise<void> | null = null;
  // One generation at a time also suits the CPU model; only a small backlog is admitted.
  private vieneu = new TtsService(new AudioCache(24 * 1024 * 1024, 200), 1, 8);
  private legacy = new TtsService(new AudioCache(16 * 1024 * 1024, 200), 2, 32);
  private base: string;
  private timeout: number;

  constructor(raw: unknown, private options: {
    baseUrl?: string; apiKey?: string; timeoutMs?: number;
    legacy: (text: string, lang: Lang, teacher: Teacher) => Promise<Buffer>;
    changed?: (state: VoiceState) => void;
    fetch?: typeof fetch;
  }) {
    this.settings = validVoiceSettings(raw) ? { ...raw } : { ...DEFAULT_VOICE_SETTINGS };
    const base = new URL(options.baseUrl || 'http://127.0.0.1:8000/v1');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('VIENEU_BASE_URL must be an HTTP base URL without credentials or query');
    this.base = base.toString().replace(/\/$/, '');
    this.timeout = Number.isFinite(options.timeoutMs) ? Math.max(1000, Math.min(120000, options.timeoutMs!)) : 45000;
  }

  state(): VoiceState {
    return { settings: { ...this.settings }, status: this.status, voices: this.voices.map((voice) => ({ ...voice })), revision: this.revision,
      message: this.settings.provider === 'edge' ? 'Đang dùng giọng tiêu chuẩn.' : this.status === 'ready' ? 'VieNeu sẵn sàng đọc tiếng Việt.' : this.status === 'unavailable' ? 'VieNeu chưa sẵn sàng. Tạm dùng giọng dự phòng; hãy mở bộ giọng Việt rồi kiểm tra lại.' : 'Mở bộ giọng Việt, rồi bấm Kiểm tra kết nối.' };
  }
  private notify() { this.options.changed?.(this.state()); }
  update(raw: unknown) {
    if (!validVoiceSettings(raw)) throw new Error('Cài đặt giọng không hợp lệ');
    this.settings = { ...raw };
    this.revision++;
    this.retryAt = 0;
    this.notify();
  }
  private headers() { return { ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}), 'Content-Type': 'application/json' }; }
  private get request() { return this.options.fetch || fetch; }
  async refresh() {
    if (this.discovery) return this.discovery;
    this.discovery = this.discover().finally(() => { this.discovery = null; });
    return this.discovery;
  }
  private async discover() {
    try {
      const response = await this.request(`${this.base}/voices`, { headers: this.headers(), signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) throw new Error('VieNeu unavailable');
      const payload = await response.json();
      if (!Array.isArray(payload.data)) throw new Error('Invalid voices');
      this.voices = payload.data.slice(0, 100).filter((v: VoiceOption) => v && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 128)
        .map((v: VoiceOption) => ({ id: v.id, name: typeof v.name === 'string' ? v.name.slice(0, 128) : v.id, gender: typeof v.gender === 'string' ? v.gender : '' }));
      if (!this.voices.length) throw new Error('No voices');
      this.status = 'ready';
      this.retryAt = 0;
    } catch {
      this.status = 'unavailable';
      this.retryAt = Date.now() + 15000;
    }
    this.notify();
  }
  private selectedVoice(teacher: Teacher, settings: VoiceSettings) {
    const selected = teacher === 'male' ? settings.maleVoice : settings.femaleVoice;
    if (selected) return selected;
    const genders = teacher === 'male' ? ['male', 'm', 'nam'] : ['female', 'f', 'nữ', 'nu'];
    return this.voices.find((v) => genders.includes(v.gender.toLowerCase()))?.id || this.voices[0]?.id || '';
  }
  async synthesize(text: string, lang: Lang, teacher: Teacher): Promise<VoiceAudio> {
    const settings = { ...this.settings };
    if (lang === 'vi' && settings.provider === 'vieneu' && Date.now() >= this.retryAt) {
      if (this.status !== 'ready') await this.refresh();
      if (this.status === 'ready') {
        const voice = this.selectedVoice(teacher, settings);
        try {
          const audio = await this.vieneu.get(JSON.stringify([this.base, voice, text]), () => this.speak(text, voice));
          return { audio, contentType: 'audio/wav', provider: 'vieneu' };
        } catch (error) {
          if (error instanceof TtsBusyError) throw error;
          this.status = 'unavailable';
          this.retryAt = Date.now() + 15000;
          this.notify();
        }
      }
    }
    // A fallback has its own key: it must never poison the preferred VieNeu cache.
    const audio = await this.legacy.get(JSON.stringify(['edge', lang, teacher, text]), () => this.options.legacy(text, lang, teacher));
    return { audio, contentType: 'audio/mpeg', provider: 'edge' };
  }
  private async speak(text: string, voice: string): Promise<Buffer> {
    const response = await this.request(`${this.base}/audio/speech`, {
      method: 'POST', headers: this.headers(), signal: AbortSignal.timeout(this.timeout), redirect: 'error',
      body: JSON.stringify({ model: 'vieneu-v3-turbo', input: text, voice, response_format: 'wav', stream_format: 'audio' }),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('VieNeu synthesis failed'); }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_AUDIO_BYTES) throw new Error('VieNeu audio too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return finalizeWav(Buffer.concat(chunks));
  }
  stats() {
    const preferred = this.vieneu.stats(), legacy = this.legacy.stats();
    return { cacheBytes: preferred.cacheBytes + legacy.cacheBytes, cacheEntries: preferred.cacheEntries + legacy.cacheEntries,
      active: preferred.active + legacy.active, waiting: preferred.waiting + legacy.waiting, pending: preferred.pending + legacy.pending };
  }
}
