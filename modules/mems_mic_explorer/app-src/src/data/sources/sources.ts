import type { Source } from "../../types/source";
import { KNOWLES_MM20_SOURCES } from "./knowles-mm20";
import { MEMS_LITERATURE_SOURCES } from "./mems-literature";

export const SOURCES: Source[] = [...KNOWLES_MM20_SOURCES, ...MEMS_LITERATURE_SOURCES];

export const SOURCE_BY_ID: ReadonlyMap<string, Source> = new Map(SOURCES.map((s) => [s.id, s]));

export function getSource(id: string): Source | undefined {
  return SOURCE_BY_ID.get(id);
}
