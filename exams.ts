import fs from 'node:fs';
import path from 'node:path';
import { HSK_LEVELS, type ExamExercise, type ExamPaper, type HskLevel } from './src/examTypes';

export const isHskLevel = (value: unknown): value is HskLevel => HSK_LEVELS.includes(value as HskLevel);

export function validateExam(raw: unknown): raw is ExamPaper {
  const paper = raw as ExamPaper | null;
  if (!paper || !isHskLevel(paper.level) || typeof paper.id !== 'string' || !paper.id.trim() ||
    typeof paper.title !== 'string' || !paper.title.trim() || typeof paper.description !== 'string' ||
    !Array.isArray(paper.questions) || !paper.questions.length) return false;
  const ids = new Set<string>();
  return paper.questions.every((q: ExamExercise) => {
    if (!q || typeof q.id !== 'string' || !q.id.trim() || ids.has(q.id) ||
      !['listening', 'reading'].includes(q.section) ||
      !['instruction', 'hint', 'prompt', 'translation', 'explanation', 'keyword'].every((key) => typeof q[key as keyof ExamExercise] === 'string' && String(q[key as keyof ExamExercise]).trim()) ||
      !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4 ||
      q.options.some((option) => typeof option !== 'string' || !option.trim()) || new Set(q.options).size !== q.options.length ||
      !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length ||
      !Number.isInteger(q.seconds) || q.seconds < 10 || q.seconds > 120 ||
      (q.section === 'listening' && (typeof q.transcript !== 'string' || !q.transcript.trim()))) return false;
    ids.add(q.id);
    return true;
  });
}

export function loadExams(): ExamPaper[] {
  return HSK_LEVELS.flatMap((level) => {
    const file = path.join(process.cwd(), 'content', 'exams', `${level}.json`);
    try {
      const paper: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (validateExam(paper) && paper.level === level) return [paper];
      console.error(`Bỏ qua ${file}: cấu trúc đề không hợp lệ`);
    } catch (error) {
      console.error(`Không đọc được đề ${level}:`, error instanceof Error ? error.message : String(error));
    }
    return [];
  });
}
