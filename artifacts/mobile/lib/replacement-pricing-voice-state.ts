export function mainReplacementVoiceDisabled(input: {
  searching: boolean;
  processing: boolean;
  requestingPermission: boolean;
  startingRecording: boolean;
  refinementVisible: boolean;
}): boolean {
  return (
    input.searching ||
    input.processing ||
    input.requestingPermission ||
    input.startingRecording ||
    input.refinementVisible
  );
}

export function shouldApplyMainReplacementVoiceResult(input: {
  requestId: number;
  activeRequestId: number;
  refinementVisible: boolean;
  mounted: boolean;
}): boolean {
  return (
    input.mounted &&
    !input.refinementVisible &&
    input.requestId === input.activeRequestId
  );
}
