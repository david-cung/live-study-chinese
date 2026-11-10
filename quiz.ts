import fs from 'fs';
import path from 'path';
import type { LessonInfo, QuizQuestion, QuizState, TopEntry, Word } from './src/types';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'zh');
export const ANSWER_SECONDS = [10, 15, 20, 30];
const REVEAL_MS = 9000;
const BASE_POINTS = 10;
const LETTERS = ['A', 'B', 'C', 'D'];

type Lesson = LessonInfo & { words: Word[] };
type User = { username: string; nickname: string };

function readTopic(file: string): { title: string; words: Word[] } | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const words: Word[] = (Array.isArray(data.words) ? data.words : []).filter(
      (w: Word) => typeof w?.hanzi === 'string' && typeof w?.pinyin === 'string' && typeof w?.vi === 'string',
    );
    return { title: String(data.title || path.basename(file, '.json')), words };
  } catch (err) {
    console.error(`Bỏ qua ${file}: JSON lỗi`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Each folder in content/zh (hsk1, hsk2, ...) is one level that mixes all of its topic files; a loose .json file is a lesson of its own
export function loadLessons(): Lesson[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(CONTENT_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch {
    return [];
  }
  const lessons: Lesson[] = [];
  for (const e of entries) {
    const full = path.join(CONTENT_DIR, e.name);
    let words: Word[] = [];
    let title = e.name;
    if (e.isDirectory()) {
      title = e.name.toUpperCase();
      const files = fs.readdirSync(full).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const seen = new Set<string>();
      for (const f of files) {
        const topic = readTopic(path.join(full, f));
        for (const w of topic?.words || []) {
          if (seen.has(w.hanzi)) continue;
          seen.add(w.hanzi);
          words.push({ ...w, topic: topic!.title });
        }
      }
    } else if (e.name.endsWith('.json')) {
      const topic = readTopic(full);
      if (!topic) continue;
      title = topic.title;
      words = topic.words;
    } else continue;
    if (words.length >= 4) lessons.push({ id: e.name.replace(/\.json$/, ''), title, count: words.length, words });
  }
  return lessons;
}

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const samePinyin = (a: string, b: string) => a.replace(/[\s']/g, '').toLowerCase() === b.replace(/[\s']/g, '').toLowerCase();

// "A", "b", "1", "đáp án C", "câu B nha", "c ạ 😁" all count; anything longer is ordinary chat
const ANSWER_RE =
  /^\s*(?:đáp án|dap an|chọn|chon|câu|cau)?\s*(?:là|la)?\s*([abcd1-4])\s*(?:ạ|nha|nhé|nhe|nè|ne)?[\s.!?\p{Extended_Pictographic}\uFE0F]*$/iu;
export const parseAnswer = (text: string): number | null => {
  const m = ANSWER_RE.exec(text);
  if (!m) return null;
  const c = m[1].toLowerCase();
  return /\d/.test(c) ? Number(c) - 1 : c.charCodeAt(0) - 97;
};

export class Quiz {
  private lessons: Lesson[] = loadLessons();
  private lessonId: string;
  private seconds: number;
  private running = false;
  private phase: QuizState['phase'] = 'idle';
  private question: QuizQuestion | null = null;
  private correct: number | null = null;
  private correctUsers: string[] = [];
  private winners: string[] = [];
  private deck: Word[] = [];
  private no = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private answers = new Map<string, { choice: number; at: number; nickname: string }>();
  private scores = new Map<string, TopEntry>();
  private vipNext = new Set<string>();
  private bonusPending = false;
  private megaBonus = false;

  constructor(
    private emit: (event: string, data: unknown) => void,
    opts: { lessonId?: string; seconds?: number },
  ) {
    this.lessonId = this.lessons.some((l) => l.id === opts.lessonId) ? opts.lessonId! : this.lessons[0]?.id || '';
    this.seconds = ANSWER_SECONDS.includes(opts.seconds!) ? opts.seconds! : 15;
  }

  get settings() {
    return { lessonId: this.lessonId, seconds: this.seconds };
  }
  get isAsking() {
    return this.phase === 'asking';
  }
  lessonList(): LessonInfo[] {
    this.lessons = loadLessons();
    return this.lessons.map(({ id, title, count }) => ({ id, title, count }));
  }
  private get lesson() {
    return this.lessons.find((l) => l.id === this.lessonId) || this.lessons[0];
  }
  allWords(): Word[] {
    return this.lessons.flatMap((l) => l.words);
  }

  state(): QuizState {
    return {
      running: this.running,
      phase: this.phase,
      lessonId: this.lesson?.id || '',
      lessonTitle: this.lesson?.title || 'Chưa có bài học',
      seconds: this.seconds,
      question: this.question,
      answeredCount: this.answers.size,
      correct: this.phase === 'reveal' ? this.correct : null,
      correctUsers: this.phase === 'reveal' ? this.correctUsers : [],
      winners: this.phase === 'reveal' ? this.winners : [],
      bonusPending: this.bonusPending,
    };
  }
  private push() {
    this.emit('quiz', this.state());
  }
  top(n = 5) {
    return [...this.scores.values()].sort((a, b) => b.points - a.points).slice(0, n);
  }
  rankOf(username: string) {
    const all = [...this.scores.values()].sort((a, b) => b.points - a.points);
    const i = all.findIndex((s) => s.username === username);
    return i < 0 ? null : { rank: i + 1, points: all[i].points, total: all.length };
  }

  start() {
    if (!this.lesson) throw new Error('Chưa có bài học nào trong content/zh');
    this.running = true;
    if (this.phase === 'idle') this.next();
    else this.push();
  }
  // Pausing mid-question drops that question; mid-reveal the answer stays up until its timer ends
  pause() {
    this.running = false;
    if (this.phase === 'asking') {
      this.clear();
      this.phase = 'idle';
      this.question = null;
      this.answers.clear();
    }
    this.push();
  }
  skip() {
    if (!this.lesson) throw new Error('Chưa có bài học nào trong content/zh');
    this.next();
  }
  setLesson(id: string) {
    this.lessons = loadLessons();
    if (!this.lessons.some((l) => l.id === id)) throw new Error('Không tìm thấy bài học');
    this.lessonId = id;
    this.deck = [];
    this.push();
  }
  setSeconds(n: number) {
    if (!ANSWER_SECONDS.includes(n)) throw new Error('Thời gian không hợp lệ');
    this.seconds = n;
    this.push();
  }
  resetScores() {
    this.scores.clear();
    this.emit('score', { top: [] });
  }
  vip(username: string) {
    this.vipNext.add(username);
  }
  bonusNext() {
    this.bonusPending = true;
    this.push();
  }
  // Flat bonus (follow, event reward) — not tied to a quiz answer
  awardPoints(u: User, points: number) {
    if (points <= 0) return;
    const s = this.scores.get(u.username) || { username: u.username, nickname: u.nickname, points: 0 };
    this.scores.set(u.username, { ...s, nickname: u.nickname || s.nickname, points: s.points + points });
    this.emit('score', { top: this.top() });
  }
  // Next question is worth five times the normal points (session milestone reward)
  megaBonusNext() {
    this.bonusPending = true;
    this.megaBonus = true;
    this.push();
  }
  takeMegaBonus() {
    const v = this.megaBonus;
    this.megaBonus = false;
    return v;
  }

  // Returns true when the comment was an answer (counted or not), so it is not treated as chat
  tryAnswer(u: User, text: string) {
    const choice = parseAnswer(text);
    if (choice === null) return false;
    if (this.phase !== 'asking' || this.answers.has(u.username)) return true;
    this.answers.set(u.username, { choice, at: Date.now(), nickname: u.nickname });
    this.emit('answered', { username: u.username, count: this.answers.size });
    return true;
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private next() {
    this.clear();
    const lesson = this.lesson;
    if (this.deck.length === 0) this.deck = shuffle(lesson.words);
    const word = this.deck.pop()!;
    const others = shuffle(lesson.words.filter((w) => w.hanzi !== word.hanzi));
    // Listening needs choices that sound different, otherwise 他/她 would be a coin toss
    const audible = others.filter((w) => !samePinyin(w.pinyin, word.pinyin));
    const kind: QuizQuestion['kind'] = audible.length >= 3 && Math.random() < 0.4 ? 'listen' : 'meaning';
    const pool = kind === 'listen' ? audible : others.filter((w) => w.vi !== word.vi);
    const label = (w: Word) => (kind === 'listen' ? w.hanzi : w.vi);
    const options = shuffle([word, ...pool.slice(0, 3)]).map(label);

    this.answers.clear();
    this.correct = options.indexOf(label(word));
    this.correctUsers = [];
    this.winners = [];
    const bonus = this.bonusPending;
    this.bonusPending = false;
    const mega = this.takeMegaBonus();
    this.question = {
      no: ++this.no,
      kind,
      word,
      options,
      seconds: this.seconds,
      endsAt: Date.now() + this.seconds * 1000,
      bonus,
      megaBonus: mega || undefined,
    };
    this.phase = 'asking';
    this.push();
    this.timer = setTimeout(() => this.reveal(), this.seconds * 1000);
  }

  private reveal() {
    this.clear();
    const q = this.question!;
    const startedAt = q.endsAt - q.seconds * 1000;
    const right = [...this.answers.entries()].filter(([, a]) => a.choice === this.correct).sort((a, b) => a[1].at - b[1].at);
    for (const [username, a] of right) {
      // Faster answers earn up to double the base points
      const speed = Math.max(0, 1 - (a.at - startedAt) / (q.seconds * 1000));
      let pts = Math.round(BASE_POINTS * (1 + speed));
      if (q.megaBonus) pts *= 5;
      else if (q.bonus) pts *= 3;
      if (this.vipNext.has(username)) pts *= 2;
      const s = this.scores.get(username) || { username, nickname: a.nickname, points: 0 };
      this.scores.set(username, { ...s, nickname: a.nickname, points: s.points + pts });
    }
    // A VIP boost lasts for one question the person actually answers
    for (const username of this.answers.keys()) this.vipNext.delete(username);
    this.correctUsers = right.map(([u]) => u);
    this.winners = right.slice(0, 2).map(([, a]) => a.nickname);
    this.phase = 'reveal';
    this.push();
    this.emit('score', { top: this.top() });
    this.timer = setTimeout(() => {
      if (this.running) this.next();
      else {
        this.phase = 'idle';
        this.question = null;
        this.push();
      }
    }, REVEAL_MS);
  }

  letter(i: number) {
    return LETTERS[i] || '?';
  }
}
