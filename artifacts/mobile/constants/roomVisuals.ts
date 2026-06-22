import { MaterialCommunityIcons } from "@expo/vector-icons";

type RoomIconName = keyof typeof MaterialCommunityIcons.glyphMap;

const ROOM_ICON_RULES: Array<{ terms: string[]; icon: RoomIconName }> = [
  { terms: ["garage", "carport", "workshop"], icon: "car" },
  { terms: ["bedroom", "master", "guest room", "nursery"], icon: "bed" },
  { terms: ["lounge", "living room", "family room", "media room", "tv room"], icon: "sofa" },
  { terms: ["kitchen", "scullery"], icon: "stove" },
  { terms: ["dining", "breakfast room"], icon: "table-chair" },
  { terms: ["bathroom", "ensuite", "toilet", "washroom"], icon: "shower" },
  { terms: ["office", "study", "workspace"], icon: "desk" },
  { terms: ["laundry", "utility"], icon: "washing-machine" },
  { terms: ["hallway", "entry", "foyer", "landing"], icon: "door" },
  { terms: ["garden", "outdoor", "patio", "deck", "courtyard"], icon: "tree" },
  { terms: ["storage", "closet", "wardrobe", "cupboard"], icon: "archive" },
  { terms: ["attic", "loft"], icon: "home-roof" },
  { terms: ["basement", "cellar"], icon: "home-floor-b" },
  { terms: ["gym", "fitness"], icon: "dumbbell" },
  { terms: ["playroom", "games room"], icon: "toy-brick" },
  { terms: ["shed", "barn"], icon: "barn" },
];

function normaliseRoomLabel(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function getRoomPlaceholderIcon(
  roomType: string | null | undefined,
  roomName: string | null | undefined,
): RoomIconName {
  const context = `${normaliseRoomLabel(roomType)} ${normaliseRoomLabel(roomName)}`.trim();
  return ROOM_ICON_RULES.find((rule) => rule.terms.some((term) => context.includes(term)))?.icon
    ?? "home-outline";
}
