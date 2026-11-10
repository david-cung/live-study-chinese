import type { Lang } from './types';

// Each tip is a list of parts so Chinese words are read by the Chinese voice
type Part = { text: string; lang: Lang };
const vi = (text: string): Part => ({ text, lang: 'vi' });
const zh = (text: string): Part => ({ text, lang: 'zh' });

const TIPS: Part[][] = [
  [vi('Mẹo nhỏ: tiếng Trung có bốn thanh. Nghe cô đọc bốn chữ này nha.'), zh('妈，麻，马，骂。')],
  [vi('Chữ này là mẹ:'), zh('妈。'), vi('còn chữ này là con ngựa:'), zh('马。'), vi('Sai thanh là gọi mẹ thành ngựa đó, cẩn thận nha!')],
  [vi('Khi hai thanh ba đứng liền nhau, chữ đầu đọc thành thanh hai. Ví dụ xin chào:'), zh('你好。')],
  [vi('Chữ không đứng trước thanh bốn thì đổi sang thanh hai. Ví dụ không có gì:'), zh('不客气。')],
  [vi('Muốn nhớ từ lâu, mỗi ngày ôn lại năm phút là đủ, quan trọng là đều đặn.')],
  [vi('Ai mới vào lớp thì gõ A, B, C hoặc D để trả lời câu hỏi nha. Trả lời càng nhanh điểm càng cao!')],
  [vi('Thả tim cho lớp đi mọi người, đủ ba trăm tim là câu tiếp theo được nhân ba điểm.')],
  [vi('Tặng quà để cô đặt tên tiếng Trung cho bạn nha! Có chữ Hán và pinyin luôn.')],
  [vi('Follow lớp để nhận năm điểm khởi đầu, rồi trả lời câu hỏi để leo bảng vàng!')],
  [vi('Muốn nghe cô đọc một từ thì gõ chữ đọc, rồi cách một khoảng, gõ từ đó. Ví dụ: đọc cảm ơn.')],
  [vi('Gõ chữ điểm để xem mình đang đứng hạng mấy nha.')],
  [vi('Có câu hỏi gì về tiếng Trung thì cứ comment, cô sẽ trả lời trên live.')],
  [vi('Câu cảm ơn hay dùng nhất là:'), zh('谢谢。'), vi('Còn trả lời không có gì là:'), zh('不客气。')],
  [vi('Chào buổi sáng tiếng Trung là:'), zh('早上好。')],
];

let recent: number[] = [];
export function nextTip(): Part[] {
  const fresh = TIPS.map((_, i) => i).filter((i) => !recent.includes(i));
  const i = fresh[Math.floor(Math.random() * fresh.length)];
  recent = [...recent.slice(-5), i];
  return TIPS[i];
}
