// TikTok nicknames are full of emoji, symbols and decorative letters the voice would read out one by one,
// so names are cleaned down to a few real words before they are spoken. The screen still shows the original.
const SMALL_CAPS: Record<string, string> = Object.fromEntries(
  [...'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ'].map((c, i) => [c, 'abcdefghijklmnopqrstuvwyz'[i]]),
);
// Han characters that show up as decoration (亗, 乂, 卍...) rather than as part of a Chinese name
const DECOR_HAN = /[亗乂卍卐么丶丿灬氵彡丨乀乁]/gu;
const MAX_WORDS = 3;
const MAX_CHARS = 18;

export function spokenName(nickname: string, fallback = 'bạn') {
  let s = nickname
    .normalize('NFKC')
    .replace(/[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ]/gu, (c) => SMALL_CAPS[c])
    .replace(/\p{M}/gu, '')
    .replace(DECOR_HAN, ' ')
    .replace(/[^\p{Script=Latin}\p{Script=Han}0-9]+/gu, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1');
  // "linh2005" is read as "linh hai nghìn không trăm linh năm": numbers only stay when there is nothing else
  if (/\p{L}/u.test(s)) s = s.replace(/[0-9]+/g, ' ');
  const words = s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 2 && w === w.toUpperCase() && w !== w.toLowerCase() ? w[0] + w.slice(1).toLowerCase() : w));

  const out = words.slice(0, MAX_WORDS);
  while (out.length > 1 && out.join(' ').length > MAX_CHARS) out.pop();
  const name = out.join(' ').slice(0, MAX_CHARS).trim();
  return name || fallback;
}
