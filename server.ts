import express from 'express';
import fs from 'fs';
import path from 'path';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { Quiz } from './quiz';
import { CommentRouter } from './comments';
import { safeName } from './moderation';
import { hanNameFor } from './hanName';
import { spokenName } from './src/spokenName';
import type { AiState, Lang } from './src/types';
import { TtsService, TtsBusyError } from './ttsCache';
import { SocialBuffer, pruneCooldowns } from './retention';
import { LiveSession } from './liveSession';
import { aiProcessStats, stopAiProcess } from './aiProcess';
import { questionAnswer } from './src/quizModes';

const PORT = Number(process.env.PORT) || 3002;
const app = express();
app.use(express.json({ limit: '50kb' }));

type LiveStatus = {
  isConnected: boolean;
  isConnecting: boolean;
  username: string;
  roomId: string;
  viewerCount: number;
  totalLikes: number;
  error: string;
};

const idleStatus = (): LiveStatus => ({
  isConnected: false,
  isConnecting: false,
  username: '',
  roomId: '',
  viewerCount: 0,
  totalLikes: 0,
  error: '',
});

let status = idleStatus();
let conn: InstanceType<typeof TikTokLiveConnection> | null = null;

// ---------- SSE ----------
const sseClients: express.Response[] = [];
function writeSse(res: express.Response, message: string) {
  // A paused/abandoned browser must not retain an unlimited socket buffer.
  if (res.destroyed || res.writableEnded) return;
  if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
  res.write(message);
}

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) writeSse(res, msg);
}

// Settings survive restarts in settings.json next to this file
const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');
type MusicState = { on: boolean; volume: number; style: 'files' | 'ballad' | 'vui' };
const MUSIC_STYLES = ['files', 'ballad', 'vui'];
const AUTO_TALK_CHOICES = [0, 2, 3, 5, 10];
let channelName = '';
let music: MusicState = { on: true, volume: 0.1, style: 'files' };
let autoTalkMinutes = 3;
let tiktokUser = '';
let saved: any = {};
try {
  saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  if (typeof saved.channelName === 'string') channelName = saved.channelName.trim();
  if (typeof saved.tiktokUser === 'string') tiktokUser = saved.tiktokUser;
  if (saved.music && MUSIC_STYLES.includes(saved.music.style)) music = { ...music, ...saved.music };
  if (AUTO_TALK_CHOICES.includes(saved.autoTalkMinutes)) autoTalkMinutes = saved.autoTalkMinutes;
} catch {
  // no settings yet: defaults are used
}

const quiz = new Quiz(broadcast, saved.quiz || {});
const router = new CommentRouter(quiz, broadcast, saved.ai || {});

const saveSettings = () => {
  try {
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ channelName, tiktokUser, music, autoTalkMinutes, quiz: quiz.settings, ai: router.settings }, null, 2),
    );
  } catch (err) {
    console.error('Could not save settings.json:', err);
  }
};

// Every few minutes the teacher says a tip, but never while viewers are answering
let autoTalkTimer: ReturnType<typeof setInterval> | null = null;
function scheduleAutoTalk() {
  if (autoTalkTimer) clearInterval(autoTalkTimer);
  autoTalkTimer = null;
  if (autoTalkMinutes > 0) {
    autoTalkTimer = setInterval(() => {
      if (!quiz.isAsking) broadcast('control', { action: 'autoTalk' });
    }, autoTalkMinutes * 60000);
  }
}
scheduleAutoTalk();

// Likes fill a bar; a full bar makes the next question worth triple
const LIKE_GOAL = 300;
let likeAcc = 0;
function addLikes(n: number) {
  likeAcc += n;
  if (likeAcc >= LIKE_GOAL) {
    likeAcc = 0;
    quiz.bonusNext();
    broadcast('bonus', {});
  }
  broadcast('likeProgress', { value: likeAcc, goal: LIKE_GOAL });
}

// ---------- Engagement: Chinese names, like thanks, follow/share, session milestones ----------
const BIG_GIFT_DIAMONDS = 99;
const session = new LiveSession();
const namedThisSession = session.named;
const followedThisSession = session.followed;

// Per-user like tally; every minute thank the top few by name
const LIKE_THANKS_EVERY_MS = 60000;
const LIKE_THANKS_COOLDOWN_MS = 5 * 60000;
const likeTally = new Map<string, { nickname: string; count: number }>();
const likeThankedAt = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  pruneCooldowns(likeThankedAt, LIKE_THANKS_COOLDOWN_MS, now);
  if (quiz.isAsking || likeTally.size === 0) return;
  const top = [...likeTally.entries()]
    .filter(([u]) => now - (likeThankedAt.get(u) || 0) >= LIKE_THANKS_COOLDOWN_MS)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);
  likeTally.clear();
  if (!top.length) return;
  for (const [u] of top) likeThankedAt.set(u, now);
  broadcast('likeThanks', { names: top.map(([, v]) => spokenName(v.nickname)) });
}, LIKE_THANKS_EVERY_MS);

const socialQueue = new SocialBuffer();
setInterval(() => {
  if (quiz.isAsking || socialQueue.size === 0) return;
  broadcast('social', socialQueue.take());
}, 8000);

type RewardLine = { vi: string; zh: string; pinyin?: string };
let rewards: { tongues: RewardLine[]; phrases: RewardLine[] } = { tongues: [], phrases: [] };
try {
  rewards = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'content', 'rewards.json'), 'utf8'));
} catch {
  // optional file
}
const pickReward = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const MILESTONE_BASE = [1000, 3000, 5000];
const hitMilestones = new Set<number>();
function nextMilestone(total: number) {
  for (const m of MILESTONE_BASE) if (total < m) return m;
  return Math.ceil((total + 1) / 5000) * 5000;
}
function milestoneLabel(at: number) {
  if (at === 1000) return 'câu nói líu lưỡi';
  if (at === 3000) return 'câu giao tiếp hay';
  return 'câu hỏi nhân 5 điểm';
}
function broadcastMilestoneProgress() {
  const total = status.totalLikes;
  const nextAt = nextMilestone(total);
  broadcast('milestone', { total, nextAt, label: milestoneLabel(nextAt) });
}
function checkMilestones() {
  const total = status.totalLikes;
  const due: number[] = [];
  for (const m of MILESTONE_BASE) if (total >= m && !hitMilestones.has(m)) due.push(m);
  // After 5000, every further 5000 (10000, 15000, ...)
  if (total >= 5000) {
    for (let m = 10000; m <= total; m += 5000) if (!hitMilestones.has(m)) due.push(m);
  }
  for (const m of due.sort((a, b) => a - b)) {
    hitMilestones.add(m);
    if (m === 1000 && rewards.tongues.length) {
      const t = pickReward(rewards.tongues);
      broadcast('milestoneReward', { kind: 'tongue', at: m, ...t });
    } else if (m === 3000 && rewards.phrases.length) {
      const p = pickReward(rewards.phrases);
      broadcast('milestoneReward', { kind: 'phrase', at: m, ...p });
    } else {
      quiz.megaBonusNext();
      broadcast('milestoneReward', { kind: 'mega', at: m, vi: `Đủ ${m} tim! Câu tiếp theo nhân năm điểm!` });
    }
  }
  broadcastMilestoneProgress();
}
function seedMilestonesFromCurrent() {
  hitMilestones.clear();
  likeTally.clear();
  likeThankedAt.clear();
  socialQueue.clear();
  likeAcc = 0;
  broadcast('likeProgress', { value: likeAcc, goal: LIKE_GOAL });
  const total = status.totalLikes;
  for (const m of MILESTONE_BASE) if (total >= m) hitMilestones.add(m);
  if (total >= 5000) for (let m = 10000; m <= total; m += 5000) hitMilestones.add(m);
  broadcastMilestoneProgress();
}

// Songs dropped into public/music are played in turn on the stage
const MUSIC_DIR = path.join(process.cwd(), 'public', 'music');
app.get('/api/music', (_req, res) => {
  let files: string[] = [];
  try {
    files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|ogg|wav)$/i.test(f));
  } catch {
    // folder missing: no songs
  }
  res.json(files.map((f) => `/music/${encodeURIComponent(f)}`));
});

app.get('/api/lessons', (_req, res) => res.json(quiz.lessonList()));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  const send = (event: string, data: unknown) => writeSse(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // While idle, username carries the last account used so the dashboard can prefill it
  send('status', status.username ? status : { ...status, username: tiktokUser });
  if (channelName) send('control', { action: 'setName', text: channelName });
  send('music', music);
  send('autoTalk', { minutes: autoTalkMinutes });
  send('quiz', quiz.state());
  send('score', { top: quiz.top() });
  send('ai', router.state());
  send('likeProgress', { value: likeAcc, goal: LIKE_GOAL });
  send('milestone', { total: status.totalLikes, nextAt: nextMilestone(status.totalLikes), label: milestoneLabel(nextMilestone(status.totalLikes)) });
  if (stageInfo) send('stageInfo', stageInfo);
  const ping = setInterval(() => writeSse(res, ': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    const i = sseClients.indexOf(res);
    if (i >= 0) sseClients.splice(i, 1);
  });
});

app.get('/api/status', (_req, res) => res.json(status));

// The stage page reports the size it is rendered at, so the dashboard can warn about a wrongly sized Link source
let stageInfo: { w: number; h: number; dpr: number; at: number } | null = null;
app.post('/api/stage-info', (req, res) => {
  const { w, h, dpr } = req.body || {};
  if (![w, h, dpr].every((n) => typeof n === 'number' && n > 0 && n < 10000)) return res.status(400).end();
  stageInfo = { w: Math.round(w), h: Math.round(h), dpr, at: Date.now() };
  broadcast('stageInfo', stageInfo);
  res.json({ success: true });
});

// ---------- Viewers ----------
type User = { username: string; nickname: string; avatar: string };

const userOf = (data: any): User => ({
  username: data?.user?.uniqueId || data?.uniqueId || data?.user?.displayId || 'khach',
  nickname: safeName(String(data?.user?.nickname || data?.nickname || data?.user?.uniqueId || 'Bạn').slice(0, 30)),
  avatar: data?.user?.avatarThumb?.urlList?.[0] || '',
});

let chatId = 0;
function onChat(u: User, comment: string) {
  broadcast('chat', { ...u, id: ++chatId, comment });
  router.handle(u, comment);
}
function onGift(u: User, giftName: string, diamondCount: number, repeatCount: number) {
  quiz.vip(u.username);
  // One Chinese name per person per session — the fun gift reward
  const grantName = !namedThisSession.has(u.username);
  if (grantName) namedThisSession.add(u.username);
  broadcast('gift', { ...u, giftName, diamondCount, repeatCount, grantName });
  if (!grantName) return;
  const name = hanNameFor(u.nickname, u.username);
  const fancy = diamondCount * Math.max(1, repeatCount) >= BIG_GIFT_DIAMONDS;
  broadcast('hanName', { ...u, ...name, fancy });
}

function onLike(u: User, count: number) {
  const row = likeTally.get(u.username) || { nickname: u.nickname, count: 0 };
  row.nickname = u.nickname || row.nickname;
  row.count += count;
  likeTally.set(u.username, row);
  addLikes(count);
}

function onFollow(u: User) {
  socialQueue.add(spokenName(u.nickname), 'follow');
  if (!followedThisSession.has(u.username)) {
    followedThisSession.add(u.username);
    quiz.awardPoints(u, 5);
  }
}

function onShare(u: User) {
  socialQueue.add(spokenName(u.nickname), 'share');
}

// ---------- TikTok ----------
// TikTok drops the connection now and then; while the user wants to be connected, keep retrying
let wantUser = '';
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const RETRY_MS = 15000;

function dropConnection() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (conn) {
    const old = conn;
    conn = null;
    try {
      old.disconnect();
    } catch {
      // ignore
    }
  }
}

function scheduleRetry(username: string) {
  if (retryTimer || wantUser !== username) return;
  console.log(`[tiktok] @${username}: thử nối lại sau ${RETRY_MS / 1000}s`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (wantUser === username && !status.isConnected) connectTikTok(username).catch(() => {});
  }, RETRY_MS);
}

async function connectTikTok(username: string) {
  dropConnection();
  status = { ...idleStatus(), username, isConnecting: true, error: status.username === username ? status.error : '' };
  broadcast('status', status);
  console.log(`[tiktok] đang nối @${username}...`);

  const c = new TikTokLiveConnection(username, {
    processInitialData: true,
    // The gift-list fetch behind this option needs a paid Euler Stream plan; gift events already carry name and coins
    enableExtendedGiftInfo: false,
  });

  // Events from a connection that has since been replaced are ignored
  const live = () => conn === c;
  c.on(ControlEvent.CONNECTED, (state: { roomId?: string }) => {
    if (!live()) return;
    const roomId = String(state?.roomId || '');
    const newSession = session.enter(username, roomId);
    status = { ...status, totalLikes: session.totalLikes, isConnected: true, isConnecting: false, roomId, error: '' };
    if (newSession) {
      quiz.clearSessionBenefits();
      seedMilestonesFromCurrent();
    } else broadcastMilestoneProgress();
    broadcast('status', status);
    console.log(`[tiktok] đã nối @${username}, phòng ${state?.roomId || '?'}`);
    if (tiktokUser !== username) {
      tiktokUser = username;
      saveSettings();
    }
  });
  c.on(ControlEvent.DISCONNECTED, () => {
    if (!live()) return;
    status = { ...status, isConnected: false, isConnecting: false, error: 'Mất kết nối, đang tự nối lại...' };
    broadcast('status', status);
    console.log(`[tiktok] mất kết nối @${username}`);
    scheduleRetry(username);
  });
  c.on(WebcastEvent.STREAM_END, () => {
    if (!live()) return;
    status = { ...status, isConnected: false, isConnecting: false, error: 'Phiên live đã kết thúc' };
    broadcast('status', status);
    console.log(`[tiktok] @${username} đã kết thúc live`);
    wantUser = '';
    dropConnection();
  });
  c.on(ControlEvent.ERROR, (err: any) => {
    if (!live()) return;
    const inner = err?.exception ?? err;
    const msg = inner instanceof Error ? inner.message : err?.info || err?.message || JSON.stringify(err);
    status = { ...status, error: msg };
    broadcast('status', status);
    console.log(`[tiktok] lỗi: ${msg}`);
  });

  c.on(WebcastEvent.CHAT, (data: any) => {
    if (live()) onChat(userOf(data), String(data?.content || data?.comment || ''));
  });
  c.on(WebcastEvent.MEMBER, (data: any) => {
    if (live()) broadcast('join', userOf(data));
  });

  // TikTok resends streak gifts with a cumulative repeatCount; only forward the new units
  const streaks = new Map<string, { count: number; at: number }>();
  let lastStreakPrune = 0;
  c.on(WebcastEvent.GIFT, (data: any) => {
    if (!live()) return;
    const now = Date.now();
    if (now - lastStreakPrune > 30000) {
      for (const [key, value] of streaks) if (now - value.at >= 60000) streaks.delete(key);
      lastStreakPrune = now;
    }
    const u = userOf(data);
    const giftName = data?.gift?.name || data?.giftDetails?.giftName || data?.giftName || 'Quà';
    const key = `${u.username}|${giftName}`;
    const total = data?.repeatCount || 1;
    const delta = Math.max(0, total - (streaks.get(key)?.count || 0));
    const streakable = (data?.gift?.type ?? data?.giftDetails?.giftType ?? data?.giftType) === 1;
    if (streakable && !data?.repeatEnd) streaks.set(key, { count: total, at: now });
    else streaks.delete(key);
    if (delta === 0) return;
    onGift(u, giftName, data?.gift?.diamondCount || data?.diamondCount || data?.giftDetails?.diamondCount || 1, delta);
  });

  c.on(WebcastEvent.LIKE, (data: any) => {
    if (!live()) return;
    if (typeof data?.totalLikeCount === 'number') status.totalLikes = data.totalLikeCount;
    else status.totalLikes += data?.likeCount || 1;
    session.totalLikes = status.totalLikes;
    onLike(userOf(data), data?.likeCount || 1);
    checkMilestones();
  });
  c.on(WebcastEvent.FOLLOW, (data: any) => {
    if (live()) onFollow(userOf(data));
  });
  c.on(WebcastEvent.SHARE, (data: any) => {
    if (live()) onShare(userOf(data));
  });
  c.on(WebcastEvent.ROOM_USER, (data: any) => {
    if (!live()) return;
    if (typeof data?.viewerCount === 'number') {
      status.viewerCount = data.viewerCount;
      broadcast('roomUser', { viewerCount: data.viewerCount });
    }
  });

  conn = c;
  try {
    return await c.connect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (live()) {
      status = { ...status, isConnected: false, isConnecting: false, error: msg };
      broadcast('status', status);
      console.log(`[tiktok] không nối được @${username}: ${msg}`);
      scheduleRetry(username);
    }
    throw new Error(`Không kết nối được @${username}: ${msg}. Tài khoản phải đang LIVE.`);
  }
}

app.post('/api/connect', async (req, res) => {
  const raw = typeof req.body?.username === 'string' ? req.body.username : '';
  const username = raw.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '');
  if (!username) return res.status(400).json({ success: false, error: 'Chưa nhập username TikTok' });
  wantUser = username;
  try {
    const state = await connectTikTok(username);
    res.json({ success: true, roomId: state?.roomId });
  } catch (err) {
    res.status(400).json({ success: false, error: `${err instanceof Error ? err.message : err} Ứng dụng sẽ tự thử lại mỗi ${RETRY_MS / 1000}s.` });
  }
});

app.post('/api/disconnect', (_req, res) => {
  wantUser = '';
  dropConnection();
  status = idleStatus();
  broadcast('status', status);
  res.json({ success: true });
});

// ---------- Dashboard commands ----------
const CONTROL_ACTIONS = ['speak', 'setName', 'test', 'music', 'autoTalk', 'autoTalkEvery', 'quiz', 'ai', 'repeatWord'];
const TEST_NAMES = ['Minh Anh', 'Tuấn Kiệt', 'Lan Chi', 'Bé Na', 'Quốc Bảo', 'Thảo Vy', 'Hoàng Long', 'Ngọc Hân'];
const TEST_QUESTIONS = ['Cô ơi "cảm ơn" tiếng Trung nói sao?', 'đọc 你好', 'dịch tạm biệt', 'điểm', 'Khó quá cô ơi', 'Học tiếng Trung bao lâu thì giao tiếp được ạ?'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

app.post('/api/control', (req, res) => {
  const { action, text, lang } = req.body || {};
  if (!CONTROL_ACTIONS.includes(action)) return res.status(400).json({ success: false, error: 'Lệnh không hợp lệ' });
  const clean = typeof text === 'string' ? text.replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
  const fail = (error: string) => res.status(400).json({ success: false, error });

  try {
    if (action === 'test') {
      // "join" makes a new viewer each time; the rest reuse a small pool so they hit viewers already seated
      const n = Math.floor(Math.random() * 1000);
      const k = n % 8;
      const u: User =
        clean === 'join'
          ? { username: `test_${Date.now()}_${n}`, nickname: `${pick(TEST_NAMES)} ${n}`, avatar: '' }
          : { username: `test_pool_${k}`, nickname: TEST_NAMES[k], avatar: '' };
      if (clean === 'join') broadcast('join', u);
      else if (clean === 'answer') {
        // A burst of answers from the pool, most of them right, to see scoring work
        const q = quiz.state().question;
        if (!quiz.isAsking || !q) return fail('Chưa có câu hỏi nào đang mở. Bấm "Bắt đầu" trước.');
        const right = q.options.indexOf(questionAnswer(q));
        TEST_NAMES.forEach((nickname, i) =>
          setTimeout(() => onChat({ username: `test_pool_${i}`, nickname, avatar: '' }, 'ABCD'[Math.random() < 0.65 ? right : Math.floor(Math.random() * 4)]), i * 400),
        );
      } else if (clean === 'question') onChat(u, pick(TEST_QUESTIONS));
      else if (clean.startsWith('chat:')) onChat(u, clean.slice(5));
      else if (clean === 'gift') onGift(u, 'Hoa hồng', 1, 5);
      else if (clean === 'giftBig') onGift(u, 'Leo', 99, 1);
      else if (clean === 'likes') {
        status.totalLikes += 100;
        onLike(u, 100);
        checkMilestones();
      }
      else if (clean === 'follow') onFollow(u);
      else if (clean === 'share') onShare(u);
      else if (clean === 'milestone') {
        status.totalLikes = nextMilestone(status.totalLikes);
        checkMilestones();
      }
      else return fail('Loại test không hợp lệ');
      return res.json({ success: true });
    }

    // quiz commands: start | pause | skip | reset | lesson:<id> | seconds:<n> | mode:<kind>
    if (action === 'quiz') {
      if (clean === 'start') quiz.start();
      else if (clean === 'pause') quiz.pause();
      else if (clean === 'skip') quiz.skip();
      else if (clean === 'reset') quiz.resetScores();
      else if (clean.startsWith('lesson:')) quiz.setLesson(clean.slice(7));
      else if (clean.startsWith('seconds:')) quiz.setSeconds(Number(clean.slice(8)));
      else if (clean.startsWith('mode:')) quiz.setMode(clean.slice(5));
      else return fail('Lệnh lớp học không hợp lệ');
      saveSettings();
      return res.json({ success: true });
    }

    // ai commands: on | off | mode:auto | mode:review | model:<id>
    if (action === 'ai') {
      if (clean === 'on' || clean === 'off') router.setEnabled(clean === 'on');
      else if (clean === 'mode:auto' || clean === 'mode:review') router.setMode(clean.slice(5) as AiState['mode']);
      else if (clean.startsWith('model:')) router.setModel(clean.slice(6));
      else return fail('Lệnh AI không hợp lệ');
      saveSettings();
      return res.json({ success: true });
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  if (action === 'autoTalk') {
    broadcast('control', { action });
    return res.json({ success: true });
  }
  if (action === 'autoTalkEvery') {
    const minutes = Number(clean);
    if (!AUTO_TALK_CHOICES.includes(minutes)) return fail('Chu kỳ không hợp lệ');
    autoTalkMinutes = minutes;
    saveSettings();
    scheduleAutoTalk();
    broadcast('autoTalk', { minutes });
    return res.json({ success: true });
  }

  // music commands: on | off | next | vol:0.4 | style:files|ballad|vui
  if (action === 'music') {
    if (clean === 'next') {
      broadcast('control', { action: 'musicNext' });
      return res.json({ success: true });
    }
    if (clean === 'on' || clean === 'off') music = { ...music, on: clean === 'on' };
    else if (/^vol:(0(\.\d+)?|1(\.0+)?)$/.test(clean)) music = { ...music, volume: Number(clean.slice(4)) };
    else if (clean.startsWith('style:') && MUSIC_STYLES.includes(clean.slice(6)))
      music = { ...music, on: true, style: clean.slice(6) as MusicState['style'] };
    else return fail('Lệnh nhạc không hợp lệ');
    saveSettings();
    broadcast('music', music);
    return res.json({ success: true });
  }

  if (action === 'speak' && !clean) return fail('Chưa nhập nội dung cần đọc');
  if (action === 'setName') {
    const name = clean.slice(0, 40);
    if (!name) return fail('Chưa nhập tên kênh');
    channelName = name;
    saveSettings();
  }
  broadcast('control', { action, text: action === 'setName' ? channelName : clean.slice(0, 500), lang: lang === 'zh' ? 'zh' : 'vi' });
  res.json({ success: true, pages: sseClients.length });
});

// ---------- Q&A from the dashboard ----------
const userFromBody = (b: any): User | null =>
  typeof b?.username === 'string' && typeof b?.comment === 'string' && b.comment.trim()
    ? { username: b.username.slice(0, 60), nickname: String(b.nickname || b.username).slice(0, 30), avatar: String(b.avatar || '') }
    : null;

app.post('/api/qa/:op', (req, res) => {
  try {
    const { op } = req.params;
    if (op === 'approve' || op === 'reject') {
      const id = Number(req.body?.id);
      if (op === 'approve') router.approve(id);
      else router.reject(id);
      return res.json({ success: true });
    }
    const u = userFromBody(req.body);
    if (!u) return res.status(400).json({ success: false, error: 'Thiếu bình luận' });
    if (op === 'ask') router.ask(u, req.body.comment);
    else if (op === 'pin') router.pin(u, req.body.comment);
    else return res.status(404).json({ success: false, error: 'Không có lệnh này' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------- TTS ----------
const VOICES: Record<Lang, { voice: string; rate: string; google: string }> = {
  vi: { voice: 'vi-VN-HoaiMyNeural', rate: '+5%', google: 'vi' },
  // A bit slower than normal so beginners can follow the tones
  zh: { voice: 'zh-CN-XiaoxiaoNeural', rate: '-15%', google: 'zh-CN' },
};
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function edgeTts(text: string, lang: Lang): Promise<Buffer> {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10000, synthesisTimeoutMs: 20000 });
  let stopped = false;
  let stream: ReturnType<MsEdgeTTS['toStream']>['audioStream'] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async () => {
      await tts.setMetadata(VOICES[lang].voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      if (stopped) throw new Error('Edge TTS cancelled');
      const { audioStream } = tts.toStream(escapeXml(text), { rate: VOICES[lang].rate });
      stream = audioStream;
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const c of audioStream) {
        const chunk = c as Buffer;
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new Error('Edge TTS audio too large');
        chunks.push(chunk);
      }
      if (!chunks.length) throw new Error('Edge TTS returned no audio');
      return Buffer.concat(chunks);
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Edge TTS timeout')), 20000);
    });
    return await Promise.race([read(), timeout]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    stream?.destroy();
    tts.close();
  }
}

// Fallback: Google Translate TTS caps each request near 200 chars
async function googleTts(text: string, lang: Lang): Promise<Buffer> {
  const signal = AbortSignal.timeout(20000);
  const parts: Buffer[] = [];
  const words = text.split(/\s+/);
  let chunk = '';
  const chunks: string[] = [];
  for (const w of words) {
    if ((chunk + ' ' + w).length > 190) {
      chunks.push(chunk);
      chunk = w;
    } else chunk = chunk ? `${chunk} ${w}` : w;
  }
  if (chunk) chunks.push(chunk);
  for (const c of chunks) {
    const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&tl=${VOICES[lang].google}&client=tw-ob&q=${encodeURIComponent(c)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' },
      signal,
    });
    if (!r.ok) throw new Error(`Google TTS ${r.status}`);
    parts.push(Buffer.from(await r.arrayBuffer()));
  }
  return Buffer.concat(parts);
}

const ttsService = new TtsService();
app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text || '').trim().slice(0, 800);
  const lang: Lang = req.query.lang === 'zh' ? 'zh' : 'vi';
  if (!text) return res.status(400).send('Missing text');
  const key = `${lang}|${text}`;
  try {
    const audio = await ttsService.get(key, async () => {
      try { return await edgeTts(text, lang); }
      catch (err) {
        console.warn('Edge TTS failed, falling back to Google:', err instanceof Error ? err.message : err);
        return await googleTts(text, lang);
      }
    });
    if (res.destroyed) return;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    if (res.destroyed) return;
    if (err instanceof TtsBusyError) return res.status(503).set('Retry-After', '2').json({ error: 'TTS busy' });
    console.error('TTS error:', err);
    res.status(500).json({ error: 'TTS failed' });
  }
});

// No viewer names, comments or audio text in diagnostics. No history retained.
if (process.env.MEMORY_DIAGNOSTICS === '1') {
  const snapshot = () => ({
    at: new Date().toISOString(), pid: process.pid, uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(), tts: ttsService.stats(), ai: aiProcessStats(),
    sseClients: sseClients.length, comments: router.stats(), social: socialQueue.stats(),
    cooldowns: { likeThanks: likeThankedAt.size, likeTally: likeTally.size },
    session: { named: namedThisSession.size, followed: followedThisSession.size, ...quiz.memoryStats() },
  });
  setInterval(() => console.info('[memory]', JSON.stringify(snapshot())), 10000).unref();
  app.get('/api/diagnostics', (_req, res) => res.json(snapshot()));
}

process.once('SIGINT', () => { stopAiProcess(); process.exitCode = 0; shutdown(); });
process.once('SIGTERM', () => { stopAiProcess(); process.exitCode = 0; shutdown(); });
function shutdown() {
  router.dispose();
  // Leave a short window for the owned CLI process group to be reaped.
  const timer = setInterval(() => { if (!aiProcessStats().active) process.exit(0); }, 50);
  setTimeout(() => { clearInterval(timer); process.exit(1); }, 7000);
}

// ---------- Vite / static ----------
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      // LIVE_MODE=1 (BAT-LIVE.bat): no hot reload, so an edit never reloads the stage page mid-live
      // Own HMR port so this app can run next to Nhậu Online (24679)
      server: { middlewareMode: true, hmr: process.env.LIVE_MODE === '1' ? false : { port: 24680 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  // Loopback only: the API has no login, so nobody on the same Wi-Fi can drive the live voice
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Lớp Tiếng Trung Live chạy tại http://localhost:${PORT}  ·  Link LIVE Studio: http://lvh.me:${PORT}/?view=stage`);
  });
}

start();
