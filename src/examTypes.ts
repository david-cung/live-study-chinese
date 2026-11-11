export const HSK_LEVELS = ['hsk1', 'hsk2', 'hsk3', 'hsk4', 'hsk5'] as const;
export type HskLevel = typeof HSK_LEVELS[number];
export type Activity = 'study' | 'exam';
export type ExamSection = 'listening' | 'reading';
export type ExamExercise = {
  id: string;
  section: ExamSection;
  instruction: string;
  hint: string;
  prompt: string;
  transcript?: string;
  translation: string;
  options: string[];
  answer: number;
  explanation: string;
  keyword: string;
  seconds: number;
};
export type ExamPaper = { id: string; level: HskLevel; title: string; description: string; questions: ExamExercise[] };
export type ExamQuestionView = Pick<ExamExercise, 'id' | 'section' | 'instruction' | 'hint' | 'prompt'> & {
  position: number;
  total: number;
  transcript?: string;
  translation?: string;
  explanation?: string;
  keyword?: string;
};
export type ExamResult = {
  username: string;
  nickname: string;
  answered: number;
  listening: number;
  reading: number;
};
export type ExamProgress = {
  id: string;
  level: HskLevel;
  title: string;
  description: string;
  position: number;
  total: number;
  completed: boolean;
  results: ExamResult[];
};
