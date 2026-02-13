/**
 * Curated model catalog (Option 1: local JSON). Used for "All" and "Recommended" tabs.
 */

import catalogJson from "./modelCatalog.json";

export interface CatalogEntry {
  id: string;
  name: string;
  tags: string[];
  min_ram_gb: number;
  notes: string;
}

export const modelCatalog: CatalogEntry[] = catalogJson as CatalogEntry[];

export const RECOMMENDED_TOOLTIP =
  "Recommended defaults are tested for structured tool-calling + good speed on typical PCs.";

export function isRecommended(entry: CatalogEntry): boolean {
  return entry.tags.includes("recommended");
}

export function isToolReady(entry: CatalogEntry): boolean {
  return entry.tags.includes("tools") || entry.tags.includes("recommended");
}

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return modelCatalog.find((e) => e.id === id);
}
