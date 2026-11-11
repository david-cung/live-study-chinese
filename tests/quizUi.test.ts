import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board, QuestionPrompt } from '../src/components/Stage';
import { Quiz } from '../quiz';
import { QUIZ_KINDS, QUIZ_LABELS, questionAnswer } from '../src/quizModes';

test('new quiz prompts hide the solution until reveal, then show pronunciation and full sentence', () => {
  const quiz = new Quiz(() => {}, { lessonId: 'hsk1' });
  try {
    for (const kind of ['fill', 'pinyin', 'reverse', 'listen'] as const) {
      quiz.setMode(kind);
      quiz.skip();
      const question = quiz.state().question!;
      const asking = renderToStaticMarkup(createElement(QuestionPrompt, { question, reveal: false }));
      const reveal = renderToStaticMarkup(createElement(QuestionPrompt, { question, reveal: true }));
      if (kind === 'fill') {
        assert.ok(asking.includes('___'));
        assert.ok(asking.includes(question.context!.vi));
        assert.ok(!reveal.includes('___'));
      }
      if (kind === 'reverse' || kind === 'listen') assert.ok(!asking.includes(question.word.hanzi));
      assert.ok(!asking.includes(question.word.pinyin));
      assert.ok(reveal.includes(question.word.hanzi));
      assert.ok(reveal.includes(question.word.pinyin));
    }
  } finally { quiz.pause(); }
});

test('board renders four labeled options and highlights only the revealed answer in every format', () => {
  const quiz = new Quiz(() => {}, { lessonId: 'hsk2' });
  try {
    for (const kind of QUIZ_KINDS) {
      quiz.setMode(kind);
      quiz.skip();
      const state = quiz.state();
      const asking = renderToStaticMarkup(createElement(Board, { quiz: state, now: Date.now() }));
      assert.ok(asking.includes(QUIZ_LABELS[kind]));
      for (const letter of 'ABCD') assert.ok(asking.includes(`>${letter}</span>`));
      assert.ok(!asking.includes('option-right'));
      const right = state.question!.options.indexOf(questionAnswer(state.question!));
      const revealed = renderToStaticMarkup(createElement(Board, { quiz: { ...state, phase: 'reveal', correct: right }, now: Date.now() }));
      assert.equal(revealed.split('option-right').length - 1, 1);
    }
  } finally { quiz.pause(); }
});
