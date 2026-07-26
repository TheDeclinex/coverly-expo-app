export type VideoRecordingStopReason = "manual" | "maximum-duration" | "cancel";

interface ActiveVideoRecordingSession {
  id: number;
  stopReason: VideoRecordingStopReason | null;
}

export interface VideoRecordingSessionGate {
  begin: () => number;
  requestStop: (sessionId: number, reason: VideoRecordingStopReason) => boolean;
  complete: (sessionId: number) => boolean;
  cancel: (sessionId: number) => boolean;
  isCurrent: (sessionId: number) => boolean;
}

/**
 * Coordinates native recording completion with manual, automatic, and
 * cancellation paths. The first stop request wins synchronously, while a
 * cancelled or superseded session can never deliver a late video result.
 */
export function createVideoRecordingSessionGate(): VideoRecordingSessionGate {
  let nextSessionId = 0;
  let active: ActiveVideoRecordingSession | null = null;

  return {
    begin() {
      nextSessionId += 1;
      active = { id: nextSessionId, stopReason: null };
      return nextSessionId;
    },
    requestStop(sessionId, reason) {
      if (!active || active.id !== sessionId || active.stopReason !== null) return false;
      active.stopReason = reason;
      return true;
    },
    complete(sessionId) {
      if (!active || active.id !== sessionId || active.stopReason === "cancel") return false;
      active = null;
      return true;
    },
    cancel(sessionId) {
      if (!active || active.id !== sessionId) return false;
      active = null;
      return true;
    },
    isCurrent(sessionId) {
      return active?.id === sessionId;
    },
  };
}
