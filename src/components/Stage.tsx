import { useEffect, useState } from 'react';
import { DESK_FRONT, DESK_H, DESK_W, SEATS, SEATS_PER_DESK, STAGE_H, STAGE_W, TABLES, depthScale, tableZ, type Table } from '../layout';
import type { Speaking } from '../sound';
import type { GiftBanner, Guest, HanNameCard, MilestoneProgress, QaItem, QuizQuestion, QuizState, SocialToast, TopEntry } from '../types';
import { QUIZ_LABELS } from '../quizModes';
import { GIFT_PROMOTION_TEXT } from '../giftPromotion';
import { TEACHERS, type Teacher as TeacherChoice } from '../teacher';

export const QA_MS = 8000;
const BONUS_MS = 3500;
const LETTERS = ['A', 'B', 'C', 'D'];

export type StageProps = {
  quiz: QuizState;
  speaking: Speaking | null;
  answered: Set<string>;
  qa: QaItem | null;
  qaAt: number;
  bonusAt: number;
  megaAt: number;
  welcomes: { id: number; nickname: string }[];
  socials: SocialToast[];
  guests: Guest[];
  banner: GiftBanner | null;
  hanCard: HanNameCard | null;
  top: TopEntry[];
  likeProgress: number;
  likeGoal: number;
  milestone: MilestoneProgress;
  channelName: string;
  teacher?: TeacherChoice;
  viewerCount: number;
};

export default function Stage(p: StageProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const correctSet = new Set(p.quiz.correctUsers);
  const showQa = p.qa && now - p.qaAt < QA_MS;
  return (
    <div className="relative overflow-hidden select-none font-quan classroom" style={{ width: STAGE_W, height: STAGE_H }}>
      <div className="absolute inset-x-0 top-0 h-[13%] bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute inset-x-0 top-[55%] bottom-0 floor" />

      <Board quiz={p.quiz} now={now} />

      {/* Painted back to front: chair, student, desk, then the name card on the desk */}
      {SEATS.map((s) => (
        <Chair key={`chair-${s.id}`} seatId={s.id} />
      ))}
      {p.guests.map((g) => (
        <GuestView
          key={g.username}
          g={g}
          now={now}
          answered={p.quiz.phase === 'asking' && p.answered.has(g.username)}
          correct={p.quiz.phase === 'reveal' && correctSet.has(g.username)}
          asking={!!showQa && p.qa?.username === g.username}
        />
      ))}
      {TABLES.map((t) => (
        <Desk key={t.id} t={t} />
      ))}
      {p.guests.map((g) => (
        <NameCard key={`card-${g.username}`} g={g} now={now} correct={p.quiz.phase === 'reveal' && correctSet.has(g.username)} />
      ))}

      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 px-3 pt-3 flex items-start justify-between z-[1000]">
        <div className="max-w-[62%]">
          <div className="text-[#ffd36b] text-[21px] font-black leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] truncate">{p.channelName}</div>
          <div className="text-white/85 text-[12px] font-semibold truncate">{p.quiz.activity === 'exam' ? `Luyện giải đề · ${p.quiz.exam?.level.toUpperCase()}` : 'Học tiếng Trung qua live mỗi ngày'}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="bg-black/55 text-white text-[12px] font-bold rounded-full px-2 py-0.5">👀 {p.viewerCount} đang xem</div>
          <div className="bg-black/55 text-white text-[12px] font-bold rounded-full px-2 py-0.5">🪑 {p.guests.length}/{SEATS.length} chỗ</div>
        </div>
      </div>

      {/* Like bar + session milestone */}
      <div className="absolute left-3 right-3 top-[8.6%] z-[1000]">
        <div className="flex justify-between text-[11px] font-bold text-white/90 mb-0.5 drop-shadow">
          <span>{p.quiz.activity === 'exam' ? '📝 Giải đề · Mỗi câu đúng = 1 điểm' : `❤️ Đủ ${p.likeGoal} tim: câu tiếp theo x3 điểm`}</span>
          <span>
            {Math.round(p.likeProgress * p.likeGoal)}/{p.likeGoal}
          </span>
        </div>
        <div className="h-2 rounded-full bg-black/50 overflow-hidden border border-white/20">
          <div className="h-full bg-gradient-to-r from-[#ff8fb1] to-[#ff3d6e] transition-all duration-500" style={{ width: `${Math.min(100, p.likeProgress * 100)}%` }} />
        </div>
        <div className="mt-0.5 text-[10px] font-semibold text-white/80 drop-shadow truncate">
          {p.quiz.activity === 'exam' ? '10 câu nghe · 10 câu đọc · Chữa từng câu' : `🏁 Còn ${Math.max(0, p.milestone.nextAt - p.milestone.total)} tim nữa mở: ${p.milestone.label}`}
        </div>
      </div>

      <Teacher speaking={p.speaking} pointing={p.quiz.phase === 'asking'} teacher={p.teacher ?? 'female'} compact={p.quiz.activity === 'exam'} />

      {/* Leaderboard under the board; the teacher stands to its right */}
      <div style={{ top: p.quiz.activity === 'exam' ? '72%' : '47.6%' }} className="absolute left-[3%] z-[1000] w-[60%] bg-[#2a1d12]/90 rounded-md px-2 py-1 border-2 border-[#8a5a32] shadow-lg">
        <div className="text-[11px] font-black text-[#ffd36b]">{p.quiz.activity === 'exam' ? '🏆 SỐ CÂU ĐÚNG' : '🏆 BẢNG VÀNG'}</div>
        {p.top.length === 0 && <div className="text-[11px] text-white/60 leading-[1.4]">Trả lời đúng để lên bảng</div>}
        {p.top.slice(0, 3).map((t, i) => (
          <div key={t.username} className="flex justify-between gap-1 text-[11px] text-white leading-[1.35]">
            <span className="truncate">
              {['🥇', '🥈', '🥉'][i]} {t.nickname}
            </span>
            <span className="text-[#ffd36b] font-bold shrink-0">{t.points}</span>
          </div>
        ))}
      </div>
      {/* Viewer Q&A card */}
      {showQa && p.qa && p.quiz.activity !== 'exam' && <QaCard key={p.qa.id} qa={p.qa} />}

      {/* Caption of what the teacher is saying, for viewers watching muted */}
      {p.speaking && (
        <div className="absolute left-[3%] right-[3%] bottom-[32px] z-[1050] flex justify-center pointer-events-none">
          <div
            key={p.speaking.text}
            className={`caption-in max-w-full bg-black/75 rounded-lg px-2.5 py-1 text-center font-bold leading-snug text-white ${
              p.speaking.lang === 'zh' ? 'text-[20px] zh-font text-[#ffe9a8]' : 'text-[13px]'
            }`}
          >
            {p.quiz.question?.exam?.section === 'listening' && p.quiz.phase === 'asking' && p.speaking.lang === 'zh' ? '🔊 Đang phát bài nghe · Lời thoại hiện khi chữa bài' : p.speaking.text}
          </div>
        </div>
      )}

      {/* Newcomers + follow/share */}
      <div className={`absolute left-[3%] z-[1000] flex flex-col items-start gap-1 w-[60%] ${p.speaking ? 'bottom-[80px]' : 'bottom-[34px]'}`}>
        {p.welcomes.map((w) => (
          <div key={w.id} className="welcome-in max-w-full bg-black/70 border border-[#ffd36b]/60 rounded-full px-2 py-0.5 text-[11px] text-white font-semibold truncate">
            👋 <span className="text-[#ffd36b]">{w.nickname}</span> vừa vào lớp
          </div>
        ))}
        {p.socials.map((s) => (
          <div key={s.id} className="welcome-in max-w-full bg-black/70 border border-[#7ad0ff]/60 rounded-full px-2 py-0.5 text-[11px] text-white font-semibold truncate">
            {s.kind === 'follow' ? '➕' : '🔗'} <span className="text-[#7ad0ff]">{s.nickname}</span> {s.kind === 'follow' ? 'đã follow · +5 điểm' : 'đã chia sẻ live'}
          </div>
        ))}
      </div>

      {/* Gift banner */}
      {p.banner && !p.hanCard && (
        <div key={p.banner.id} className="absolute left-1/2 top-[13%] z-[1100] banner-in">
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#ff7a3d] to-[#ffb43d] rounded-full pl-1 pr-3 py-1 shadow-[0_4px_18px_rgba(255,140,60,0.6)] border-2 border-white/80 whitespace-nowrap">
            <Avatar name={p.banner.nickname} src={p.banner.avatar} size={28} color="#c0392b" />
            <div className="text-white leading-tight">
              <div className="text-[13px] font-black max-w-[200px] truncate">👑 {p.banner.nickname}</div>
              <div className="text-[12px] font-semibold">
                tặng {p.banner.giftName} x{p.banner.count} · {p.quiz.activity === 'exam' ? 'cảm ơn bạn!' : 'lớp trưởng x2 điểm'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chinese name gift reward */}
      {p.hanCard && <HanNameOverlay card={p.hanCard} isExam={p.quiz.activity === 'exam'} />}

      {/* Bonus question announcement */}
      {p.quiz.activity !== 'exam' && now - p.bonusAt < BONUS_MS && now - p.megaAt >= BONUS_MS && (
        <div className="absolute inset-0 z-[1200] flex items-center justify-center pointer-events-none bg-black/30">
          <div className="text-center bonus-pop">
            <div className="text-[54px] leading-none">⭐</div>
            <div className="text-[30px] font-black text-[#ffd36b] chalk-stroke">CÂU THƯỞNG</div>
            <div className="text-[44px] font-black text-white chalk-stroke leading-none">x3 ĐIỂM</div>
          </div>
        </div>
      )}
      {p.quiz.activity !== 'exam' && now - p.megaAt < BONUS_MS && (
        <div className="absolute inset-0 z-[1200] flex items-center justify-center pointer-events-none bg-black/30">
          <div className="text-center bonus-pop">
            <div className="text-[54px] leading-none">🌟</div>
            <div className="text-[28px] font-black text-[#ffd36b] chalk-stroke">MỐC TIM</div>
            <div className="text-[44px] font-black text-white chalk-stroke leading-none">x5 ĐIỂM</div>
          </div>
        </div>
      )}

      {/* Bottom ticker */}
      <div className="absolute left-0 right-0 bottom-0 h-[26px] bg-black/75 z-[1000] overflow-hidden flex items-center">
        <div className="marquee whitespace-nowrap text-[12px] text-white/90 font-semibold">
          {[0, 1].map((copy) => (
            <span key={copy}>
              {p.quiz.activity === 'exam' ? <span>📝 Chọn đáp án bằng A/B/C/D theo lựa chọn trên bảng · Bài nghe phát hai lần · Chờ mở trả lời rồi bình luận · Mỗi câu đúng = 1 điểm · Cùng xem lời giải sau mỗi câu ·\u00a0\u00a0\u00a0</span> : <>
                <span className="text-[#ffd36b] font-black">🎁 {GIFT_PROMOTION_TEXT}</span>
                {' · ✍️ Gõ A, B, C hoặc D để trả lời · 🔁 Gõ "đọc lại" để nghe lại gợi ý · 🔊 Gõ "đọc" + từ để nghe phát âm · 📖 Gõ "dịch" + từ tiếng Việt · 🏆 Gõ "điểm" để xem hạng · ❤️ Đủ 300 tim có câu thưởng x3 ·\u00a0\u00a0\u00a0'}
              </>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Board({ quiz, now }: { quiz: QuizState; now: number }) {
  if (quiz.activity === 'exam') return <ExamBoard quiz={quiz} now={now} />;
  const q = quiz.question;
  const reveal = quiz.phase === 'reveal';
  const left = q ? Math.max(0, Math.ceil((q.endsAt - now) / 1000)) : 0;
  const chineseOptions = q && ['listen', 'fill', 'reverse'].includes(q.kind);
  return (
    <div className="absolute left-[3%] right-[25%] top-[12.6%] h-[33.6%] z-[900] board-frame rounded-lg p-[6px]">
      <div className="relative w-full h-full rounded board px-3 py-2 flex flex-col text-white overflow-hidden">
        {!q ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
            <div className="text-[13px] font-bold text-white/70 tracking-[0.2em]">LỚP HỌC TIẾNG TRUNG</div>
            <div className="text-[64px] leading-none font-black chalk zh-font">你好！</div>
            <div className="text-[15px] font-bold text-[#ffe9a8] chalk">nǐ hǎo · xin chào</div>
            <div className="text-[12px] text-white/80 mt-2">{quiz.lessonTitle}</div>
            <div className="text-[12px] text-[#9fe8b8] font-semibold">{quiz.running ? 'Câu hỏi sắp bắt đầu...' : 'Lớp sắp bắt đầu, vào chỗ ngồi nha!'}</div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[12px] font-bold">
              <span className="bg-white/15 rounded-full px-2 py-0.5">Câu {q.no}</span>
              <span className="text-[#ffe9a8] text-[11px]">{QUIZ_LABELS[q.kind]}</span>
              {reveal ? (
                <span className="bg-[#3fae6b] rounded-full px-2 py-0.5">Đáp án</span>
              ) : (
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[15px] font-black border-2 ${left <= 3 ? 'border-[#ff6b6b] text-[#ff6b6b] timer-pulse' : 'border-white'}`}>
                  {left}
                </span>
              )}
            </div>
            {(q.megaBonus || q.bonus) && (
              <div className="absolute left-1/2 -translate-x-1/2 top-[38px] text-[11px] font-black bg-[#ffd36b] text-[#5a3500] rounded-full px-2 z-10">
                {q.megaBonus ? '🌟 CÂU THƯỞNG x5' : '⭐ CÂU THƯỞNG x3'}
              </div>
            )}

            <div className="flex-1 flex flex-col items-center justify-center min-h-0">
              <QuestionPrompt question={q} reveal={reveal} />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {q.options.map((o, i) => {
                const right = reveal && quiz.correct === i;
                return (
                  <div
                    key={`${q.no}-${i}`}
                    className={`flex items-center min-h-[34px] gap-1.5 rounded-md px-1.5 py-1 border-2 transition-all duration-300 ${
                      right ? 'bg-[#3fae6b] border-white option-right' : reveal ? 'bg-black/20 border-white/10 opacity-40' : 'bg-black/25 border-white/30'
                    }`}
                  >
                    <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-black ${right ? 'bg-white text-[#2b7a4b]' : 'bg-[#ffd36b] text-[#3a2a00]'}`}>
                      {LETTERS[i]}
                    </span>
                    <span className={`line-clamp-2 break-words font-bold leading-tight ${chineseOptions ? 'text-[19px] zh-font' : q.kind === 'pinyin' ? 'text-[14px]' : 'text-[12px]'}`}>{o}</span>
                  </div>
                );
              })}
            </div>

            <div className="text-[11px] text-center mt-1 h-[16px] truncate">
              {reveal ? (
                quiz.winners.length ? (
                  <span className="text-[#ffe9a8] font-bold">🏆 Nhanh nhất: {quiz.winners.slice(0, 2).join(', ')}</span>
                ) : (
                  <span className="text-white/75">Chưa ai đúng câu này, câu sau cố lên nha!</span>
                )
              ) : (
                <span className="text-white/80">✋ {quiz.answeredCount} bạn đã trả lời</span>
              )}
            </div>
            {!reveal && (
              <div className="absolute left-0 bottom-0 h-[3px] bg-[#ffd36b] transition-[width] duration-300 ease-linear" style={{ width: `${(Math.max(0, q.endsAt - now) / (q.seconds * 1000)) * 100}%` }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ExamBoard({ quiz, now }: { quiz: QuizState; now: number }) {
  const q = quiz.question;
  const exam = quiz.exam;
  const item = q?.exam;
  const reveal = quiz.phase === 'reveal';
  const left = q?.endsAt ? Math.max(0, Math.ceil((q.endsAt - now) / 1000)) : null;
  const answer = q && quiz.correct !== null ? q.options[quiz.correct] : '';
  return <div className="absolute left-[3%] right-[3%] top-[12.6%] h-[58%] z-[900] board-frame rounded-lg p-[6px]">
    <div className="w-full h-full rounded board text-white p-3 flex flex-col overflow-hidden">
      <div className="text-[10px] font-black tracking-wider text-[#ffd36b]">LUYỆN GIẢI ĐỀ · {exam?.level.toUpperCase()}</div>
      {!q || !item ? <div className="flex-1 flex flex-col justify-center gap-3 text-center">
        <div className="text-[26px] font-black chalk">{exam?.completed ? 'Hoàn thành!' : 'Cùng giải đề'}</div>
        <div className="text-[13px] font-bold">{exam?.title}</div>
        <div className="text-[11px] text-white/75 leading-relaxed">{exam?.completed ? 'Đã cùng học xong 20 câu! Xem mình làm tốt phần nào nhé.' : 'Xem mẹo → tìm từ khóa → thử một đáp án. Sai cũng học được cách làm mới!'}</div>
        {exam?.completed ? <div className="space-y-2">
          {!exam.results.length && <p className="text-[12px]">Chưa có lượt trả lời. Cùng thử lại đề nhé!</p>}
          {exam.results.slice(0, 5).map((r, i) => <div key={r.username} className="rounded-lg bg-white/10 p-2 text-[12px]">
            <div className="font-bold truncate">{i + 1}. {r.nickname} · {r.listening + r.reading}/{exam.total}</div>
            <div className="text-[10px] text-[#ffe9a8]">Nghe {r.listening}/10 · Đọc {r.reading}/10 · Đã trả lời {r.answered}/{exam.total}</div>
          </div>)}
        </div> : <div className="text-[11px] text-[#9fe8b8]">10 câu nghe · 10 câu đọc<br />Bộ luyện tự biên soạn</div>}
      </div> : <>
        <div className="flex justify-between items-center text-[11px] font-bold mt-1">
          <span>{item.section === 'listening' ? '🔊 NGHE' : '📖 ĐỌC'} · {item.position}/{item.total}</span>
          <span className={`rounded-full px-2 py-1 ${reveal ? 'bg-[#3fae6b]' : 'bg-white/15'}`}>{reveal ? 'Chữa bài' : !quiz.running ? 'Tạm dừng' : left === null ? item.section === 'listening' ? 'Đang nghe' : 'Xem mẹo' : `${left}s`}</span>
        </div>
        <div className="text-[11px] text-[#ffe9a8] leading-snug mt-2">{item.instruction}</div>
        <div className="flex-1 min-h-0 overflow-y-auto mt-2 pr-1 space-y-2">
          {!reveal && <div className="rounded-lg border border-[#ffd36b]/50 bg-[#ffd36b]/10 p-2 text-[12px] leading-snug text-[#ffe9a8]">
            <span className="font-black">💡 Mẹo nhanh: </span>{item.hint}
          </div>}
          {!reveal && <div className="text-[18px] font-bold zh-font leading-relaxed break-words">{item.prompt}</div>}
          {reveal ? <>
            <div className="rounded-lg bg-[#3fae6b]/30 border border-[#9fe8b8] p-2 text-[14px] font-bold zh-font">✓ {LETTERS[quiz.correct!]} · {answer}</div>
            <div className="text-[14px] zh-font leading-relaxed"><span className="text-[10px] text-[#ffe9a8]">{item.transcript ? 'Lời thoại: ' : 'Đề bài: '}</span>{item.transcript || item.prompt}</div>
            <div className="text-[11px] leading-relaxed text-white/80">{item.translation}</div>
            <div className="text-[12px] font-bold text-[#9fe8b8]">Từ khóa: {item.keyword}</div>
            <div className="text-[12px] leading-relaxed bg-black/20 p-2 rounded-lg"><span className="font-bold text-[#ffe9a8]">Cách tìm đáp án: </span>{item.explanation}</div>
          </> : <div className="space-y-2">
            {q.options.map((option, i) => <div key={i} className="flex gap-2 rounded-lg border border-white/30 bg-black/20 p-2">
              <span className="text-[12px] font-black text-[#ffd36b]">{LETTERS[i]}</span>
              <span className="text-[15px] zh-font font-semibold leading-snug break-words">{option}</span>
            </div>)}
          </div>}
        </div>
        <div className="text-[10px] mt-2 text-center text-[#ffe9a8]">
          {reveal ? `${quiz.correctUsers.length}/${quiz.answeredCount} bạn đúng · Cùng nhớ mẹo cho câu sau nhé!` : left === null ? item.section === 'listening' ? 'Nghe hai lần, không cần hiểu từng chữ nhé!' : 'Đọc mẹo trước, rồi cùng thử một đáp án nhé!' : `Thử ${q.options.map((_, i) => LETTERS[i]).join('/')} nhé · ${quiz.answeredCount} bạn đã trả lời`}
        </div>
      </>}
    </div>
  </div>;
}

export function QuestionPrompt({ question: q, reveal }: { question: QuizQuestion; reveal: boolean }) {
  return (
    <>
      {q.kind === 'fill' && q.context ? (
        <div key={`${q.no}-sentence`} className="w-full text-center py-1">
          <div className="zh-font text-[22px] font-black leading-[1.2] chalk break-words">
            {q.context.sentence.split('___')[0]}
            <span className={reveal ? 'text-[#9fe8b8]' : 'inline-block min-w-[44px] mx-0.5 border-b-2 border-[#ffe9a8] text-[#ffe9a8]'}>
              {reveal ? q.word.hanzi : '___'}
            </span>
            {q.context.sentence.split('___')[1]}
          </div>
          {reveal && <div className="text-[13px] font-bold text-[#ffe9a8] mt-0.5">{q.word.hanzi} · {q.word.pinyin}</div>}
          <div className="text-[11px] font-semibold leading-snug text-white/85 mt-1 line-clamp-2">{q.context.vi}</div>
        </div>
      ) : q.kind === 'reverse' && !reveal ? (
        <div className="text-center px-1">
          <div className="text-[11px] font-semibold text-white/70 mb-1">Tìm chữ Hán có nghĩa là</div>
          <div className="text-[24px] leading-tight font-black text-[#ffe9a8] break-words">{q.word.vi}</div>
        </div>
      ) : q.kind !== 'listen' || reveal ? (
        <>
          <div key={`${q.no}-w`} className="text-[52px] leading-[1.05] font-black chalk zh-font word-in">
            {q.word.hanzi}
          </div>
          {(q.kind !== 'pinyin' || reveal) && <div className="text-[17px] font-bold text-[#ffe9a8] chalk">{q.word.pinyin}</div>}
          {q.kind === 'pinyin' && !reveal && <div className="text-[11px] text-white/75 mt-1">Chú ý âm và dấu thanh!</div>}
          {reveal && <div className="text-[11px] text-white/85 text-center">= {q.word.vi}</div>}
        </>
      ) : (
        <div className="flex flex-col items-center">
          <div className="text-[52px] leading-none speaker">🔊</div>
          <div className="text-[13px] font-bold text-white/85 mt-1">Nghe phát âm rồi chọn chữ đúng</div>
        </div>
      )}
    </>
  );
}

// Two drawings of the same pose (mouth closed / open); flipping between them while the voice plays reads as talking
const TEACHER_H = 318;
const TEACHER_W = Math.round((TEACHER_H * 395) / 900);

function HanNameOverlay({ card, isExam = false }: { card: HanNameCard; isExam?: boolean }) {
  return (
    <div key={card.id} className="absolute left-1/2 top-[12%] z-[1180] banner-in w-[88%] pointer-events-none">
      <div
        className={`rounded-2xl border-[3px] border-white/90 px-3 py-2.5 text-center shadow-[0_8px_28px_rgba(0,0,0,0.45)] ${
          card.fancy ? 'bg-gradient-to-b from-[#ffe08a] to-[#ffb43d]' : 'bg-gradient-to-b from-[#fff6de] to-[#ffd36b]'
        }`}
      >
        <div className="text-[11px] font-bold text-[#5a3a00]/90 truncate">Tên tiếng Trung của {card.nickname}</div>
        <div className="zh-font text-[42px] font-black leading-none text-[#2a1d12] mt-1 tracking-wide">{card.hanzi}</div>
        <div className="text-[14px] font-bold text-[#6a4a10] mt-0.5">{card.pinyin}</div>
        <div className="mt-1.5 flex flex-wrap justify-center gap-x-2 gap-y-0.5">
          {card.parts.map((part) => (
            <span key={part.hanzi + part.vi} className="text-[11px] font-semibold text-[#4a3208]">
              <span className="zh-font font-black">{part.hanzi}</span> · {part.meaning}
            </span>
          ))}
        </div>
        <div className="text-[11px] font-bold text-[#7a4a00] mt-1.5">{isExam ? '🎁 Cảm ơn bạn đã ủng hộ lớp!' : card.fancy ? '🎁 Quà lớn · lớp trưởng x2 điểm' : '👑 Lớp trưởng · câu tới x2 điểm'}</div>
      </div>
    </div>
  );
}

export function Teacher({ speaking, pointing, teacher, compact = false }: { speaking: Speaking | null; pointing: boolean; teacher: TeacherChoice; compact?: boolean }) {
  const character = TEACHERS[teacher];
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!speaking) {
      setOpen(false);
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    const flap = () => {
      setOpen((o) => !o);
      t = setTimeout(flap, 90 + Math.random() * 110);
    };
    flap();
    return () => clearTimeout(t);
  }, [speaking]);

  return (
    <div className="absolute z-[950] pointer-events-none" style={{ right: -6, top: compact ? '72%' : '11%', width: compact ? 86 : TEACHER_W, height: compact ? 180 : TEACHER_H }}>
      <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-black/35 blur-[4px]" style={{ bottom: -4, width: TEACHER_W * 0.75, height: 14 }} />
      <div className={`relative w-full h-full ${speaking ? 'teacher-talk' : pointing ? 'teacher-point' : 'teacher-idle'}`}>
        <img src={character.idle} alt={character.label} draggable={false} className="absolute inset-0 w-full h-full object-contain" style={{ opacity: open ? 0 : 1 }} />
        <img src={character.talking} alt="" aria-hidden draggable={false} className="absolute inset-0 w-full h-full object-contain" style={{ opacity: open ? 1 : 0 }} />
      </div>
      {speaking && (
        <div className="absolute top-[34px] left-[30%] text-[15px] sound-wave" aria-hidden>
          🔊
        </div>
      )}
    </div>
  );
}

function QaCard({ qa }: { qa: QaItem }) {
  return (
    <div className="absolute left-[3%] right-[29%] top-[46.8%] z-[1150] qa-in">
      <div className="rounded-xl bg-[#fffaf0] text-[#2a1d12] border-[3px] border-[#ffd36b] shadow-[0_8px_24px_rgba(0,0,0,0.55)] px-2.5 py-2">
        <div className="flex items-center gap-2">
          <Avatar name={qa.nickname} src={qa.avatar} size={26} color="#3f7fd8" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-black truncate">
              {qa.nickname} <span className="font-semibold text-[#8a6a4a]">{qa.source === 'pin' ? 'nói' : 'hỏi'}</span>
            </div>
            <div className="text-[12px] text-[#5a4a3a] truncate">“{qa.comment}”</div>
          </div>
          <span className="text-[10px] font-black bg-[#d92e35] text-white rounded-full px-1.5 py-0.5 shrink-0">{qa.source === 'pin' ? '📌 GHIM' : '💬 HỎI ĐÁP'}</span>
        </div>
        {qa.source !== 'pin' && (
          <div className="mt-1.5 pt-1.5 border-t border-[#e8d9bf] flex items-center gap-2">
            {qa.zh && (
              <div className="shrink-0 text-center bg-[#1f4d3a] text-white rounded-md px-2 py-0.5">
                <div className="text-[24px] leading-tight font-black zh-font">{qa.zh.replace(/。[\s\S]*$/, '')}</div>
                {qa.pinyin && <div className="text-[11px] text-[#ffe9a8] font-bold">{qa.pinyin}</div>}
              </div>
            )}
            <div className="text-[13px] font-semibold leading-snug">{qa.vi}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Chair sprite (public/assets/ghe-hoc.webp, 160×304); only its backrest shows behind the student
const CHAIR_W = 30;
const CHAIR_H = Math.round((CHAIR_W * 304) / 160);
// How far below the desk's back edge the chair stands and the student's body ends (both hidden by the desk)
const CHAIR_DROP = 26;
const BODY_DROP = -3;
const JOIN_FX_MS = 2600;

function Desk({ t }: { t: Table }) {
  const s = depthScale(t.y);
  return (
    <div
      className="absolute"
      style={{ left: `${t.x}%`, top: `${t.y}%`, zIndex: tableZ(t), transform: `translate(-50%, -${DESK_FRONT * 100}%) scale(${s})`, transformOrigin: `50% ${DESK_FRONT * 100}%` }}
    >
      <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-black/30 blur-[4px]" style={{ bottom: -6, width: DESK_W * 0.92, height: 14 }} />
      <img src="/assets/ban-hoc.webp" alt="" draggable={false} className="relative block" style={{ width: DESK_W, height: DESK_H }} />
    </div>
  );
}

function Chair({ seatId }: { seatId: number }) {
  const seat = SEATS[seatId];
  const s = depthScale(seat.y);
  return (
    <img
      src="/assets/ghe-hoc.webp"
      alt=""
      draggable={false}
      className="absolute"
      style={{
        left: `${seat.x}%`,
        top: `calc(${seat.y}% + ${Math.round(CHAIR_DROP * s)}px)`,
        width: CHAIR_W,
        height: CHAIR_H,
        zIndex: seat.z - 1,
        transform: `translate(-50%, -100%) scale(${s})`,
        transformOrigin: '50% 100%',
      }}
    />
  );
}

// Name card lying on the desktop right in front of each student
function NameCard({ g, now, correct }: { g: Guest; now: number; correct: boolean }) {
  const seat = SEATS[g.seat];
  const t = TABLES[seat.table];
  const s = depthScale(t.y);
  const vip = g.vipUntil > now;
  const fresh = now - (g.joinedAt || 0) < JOIN_FX_MS;
  const w = (DESK_W / SEATS_PER_DESK) * 0.86;
  return (
    <div
      className="absolute"
      style={{ left: `${seat.x}%`, top: `calc(${t.y}% - ${Math.round(DESK_H * 0.17 * s)}px)`, zIndex: tableZ(t) + 1, transform: `translate(-50%, -50%) scale(${s})`, transformOrigin: '50% 50%' }}
    >
      <div
        className={`card-in rounded-[4px] border px-0.5 text-center text-[9.5px] font-extrabold leading-[15px] truncate shadow-[0_2px_3px_rgba(0,0,0,0.35)] ${
          vip
            ? 'bg-gradient-to-b from-[#fff3c4] to-[#ffd36b] border-[#c98a1a] text-[#5a3500]'
            : correct
              ? 'bg-[#e6ffef] border-[#2f9e5a] text-[#1d6b3c]'
              : 'bg-[#fffaf0] border-[#c9a77a] text-[#4a3420]'
        } ${fresh ? 'card-fresh' : ''}`}
        style={{ width: w }}
      >
        {vip && '👑'}
        {g.nickname}
      </div>
      {fresh && (
        <div className="absolute left-1/2 -translate-x-1/2 -top-[70px] pointer-events-none">
          <div className="join-tag whitespace-nowrap rounded-full bg-[#ff5b8a] text-white text-[10px] font-black px-1.5 py-[1px] shadow">+ vào lớp</div>
        </div>
      )}
    </div>
  );
}

function GuestView({ g, now, answered, correct, asking }: { g: Guest; now: number; answered: boolean; correct: boolean; asking: boolean }) {
  const seat = SEATS[g.seat];
  const s = depthScale(seat.y);
  const vip = g.vipUntil > now;
  const fresh = now - (g.joinedAt || 0) < JOIN_FX_MS;
  const ring = correct ? '#3fdc7c' : asking ? '#4fc3ff' : vip ? '#ffd36b' : '#ffffff';
  return (
    <div
      className="absolute guest-in"
      style={{ left: `${seat.x}%`, top: `calc(${seat.y}% + ${Math.round(BODY_DROP * s)}px)`, zIndex: seat.z, transform: `translate(-50%, -100%) scale(${s})`, transformOrigin: '50% 100%' }}
    >
      <div className="relative flex flex-col items-center">
        {g.bubble && (
          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bubble-in z-10">
            <div className="relative bg-white text-[#222] text-[12px] font-semibold rounded-xl px-2 py-1 max-w-[150px] w-max leading-snug shadow-md break-words">
              {g.bubble.text}
              <div className="absolute -bottom-[4px] left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
            </div>
          </div>
        )}
        {fresh && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[18px] sparkle pointer-events-none">✨</div>}
        <div className={`relative ${correct ? 'guest-cheer' : 'guest-idle'}`} style={{ animationDelay: `${(g.seat % 5) * 0.4}s` }}>
          {vip && <div className="absolute -top-[13px] left-1/2 -translate-x-1/2 text-[14px] z-10">👑</div>}
          <Avatar name={g.nickname} src={g.avatar} size={30} color={g.color} ring={ring} glow={correct || asking || fresh} />
          <div className="mx-auto -mt-1 w-[34px] h-[22px] rounded-t-[14px]" style={{ background: g.color, boxShadow: 'inset 0 -6px 0 rgba(0,0,0,0.18)' }} />
          {answered && <div className="absolute -top-2 -right-3 text-[15px] hand-up">✋</div>}
          {correct && <div className="absolute -top-2 -right-3 w-[18px] h-[18px] rounded-full bg-[#3fdc7c] text-white text-[12px] font-black flex items-center justify-center check-pop">✓</div>}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, src, size, color, ring = '#fff', glow = false }: { name: string; src: string; size: number; color: string; ring?: string; glow?: boolean }) {
  const [broken, setBroken] = useState(false);
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div
      className="relative mx-auto rounded-full overflow-hidden flex items-center justify-center font-black text-white"
      style={{
        width: size,
        height: size,
        border: `2px solid ${ring}`,
        background: color,
        fontSize: size * 0.45,
        boxShadow: glow ? `0 0 10px 3px ${ring}` : '0 2px 4px rgba(0,0,0,0.4)',
      }}
    >
      {src && !broken ? <img src={src} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initial}
    </div>
  );
}
