import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quiz, loadLessons, parseAnswer } from '../quiz';
import { availableQuestionKinds, clozeQuestion, pronunciationKey, validClozeExercises, wordQuestion } from '../questions';
import { QUIZ_KINDS, questionAnswer, questionIntroSpeech, questionRevealSpeech, repeatQuestionSpeech } from '../src/quizModes';
import type { QuizKind, QuizQuestion } from '../src/types';

test('HSK1/HSK2 each include 24 valid cloze sentences with four distinct choices', () => {
  const lessons = loadLessons();
  for (const level of ['hsk1', 'hsk2']) {
    const lesson = lessons.find((lesson) => lesson.id === level)!;
    assert.equal(lesson.cloze.length, 24);
    assert.equal(new Set(lesson.cloze.map((item) => item.sentence)).size, 24);
    assert.deepEqual(availableQuestionKinds(lesson.words, lesson.cloze), QUIZ_KINDS);
    for (const exercise of lesson.cloze) {
      const q = clozeQuestion(exercise, lesson.words);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4);
      assert.equal(q.options.filter((value) => value === questionAnswer(q)).length, 1);
      assert.equal(q.context?.sentence.split('___').length, 2);
      assert.ok(lesson.words.some((word) => word.hanzi === q.word.hanzi));
    }
  }
});

test('all words generate four choices without duplicate meanings/pinyin or homophone listening traps', () => {
  for (const lesson of loadLessons()) {
    for (const word of lesson.words) {
      for (const kind of ['meaning', 'listen', 'pinyin', 'reverse'] as const) {
        const q = wordQuestion(kind, word, lesson.words)!;
        assert.ok(q, `${lesson.id}: ${word.hanzi} / ${kind}`);
        assert.equal(q.options.length, 4);
        assert.equal(new Set(q.options).size, 4);
        assert.equal(q.options.filter((option) => option === questionAnswer(q)).length, 1);
        if (kind === 'pinyin') assert.equal(new Set(q.options.map(pronunciationKey)).size, 4);
        if (kind === 'listen') {
          const sounds = q.options.map((option) => lesson.words.find((entry) => entry.hanzi === option)!.pinyin);
          assert.equal(new Set(sounds.map(pronunciationKey)).size, 4);
        }
        if (kind === 'reverse') {
          const meanings = q.options.map((option) => lesson.words.find((entry) => entry.hanzi === option)!.vi);
          assert.equal(new Set(meanings).size, 4);
        }
      }
    }
  }
});

test('mixed mode covers each format once per cycle and never repeats formats across cycle boundaries', () => {
  for (const lessonId of ['hsk1', 'hsk2']) {
    const quiz = new Quiz(() => {}, { lessonId });
    const kinds: QuizKind[] = [];
    try {
      quiz.start();
      for (let i = 0; i < 100; i++) {
        const q = quiz.state().question!;
        kinds.push(q.kind);
        assert.ok(q.options.includes(questionAnswer(q)));
        quiz.skip();
      }
      for (let i = 0; i < kinds.length; i += 5) assert.equal(new Set(kinds.slice(i, i + 5)).size, 5);
      for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1]);
    } finally { quiz.pause(); }
  }
});

test('cloze sentence deck does not repeat until all authored sentences have been shown', () => {
  const quiz = new Quiz(() => {}, { lessonId: 'hsk1', mode: 'fill' });
  const sentences = new Set<string>();
  try {
    quiz.start();
    for (let i = 0; i < 24; i++) {
      const q = quiz.state().question!;
      assert.equal(q.kind, 'fill');
      assert.ok(!sentences.has(q.context!.sentence));
      sentences.add(q.context!.sentence);
      quiz.skip();
    }
  } finally { quiz.pause(); }
});

test('mode selection applies on next question and survives settings reload; old settings default to mixed', () => {
  const quiz = new Quiz(() => {}, {});
  try {
    quiz.start();
    const current = quiz.state().question;
    quiz.setMode('pinyin');
    assert.equal(quiz.state().question, current);
    assert.equal(quiz.state().mode, 'pinyin');
    quiz.skip();
    assert.equal(quiz.state().question?.kind, 'pinyin');
    assert.equal(new Quiz(() => {}, quiz.settings).state().mode, 'pinyin');
    assert.equal(new Quiz(() => {}, { seconds: 15 }).state().mode, 'mixed');
    assert.throws(() => quiz.setMode('unknown'), /không hợp lệ/);
  } finally { quiz.pause(); }
});

test('every quiz format uses A/B/C/D scoring, duplicate-answer rules, VIP and x3/x5 bonuses', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  for (const kind of QUIZ_KINDS) {
    for (const multiplier of [1, 3, 5]) {
      const quiz = new Quiz(() => {}, { lessonId: 'hsk1', mode: kind, seconds: 10 });
      if (multiplier === 3) quiz.bonusNext();
      if (multiplier === 5) quiz.megaBonusNext();
      quiz.vip('winner');
      quiz.start();
      const q = quiz.state().question!;
      const right = q.options.indexOf(questionAnswer(q));
      assert.ok(right >= 0);
      const correct = 'ABCD'[right];
      const wrong = 'ABCD'[(right + 1) % 4];
      quiz.tryAnswer({ username: 'winner', nickname: 'Bạn đúng' }, `đáp án ${correct}`);
      quiz.tryAnswer({ username: 'winner', nickname: 'Bạn đúng' }, wrong);
      quiz.tryAnswer({ username: 'wrong', nickname: 'Bạn sai' }, wrong);
      assert.equal(quiz.state().answeredCount, 2);
      assert.equal(quiz.state().correct, null);
      t.mock.timers.tick(10000);
      assert.equal(quiz.state().correct, right);
      assert.deepEqual(quiz.state().correctUsers, ['winner']);
      assert.equal(quiz.rankOf('winner')?.points, 40 * multiplier);
      assert.equal(quiz.rankOf('wrong'), null);
      quiz.pause();
      t.mock.timers.tick(9000);
      assert.equal(quiz.state().phase, 'idle');
    }
  }
  assert.equal(parseAnswer('câu B nha'), 1);
  assert.equal(parseAnswer('4'), 3);
});

test('bad cloze data is skipped and unsupported formats stay unavailable', () => {
  const lesson = loadLessons()[0];
  const item = lesson.cloze[0];
  const cases = [null, {}, { ...item, sentence: '没有空格' }, { ...item, sentence: '___和___' },
    { ...item, answer: 'not-in-options' }, { ...item, options: [item.answer, item.answer, '你', '我'] },
    { ...item, options: [item.answer, 'not-in-vocabulary', '你', '我'] }];
  assert.equal(validClozeExercises(cases, lesson.words).length, 0);
  const homophones = ['他', '她', '它', '祂'].map((hanzi, i) => ({ hanzi, pinyin: 'tā', vi: `nghĩa ${i}` }));
  assert.deepEqual(availableQuestionKinds(homophones, []), ['meaning', 'reverse']);
  assert.equal(wordQuestion('listen', homophones[0], homophones), null);
});

test('new-format intro and repeat speech keep hidden answers for the reveal', () => {
  const lesson = loadLessons().find((lesson) => lesson.id === 'hsk1')!;
  const fill = { ...clozeQuestion(lesson.cloze[0], lesson.words), no: 1, seconds: 15, endsAt: 999999, bonus: false } as QuizQuestion;
  assert.equal(fill.word.hanzi, '是');
  for (const speech of [questionIntroSpeech(fill), repeatQuestionSpeech(fill)]) {
    assert.ok(!speech.some((line) => line.text.includes(fill.word.hanzi)));
    assert.ok(!speech.some((line) => line.text.includes('___')));
  }
  assert.equal(questionRevealSpeech(fill)[0].text, '我是学生。');
  const word = lesson.words.find((word) => word.hanzi === '你好')!;
  for (const kind of ['reverse', 'pinyin'] as const) {
    const q = { ...fill, ...wordQuestion(kind, word, lesson.words), context: undefined } as QuizQuestion;
    for (const speech of [questionIntroSpeech(q), repeatQuestionSpeech(q)]) {
      assert.ok(!speech.some((line) => line.lang === 'zh'));
      assert.ok(!speech.some((line) => line.text.includes(word.hanzi) || line.text.includes(word.pinyin)));
    }
    assert.ok(questionRevealSpeech(q).some((line) => line.lang === 'zh' && line.text === word.hanzi));
  }
});
