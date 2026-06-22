export type CoverageTone = "comfortable" | "moderate" | "approaching" | "over";

export interface CoverageInsight {
  hasCover: boolean;
  coverAmount: number | null;
  contentsValue: number;
  percent: number | null;
  remainingAmount: number;
  overAmount: number;
  tone: CoverageTone | "unset";
  color: string | null;
  statusLabel: string;
}

export function getCoverageColor(percent: number): string {
  if (percent >= 100) return "#EF4444";
  if (percent >= 75) return "#F97316";
  return "#22C55E";
}

export function getCoverageTone(percent: number): CoverageTone {
  if (percent >= 100) return "over";
  if (percent >= 90) return "approaching";
  if (percent >= 70) return "moderate";
  return "comfortable";
}

export function getCoverageStatusLabel(percent: number): string {
  const tone = getCoverageTone(percent);
  if (tone === "over") return "Recorded cover value reached — review with your insurer";
  if (tone === "approaching") return "Approaching recorded cover value";
  if (tone === "moderate") return "Moderate usage of recorded cover";
  return `${Math.round(percent)}% of recorded cover value`;
}

export function calculateCoverageInsight(
  contentsValue: number,
  coverAmount: number | null | undefined,
): CoverageInsight {
  const safeContentsValue = Number.isFinite(contentsValue) ? Math.max(contentsValue, 0) : 0;
  if (coverAmount == null || !Number.isFinite(coverAmount) || coverAmount <= 0) {
    return {
      hasCover: false,
      coverAmount: null,
      contentsValue: safeContentsValue,
      percent: null,
      remainingAmount: 0,
      overAmount: 0,
      tone: "unset",
      color: null,
      statusLabel: "Cover not set",
    };
  }

  const percent = (safeContentsValue / coverAmount) * 100;
  return {
    hasCover: true,
    coverAmount,
    contentsValue: safeContentsValue,
    percent,
    remainingAmount: Math.max(coverAmount - safeContentsValue, 0),
    overAmount: Math.max(safeContentsValue - coverAmount, 0),
    tone: getCoverageTone(percent),
    color: getCoverageColor(percent),
    statusLabel: getCoverageStatusLabel(percent),
  };
}
