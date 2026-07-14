export const DEFAULT_SCAN_MODEL = 'gpt-5.6-luna';

export const SCAN_MODES = [
  'single_photo',
  'multi_photo',
  'video_frames',
  'single_item',
] as const;

export type ScanMode = typeof SCAN_MODES[number];

export function resolveScanModel(configuredModel?: string | null): string {
  return configuredModel?.trim() || DEFAULT_SCAN_MODEL;
}

export function scanModelForMode(mode: ScanMode, configuredModel?: string | null): string {
  if (!SCAN_MODES.includes(mode)) {
    throw new Error(`Unsupported scan mode: ${mode}`);
  }
  return resolveScanModel(configuredModel);
}
