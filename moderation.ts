import fs from 'fs';
import path from 'path';

const BLOCKLIST_FILE = path.join(process.cwd(), 'content', 'blocklist.txt');

let words = new Set<string>();
let phrases: string[] = [];
let loadedAt = 0;

// Re-read at most every 30 s so edits to blocklist.txt apply without a restart
function load() {
  if (Date.now() - loadedAt < 30000) return;
  loadedAt = Date.now();
  try {
    const lines = fs
      .readFileSync(BLOCKLIST_FILE, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'));
    words = new Set(lines.filter((l) => !l.includes(' ')));
    phrases = lines.filter((l) => l.includes(' '));
  } catch {
    words = new Set();
    phrases = [];
  }
}

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|vn|org|io|me|xyz|link|shop)\b)/i;
const PHONE = /(\+?\d[\s.-]?){8,}/;

export function isBlocked(text: string) {
  load();
  const lower = text.toLowerCase();
  if (LINK.test(lower) || PHONE.test(lower)) return true;
  // Single words match whole tokens only, so "dm" does not hit "admin"
  if (lower.split(/[^\p{L}\p{N}]+/u).some((t) => words.has(t))) return true;
  return phrases.some((p) => lower.includes(p));
}

export const safeName = (name: string) => (isBlocked(name) ? 'Bạn ẩn danh' : name);
