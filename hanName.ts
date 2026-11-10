import fs from 'fs';
import path from 'path';
import { spokenName } from './src/spokenName';

type Syllable = { hanzi: string; pinyin: string; vi: string };
export type HanPart = { vi: string; hanzi: string; pinyin: string; meaning: string };
export type HanName = {
  nickname: string;
  parts: HanPart[];
  hanzi: string;
  pinyin: string;
  fallback: boolean;
};

const DICT_FILE = path.join(process.cwd(), 'content', 'han-viet-names.json');

const FALLBACKS: HanPart[][] = [
  [
    { vi: 'Minh', hanzi: '明', pinyin: 'Míng', meaning: 'sáng suốt' },
    { vi: 'Anh', hanzi: '英', pinyin: 'Yīng', meaning: 'anh hoa' },
  ],
  [
    { vi: 'Hạo', hanzi: '皓', pinyin: 'Hào', meaning: 'sáng rõ' },
    { vi: 'Nhiên', hanzi: '然', pinyin: 'Rán', meaning: 'tự nhiên' },
  ],
  [
    { vi: 'Ngọc', hanzi: '玉', pinyin: 'Yù', meaning: 'ngọc' },
    { vi: 'Lan', hanzi: '兰', pinyin: 'Lán', meaning: 'hoa lan' },
  ],
  [
    { vi: 'Tuấn', hanzi: '俊', pinyin: 'Jùn', meaning: 'tuấn tú' },
    { vi: 'Kiệt', hanzi: '杰', pinyin: 'Jié', meaning: 'xuất chúng' },
  ],
  [
    { vi: 'Thảo', hanzi: '草', pinyin: 'Cǎo', meaning: 'cỏ thơm' },
    { vi: 'My', hanzi: '美', pinyin: 'Měi', meaning: 'đẹp' },
  ],
  [
    { vi: 'Gia', hanzi: '嘉', pinyin: 'Jiā', meaning: 'tốt lành' },
    { vi: 'Hân', hanzi: '欣', pinyin: 'Xīn', meaning: 'vui vẻ' },
  ],
];

let dict: Record<string, Syllable> = {};
let loadedAt = 0;

function load() {
  if (Date.now() - loadedAt < 30000 && Object.keys(dict).length) return;
  loadedAt = Date.now();
  try {
    dict = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
  } catch {
    dict = {};
  }
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd');

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Split a cleaned Vietnamese name into syllables: "MinhAnh" / "minh anh" / "Nguyễn"
function syllables(name: string): string[] {
  // Only ASCII camelCase (MinhAnh) — Vietnamese tone letters must not be treated as "uppercase"
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' ').trim();
  const parts = spaced.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const clean = strip(p).replace(/[^a-z]/g, '');
    if (!clean) continue;
    // Long glued tokens: try greedy left-to-right match against the dictionary
    if (clean.length > 6 && !dict[clean]) {
      let rest = clean;
      while (rest) {
        let hit = '';
        for (let n = Math.min(6, rest.length); n >= 2; n--) {
          const slice = rest.slice(0, n);
          if (dict[slice]) {
            hit = slice;
            break;
          }
        }
        if (!hit) {
          out.push(rest);
          break;
        }
        out.push(hit);
        rest = rest.slice(hit.length);
      }
    } else out.push(clean);
  }
  return out.slice(0, 3);
}

export function hanNameFor(nickname: string, username = ''): HanName {
  load();
  const spoken = spokenName(nickname, '');
  const keys = syllables(spoken || nickname);
  const parts: HanPart[] = [];
  for (const key of keys) {
    const hit = dict[key];
    // Skip unknown bits (middle initials, nick fluff) instead of throwing the whole name away
    if (!hit) continue;
    const display = (spoken || nickname).split(/\s+/).find((w) => strip(w).replace(/[^a-z]/g, '') === key) || key;
    parts.push({ vi: display[0].toUpperCase() + display.slice(1), hanzi: hit.hanzi, pinyin: hit.pinyin, meaning: hit.vi });
  }

  if (parts.length === 0) {
    const fb = FALLBACKS[hash(username || nickname) % FALLBACKS.length];
    return {
      nickname: spoken || nickname || 'bạn',
      parts: fb,
      hanzi: fb.map((p) => p.hanzi).join(''),
      pinyin: fb.map((p) => p.pinyin).join(' '),
      fallback: true,
    };
  }

  return {
    nickname: spoken || nickname || 'bạn',
    parts,
    hanzi: parts.map((p) => p.hanzi).join(''),
    pinyin: parts.map((p) => p.pinyin).join(' '),
    fallback: false,
  };
}
