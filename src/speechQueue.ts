import type { Lang } from './types';

export type SpeechLine = { text: string; onStart?: () => void; onEnd?: () => void; lang: Lang };
export type SpeechGroup = { lines: SpeechLine[]; urgent: boolean; question?: number };

// Text only. Overload eviction applies to whole messages that haven't started.
// Quiz announcements may interrupt between segments; resume the interrupted
// message afterwards rather than discarding half a gift/Q&A announcement.
export class SpeechQueue {
  private ordinary: SpeechGroup[] = [];
  private priority: SpeechGroup[] = [];
  private active: SpeechGroup | null = null;
  private suspended: SpeechGroup | null = null;
  private question: number | null = null;

  add(group: SpeechGroup) {
    if (!group.lines.length || group.lines.length > (group.urgent ? 24 : 6)) return;
    const queue = group.urgent ? this.priority : this.ordinary;
    queue.push(group);
    const limit = group.urgent ? 24 : 6;
    while (queue.reduce((n, g) => n + g.lines.length, 0) > limit) {
      const index = queue.findIndex((g) => g.question === undefined || g.question !== this.question);
      // All waiting messages belong to this question: discard the newest
      // repeat rather than the question's introduction/answer announcement.
      queue.splice(index < 0 ? queue.length - 1 : index, 1);
    }
  }

  private quizIndex() {
    return this.question === null ? -1 : this.priority.findIndex((g) => g.question === this.question);
  }

  peek() {
    const quiz = this.priority[this.quizIndex()];
    if (quiz && this.active?.question === undefined) return quiz.lines[0];
    return this.active?.lines[0] ?? quiz?.lines[0] ?? this.suspended?.lines[0] ?? this.priority[0]?.lines[0] ?? this.ordinary[0]?.lines[0];
  }

  take() {
    const quizIndex = this.quizIndex();
    if (quizIndex >= 0 && this.active?.lines.length && this.active.question === undefined && !this.suspended) {
      this.suspended = this.active;
      this.active = this.priority.splice(quizIndex, 1)[0];
    } else if (!this.active?.lines.length) {
      if (quizIndex >= 0) this.active = this.priority.splice(quizIndex, 1)[0];
      else if (this.suspended) { this.active = this.suspended; this.suspended = null; }
      else this.active = this.priority.shift() ?? this.ordinary.shift() ?? null;
    }
    return this.active?.lines.shift();
  }

  // true means the caller also needs to stop the audio currently playing.
  setQuestion(question: number | null) {
    this.question = question;
    const keep = (g: SpeechGroup) => g.question === undefined || g.question === question;
    this.priority = this.priority.filter(keep);
    this.ordinary = this.ordinary.filter(keep);
    if (this.suspended && !keep(this.suspended)) this.suspended = null;
    if (this.active && !keep(this.active)) { this.active = null; return true; }
    return false;
  }

  clear() { this.ordinary = []; this.priority = []; this.active = null; this.suspended = null; }

  stats() {
    const count = (groups: SpeechGroup[]) => groups.reduce((n, g) => n + g.lines.length, 0);
    return { ordinary: count(this.ordinary), priority: count(this.priority),
      activeRemaining: (this.active?.lines.length ?? 0) + (this.suspended?.lines.length ?? 0) };
  }
}
