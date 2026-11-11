import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadExams, validateExam } from '../exams';
import { Quiz, loadLessons } from '../quiz';
import { HSK_LEVELS } from '../src/examTypes';
import { Board } from '../src/components/Stage';
import { availableQuestionKinds } from '../questions';
import { QUIZ_KINDS, questionIntroSpeech, questionRevealSpeech, repeatQuestionSpeech } from '../src/quizModes';

test('all five levels have original twenty-item papers, explanations, audio scripts and study vocabulary', () => {
  const papers = loadExams();
  assert.deepEqual(papers.map((paper) => paper.level), [...HSK_LEVELS]);
  for (const paper of papers) {
    assert.ok(validateExam(paper));
    assert.equal(paper.questions.length, 20);
    assert.equal(paper.questions.filter((q) => q.section === 'listening').length, 10);
    assert.equal(paper.questions.filter((q) => q.section === 'reading').length, 10);
    assert.equal(new Set(paper.questions.map((q) => q.prompt)).size, 20);
    assert.equal(paper.questions.filter((q) => q.options.length === 2).length, 2);
    for (const exercise of paper.questions) {
      assert.ok(exercise.hint.length >= 15 && exercise.hint.length <= 160);
      assert.ok(exercise.seconds >= 30, 'leave room for a tip and TikTok comments');
      if (exercise.transcript) assert.ok(exercise.transcript.length <= 140, 'keep listening passages short for live viewers');
    }
    const lesson = loadLessons().find((lesson) => lesson.id === paper.level)!;
    assert.ok(lesson.words.length >= 40);
    assert.deepEqual(availableQuestionKinds(lesson.words, lesson.cloze), QUIZ_KINDS);
    assert.equal(validateExam({ ...paper, questions: [{ ...paper.questions[0], answer: 99 }] }), false);
    assert.equal(validateExam({ ...paper, questions: [{ ...paper.questions[0], transcript: '' }] }), false);
    assert.equal(validateExam({ ...paper, questions: [{ ...paper.questions[0], hint: '' }] }), false);
    assert.equal(validateExam({ ...paper, questions: [paper.questions[0], paper.questions[0]] }), false);
  }
});

test('each paper runs in order, gates listening, scores once without bonuses and finishes after twenty questions', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  for (const paper of loadExams()) {
    const quiz = new Quiz(() => {}, { activity: 'exam', examLevel: paper.level });
    try {
      quiz.start();
      for (let i = 0; i < paper.questions.length; i++) {
        const authored = paper.questions[i];
        let state = quiz.state();
        assert.equal(state.exam!.position, i + 1);
        assert.equal(state.question!.exam!.id, authored.id);
        assert.equal(state.question!.exam!.transcript, undefined);
        assert.equal(state.question!.exam!.explanation, undefined);
        assert.equal(state.question!.exam!.hint, authored.hint);
        assert.equal(state.correct, null);
        if (authored.section === 'listening') {
          assert.equal(state.question!.endsAt, 0);
          quiz.tryAnswer({ username: 'right', nickname: 'Đúng' }, String(authored.answer + 1));
          assert.equal(quiz.state().answeredCount, 0);
          t.mock.timers.tick(120000);
          assert.equal(quiz.state().phase, 'asking');
          quiz.openExamAnswers(state.question!.no);
          const deadline = quiz.state().question!.endsAt;
          quiz.openExamAnswers(state.question!.no);
          assert.equal(quiz.state().question!.endsAt, deadline);
        }
        if (authored.section === 'reading') {
          assert.equal(quiz.state().question!.endsAt, 0, 'read the tip before starting the timer');
          quiz.openExamAnswers(state.question!.no);
        }
        assert.ok(quiz.state().question!.endsAt > Date.now());
        quiz.tryAnswer({ username: 'invalid', nickname: 'Ngoài lựa chọn' }, 'D');
        assert.equal(quiz.state().answeredCount, 0);
        quiz.vip('right');
        quiz.bonusNext();
        quiz.megaBonusNext();
        quiz.awardPoints({ username: 'right', nickname: 'Đúng' }, 100);
        quiz.tryAnswer({ username: 'right', nickname: 'Đúng' }, String(authored.answer + 1));
        quiz.tryAnswer({ username: 'right', nickname: 'Đúng' }, String((authored.answer + 1) % authored.options.length + 1));
        quiz.tryAnswer({ username: 'wrong', nickname: 'Sai' }, String((authored.answer + 1) % authored.options.length + 1));
        t.mock.timers.tick(authored.seconds * 1000);
        state = quiz.state();
        assert.equal(state.phase, 'reveal');
        assert.equal(state.correct, authored.answer);
        assert.equal(state.answeredCount, 2);
        assert.equal(state.question!.exam!.explanation, authored.explanation);
        assert.equal(quiz.top()[0].points, i + 1);
        assert.ok(questionRevealSpeech(state.question!).some((line) => line.text === authored.explanation));
        t.mock.timers.tick(120000);
        assert.equal(quiz.state().exam!.position, i + 1, 'reveal waits for the operator');
        quiz.skip();
      }
      const final = quiz.state();
      assert.equal(final.running, false);
      assert.equal(final.exam!.completed, true);
      assert.equal(final.question, null);
      assert.deepEqual(final.exam!.results.find((r) => r.username === 'right'), { username: 'right', nickname: 'Đúng', answered: 20, listening: 10, reading: 10 });
      assert.equal(final.exam!.results.find((r) => r.username === 'wrong')!.listening, 0);
      assert.throws(() => quiz.skip());
      quiz.start();
      assert.equal(quiz.state().exam!.position, 1);
      assert.equal(quiz.state().exam!.results.length, 0);
    } finally { quiz.pause(); }
  }
});

test('pause, resume, stale audio acknowledgments and activity changes preserve valid state', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  const quiz = new Quiz(() => {}, { lessonId: 'hsk2', mode: 'fill', seconds: 20 });
  try {
    quiz.start();
    quiz.setActivity('exam');
    assert.equal(quiz.state().question, null);
    quiz.start();
    const oldNo = quiz.state().question!.no;
    quiz.openExamAnswers(oldNo);
    quiz.pause();
    t.mock.timers.tick(120000);
    assert.equal(quiz.state().phase, 'asking');
    assert.equal(quiz.state().question!.endsAt, 0);
    quiz.openExamAnswers(oldNo);
    assert.equal(quiz.state().question!.endsAt, 0);
    quiz.start();
    quiz.openExamAnswers(oldNo);
    assert.ok(quiz.state().question!.endsAt > Date.now());
    quiz.skip();
    quiz.skip();
    quiz.openExamAnswers(oldNo);
    assert.equal(quiz.state().question!.endsAt, 0, 'old audio cannot open the new item');
    quiz.setLesson('hsk5');
    assert.equal(quiz.state().lessonId, 'hsk5');
    assert.equal(quiz.state().running, false);
    assert.equal(quiz.state().exam!.position, 0);
    assert.throws(() => quiz.setLesson('../hsk1'));
    assert.throws(() => quiz.setActivity('invalid'));
    const restored = new Quiz(() => {}, quiz.settings);
    assert.equal(restored.state().activity, 'exam');
    assert.equal(restored.state().exam!.level, 'hsk5');
    quiz.setActivity('study');
    assert.equal(quiz.state().lessonId, 'hsk2');
    assert.equal(quiz.state().mode, 'fill');
    assert.equal(quiz.state().seconds, 20);
    quiz.start();
    assert.equal(quiz.state().question!.kind, 'fill');
  } finally { quiz.pause(); }
});

test('exam board hides solutions during answering and renders explanations and final results', () => {
  const quiz = new Quiz(() => {}, { activity: 'exam', examLevel: 'hsk1' });
  try {
    quiz.start();
    const authored = loadExams()[0].questions[0];
    const intro = questionIntroSpeech(quiz.state().question!);
    assert.ok(intro.some((line) => line.text.includes(authored.hint)));
    assert.ok(repeatQuestionSpeech(quiz.state().question!).some((line) => line.text.includes(authored.hint)));
    assert.ok(!intro.some((line) => line.text.includes(authored.transcript!)));
    let html = renderToStaticMarkup(createElement(Board, { quiz: quiz.state(), now: Date.now() }));
    assert.ok(html.includes('Đang nghe'));
    assert.ok(html.includes('Mẹo nhanh:'));
    assert.ok(html.includes(authored.hint));
    assert.ok(!html.includes(authored.transcript!));
    assert.ok(!html.includes(authored.translation));
    assert.ok(!html.includes(authored.explanation));
    quiz.openExamAnswers(quiz.state().question!.no);
    quiz.tryAnswer({ username: 'learner', nickname: 'Học viên' }, String(authored.answer + 1));
    quiz.skip();
    html = renderToStaticMarkup(createElement(Board, { quiz: quiz.state(), now: Date.now() }));
    assert.ok(html.includes(authored.transcript!));
    assert.ok(html.includes(authored.explanation));
    assert.ok(html.includes('Từ khóa:'));
    for (let i = 0; i < 19; i++) { quiz.skip(); quiz.skip(); }
    quiz.skip();
    html = renderToStaticMarkup(createElement(Board, { quiz: quiz.state(), now: Date.now() }));
    assert.ok(html.includes('Hoàn thành!'));
    assert.ok(html.includes('Học viên'));
    assert.ok(html.includes('1/20'));
  } finally { quiz.pause(); }
});
