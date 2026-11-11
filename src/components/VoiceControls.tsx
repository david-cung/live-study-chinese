import { useEffect, useState } from 'react';
import type { VoiceSettings, VoiceState } from '../voiceSettings';

export default function VoiceControls({ voice, run }: { voice: VoiceState; run: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [settings, setSettings] = useState(voice.settings);
  const [checking, setChecking] = useState(false);
  useEffect(() => setSettings({ ...voice.settings }), [voice.settings.provider, voice.settings.femaleVoice, voice.settings.maleVoice]);
  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Chưa lưu được cài đặt giọng đọc.');
  };
  return <div className="rounded-lg border border-white/15 bg-white/5 p-3 mb-3">
    <label className="block text-sm font-bold mb-2" htmlFor="voice-provider">Giọng đọc tiếng Việt</label>
    <select id="voice-provider" className="input w-full" value={settings.provider}
      onChange={(e) => setSettings({ ...settings, provider: e.target.value as VoiceSettings['provider'] })}>
      <option value="vieneu">VieNeu · Giọng tự nhiên trên máy</option>
      <option value="edge">Giọng tiêu chuẩn</option>
    </select>
    {settings.provider === 'vieneu' && <>
      <p className={`text-xs leading-relaxed mt-2 ${voice.status === 'ready' ? 'text-[#9fe8b8]' : 'text-[#ffd36b]'}`}>{voice.message}</p>
      {voice.status !== 'ready' && <p className="text-xs text-white/60 mt-1">Mở BAT-GIONG-VIET.bat (Windows) hoặc BAT-GIONG-VIET.command (Mac) trước buổi live.</p>}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {([['femaleVoice', 'Giọng cô giáo'], ['maleVoice', 'Giọng thầy giáo']] as const).map(([key, label]) => <label key={key} className="text-xs text-white/75">
          {label}
          <select aria-label={label} className="input w-full mt-1" value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}>
            <option value="">Tự chọn theo nhân vật</option>
            {!!settings[key] && !voice.voices.some((v) => v.id === settings[key]) && <option value={settings[key]}>{settings[key]}</option>}
            {voice.voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gender ? ` · ${v.gender}` : ''}</option>)}
          </select>
        </label>)}
      </div>
      <button className="btn bg-white/10 w-full mt-2 disabled:opacity-40" disabled={checking} onClick={async () => {
        setChecking(true);
        await run(async () => {
          const response = await fetch('/api/voice?refresh=1');
          if (!response.ok) throw new Error('Không kiểm tra được kết nối.');
          const state: VoiceState = await response.json();
          if (state.status !== 'ready') throw new Error(state.message);
        }, 'Đã kết nối VieNeu và tải danh sách giọng.');
        setChecking(false);
      }}>{checking ? 'Đang kiểm tra…' : '↻ Kiểm tra kết nối / Tải giọng'}</button>
    </>}
    <div className="flex gap-2 mt-2">
      <button className="btn bg-[#3fae6b] flex-1" onClick={() => run(() => post('/api/voice', settings), 'Đã lưu giọng đọc.')}>Lưu giọng</button>
      <button className="btn bg-white/10 flex-1" onClick={() => run(async () => {
        await post('/api/voice', settings);
        await post('/api/control', { action: 'speak', lang: 'vi', text: 'Chào cả lớp! Mình cùng tìm từ khóa và thử một đáp án nhé. Sai cũng không sao, mình cùng học tiếp nha!' });
      }, 'Đã lưu và gửi câu thử sang sân khấu có tiếng.')}>🔊 Lưu & nghe thử</button>
    </div>
    <p className="text-xs text-white/50 mt-2">Giọng đổi theo thầy/cô đã chọn. VieNeu đọc tiếng Việt; phần tiếng Trung dùng giọng Trung. Nếu VieNeu lỗi, lớp tạm dùng giọng dự phòng.</p>
  </div>;
}
