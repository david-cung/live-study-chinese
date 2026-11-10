// Stage is laid out at 430×764 (9:16) and zoomed to 1080×1920 on the live page.
export const STAGE_W = 430;
export const STAGE_H = 764;

export type Table = { id: number; x: number; y: number };
export type Seat = { id: number; table: number; x: number; y: number; z: number; slot: number };

// Desk sprite (public/assets/ban-hoc.webp, 600×235) drawn this wide in the front row
export const DESK_W = 190;
export const DESK_H = Math.round((DESK_W * 235) / 600);
// Where the desktop's front edge and back edge sit, as a fraction of the sprite height
export const DESK_FRONT = 0.52;
export const DESK_BACK = 0.2;
export const SEATS_PER_DESK = 4;

// Rows further back look smaller
export const depthScale = (y: number) => 0.75 + ((y - 63) / 25.5) * 0.25;

// Two long desks per row, four rows; x/y are % of the stage, y is the desktop's front edge
export const TABLES: Table[] = [63, 71.5, 80, 88.5].flatMap((y) => [25.5, 74.5].map((x) => ({ x, y }))).map((t, id) => ({ id, ...t }));

const pctX = (px: number) => (px / STAGE_W) * 100;
const pctY = (px: number) => (px / STAGE_H) * 100;

// Students sit just behind the desk's back edge, evenly spread along it
export const SEATS: Seat[] = TABLES.flatMap((t) => {
  const s = depthScale(t.y);
  return Array.from({ length: SEATS_PER_DESK }, (_, slot) => ({
    table: t.id,
    slot,
    x: t.x + pctX((slot - (SEATS_PER_DESK - 1) / 2) * (DESK_W / SEATS_PER_DESK) * 0.92 * s),
    y: t.y - pctY((DESK_FRONT - DESK_BACK) * DESK_H * s),
    z: tableZ(t) - 2,
  }));
}).map((s, id) => ({ id, ...s }));

export function tableZ(t: Table) {
  return Math.round(t.y * 10);
}
