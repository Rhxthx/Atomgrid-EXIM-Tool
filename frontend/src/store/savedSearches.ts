import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { FilterParams } from "@/types/api";
import type { GroupNode } from "@/types/query";

export interface SavedSearch {
  id: string;
  name: string;
  pathname: string;          // e.g. "/shipments" — for routing back
  filters: FilterParams;
  createdAt: number;
}

export interface BookmarkedEntity {
  id: string;
  kind: "Importer" | "Exporter" | "Supplier" | "Buyer";
  name: string;
  createdAt: number;
}

export interface QueryTemplate {
  id: string;
  name: string;
  where: GroupNode;
  createdAt: number;
}

interface SavedState {
  searches: SavedSearch[];
  bookmarks: BookmarkedEntity[];
  templates: QueryTemplate[];
  saveSearch: (s: Omit<SavedSearch, "id" | "createdAt">) => void;
  removeSearch: (id: string) => void;
  toggleBookmark: (b: Omit<BookmarkedEntity, "id" | "createdAt">) => void;
  isBookmarked: (kind: BookmarkedEntity["kind"], name: string) => boolean;
  saveTemplate: (t: Omit<QueryTemplate, "id" | "createdAt">) => void;
  removeTemplate: (id: string) => void;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useSavedStore = create<SavedState>()(
  persist(
    (set, get) => ({
      searches: [],
      bookmarks: [],
      templates: [],
      saveSearch: (s) =>
        set((st) => ({
          searches: [{ ...s, id: newId(), createdAt: Date.now() }, ...st.searches].slice(0, 50),
        })),
      removeSearch: (id) =>
        set((st) => ({ searches: st.searches.filter((s) => s.id !== id) })),
      toggleBookmark: (b) =>
        set((st) => {
          const exists = st.bookmarks.find(
            (x) => x.kind === b.kind && x.name === b.name
          );
          if (exists) {
            return { bookmarks: st.bookmarks.filter((x) => x.id !== exists.id) };
          }
          return {
            bookmarks: [
              { ...b, id: newId(), createdAt: Date.now() },
              ...st.bookmarks,
            ].slice(0, 200),
          };
        }),
      isBookmarked: (kind, name) =>
        !!get().bookmarks.find((b) => b.kind === kind && b.name === name),
      saveTemplate: (t) =>
        set((st) => ({
          templates: [
            { ...t, id: newId(), createdAt: Date.now() },
            ...st.templates,
          ].slice(0, 50),
        })),
      removeTemplate: (id) =>
        set((st) => ({ templates: st.templates.filter((t) => t.id !== id) })),
    }),
    { name: "exim-saved" }
  )
);
