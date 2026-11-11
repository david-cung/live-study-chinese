import { QUIZ_BLOCK_SIZE } from './quizTiming';

export const GIFT_PROMOTION_TEXT = 'Tặng quà làm lớp trưởng: x2 điểm cho câu tham gia tiếp theo khi trả lời đúng.';
export const GIFT_PROMOTION_SPEECH = 'Thấy lớp hữu ích, bạn có thể tặng quà ủng hộ lớp nhé. Cảm ơn cả nhà!';
export const GIFT_REMINDER_MS = 5 * 60 * 1000;
export const GIFT_REMINDER_QUESTIONS = QUIZ_BLOCK_SIZE;
export const GIFT_THANKS_PAUSE_MS = 2 * 60 * 1000;
// Leave enough room for the short invitation before the next question.
export const GIFT_REMINDER_SPEECH_MS = 8000;
