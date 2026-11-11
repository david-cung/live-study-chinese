// A longer break after each block lets the teacher finish feedback and a short invitation.
export const QUIZ_BLOCK_SIZE = 10;
export const revealDuration = (questionNo: number) => questionNo % QUIZ_BLOCK_SIZE === 0 ? 24000 : 9000;
