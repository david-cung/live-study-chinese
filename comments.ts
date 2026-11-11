import { askAi } from './ai';
import { isBlocked } from './moderation';
import type { Quiz } from './quiz';
import type { AiState, QaItem, QuizState, Word } from './src/types';
import { spokenName } from './src/spokenName';
import { pruneCooldowns } from './retention';

type User = { username: string; nickname: string; avatar: string };

const USER_AI_COOLDOWN_MS = 2 * 60 * 1000;
const USER_QUICK_COOLDOWN_MS = 30 * 1000;
const AI_START_EVERY_MS = 20 * 1000;
const SMALLTALK_EVERY_MS = 15 * 1000;
const REPEAT_EVERY_MS = 6 * 1000;
// Matches the Q&A card time on the stage, so cards never cut each other off
const CARD_MS = 8000;
const MAX_QUEUE = 5;
const MAX_OUTBOX = 6;
const MAX_PENDING = 10;

const QUESTION_RE = /\?|nói sao|noi sao|đọc sao|doc sao|viết sao|viet sao|là gì|la gi|là sao|nghĩa là|nghia la|thế nào|như nào|tiếng trung|cô ơi|thầy ơi/i;
const CJK_RE = /[\u3400-\u9fff]/;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?~"'“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
// "là, phải" and "cái (lượng từ chung)" can be looked up by either part
const meanings = (w: Word) =>
  w.vi
    .replace(/\(.*?\)/g, '')
    .split(',')
    .map(norm)
    .filter(Boolean);

const lessonLabel = (s: QuizState) => [s.lessonTitle, s.question?.word.topic].filter(Boolean).join(' · ');
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const SMALLTALK: { re: RegExp; replies: string[] }[] = [
  { re: /khó quá|kho qua|khó ghê|chịu|bó tay/i, replies: ['{name} ơi đừng nản nha, mỗi ngày nhớ thêm một từ là giỏi lắm rồi!', 'Khó lúc đầu thôi {name}, nghe đi nghe lại vài lần là quen liền.'] },
  { re: /hay quá|hay qua|thích quá|dễ hiểu|bổ ích/i, replies: ['Cảm ơn {name} nha, nhớ ở lại học tiếp với cả lớp!', 'Vui quá, {name} thấy hay thì rủ bạn bè vào học chung nha.'] },
  { re: /cảm ơn cô|cam on co|cảm ơn thầy|thank/i, replies: ['Không có gì đâu {name}, học vui là cô vui rồi!', 'Cô cảm ơn {name} đã học chăm nha.'] },
];

export class CommentRouter {
  private ai: AiState;
  private queue: { user: User; comment: string }[] = [];
  private outbox: QaItem[] = [];
  private lastAiStart = 0;
  private lastSmalltalk = 0;
  private lastRepeat = 0;
  private lastDelivered = 0;
  private userLastAi = new Map<string, number>();
  private userLastQuick = new Map<string, number>();
  private id = 0;
  private timer: ReturnType<typeof setInterval>;
  private lastPrune = 0;

  dispose() { clearInterval(this.timer); }

  stats() {
    return { queued: this.queue.length, outbox: this.outbox.length, pending: this.ai.pending.length,
      busy: this.ai.busy, aiCooldowns: this.userLastAi.size, quickCooldowns: this.userLastQuick.size };
  }

  constructor(
    private quiz: Quiz,
    private emit: (event: string, data: unknown) => void,
    opts: { enabled?: boolean; mode?: AiState['mode']; model?: string },
  ) {
    this.ai = {
      enabled: opts.enabled ?? true,
      mode: opts.mode === 'review' ? 'review' : 'auto',
      model: opts.model || 'composer-2.5',
      busy: false,
      queued: 0,
      calls: 0,
      error: '',
      pending: [],
    };
    this.timer = setInterval(() => this.tick(), 1000);
  }

  get settings() {
    return { enabled: this.ai.enabled, mode: this.ai.mode, model: this.ai.model };
  }
  state(): AiState {
    return { ...this.ai, queued: this.queue.length };
  }
  private push() {
    this.emit('ai', this.state());
  }

  setEnabled(on: boolean) {
    this.ai.enabled = on;
    if (!on) this.queue = [];
    this.ai.error = '';
    this.push();
  }
  setMode(mode: AiState['mode']) {
    this.ai.mode = mode;
    this.push();
  }
  setModel(model: string) {
    if (!/^[a-z0-9.\-[\]=,]{2,80}$/i.test(model)) throw new Error('Tên model không hợp lệ');
    this.ai.model = model;
    this.push();
  }

  handle(user: User, comment: string) {
    if (this.quiz.tryAnswer(user, comment)) return;
    const text = comment.trim();
    if (!text || isBlocked(text)) return;
    const now = Date.now();

    // "đọc lại": hear the word on the board again; one repeat per few seconds for the whole room
    if (/^(đọc lại|doc lai|nghe lại|nghe lai)[.!]*$/i.test(text)) {
      if (this.quiz.state().question && now - this.lastRepeat > REPEAT_EVERY_MS) {
        this.lastRepeat = now;
        this.emit('control', { action: 'repeatWord' });
      }
      return;
    }

    const quick = this.quickReply(user, text);
    if (quick !== undefined) {
      if (now - (this.userLastQuick.get(user.username) || 0) < USER_QUICK_COOLDOWN_MS) return;
      this.userLastQuick.set(user.username, now);
      if (quick) this.deliver(quick);
      else this.enqueue(user, text, true);
      return;
    }

    for (const s of SMALLTALK) {
      if (s.re.test(text) && now - this.lastSmalltalk > SMALLTALK_EVERY_MS) {
        this.lastSmalltalk = now;
        this.deliver(this.item(user, text, { vi: pick(s.replies).replace('{name}', spokenName(user.nickname)) }, 'quick'));
        return;
      }
    }

    if (QUESTION_RE.test(text) || CJK_RE.test(text)) this.enqueue(user, text, false);
  }

  // undefined = not a command; null = a command the word list can't answer, so the AI takes it
  private quickReply(user: User, text: string): QaItem | null | undefined {
    const cmd = /^(đọc|doc|dịch|dich)\s+(.{1,40})$/i.exec(text);
    if (cmd) {
      const query = cmd[2].trim();
      const w = this.lookup(query);
      if (w) return this.item(user, text, { vi: `${w.vi[0].toUpperCase()}${w.vi.slice(1)}, đọc là:`, zh: `${w.hanzi}。${w.hanzi}。${w.hanzi}。`, pinyin: w.pinyin }, 'quick');
      if (/^(đọc|doc)$/i.test(cmd[1]) && CJK_RE.test(query) && query.length <= 12) return this.item(user, text, { vi: 'Cô đọc thử cho bạn nè:', zh: `${query}。${query}。` }, 'quick');
      return null;
    }
    if (/^(điểm|diem|xem điểm|hạng)$/i.test(text)) {
      const r = this.quiz.rankOf(user.username);
      return this.item(
        user,
        text,
        { vi: r ? `${spokenName(user.nickname)} đang có ${r.points} điểm, đứng hạng ${r.rank} trên ${r.total} bạn.` : `${spokenName(user.nickname)} chưa có điểm, trả lời đúng câu tới là có liền nha!` },
        'quick',
      );
    }
    return undefined;
  }

  private lookup(query: string): Word | undefined {
    const q = norm(query);
    const words = this.quiz.allWords();
    return words.find((w) => w.hanzi === query.trim()) || words.find((w) => meanings(w).includes(q)) || words.find((w) => norm(w.pinyin) === q);
  }

  // Dashboard: answer this comment with AI right away, skipping the question check and per-person limit
  ask(user: User, comment: string) {
    if (!this.ai.enabled) throw new Error('AI đang tắt');
    this.enqueue(user, comment, true, true);
  }
  pin(user: User, comment: string) {
    this.outbox.unshift(this.item(user, comment, { vi: '' }, 'pin'));
    this.outbox.splice(MAX_OUTBOX);
  }
  approve(id: number) {
    const i = this.ai.pending.findIndex((p) => p.id === id);
    if (i < 0) throw new Error('Câu này không còn trong danh sách chờ');
    this.deliver(this.ai.pending.splice(i, 1)[0]);
    this.push();
  }
  reject(id: number) {
    this.ai.pending = this.ai.pending.filter((p) => p.id !== id);
    this.push();
  }

  private enqueue(user: User, comment: string, direct: boolean, force = false) {
    if (!this.ai.enabled) return;
    const now = Date.now();
    if (!force) {
      if (!direct && now - (this.userLastAi.get(user.username) || 0) < USER_AI_COOLDOWN_MS) return;
      if (this.queue.some((q) => q.user.username === user.username)) return;
    }
    this.userLastAi.set(user.username, now);
    const entry = { user, comment: comment.slice(0, 200) };
    if (force) this.queue.unshift(entry);
    else this.queue.push(entry);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(MAX_QUEUE);
    this.push();
  }

  private item(user: User, comment: string, reply: { vi: string; zh?: string; pinyin?: string }, source: QaItem['source']): QaItem {
    return { id: ++this.id, username: user.username, nickname: user.nickname, avatar: user.avatar, comment: comment.slice(0, 120), ...reply, source };
  }

  private deliver(item: QaItem) {
    this.outbox.push(item);
    if (this.outbox.length > MAX_OUTBOX) this.outbox.shift();
  }

  private tick() {
    const now = Date.now();
    if (now - this.lastPrune >= 30000) {
      this.lastPrune = now;
      pruneCooldowns(this.userLastAi, USER_AI_COOLDOWN_MS, now);
      pruneCooldowns(this.userLastQuick, USER_QUICK_COOLDOWN_MS, now);
    }
    // Cards wait while viewers are answering, so they never cover the question
    if (this.outbox.length && !this.quiz.isAsking && now - this.lastDelivered >= CARD_MS) {
      this.lastDelivered = now;
      this.emit('qa', this.outbox.shift());
    }
    if (this.ai.enabled && !this.ai.busy && this.queue.length && now - this.lastAiStart >= AI_START_EVERY_MS) {
      this.lastAiStart = now;
      this.runAi(this.queue.shift()!);
    }
  }

  private async runAi({ user, comment }: { user: User; comment: string }) {
    this.ai.busy = true;
    this.ai.calls++;
    this.push();
    try {
      const reply = await askAi({ nickname: spokenName(user.nickname), comment, lesson: lessonLabel(this.quiz.state()) }, this.ai.model);
      this.ai.error = '';
      if ([reply.vi, reply.zh || '', reply.pinyin || ''].some(isBlocked)) return;
      const item = this.item(user, comment, reply, 'ai');
      if (this.ai.mode === 'review') {
        this.ai.pending.push(item);
        if (this.ai.pending.length > MAX_PENDING) this.ai.pending.shift();
      } else this.deliver(item);
    } catch (err) {
      this.ai.error = err instanceof Error ? err.message : String(err);
      console.warn('AI lỗi:', this.ai.error);
    } finally {
      this.ai.busy = false;
      this.push();
    }
  }
}
