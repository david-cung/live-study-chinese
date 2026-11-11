export type LiveStatus = {
  isConnected: boolean;
  isConnecting: boolean;
  username: string;
  roomId: string;
  viewerCount: number;
  totalLikes: number;
  error: string;
};

export type Guest = {
  username: string;
  nickname: string;
  avatar: string;
  seat: number;
  lastActive: number;
  vipUntil: number;
  joinedAt: number;
  color: string;
  bubble?: { text: string; until: number };
};

export type MusicState = { on: boolean; volume: number; style: 'files' | 'ballad' | 'vui' };

export type GiftBanner = { id: number; nickname: string; avatar: string; giftName: string; count: number };
export type TopEntry = { username: string; nickname: string; points: number };

export type Lang = 'vi' | 'zh';

export type Word = { hanzi: string; pinyin: string; vi: string; topic?: string };
export type LessonInfo = { id: string; title: string; count: number };
export type QuizKind = 'meaning' | 'listen' | 'fill' | 'pinyin' | 'reverse';
export type QuizMode = 'mixed' | QuizKind;
export type ClozeExercise = { sentence: string; vi: string; answer: string; options: string[] };

export type QuizQuestion = {
  no: number;
  kind: QuizKind;
  word: Word;
  options: string[];
  // Exactly one ___ placeholder; only fill questions have sentence context.
  context?: { sentence: string; vi: string };
  seconds: number;
  endsAt: number;
  bonus: boolean;
  // Session milestone reward: five times normal points
  megaBonus?: boolean;
};

export type HanNamePart = { vi: string; hanzi: string; pinyin: string; meaning: string };
export type HanNameCard = {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  parts: HanNamePart[];
  hanzi: string;
  pinyin: string;
  fancy: boolean;
};

export type SocialToast = { id: number; nickname: string; kind: 'follow' | 'share' };

export type MilestoneProgress = {
  total: number;
  nextAt: number;
  label: string;
};

export type QuizState = {
  running: boolean;
  mode: QuizMode;
  availableKinds: QuizKind[];
  phase: 'idle' | 'asking' | 'reveal';
  lessonId: string;
  lessonTitle: string;
  seconds: number;
  question: QuizQuestion | null;
  answeredCount: number;
  // Only set once the answer is revealed
  correct: number | null;
  correctUsers: string[];
  winners: string[];
  bonusPending: boolean;
};

export type QaItem = {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  comment: string;
  vi: string;
  zh?: string;
  pinyin?: string;
  source: 'quick' | 'ai' | 'pin';
};

export type AiState = {
  enabled: boolean;
  mode: 'auto' | 'review';
  model: string;
  busy: boolean;
  queued: number;
  calls: number;
  error: string;
  pending: QaItem[];
};

export type ChatItem = { id: number; username: string; nickname: string; avatar: string; comment: string };
