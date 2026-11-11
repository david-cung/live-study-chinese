import { useCallback, useEffect, useRef, useState } from 'react';
import { SEATS } from './layout';
import { DEFAULT_VOICE_SETTINGS, type VoiceState } from './voiceSettings';
import { isTeacher, type Teacher } from './teacher';
import { sound, type Speaking } from './sound';
import type {
  AiState,
  ChatItem,
  GiftBanner,
  Guest,
  HanNameCard,
  LessonInfo,
  LiveStatus,
  MilestoneProgress,
  MusicState,
  QaItem,
  QuizState,
  SocialToast,
  TopEntry,
} from './types';
import Stage, { type StageProps } from './components/Stage';
import Dashboard from './components/Dashboard';
import { nextTip } from './tips';
import { spokenName } from './spokenName';
import { pruneCooldowns } from '../retention';
import { questionIntroSpeech, questionRevealSpeech, repeatQuestionSpeech } from './quizModes';
import { GIFT_PROMOTION_SPEECH, GIFT_REMINDER_MS, GIFT_REMINDER_QUESTIONS, GIFT_THANKS_PAUSE_MS, GIFT_REMINDER_SPEECH_MS } from './giftPromotion';
import { revealDuration } from './quizTiming';

const PARAMS = new URLSearchParams(location.search);
const IS_STAGE = PARAMS.get('view') === 'stage';
// ?view=stage&silent=1 shows the full stage without sound, for checking visuals
const STAGE_SOUND = IS_STAGE && !PARAMS.has('silent');

const SHIRTS = ['#e85d4a', '#3f7fd8', '#f2b233', '#3fae6b', '#9b5de5', '#ef6fa4', '#1fb5b5', '#f08a3c', '#5c6b7a'];
const LETTERS = ['A', 'B', 'C', 'D'];
const BUBBLE_MS = 5000;
const VIP_MS = 60000;
const GIFT_VOICE_COOLDOWN_MS = 20000;
const GREET_EVERY_MS = 7000;
const GREET_NAMES_PER_LINE = 3;
const REGREET_AFTER_MS = 10 * 60 * 1000;
const WELCOME_TOAST_MS = 4000;
const HAN_NAME_MS = 6500;
const HAN_NAME_FANCY_MS = 9000;
const SOCIAL_TOAST_MS = 4000;
const MAX_CHATS = 30;

const EMPTY_QUIZ: QuizState = {
  running: false,
  mode: 'mixed',
  availableKinds: [],
  phase: 'idle',
  lessonId: '',
  lessonTitle: '',
  seconds: 15,
  question: null,
  answeredCount: 0,
  correct: null,
  correctUsers: [],
  winners: [],
  bonusPending: false,
};

const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;

// Chinese characters go to the Chinese voice, everything else to the Vietnamese one
const CJK_SPLIT = /([\u3400-\u9fff，。！？、]+)/;
function sayMixed(text: string, urgent = false, onStart?: () => void, onEnd?: () => void) {
  const parts = text.split(CJK_SPLIT).filter((s) => s.trim());
  parts.forEach((s, i) => sound.say(s, urgent, i === 0 ? onStart : undefined, CJK_SPLIT.test(s) ? 'zh' : 'vi', i === parts.length - 1 ? onEnd : undefined));
  if (parts.length === 0) onStart?.();
}

type UserPayload = { username: string; nickname: string; avatar: string };

export default function App() {
  const [status, setStatus] = useState<LiveStatus>({
    isConnected: false,
    isConnecting: false,
    username: '',
    roomId: '',
    viewerCount: 0,
    totalLikes: 0,
    error: '',
  });
  const [channelName, setChannelName] = useState(sound.channelName);
  const [teacher, setTeacher] = useState<Teacher>('female');
  const [voice, setVoice] = useState<VoiceState>({ settings: { ...DEFAULT_VOICE_SETTINGS }, status: 'unchecked', voices: [], message: 'Mở bộ giọng Việt rồi kiểm tra kết nối.', revision: 0 });
  useEffect(() => sound.setVoiceRevision(JSON.stringify([teacher, voice.settings, voice.revision])), [teacher, voice.settings.provider, voice.settings.femaleVoice, voice.settings.maleVoice, voice.revision]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [banner, setBanner] = useState<GiftBanner | null>(null);
  const [top, setTop] = useState<TopEntry[]>([]);
  const [like, setLike] = useState({ value: 0, goal: 300 });
  const [milestone, setMilestone] = useState<MilestoneProgress>({ total: 0, nextAt: 1000, label: 'câu nói líu lưỡi' });
  const [music, setMusic] = useState<MusicState>({ on: true, volume: 0.1, style: 'files' });
  const [welcomes, setWelcomes] = useState<{ id: number; nickname: string }[]>([]);
  const [socials, setSocials] = useState<SocialToast[]>([]);
  const [hanCard, setHanCard] = useState<HanNameCard | null>(null);
  const [autoTalkMinutes, setAutoTalkMinutes] = useState(3);
  const [stageInfo, setStageInfo] = useState<{ w: number; h: number } | null>(null);
  const [quiz, setQuiz] = useState<QuizState>(EMPTY_QUIZ);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [qa, setQa] = useState<{ item: QaItem; at: number } | null>(null);
  const [bonusAt, setBonusAt] = useState(0);
  const [megaAt, setMegaAt] = useState(0);
  const [ai, setAi] = useState<AiState | null>(null);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [lessons, setLessons] = useState<LessonInfo[]>([]);
  const [speaking, setSpeaking] = useState<Speaking | null>(null);
  useEffect(() => sound.onSpeaking(setSpeaking), []);

  const greetQueueRef = useRef<string[]>([]);
  const greetExtraRef = useRef(0);
  const greetedRef = useRef(new Map<string, number>());
  const guestsRef = useRef(new Map<string, Guest>());
  const lastGiftVoiceRef = useRef(new Map<string, number>());
  const lastGiftReminderRef = useRef(Date.now());
  const lastGiftReceivedRef = useRef(0);
  const completedSinceReminderRef = useRef(0);
  const revealStartedRef = useRef(0);
  const quizRef = useRef<QuizState>(EMPTY_QUIZ);
  const likeRef = useRef({ value: 0, goal: 300 });
  const idRef = useRef(0);

  const commit = useCallback(() => setGuests([...guestsRef.current.values()]), []);

  // Seat someone right away. When every chair is taken, the viewer idle the longest gives up theirs.
  const seat = useCallback((u: UserPayload): Guest => {
    const now = Date.now();
    const map = guestsRef.current;
    const existing = map.get(u.username);
    if (existing) {
      const updated = { ...existing, nickname: u.nickname || existing.nickname, avatar: u.avatar || existing.avatar, lastActive: now };
      map.set(u.username, updated);
      return updated;
    }
    const used = new Set([...map.values()].map((g) => g.seat));
    let free = SEATS.filter((s) => !used.has(s.id));
    if (free.length === 0) {
      const candidates = [...map.values()].filter((g) => g.vipUntil < now);
      const pool = candidates.length ? candidates : [...map.values()];
      const leaving = pool.reduce((a, b) => (a.lastActive <= b.lastActive ? a : b));
      map.delete(leaving.username);
      free = SEATS.filter((s) => s.id === leaving.seat);
    }
    // Front rows fill first, like a real class
    const row = (s: (typeof SEATS)[number]) => Math.floor(s.table / 2);
    const front = Math.min(...free.map(row));
    const pool = free.filter((s) => row(s) === front);
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const guest: Guest = {
      username: u.username,
      nickname: u.nickname || u.username,
      avatar: u.avatar,
      seat: chosen.id,
      lastActive: now,
      vipUntil: 0,
      joinedAt: now,
      color: SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
    };
    map.set(u.username, guest);
    return guest;
  }, []);

  const onQuiz = useCallback((next: QuizState) => {
    const prev = quizRef.current;
    quizRef.current = next;
    if (next.question?.exam && (next.phase !== prev.phase || !next.running)) sound.setQuestion(null);
    sound.setQuestion(next.question?.exam && !next.running ? null : next.question?.no ?? null);
    setQuiz(next);
    const q = next.question;
    if (!q) return;
    if (next.phase === 'asking' && (prev.phase !== 'asking' || prev.question?.no !== q.no || (q.exam && !prev.running && next.running))) {
      setAnswered(new Set());
      // Fixed wording (no question number) so the server's voice cache answers instantly
      if (q.megaBonus) {
        setMegaAt(Date.now());
        sound.say('Câu thưởng lớn, nhân năm điểm!', true);
      } else if (q.bonus) sound.say('Câu thưởng, nhân ba điểm!', true);
      const intro = questionIntroSpeech(q);
      intro.forEach((line, i) => {
        const done = q.exam?.section === 'reading' && i === intro.length - 1 ? () => openCurrentExamAnswers(q.no) : undefined;
        if (q.exam && line.lang === 'vi') sayMixed(line.text, true, undefined, done);
        else sound.say(line.text, true, undefined, line.lang, done);
      });
      if (q.exam?.section === 'listening' && !q.endsAt) void playExamListening(q);
    }
    if (next.phase === 'reveal' && prev.phase === 'asking' && next.correct !== null) {
      revealStartedRef.current = Date.now();
      completedSinceReminderRef.current++;
      sound.bell();
      sound.say(`Hết giờ! Đáp án đúng là ${LETTERS[next.correct]}.`, true, () => sound.ding());
      for (const line of questionRevealSpeech(q)) {
        if (q.exam && line.lang === 'vi') sayMixed(line.text, true);
        else sound.say(line.text, true, undefined, line.lang);
      }
      sayMixed(
        q.exam
          ? next.correctUsers.length ? `Có ${next.correctUsers.length} bạn tìm ra đáp án rồi. Cả lớp cùng nhớ mẹo này nhé!` : 'Không sao, mình cùng xem cách tìm đáp án nhé. Câu sau thử lại nha!'
          : next.winners.length
          ? `Nhanh nhất là ${joinNames(next.winners.slice(0, 2).map((n) => spokenName(n)))}. Giỏi quá!`
          : 'Câu này chưa ai đúng, không sao, câu sau cố lên nha!',
        true,
      );
      // Celebrate with likes about one third of the time when someone got it right
      if (next.winners.length && Math.random() < 0.34) {
        sound.say('Ai đúng thì thả tim ăn mừng nha!', true);
      }
    }
  }, []);

  function openCurrentExamAnswers(no: number) {
    const latest = quizRef.current;
    if (STAGE_SOUND && latest.running && latest.phase === 'asking' && latest.question?.no === no && !latest.question.endsAt) {
      void fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quiz', text: `openExam:${no}` }) }).catch(() => {});
    }
  }

  async function playExamListening(q: NonNullable<QuizState['question']>) {
    if (!STAGE_SOUND) return;
    try {
      const response = await fetch(`/api/exam-listening/${q.no}`);
      if (!response.ok) return;
      const { transcript } = await response.json();
      const current = quizRef.current;
      if (typeof transcript !== 'string' || !current.running || current.phase !== 'asking' || current.question?.no !== q.no) return;
      sound.group(() => {
        sound.say(transcript, true, undefined, 'zh');
        sound.say(transcript, true, undefined, 'zh', () => openCurrentExamAnswers(q.no));
      }, q.no);
    } catch { /* The operator can use Open answers if audio is unavailable. */ }
  }

  useEffect(() => {
    if (STAGE_SOUND) sound.enable();
    fetch('/api/lessons')
      .then((r) => r.json())
      .then(setLessons)
      .catch(() => {});
    const es = new EventSource('/api/events');
    const on = <T,>(event: string, fn: (data: T) => void) => es.addEventListener(event, (e) => {
      const data = JSON.parse((e as MessageEvent).data) as T;
      const question = event === 'quiz' ? (data as QuizState).question?.no : undefined;
      sound.group(() => fn(data), question);
    });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (run: () => void, ms: number) => {
      const timer = setTimeout(() => { timers.delete(timer); run(); }, ms);
      timers.add(timer);
    };

    on<LiveStatus>('status', setStatus);
    on<{ viewerCount: number }>('roomUser', ({ viewerCount }) => {
      setStatus((s) => ({ ...s, viewerCount }));
    });
    on<QuizState>('quiz', onQuiz);
    on<{ top: TopEntry[] }>('score', ({ top }) => setTop(top));
    on<AiState>('ai', setAi);
    on<{ value: number; goal: number }>('likeProgress', (p) => {
      const prev = likeRef.current;
      likeRef.current = p;
      setLike(p);
      const left = p.goal - p.value;
      const wasFar = prev.goal - prev.value > 50;
      if (left > 0 && left <= 50 && wasFar && quizRef.current.phase !== 'asking') {
        sound.say(`Còn ${left} tim nữa là câu sau nhân ba điểm!`);
      }
    });
    on<MilestoneProgress>('milestone', setMilestone);
    on<MusicState>('music', (m) => {
      setMusic(m);
      sound.setMusic(m);
    });
    on<VoiceState>('voice', setVoice);
    on<{ w: number; h: number }>('stageInfo', setStageInfo);
    on<{ minutes: number }>('autoTalk', ({ minutes }) => setAutoTalkMinutes(minutes));

    on<UserPayload>('join', (u) => {
      const g = seat(u);
      commit();
      // TikTok resends member events, so each person is greeted at most once per REGREET_AFTER_MS
      const last = greetedRef.current.get(g.username) || 0;
      if (Date.now() - last < REGREET_AFTER_MS) return;
      greetedRef.current.set(g.username, Date.now());
      const nickname = g.nickname.trim().slice(0, 25) || 'bạn mới';
      if (greetQueueRef.current.length < 12) greetQueueRef.current.push(spokenName(g.nickname, 'bạn mới'));
      else greetExtraRef.current++;
      const toast = { id: ++idRef.current, nickname };
      setWelcomes((w) => [...w.slice(-2), toast]);
      later(() => setWelcomes((w) => w.filter((x) => x !== toast)), WELCOME_TOAST_MS);
    });

    on<ChatItem>('chat', (d) => {
      const g = seat(d);
      g.bubble = { text: d.comment.slice(0, 80), until: Date.now() + BUBBLE_MS };
      commit();
      setChats((c) => [...c.slice(-(MAX_CHATS - 1)), d]);
    });

    on<{ username: string; count: number }>('answered', ({ username, count }) => {
      setAnswered((a) => new Set(a).add(username));
      setQuiz((q) => ({ ...q, answeredCount: count }));
      sound.pop();
    });

    on<UserPayload & { giftName: string; diamondCount: number; repeatCount: number; grantName?: boolean }>('gift', (d) => {
      lastGiftReceivedRef.current = Date.now();
      const g = seat(d);
      g.vipUntil = Date.now() + VIP_MS;
      commit();
      setBanner({ id: ++idRef.current, nickname: g.nickname, avatar: g.avatar, giftName: d.giftName, count: d.repeatCount });
      // First gift this session: hanName event speaks instead, so we do not double up
      if (d.grantName) return;
      const last = lastGiftVoiceRef.current.get(d.username) || 0;
      if (Date.now() - last > GIFT_VOICE_COOLDOWN_MS) {
        lastGiftVoiceRef.current.set(d.username, Date.now());
        sayMixed(`${sound.channelName} cảm ơn ${spokenName(g.nickname)} đã tặng quà.${quizRef.current.activity === 'exam' ? ' Cảm ơn bạn đã ủng hộ buổi giải đề!' : ' Bạn được làm lớp trưởng, câu tới trả lời đúng được gấp đôi điểm!'}`, true);
      }
    });

    on<UserPayload & { parts: HanNameCard['parts']; hanzi: string; pinyin: string; fancy: boolean }>('hanName', (d) => {
      seat(d);
      commit();
      const card: HanNameCard = {
        id: ++idRef.current,
        username: d.username,
        nickname: d.nickname,
        avatar: d.avatar,
        parts: d.parts,
        hanzi: d.hanzi,
        pinyin: d.pinyin,
        fancy: d.fancy,
      };
      setHanCard(card);
      later(() => setHanCard((c) => (c?.id === card.id ? null : c)), d.fancy ? HAN_NAME_FANCY_MS : HAN_NAME_MS);
      lastGiftVoiceRef.current.set(d.username, Date.now());
      const who = spokenName(d.nickname);
      sayMixed(`${sound.channelName} cảm ơn ${who} đã tặng quà. Tên tiếng Trung của bạn là`, true);
      sound.say(`${d.hanzi}。`, true, undefined, 'zh');
      if (d.fancy) {
        for (const p of d.parts) {
          sayMixed(`${p.vi} là`, true);
          sound.say(`${p.hanzi}，`, true, undefined, 'zh');
          sayMixed(`nghĩa là ${p.meaning}.`, true);
        }
      }
      sayMixed(quizRef.current.activity === 'exam' ? 'Cảm ơn bạn đã ủng hộ buổi giải đề!' : 'Bạn được làm lớp trưởng, câu tới trả lời đúng được gấp đôi điểm!', true);
    });

    on<{ items: { nickname: string; kind: 'follow' | 'share' }[]; extra?: { follow: number; share: number } }>('social', ({ items, extra }) => {
      for (const it of items) {
        const toast: SocialToast = { id: ++idRef.current, nickname: it.nickname, kind: it.kind };
        setSocials((s) => [...s.slice(-2), toast]);
        later(() => setSocials((s) => s.filter((x) => x !== toast)), SOCIAL_TOAST_MS);
      }
      if (quizRef.current.phase === 'asking') return;
      const follows = items.filter((i) => i.kind === 'follow').map((i) => i.nickname);
      const shares = items.filter((i) => i.kind === 'share').map((i) => i.nickname);
      if (follows.length) sayMixed(`Cảm ơn ${joinNames(follows)} đã follow lớp!${quizRef.current.activity === 'exam' ? '' : ' Được cộng năm điểm khởi đầu nha.'}`);
      if (shares.length) sayMixed(`Cảm ơn ${joinNames(shares)} đã chia sẻ live!`);
      if (extra?.follow) sound.say(`Cảm ơn ${extra.follow} bạn nữa đã follow lớp${quizRef.current.activity === 'exam' ? '!' : ', mỗi bạn được cộng năm điểm!'}`);
      if (extra?.share) sound.say(`Cảm ơn ${extra.share} lượt chia sẻ nữa cho lớp!`);
    });

    on('bonus', () => {
      if (quizRef.current.activity === 'exam') return;
      setBonusAt(Date.now());
      sound.say('Đủ ba trăm tim rồi! Câu tiếp theo là câu thưởng, nhân ba điểm!', true);
    });

    on<{ kind: string; at: number; vi?: string; zh?: string }>('milestoneReward', (r) => {
      if (quizRef.current.activity === 'exam') return;
      if (r.kind === 'mega') {
        setMegaAt(Date.now());
        sound.say(r.vi || `Đủ ${r.at} tim! Câu tiếp theo nhân năm điểm!`, true);
        return;
      }
      if (r.vi) sayMixed(r.vi, true);
      if (r.zh) sound.say(r.zh, true, undefined, 'zh');
    });

    on<QaItem>('qa', (item) => {
      setQa({ item, at: Date.now() });
      const g = guestsRef.current.get(item.username);
      if (g) g.lastActive = Date.now();
      // Score lookups keep their on-screen reply without adding speech to the live queue.
      if (item.source === 'quick' && /^(điểm|diem|xem điểm|hạng)$/i.test(item.comment.trim())) return;
      if (item.source === 'pin') {
        sayMixed(`${spokenName(item.nickname)} nói: ${item.comment}`);
        return;
      }
      if (item.source === 'ai') sayMixed(`${spokenName(item.nickname)} hỏi: ${item.comment}`);
      sayMixed(item.vi);
      if (item.zh) sound.say(item.zh, false, undefined, 'zh');
    });

    on<{ action: string; text?: string; lang?: 'vi' | 'zh' }>('control', ({ action, text, lang }) => {
      if (action === 'setTeacher' && isTeacher(text)) setTeacher(text);
      if (action === 'setName' && text) {
        sound.setChannelName(text);
        setChannelName(text);
      }
      // Sound itself only plays where sound.enable() ran (the stage page); the preview just shows the visuals
      if (action === 'speak' && text) {
        if (lang === 'zh') sound.say(text, true, undefined, 'zh');
        else sayMixed(text, true);
      }
      if (action === 'musicNext') sound.nextTrack();
      if (action === 'repeatWord') {
        const q = quizRef.current.question;
        if (q?.exam?.section === 'listening' && quizRef.current.phase === 'asking') {
          void playExamListening(q);
          return;
        }
        if (q) sound.group(() => {
          const lines = quizRef.current.phase === 'reveal' ? questionRevealSpeech(q) : repeatQuestionSpeech(q);
          for (const line of lines) sound.say(line.text, true, undefined, line.lang);
        }, q.no);
      }
      if (action === 'autoTalk' && !quizRef.current.question?.exam) for (const part of nextTip()) sound.say(part.text, false, undefined, part.lang);
    });

    // ?demo=1 fills this page only with sample viewers, without touching other pages
    if (PARAMS.has('demo')) {
      const names = ['Minh Anh', 'Tuấn Kiệt', 'Lan Chi', 'Bé Na', 'Quốc Bảo', 'Thảo Vy', 'Hoàng Long', 'Ngọc Hân', 'Gia Huy', 'Mai Phương'];
      for (let i = 0; i < 20; i++) {
        const g = seat({ username: `demo_${i}`, nickname: `${names[i % names.length]}${i >= names.length ? ' ' + i : ''}`, avatar: '' });
        if (i % 5 === 0) g.bubble = { text: ['B', 'Cô ơi chữ này đọc sao?', 'A', 'Hay quá', 'C'][i % 5], until: Date.now() + 600000 };
      }
      commit();
    }

    // Expire chat bubbles
    const tick = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const g of guestsRef.current.values()) {
        if (g.bubble && g.bubble.until < now) {
          g.bubble = undefined;
          changed = true;
        }
      }
      if (changed) commit();

      // Wait for a completed block and a quiet reveal; never advertise during an answer window.
      const quiz = quizRef.current;
      if (!STAGE_SOUND || !quiz.running || quiz.phase !== 'reveal' || !quiz.question || quiz.activity === 'exam' ||
        quiz.question.no % GIFT_REMINDER_QUESTIONS !== 0 ||
        completedSinceReminderRef.current < GIFT_REMINDER_QUESTIONS ||
        now - lastGiftReminderRef.current < GIFT_REMINDER_MS ||
        now - lastGiftReceivedRef.current < GIFT_THANKS_PAUSE_MS) return;
      if (revealStartedRef.current + revealDuration(quiz.question.no) - now < GIFT_REMINDER_SPEECH_MS) return;
      const voice = sound.stats();
      if (voice.blocked || voice.activeAudio || voice.preloadedAudio || voice.ordinary || voice.priority || voice.activeRemaining) return;
      lastGiftReminderRef.current = now;
      completedSinceReminderRef.current = 0;
      sound.group(() => sound.say(GIFT_PROMOTION_SPEECH), quiz.question.no);
    }, 1000);

    // Countdown ticks and repeat the current prompt without revealing hidden answers.
    let lastTick = 0;
    let repeatedNo = 0;
    const countdown = setInterval(() => {
      const q = quizRef.current;
      if (q.phase !== 'asking' || !q.question) return;
        if (q.question.exam && !q.question.endsAt) return;
      const left = Math.ceil((q.question.endsAt - Date.now()) / 1000);
        if (!q.question.exam && q.question.no !== repeatedNo && left <= Math.ceil(q.question.seconds / 2) && left > 3) {
        repeatedNo = q.question.no;
        sound.group(() => {
          for (const line of repeatQuestionSpeech(q.question!)) sound.say(line.text, true, undefined, line.lang);
        }, q.question.no);
      }
      if (left >= 1 && left <= 3 && left !== lastTick) {
        lastTick = left;
        sound.tick();
      }
    }, 200);

    // Greet newcomers in batches so a busy room doesn't pile up a long voice queue
    const greet = setInterval(() => {
      const q = greetQueueRef.current;
      if ((q.length === 0 && !greetExtraRef.current) || quizRef.current.phase === 'asking') return;
      const names = [...new Set(q.splice(0, GREET_NAMES_PER_LINE))];
      // Big rush: name the first few and count the rest instead of reading a backlog for minutes
      const rest = greetExtraRef.current + (q.length > GREET_NAMES_PER_LINE * 2 ? q.splice(0).length : 0);
      greetExtraRef.current = 0;
      const who = rest ? (names.length ? `${names.join(', ')} cùng ${rest} bạn nữa` : `${rest} bạn mới`) : joinNames(names);
      sound.group(() => sayMixed(`Chào ${who} vào lớp! Gõ A, B, C hoặc D để trả lời câu hỏi nha.`));
    }, GREET_EVERY_MS);

    const prune = setInterval(() => {
      pruneCooldowns(greetedRef.current, REGREET_AFTER_MS);
      pruneCooldowns(lastGiftVoiceRef.current, GIFT_VOICE_COOLDOWN_MS);
    }, 30000);

    // Opt-in diagnostics never include names, comments, or spoken text.
    const diagnostics = PARAMS.has('diagnostics') ? setInterval(() => {
      console.info('[memory:stage]', { ...sound.stats(), greeted: greetedRef.current.size,
        giftCooldowns: lastGiftVoiceRef.current.size, greetingNames: greetQueueRef.current.length,
        greetingExtra: greetExtraRef.current, guests: guestsRef.current.size });
    }, 10000) : null;

    return () => {
      es.close();
      sound.shutdown();
      for (const timer of timers) clearTimeout(timer);
      clearInterval(prune);
      if (diagnostics) clearInterval(diagnostics);
      clearInterval(tick);
      clearInterval(countdown);
      clearInterval(greet);
    };
  }, [seat, commit, onQuiz]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);

  const stageProps: StageProps = {
    quiz,
    answered,
    speaking,
    qa: qa?.item || null,
    qaAt: qa?.at || 0,
    bonusAt,
    megaAt,
    welcomes,
    socials,
    guests,
    banner,
    hanCard,
    top,
    likeProgress: like.value / like.goal,
    likeGoal: like.goal,
    milestone,
    channelName,
    teacher,
    viewerCount: status.viewerCount,
  };

  if (IS_STAGE) return <StageFullscreen {...stageProps} />;
  return (
    <Dashboard
      status={status}
      channelName={channelName}
      teacher={teacher}
      voice={voice}
      guestCount={guests.length}
      music={music}
      autoTalkMinutes={autoTalkMinutes}
      stageInfo={stageInfo}
      quiz={quiz}
      lessons={lessons}
      ai={ai}
      chats={chats}
      stage={<Stage {...stageProps} />}
    />
  );
}

function StageFullscreen(props: StageProps) {
  const [zoom, setZoom] = useState(1);
  const [blocked, setBlocked] = useState(sound.blocked);
  useEffect(() => sound.onBlocked(setBlocked), []);
  useEffect(() => {
    const fit = () => {
      setZoom(Math.min(window.innerWidth / 430, window.innerHeight / 764));
      // Tell the dashboard what size LIVE Studio renders us at: anything under 1080×1920 gets upscaled and looks blurry
      if (STAGE_SOUND)
        fetch('/api/stage-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }),
        }).catch(() => {});
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
      <div style={{ zoom }}>
        <Stage {...props} />
      </div>
      {/* Browsers (not LIVE Studio) refuse to play sound before the first click */}
      {blocked && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/60 cursor-pointer">
          <div className="bg-[#ffd36b] text-[#3a2a00] rounded-2xl px-6 py-4 text-center shadow-2xl animate-pulse">
            <div className="text-[40px] leading-none">🔊</div>
            <div className="text-[20px] font-black mt-1">Bấm vào đây để bật âm thanh</div>
            <div className="text-[13px] font-semibold opacity-80">Trình duyệt chặn tự phát tiếng cho tới khi bạn bấm</div>
          </div>
        </div>
      )}
    </div>
  );
}
