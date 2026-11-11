import fs from 'fs';
import { revealDuration } from './src/quizTiming';
import path from 'path';
import type { ClozeExercise, LessonInfo, QuizKind, QuizMode, QuizQuestion, QuizState, TopEntry, Word } from './src/types';
import { QUIZ_KINDS, QUIZ_LABELS, questionAnswer } from './src/quizModes';
import { availableQuestionKinds, clozeQuestion, shuffle, validClozeExercises, wordQuestion } from './questions';
import { isHskLevel, loadExams } from './exams';
import type { Activity, ExamExercise, ExamResult, HskLevel } from './src/examTypes';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'zh');
export const ANSWER_SECONDS = [10, 15, 20, 30];
const BASE_POINTS = 10;
const LETTERS = ['A', 'B', 'C', 'D'];

type Lesson = LessonInfo & { words: Word[]; cloze: ClozeExercise[] };
type User = { username: string; nickname: string };

function readTopic(file: string): { title: string; words: Word[]; cloze: unknown[] } | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const words: Word[] = (Array.isArray(data.words) ? data.words : []).filter(
      (w: Word) => typeof w?.hanzi === 'string' && !!w.hanzi.trim() && typeof w?.pinyin === 'string' && !!w.pinyin.trim() && typeof w?.vi === 'string' && !!w.vi.trim(),
    );
    return { title: String(data.title || path.basename(file, '.json')), words, cloze: Array.isArray(data.cloze) ? data.cloze : [] };
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
    const rawCloze: unknown[] = [];
    let title = e.name;
    if (e.isDirectory()) {
      title = e.name.toUpperCase();
      const files = fs.readdirSync(full).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const seen = new Set<string>();
      for (const f of files) {
        const topic = readTopic(path.join(full, f));
        rawCloze.push(...(topic?.cloze || []));
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
      rawCloze.push(...topic.cloze);
    } else continue;
    if (words.length >= 4) lessons.push({ id: e.name.replace(/\.json$/, ''), title, count: words.length, words, cloze: validClozeExercises(rawCloze, words) });
  }
  return lessons;
}

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
  private mode: QuizMode;
  private kindDeck: QuizKind[] = [];
  private lastKind: QuizKind | null = null;
  private clozeDeck: ClozeExercise[] = [];
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
  private activity: Activity = 'study';
  private papers = loadExams();
  private examLevel: HskLevel = 'hsk1';
  private examCursor = 0;
  private examCompleted = false;
  private examResults = new Map<string, ExamResult>();

  constructor(
    private emit: (event: string, data: unknown) => void,
    opts: { lessonId?: string; seconds?: number; mode?: QuizMode; activity?: Activity; examLevel?: HskLevel },
  ) {
    this.lessonId = this.lessons.some((l) => l.id === opts.lessonId) ? opts.lessonId! : this.lessons[0]?.id || '';
    this.seconds = ANSWER_SECONDS.includes(opts.seconds!) ? opts.seconds! : 15;
    this.mode = opts.mode && (opts.mode === 'mixed' || this.availableKinds.includes(opts.mode)) ? opts.mode : 'mixed';
    if (isHskLevel(opts.examLevel)) this.examLevel = opts.examLevel;
    if (opts.activity === 'exam' && this.paper) this.activity = 'exam';
  }

  get settings() {
    return { lessonId: this.lessonId, seconds: this.seconds, mode: this.mode, activity: this.activity, examLevel: this.examLevel };
  }
  private get paper() { return this.papers.find((paper) => paper.level === this.examLevel); }
  private get exercise(): ExamExercise | undefined { return this.paper?.questions[this.examCursor - 1]; }
  private get availableKinds() { return this.lesson ? availableQuestionKinds(this.lesson.words, this.lesson.cloze) : []; }
  get isAsking() {
    return this.phase === 'asking' && this.running;
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
    let question = this.question;
    if (question?.exam && this.phase === 'reveal' && this.exercise) {
      const { transcript, translation, explanation, keyword } = this.exercise;
      question = { ...question, exam: { ...question.exam, transcript, translation, explanation, keyword } };
    }
    return {
      activity: this.activity,
      exam: this.activity === 'exam' && this.paper ? {
        id: this.paper.id, level: this.examLevel, title: this.paper.title, description: this.paper.description,
        position: this.examCursor, total: this.paper.questions.length, completed: this.examCompleted,
        results: [...this.examResults.values()].sort((a, b) => b.listening + b.reading - a.listening - a.reading),
      } : undefined,
      running: this.running,
      mode: this.mode,
      availableKinds: this.availableKinds,
      phase: this.phase,
      lessonId: this.activity === 'exam' ? this.examLevel : this.lesson?.id || '',
      lessonTitle: this.activity === 'exam' ? this.paper?.title || 'Chưa có bộ đề' : this.lesson?.title || 'Chưa có bài học',
      seconds: this.seconds,
      question,
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
    if (this.activity === 'exam') return [...this.examResults.values()]
      .map((result) => ({ username: result.username, nickname: result.nickname, points: result.listening + result.reading }))
      .sort((a, b) => b.points - a.points).slice(0, n);
    return [...this.scores.values()].sort((a, b) => b.points - a.points).slice(0, n);
  }
  rankOf(username: string) {
    const all = this.activity === 'exam' ? this.top(this.examResults.size) : [...this.scores.values()].sort((a, b) => b.points - a.points);
    const i = all.findIndex((s) => s.username === username);
    return i < 0 ? null : { rank: i + 1, points: all[i].points, total: all.length };
  }

  start() {
    if (this.activity === 'exam') {
      if (!this.paper) throw new Error('Chưa có bộ đề cho cấp độ này');
      if (this.running) return;
      if (this.examCompleted) { this.resetExam(); this.emit('score', { top: [] }); }
      this.running = true;
      if (!this.question) this.nextExam();
      else this.push();
      return;
    }
    if (!this.lesson) throw new Error('Chưa có bài học nào trong content/zh');
    this.running = true;
    if (this.phase === 'idle') this.next();
    else this.push();
  }
  // Pausing mid-question drops that question; mid-reveal the answer stays up until its timer ends
  pause() {
    this.running = false;
    if (this.activity === 'exam') {
      this.clear();
      if (this.question && this.phase === 'asking') this.question = { ...this.question, endsAt: 0 };
      this.push();
      return;
    }
    if (this.phase === 'asking') {
      this.clear();
      this.phase = 'idle';
      this.question = null;
      this.answers.clear();
    }
    this.push();
  }
  skip() {
    if (this.activity === 'exam') {
      if (!this.running) throw new Error('Bấm Bắt đầu hoặc Tiếp tục trước');
      if (this.phase === 'asking') this.reveal();
      else this.nextExam();
      return;
    }
    if (!this.lesson) throw new Error('Chưa có bài học nào trong content/zh');
    this.next();
  }
  setLesson(id: string) {
    if (this.activity === 'exam') {
      if (!isHskLevel(id) || !this.papers.some((paper) => paper.level === id)) throw new Error('Không tìm thấy bộ đề');
      this.examLevel = id;
      this.resetExam();
      this.push();
      this.emit('score', { top: this.top() });
      return;
    }
    this.lessons = loadLessons();
    if (!this.lessons.some((l) => l.id === id)) throw new Error('Không tìm thấy bài học');
    this.lessonId = id;
    this.deck = [];
    this.clozeDeck = [];
    this.kindDeck = [];
    if (this.mode !== 'mixed' && !this.availableKinds.includes(this.mode)) this.mode = 'mixed';
    this.push();
  }
  setMode(mode: string) {
    if (mode !== 'mixed' && !QUIZ_KINDS.includes(mode as QuizKind)) throw new Error('Dạng bài không hợp lệ');
    if (mode !== 'mixed' && !this.availableKinds.includes(mode as QuizKind)) throw new Error(`Bài học này chưa đủ dữ liệu cho dạng ${QUIZ_LABELS[mode as QuizKind]}`);
    this.mode = mode as QuizMode;
    this.kindDeck = [];
    this.push();
  }
  setSeconds(n: number) {
    if (!ANSWER_SECONDS.includes(n)) throw new Error('Thời gian không hợp lệ');
    this.seconds = n;
    this.push();
  }
  resetScores() {
    if (this.activity === 'exam') throw new Error('Dùng Làm lại đề để đặt lại kết quả giải đề');
    this.scores.clear();
    this.emit('score', { top: [] });
  }
  memoryStats() { return { scores: this.scores.size, answers: this.answers.size, vip: this.vipNext.size }; }
  clearSessionBenefits() { this.vipNext.clear(); }

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
    if (!this.isAsking || !this.question || choice >= this.question.options.length || this.answers.has(u.username)) return true;
    if (this.activity === 'exam' && (!this.question.endsAt || Date.now() >= this.question.endsAt)) return true;
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
    const available = this.availableKinds;
    if (!available.length) throw new Error('Bài học cần ít nhất bốn đáp án khác nhau để tạo câu hỏi');
    if (this.mode !== 'mixed' && !available.includes(this.mode)) this.mode = 'mixed';
    let kind: QuizKind;
    if (this.mode === 'mixed') {
      this.kindDeck = this.kindDeck.filter((kind) => available.includes(kind));
      if (!this.kindDeck.length) {
        this.kindDeck = shuffle(available);
        // Avoid the same format on both sides of a shuffled cycle boundary.
        if (this.kindDeck.length > 1 && this.kindDeck.at(-1) === this.lastKind) {
          [this.kindDeck[0], this.kindDeck[this.kindDeck.length - 1]] = [this.kindDeck[this.kindDeck.length - 1], this.kindDeck[0]];
        }
      }
      kind = this.kindDeck.pop()!;
    } else kind = this.mode;
    this.lastKind = kind;
    let draft;
    if (kind === 'fill') {
      if (!this.clozeDeck.length) this.clozeDeck = shuffle(lesson.cloze);
      draft = clozeQuestion(this.clozeDeck.pop()!, lesson.words);
    } else {
      if (!this.deck.length) this.deck = shuffle(lesson.words);
      draft = wordQuestion(kind, this.deck.pop()!, lesson.words);
    }
    if (!draft) throw new Error('Không tạo được bốn đáp án khác nhau cho câu hỏi');

    this.answers.clear();
    this.correct = draft.options.indexOf(questionAnswer(draft));
    this.correctUsers = [];
    this.winners = [];
    const bonus = this.bonusPending;
    this.bonusPending = false;
    const mega = this.takeMegaBonus();
    this.question = {
      no: ++this.no,
      ...draft,
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
    if (!this.question || this.phase !== 'asking') return;
    const q = this.question!;
    const startedAt = q.endsAt - q.seconds * 1000;
    const right = [...this.answers.entries()].filter(([, a]) => a.choice === this.correct).sort((a, b) => a[1].at - b[1].at);
    if (this.activity === 'exam' && this.exercise) {
      for (const [username, answer] of this.answers) {
        const result = this.examResults.get(username) || { username, nickname: answer.nickname, answered: 0, listening: 0, reading: 0 };
        result.nickname = answer.nickname;
        result.answered++;
        if (answer.choice === this.correct) result[this.exercise.section]++;
        this.examResults.set(username, result);
      }
    }
    for (const [username, a] of this.activity === 'exam' ? [] : right) {
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
    if (this.activity === 'exam') return; // The operator advances after the explanation has finished.
    this.timer = setTimeout(() => {
      if (this.running) this.next();
      else {
        this.phase = 'idle';
        this.question = null;
        this.push();
      }
    }, revealDuration(q.no));
  }

  letter(i: number) {
    return LETTERS[i] || '?';
  }

  setActivity(value: string) {
    if (value !== 'study' && value !== 'exam') throw new Error('Chế độ không hợp lệ');
    if (value === this.activity) return;
    if (value === 'exam' && !this.paper) throw new Error('Chưa có bộ đề');
    this.resetExam();
    this.activity = value;
    this.push();
    this.emit('score', { top: this.top() });
  }

  private resetExam() {
    this.clear();
    this.running = false;
    this.phase = 'idle';
    this.question = null;
    this.correct = null;
    this.answers.clear();
    this.correctUsers = [];
    this.winners = [];
    this.examCursor = 0;
    this.examCompleted = false;
    this.examResults.clear();
  }

  restartExam() {
    if (this.activity !== 'exam') throw new Error('Chỉ dùng trong chế độ giải đề');
    this.resetExam();
    this.push();
    this.emit('score', { top: [] });
  }

  // A question number prevents a late audio callback from opening a different question.
  openExamAnswers(no: number) {
    if (this.activity !== 'exam' || !this.running || this.phase !== 'asking' || this.question?.no !== no || this.question.endsAt) return;
    this.question = { ...this.question, endsAt: Date.now() + this.question.seconds * 1000 };
    this.push();
    this.timer = setTimeout(() => this.reveal(), this.question.seconds * 1000);
  }

  examTranscript(no: number) {
    return this.activity === 'exam' && this.question?.no === no ? this.exercise?.transcript : undefined;
  }

  private nextExam() {
    this.clear();
    const paper = this.paper!;
    if (this.examCursor >= paper.questions.length) {
      this.running = false;
      this.phase = 'idle';
      this.question = null;
      this.examCompleted = true;
      this.push();
      return;
    }
    const exercise = paper.questions[this.examCursor++];
    this.answers.clear();
    this.correct = exercise.answer;
    this.correctUsers = [];
    this.winners = [];
    this.question = {
      no: ++this.no, kind: 'reverse', word: { hanzi: '', pinyin: '', vi: '' }, options: exercise.options,
      seconds: exercise.seconds, endsAt: 0, bonus: false,
      exam: { id: exercise.id, position: this.examCursor, total: paper.questions.length,
        section: exercise.section, instruction: exercise.instruction, hint: exercise.hint, prompt: exercise.prompt },
    };
    this.phase = 'asking';
    this.push();
  }
}
