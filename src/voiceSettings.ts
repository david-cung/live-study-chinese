export type VoiceProvider = 'vieneu' | 'edge';
export type VoiceSettings = { provider: VoiceProvider; femaleVoice: string; maleVoice: string };
export type VoiceOption = { id: string; name: string; gender: string };
export type VoiceState = {
  settings: VoiceSettings;
  status: 'unchecked' | 'ready' | 'unavailable';
  voices: VoiceOption[];
  message: string;
  revision: number;
};
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { provider: 'vieneu', femaleVoice: '', maleVoice: '' };
export function validVoiceSettings(raw: unknown): raw is VoiceSettings {
  const value = raw as VoiceSettings | null;
  return !!value && (value.provider === 'vieneu' || value.provider === 'edge') &&
    ['femaleVoice', 'maleVoice'].every((key) => typeof value[key as keyof VoiceSettings] === 'string' &&
      value[key as keyof VoiceSettings].length <= 128 && !/[\x00-\x1f\x7f]/.test(value[key as keyof VoiceSettings]));
}
