// Audio is bounded by bytes as well as entries: long, unique viewer names must
// not turn the voice cache into an unbounded part of the live session.
export class AudioCache {
  private entries = new Map<string, Buffer>();
  bytes = 0;

  constructor(readonly maxBytes = 32 * 1024 * 1024, readonly maxEntries = 300) {}

  get size() { return this.entries.size; }

  get(key: string) {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: Buffer) {
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.length;
    this.entries.delete(key);
    if (value.length <= this.maxBytes) {
      this.entries.set(key, value);
      this.bytes += value.length;
    }
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.length;
      this.entries.delete(oldest);
    }
  }
}

export class TtsBusyError extends Error {}

export class TtsService {
  readonly cache: AudioCache;
  private pending = new Map<string, Promise<Buffer>>();
  private waiting: (() => void)[] = [];
  private active = 0;

  constructor(cache = new AudioCache(), private concurrency = 2, private maxWaiting = 32) {
    this.cache = cache;
  }

  stats() {
    return { cacheBytes: this.cache.bytes, cacheEntries: this.cache.size, active: this.active, waiting: this.waiting.length, pending: this.pending.size };
  }

  get(key: string, produce: () => Promise<Buffer>): Promise<Buffer> {
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.active >= this.concurrency && this.waiting.length >= this.maxWaiting) {
      return Promise.reject(new TtsBusyError('Voice queue is full'));
    }
    // Defer execution until pending has been populated, including when a
    // producer throws synchronously. Every waiter for a key shares one job.
    const promise = new Promise<Buffer>((resolve, reject) => {
      const start = () => {
        this.active++;
        const release = () => {
          this.pending.delete(key);
          this.active--;
          this.waiting.shift()?.();
        };
        Promise.resolve().then(produce).then((audio) => {
          this.cache.set(key, audio);
          release();
          resolve(audio);
        }, (error) => {
          release();
          reject(error);
        });
      };
      if (this.active < this.concurrency) start();
      else this.waiting.push(start);
    });
    this.pending.set(key, promise);
    return promise;
  }
}
