export function replacementVoiceTranscriptToQuery(transcript: string | null | undefined): string {
  return (transcript ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
