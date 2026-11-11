import type { Lang, QuizKind, QuizQuestion } from './types';

export const QUIZ_KINDS: QuizKind[] = ['meaning', 'listen', 'fill', 'pinyin', 'reverse'];
export const QUIZ_LABELS: Record<QuizKind, string> = {
  meaning: '📖 Chọn nghĩa đúng',
  listen: '🔊 Nghe và chọn chữ',
  fill: '✍️ Điền từ còn thiếu',
  pinyin: '🗣️ Chọn pinyin đúng',
  reverse: '🔎 Tìm chữ theo nghĩa',
};

export function questionAnswer(q: Pick<QuizQuestion, 'kind' | 'word'>) {
  return q.kind === 'meaning' ? q.word.vi : q.kind === 'pinyin' ? q.word.pinyin : q.word.hanzi;
}

type Speech = { text: string; lang: Lang };
const vi = (text: string): Speech => ({ text, lang: 'vi' });
const zh = (text: string): Speech => ({ text, lang: 'zh' });

// Used both for auto-repeat and the viewer's "đọc lại" command. Reading the
// hidden target here would give away fill/reverse/pinyin answers mid-question.
export function repeatQuestionSpeech(q: QuizQuestion): Speech[] {
  if (q.exam) return [vi(q.exam.instruction), vi(`Mẹo nhanh: ${q.exam.hint}`)];
  if (q.kind === 'meaning' || q.kind === 'listen') return [zh(`${q.word.hanzi}。……${q.word.hanzi}。`)];
  if (q.kind === 'reverse') return [vi(q.word.vi)];
  if (q.kind === 'fill' && q.context) return [zh(q.context.sentence.replace('___', '，……，'))];
  return [vi('Chọn pinyin đúng cho chữ trên bảng. Chú ý dấu thanh nha!')];
}

export function questionIntroSpeech(q: QuizQuestion): Speech[] {
  if (q.exam) return [vi(q.exam.instruction), vi(`Mẹo nhanh: ${q.exam.hint}`)];
  const instructions: Record<QuizKind, string> = {
    meaning: 'Nghe cô đọc, chữ này nghĩa là gì?',
    listen: 'Nghe và chọn chữ đúng.',
    fill: 'Điền từ còn thiếu vào câu. Xem gợi ý tiếng Việt rồi chọn A, B, C hoặc D nhé!',
    pinyin: 'Chọn pinyin đúng cho chữ trên bảng. Chú ý dấu thanh nha!',
    reverse: 'Nghĩa tiếng Việt này viết bằng chữ Hán nào?',
  };
  return [vi(instructions[q.kind]), ...(q.kind === 'pinyin' ? [] : repeatQuestionSpeech(q))];
}

export function questionRevealSpeech(q: QuizQuestion): Speech[] {
  if (q.exam) return [
    ...(q.exam.transcript ? [zh(q.exam.transcript)] : []),
    ...(q.exam.translation ? [vi(q.exam.translation)] : []),
    ...(q.exam.explanation ? [vi(q.exam.explanation)] : []),
  ];
  if (q.kind === 'fill' && q.context) {
    return [zh(q.context.sentence.replace('___', q.word.hanzi)), vi(q.context.vi)];
  }
  return [zh(q.word.hanzi), vi(`nghĩa là ${q.word.vi}.`)];
}
