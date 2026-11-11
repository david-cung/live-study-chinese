import type { ClozeExercise, QuizKind, QuizQuestion, Word } from './src/types';
import { QUIZ_KINDS, questionAnswer } from './src/quizModes';

export const shuffle = <T,>(items: T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export const pronunciationKey = (value: string) => value.normalize('NFC').replace(/[\s'’]/g, '').toLowerCase();
const meaningKey = (value: string) => value.normalize('NFC').trim().toLowerCase();

export function validClozeExercises(raw: unknown, words: Word[]): ClozeExercise[] {
  if (!Array.isArray(raw)) return [];
  const vocabulary = new Set(words.map((word) => word.hanzi));
  return raw.filter((item): item is ClozeExercise => {
    if (!item || typeof item.sentence !== 'string' || item.sentence.length > 60 || item.sentence.split('___').length !== 2 ||
      typeof item.vi !== 'string' || !item.vi.trim() || item.vi.length > 160 || typeof item.answer !== 'string' ||
      !Array.isArray(item.options) || item.options.length !== 4 || new Set(item.options).size !== 4) return false;
    return item.options.includes(item.answer) && item.options.every((option: unknown) => typeof option === 'string' && vocabulary.has(option));
  });
}

export function availableQuestionKinds(words: Word[], cloze: ClozeExercise[]): QuizKind[] {
  const meanings = new Set(words.map((word) => meaningKey(word.vi))).size;
  const sounds = new Set(words.map((word) => pronunciationKey(word.pinyin))).size;
  return QUIZ_KINDS.filter((kind) => kind === 'fill' ? cloze.length > 0 : kind === 'meaning' || kind === 'reverse' ? meanings >= 4 : sounds >= 4);
}

export type QuestionDraft = Pick<QuizQuestion, 'kind' | 'word' | 'options' | 'context'>;

export function wordQuestion(kind: Exclude<QuizKind, 'fill'>, word: Word, words: Word[]): QuestionDraft | null {
  const answer = questionAnswer({ kind, word });
  const seen = new Set([kind === 'pinyin' ? pronunciationKey(answer) : meaningKey(answer)]);
  const seenSounds = new Set([pronunciationKey(word.pinyin)]);
  const seenMeanings = new Set([meaningKey(word.vi)]);
  const distractors: string[] = [];
  for (const other of shuffle(words)) {
    if (other.hanzi === word.hanzi) continue;
    const option = questionAnswer({ kind, word: other });
    const key = kind === 'pinyin' ? pronunciationKey(option) : meaningKey(option);
    if (seen.has(key)) continue;
    if (kind === 'listen' && seenSounds.has(pronunciationKey(other.pinyin))) continue;
    if (kind === 'reverse' && seenMeanings.has(meaningKey(other.vi))) continue;
    seen.add(key);
    seenSounds.add(pronunciationKey(other.pinyin));
    seenMeanings.add(meaningKey(other.vi));
    distractors.push(option);
    if (distractors.length === 3) break;
  }
  if (distractors.length < 3) return null;
  return { kind, word, options: shuffle([answer, ...distractors]) };
}

export function clozeQuestion(exercise: ClozeExercise, words: Word[]): QuestionDraft {
  const word = words.find((word) => word.hanzi === exercise.answer)!;
  return { kind: 'fill', word, options: shuffle(exercise.options), context: { sentence: exercise.sentence, vi: exercise.vi } };
}
