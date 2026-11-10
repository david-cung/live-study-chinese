import { useEffect, useState, type ReactNode } from 'react';
import type { AiState, ChatItem, LessonInfo, LiveStatus, MusicState, QuizState } from '../types';

const STAGE_URL = `http://lvh.me:${location.port || 3002}/?view=stage`;

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Lỗi ${r.status}`);
  return data;
}

const MUSIC_STYLES: { id: MusicState['style']; label: string }[] = [
  { id: 'files', label: '📁 File nhạc' },
  { id: 'ballad', label: '🎹 Nhẹ nhàng' },
  { id: 'vui', label: '🎉 Vui tươi' },
];
const MODELS = ['composer-2.5', 'gemini-3.7-flash-high', 'grok-4.7-low-fast', 'auto'];

export default function Dashboard({
  status,
  channelName,
  guestCount,
  music,
  autoTalkMinutes,
  stageInfo,
  quiz,
  lessons,
  ai,
  chats,
  stage,
}: {
  status: LiveStatus;
  channelName: string;
  guestCount: number;
  music: MusicState;
  autoTalkMinutes: number;
  stageInfo: { w: number; h: number } | null;
  quiz: QuizState;
  lessons: LessonInfo[];
  ai: AiState | null;
  chats: ChatItem[];
  stage: ReactNode;
}) {
  const [user, setUser] = useState('');
  const [name, setName] = useState('');
  const [speech, setSpeech] = useState('');
  const [speechLang, setSpeechLang] = useState<'vi' | 'zh'>('vi');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (status.username) setUser((u) => u || status.username);
  }, [status.username]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const control = (action: string, text?: string, lang?: string) => post('/api/control', { action, text, lang });

  const dot = status.isConnected ? 'bg-green-500' : status.isConnecting ? 'bg-yellow-400 animate-pulse' : 'bg-gray-500';
  const label = status.isConnected ? `Đã nối @${status.username}` : status.isConnecting ? `Đang nối @${status.username}...` : 'Chưa kết nối';
  const phaseLabel = quiz.phase === 'asking' ? `Đang hỏi câu ${quiz.question?.no}` : quiz.phase === 'reveal' ? 'Đang công bố đáp án' : 'Đang nghỉ';

  return (
    <div className="min-h-screen bg-[#121a16] text-white flex flex-wrap gap-6 p-6 justify-center">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-black text-[#ffd36b]">📚 Lớp Tiếng Trung Live · Bảng điều khiển</h1>
        {!status.isConnected && (
          <div className="text-sm bg-red-500/20 border border-red-500/60 text-red-200 rounded-lg px-3 py-2">
            ⚠️ <b>{status.isConnecting ? 'Đang nối TikTok...' : 'Chưa nối TikTok LIVE.'}</b> Người vào lớp và bình luận trả lời sẽ không hiện cho tới khi nối xong. Bật LIVE trước, rồi nhập username và bấm "Kết nối" ở mục 1.
          </div>
        )}
        <div className="text-xs text-white/70 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="flex-1">Trang này không phát tiếng. Giọng đọc và nhạc chỉ phát ở trang sân khấu (trong LIVE Studio, hoặc mở thử ở tab khác).</span>
          <button className="btn bg-[#3fae6b] shrink-0" onClick={() => window.open('/?view=stage', '_blank')}>
            🔊 Mở sân khấu có tiếng
          </button>
        </div>

        <Card title="1. Kết nối TikTok LIVE">
          <div className="flex items-center gap-2 text-sm mb-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
            {label}
            {status.isConnected && <span className="text-white/50">· 👀 {status.viewerCount} · ❤️ {status.totalLikes}</span>}
          </div>
          {status.error && <div className="text-xs text-red-400 mb-2 break-words">{status.error}</div>}
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="username TikTok (đang LIVE)" value={user} onChange={(e) => setUser(e.target.value)} />
            <button className="btn bg-[#ff4f6d]" onClick={() => run(() => post('/api/connect', { username: user }), 'Đã kết nối')}>
              Kết nối
            </button>
          </div>
          {(status.isConnected || status.isConnecting) && (
            <button className="btn bg-white/10 mt-2 w-full" onClick={() => run(() => post('/api/disconnect', {}), 'Đã ngắt')}>
              Ngắt kết nối
            </button>
          )}
        </Card>

        <Card title="2. Link cho TikTok LIVE Studio">
          <div className="text-xs text-white/60 mb-2">Thêm nguồn Link, kích thước 1080 × 1920.</div>
          {stageInfo && (
            <div
              className={`text-xs mb-2 rounded px-2 py-1.5 ${
                stageInfo.w >= 1080 && stageInfo.h >= 1900 ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'
              }`}
            >
              Sân khấu đang được vẽ ở {stageInfo.w} × {stageInfo.h}.{' '}
              {stageInfo.w >= 1080 && stageInfo.h >= 1900
                ? 'Đúng kích thước, hình sẽ nét.'
                : 'Nhỏ hơn 1080 × 1920 nên hình bị kéo giãn và mờ. Vào LIVE Studio, sửa nguồn Link thành Rộng 1080, Cao 1920 rồi làm mới.'}
            </div>
          )}
          <div className="flex gap-2">
            <code className="flex-1 bg-black/40 rounded px-2 py-1.5 text-xs text-[#ffd36b] truncate">{STAGE_URL}</code>
            <button className="btn bg-white/10" onClick={() => run(() => navigator.clipboard.writeText(STAGE_URL), 'Đã copy link')}>
              Copy
            </button>
          </div>
        </Card>

        <Card title="3. Lớp học">
          <div className="text-xs text-white/60 mb-2">
            {phaseLabel} · {quiz.running ? 'đang chạy' : 'đã dừng'}
            {quiz.bonusPending && <span className="text-[#ffd36b]"> · câu tới là câu thưởng x3</span>}
          </div>
          <select className="input w-full mb-2" value={quiz.lessonId} onChange={(e) => run(() => control('quiz', `lesson:${e.target.value}`), 'Đã đổi bài học')}>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} ({l.count} từ)
              </option>
            ))}
          </select>
          <div className="grid grid-cols-3 gap-2">
            {quiz.running ? (
              <button className="btn bg-[#f08a3c]" onClick={() => run(() => control('quiz', 'pause'), 'Đã tạm dừng')}>
                ⏸ Tạm dừng
              </button>
            ) : (
              <button className="btn bg-[#3fae6b]" onClick={() => run(() => control('quiz', 'start'), 'Lớp bắt đầu!')}>
                ▶️ Bắt đầu
              </button>
            )}
            <button className="btn bg-white/10" onClick={() => run(() => control('quiz', 'skip'), 'Đã sang câu mới')}>
              ⏭ Câu mới
            </button>
            <button className="btn bg-white/10" onClick={() => confirm('Xoá toàn bộ điểm của buổi này?') && run(() => control('quiz', 'reset'), 'Đã xoá điểm')}>
              🧹 Xoá điểm
            </button>
          </div>
          <button
            className="btn bg-[#d92e35] w-full mt-2"
            disabled={!quiz.question}
            onClick={() => run(() => control('repeatWord'), `Đã đọc lại ${quiz.question?.word.hanzi || ''}`)}
          >
            🔊 Đọc lại từ trên bảng{quiz.question ? `: ${quiz.question.word.hanzi}` : ''}
          </button>
          <div className="text-xs text-white/60 mt-3 mb-1.5">Thời gian trả lời mỗi câu:</div>
          <div className="grid grid-cols-4 gap-1.5">
            {[10, 15, 20, 30].map((s) => (
              <button key={s} className={`btn px-1 ${quiz.seconds === s ? 'bg-[#3fae6b]' : 'bg-white/10'}`} onClick={() => run(() => control('quiz', `seconds:${s}`), `${s} giây mỗi câu`)}>
                {s} giây
              </button>
            ))}
          </div>
          <div className="text-xs text-white/40 mt-2 leading-relaxed">
            Thêm hoặc sửa từ vựng trong thư mục <code>content/zh</code>, mỗi file là một bài. Đổi bài là app đọc lại file.
          </div>
        </Card>

        <AiCard ai={ai} chats={chats} run={run} control={control} />

        <Card title="5. Tên kênh">
          <div className="text-xs text-white/60 mb-2">
            Hiện trên sân khấu và dùng trong lời cảm ơn. Đang dùng: <b className="text-white">{channelName}</b>
          </div>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Ví dụ: Tiếng Trung cùng cô Mai" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn bg-[#3f7fd8]" onClick={() => run(() => control('setName', name), 'Đã lưu tên kênh')}>
              Lưu
            </button>
          </div>
        </Card>

        <Card title="6. Đọc một câu trên live">
          <textarea className="input w-full h-16 resize-none" placeholder="Nhập câu muốn đọc..." value={speech} onChange={(e) => setSpeech(e.target.value)} />
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button className={`btn ${speechLang === 'vi' ? 'bg-[#3f7fd8]' : 'bg-white/10'}`} onClick={() => setSpeechLang('vi')}>
              🇻🇳 Giọng Việt
            </button>
            <button className={`btn ${speechLang === 'zh' ? 'bg-[#d92e35]' : 'bg-white/10'}`} onClick={() => setSpeechLang('zh')}>
              🇨🇳 Giọng Trung
            </button>
            <button className="btn bg-[#3fae6b]" onClick={() => run(() => control('speak', speech, speechLang), 'Đã gửi câu đọc')}>
              🔊 Đọc
            </button>
          </div>
          <div className="text-xs text-white/60 mt-3 mb-1.5">Tự đọc mẹo học xen giữa các câu hỏi mỗi:</div>
          <div className="grid grid-cols-5 gap-1.5">
            {[0, 2, 3, 5, 10].map((m) => (
              <button
                key={m}
                className={`btn px-1 ${autoTalkMinutes === m ? 'bg-[#9b5de5]' : 'bg-white/10'}`}
                onClick={() => run(() => control('autoTalkEvery', String(m)), m ? `Mỗi ${m} phút` : 'Đã tắt tự nói')}
              >
                {m ? `${m} phút` : 'Tắt'}
              </button>
            ))}
          </div>
          <button className="btn bg-white/10 w-full mt-2" onClick={() => run(() => control('autoTalk'), 'Đã đọc một mẹo')}>
            💡 Đọc một mẹo ngay
          </button>
        </Card>

        <Card title="7. Nhạc nền">
          <div className="grid grid-cols-3 gap-2">
            {MUSIC_STYLES.map((s) => (
              <button
                key={s.id}
                className={`btn ${music.on && music.style === s.id ? 'bg-[#9b5de5]' : 'bg-white/10'}`}
                onClick={() => run(() => control('music', `style:${s.id}`), `Đã chọn ${s.label}`)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-white/60 w-14">Âm lượng</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={music.volume}
              className="flex-1 accent-[#9b5de5]"
              onChange={(e) => control('music', `vol:${Number(e.target.value).toFixed(2)}`).catch(() => {})}
            />
            <span className="text-xs w-8 text-right">{Math.round(music.volume * 100)}%</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button className="btn bg-white/10" onClick={() => run(() => control('music', music.on ? 'off' : 'on'), music.on ? 'Đã tắt nhạc' : 'Đã bật nhạc')}>
              {music.on ? '⏸ Tắt nhạc' : '▶️ Bật nhạc'}
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('music', 'next'), 'Đã đổi bài')}>
              ⏭ Đổi bài
            </button>
          </div>
        </Card>

        <Card title="Thử nhanh (không cần live)">
          <div className="grid grid-cols-3 gap-2">
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'join'), 'Có người vào lớp')}>
              👋 Vào lớp
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'answer'), 'Cả lớp đang trả lời')}>
              ✍️ Trả lời
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'question'), 'Có người hỏi')}>
              💬 Hỏi cô
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'gift'), 'Có quà')}>
              🎁 Tặng quà
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'giftBig'), 'Quà lớn + tên Hán')}>
              🎁 Quà lớn
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'likes'), '+100 tim')}>
              ❤️ +100 tim
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'follow'), 'Có người follow')}>
              ➕ Follow
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'share'), 'Có người chia sẻ')}>
              🔗 Chia sẻ
            </button>
            <button className="btn bg-white/10" onClick={() => run(() => control('test', 'milestone'), 'Chạm mốc tim')}>
              🏁 Mốc tim
            </button>
          </div>
          <div className="text-xs text-white/40 mt-2">Đang có {guestCount} bạn trong lớp.</div>
        </Card>

        {msg && <div className="text-sm text-[#ffd36b]">{msg}</div>}
      </div>

      <div className="shrink-0">
        <div className="text-xs text-white/50 mb-2">Xem trước sân khấu (không tiếng)</div>
        <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl" style={{ zoom: 0.95 }}>
          {stage}
        </div>
      </div>
    </div>
  );
}

function AiCard({
  ai,
  chats,
  run,
  control,
}: {
  ai: AiState | null;
  chats: ChatItem[];
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  control: (action: string, text?: string) => Promise<unknown>;
}) {
  if (!ai) return null;
  const recent = [...chats].reverse().slice(0, 12);
  return (
    <Card title="4. AI trả lời bình luận (Cursor CLI)">
      <div className="text-xs text-white/60 mb-2">
        {ai.enabled ? (ai.busy ? '🤖 Đang soạn câu trả lời...' : '🟢 Đang bật') : '⚪ Đang tắt'} · chờ {ai.queued} · đã gọi {ai.calls} lần
      </div>
      {ai.error && <div className="text-xs text-red-400 mb-2 break-words">Lỗi AI: {ai.error}</div>}
      <div className="grid grid-cols-3 gap-2">
        <button className={`btn ${ai.enabled ? 'bg-[#3fae6b]' : 'bg-white/10'}`} onClick={() => run(() => control('ai', ai.enabled ? 'off' : 'on'), ai.enabled ? 'Đã tắt AI' : 'Đã bật AI')}>
          {ai.enabled ? '🤖 Đang bật' : '🤖 Bật AI'}
        </button>
        <button className={`btn ${ai.mode === 'auto' ? 'bg-[#3f7fd8]' : 'bg-white/10'}`} onClick={() => run(() => control('ai', 'mode:auto'), 'AI tự đọc câu trả lời')}>
          Tự đọc
        </button>
        <button className={`btn ${ai.mode === 'review' ? 'bg-[#3f7fd8]' : 'bg-white/10'}`} onClick={() => run(() => control('ai', 'mode:review'), 'Duyệt trước khi đọc')}>
          Duyệt trước
        </button>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-white/60 shrink-0">Model</span>
        <select className="input flex-1 py-1 text-xs" value={ai.model} onChange={(e) => run(() => control('ai', `model:${e.target.value}`), `Đã chọn ${e.target.value}`)}>
          {[...new Set([ai.model, ...MODELS])].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {ai.pending.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-bold text-[#ffd36b]">Chờ duyệt ({ai.pending.length})</div>
          {ai.pending.map((p) => (
            <div key={p.id} className="bg-black/30 rounded-lg p-2 text-xs">
              <div className="text-white/60 truncate">
                <b className="text-white">{p.nickname}</b>: {p.comment}
              </div>
              <div className="mt-1">
                {p.zh && <span className="text-[#ffd36b] font-bold mr-1">{p.zh} {p.pinyin && `(${p.pinyin})`}</span>}
                {p.vi}
              </div>
              <div className="flex gap-2 mt-1.5">
                <button className="btn bg-[#3fae6b] py-1 flex-1" onClick={() => run(() => post('/api/qa/approve', { id: p.id }), 'Đã đưa lên live')}>
                  🔊 Đọc
                </button>
                <button className="btn bg-white/10 py-1 flex-1" onClick={() => run(() => post('/api/qa/reject', { id: p.id }), 'Đã bỏ')}>
                  Bỏ
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs font-bold text-white/70 mt-3 mb-1">Bình luận mới nhất</div>
      {recent.length === 0 && <div className="text-xs text-white/40">Chưa có bình luận.</div>}
      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
        {recent.map((c) => (
          <div key={c.id} className="flex items-center gap-1.5 text-xs bg-black/20 rounded px-2 py-1">
            <div className="flex-1 min-w-0 truncate">
              <b>{c.nickname}</b>: <span className="text-white/75">{c.comment}</span>
            </div>
            <button className="btn bg-white/10 px-1.5 py-0.5 text-[11px]" title="Bắt AI trả lời bình luận này" onClick={() => run(() => post('/api/qa/ask', c), 'Đã gửi cho AI')}>
              🤖
            </button>
            <button className="btn bg-white/10 px-1.5 py-0.5 text-[11px]" title="Ghim lên sân khấu và đọc to" onClick={() => run(() => post('/api/qa/pin', c), 'Đã ghim lên sân khấu')}>
              📌
            </button>
          </div>
        ))}
      </div>
      <div className="text-xs text-white/40 mt-2 leading-relaxed">
        AI chỉ trả lời câu hỏi (có dấu ?, "nói sao", "là gì"...), mỗi người tối đa 1 lần mỗi 2 phút, cả lớp 1 câu mỗi 20 giây. Câu trả lời chờ tới lúc không có câu hỏi đang mở mới hiện lên.
        Lệnh nhanh không tốn AI: <code>đọc ...</code>, <code>dịch ...</code>, <code>điểm</code>.
      </div>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="font-bold text-sm mb-2">{title}</div>
      {children}
    </div>
  );
}
