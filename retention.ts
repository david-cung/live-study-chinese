export function pruneCooldowns(map: Map<string, number>, ttlMs: number, now = Date.now()) {
  for (const [key, at] of map) if (now - at >= ttlMs) map.delete(key);
}

// Keep a few names for on-screen thanks and count the rest without keeping
// a separate object (and nickname) for every event during a rush.
export class SocialBuffer {
  private items: { nickname: string; kind: 'follow' | 'share' }[] = [];
  private extra = { follow: 0, share: 0 };

  constructor(private limit = 24) {}

  add(nickname: string, kind: 'follow' | 'share') {
    if (this.items.length < this.limit) this.items.push({ nickname, kind });
    else this.extra[kind]++;
  }

  take() {
    const items = this.items.splice(0, 3);
    const extra = this.extra;
    this.extra = { follow: 0, share: 0 };
    return { items, extra };
  }

  clear() { this.items = []; this.extra = { follow: 0, share: 0 }; }
  stats() { return { named: this.items.length, extraFollow: this.extra.follow, extraShare: this.extra.share }; }
  get size() { return this.items.length + this.extra.follow + this.extra.share; }
}
