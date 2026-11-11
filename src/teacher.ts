export type Teacher = 'female' | 'male';

export const TEACHERS = {
  female: { label: 'Cô giáo', idle: '/assets/co-giao.webp', talking: '/assets/co-giao-noi.webp' },
  male: { label: 'Thầy giáo', idle: '/assets/thay-giao.png', talking: '/assets/thay-giao-noi.png' },
} as const;

export const isTeacher = (value: unknown): value is Teacher => value === 'female' || value === 'male';
