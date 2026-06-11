export type AudioSettings = {
  microphone: string;
  inputGain: number;
  listenToInput: boolean;
};

export const AUDIO_SETTINGS_KEY = "pitch-pro-settings";

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  microphone: "default",
  inputGain: 12,
  listenToInput: true,
};

export function normalizeAudioSettings(rawSettings: Partial<AudioSettings> | null | undefined): AudioSettings {
  return {
    microphone: typeof rawSettings?.microphone === "string" ? rawSettings.microphone : DEFAULT_AUDIO_SETTINGS.microphone,
    inputGain:
      typeof rawSettings?.inputGain === "number"
        ? Math.min(24, Math.max(0, Math.round(rawSettings.inputGain)))
        : DEFAULT_AUDIO_SETTINGS.inputGain,
    listenToInput:
      typeof rawSettings?.listenToInput === "boolean"
        ? rawSettings.listenToInput
        : DEFAULT_AUDIO_SETTINGS.listenToInput,
  };
}

export function readAudioSettings(storage: Pick<Storage, "getItem"> | null | undefined): AudioSettings {
  if (!storage) {
    return DEFAULT_AUDIO_SETTINGS;
  }

  const storedSettings = storage.getItem(AUDIO_SETTINGS_KEY);
  if (!storedSettings) {
    return DEFAULT_AUDIO_SETTINGS;
  }

  try {
    return normalizeAudioSettings(JSON.parse(storedSettings) as Partial<AudioSettings>);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function saveAudioSettings(storage: Pick<Storage, "setItem"> | null | undefined, settings: AudioSettings) {
  storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
}

export function gainDbToLinear(gainDb: number) {
  return Math.pow(10, gainDb / 20);
}