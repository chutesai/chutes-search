export const FREE_SEARCH_LIMIT = 3;
export const FREE_SEARCH_STORAGE_KEY = 'chutes_search_free_searches_v1';

export type FreeSearchState = {
  date: string; // YYYY-MM-DD (local time)
  count: number;
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function getLocalDateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function readFreeSearchState(
  storage: StorageLike,
  now: Date = new Date(),
): FreeSearchState {
  const today = getLocalDateKey(now);
  const raw = storage.getItem(FREE_SEARCH_STORAGE_KEY);
  if (!raw) return { date: today, count: 0 };

  try {
    const parsed = JSON.parse(raw) as Partial<FreeSearchState>;
    if (parsed.date !== today) return { date: today, count: 0 };
    const count =
      typeof parsed.count === 'number' && Number.isFinite(parsed.count)
        ? Math.max(0, Math.floor(parsed.count))
        : 0;
    return { date: today, count };
  } catch {
    storage.removeItem(FREE_SEARCH_STORAGE_KEY);
    return { date: today, count: 0 };
  }
}

export function writeFreeSearchState(storage: StorageLike, state: FreeSearchState) {
  storage.setItem(FREE_SEARCH_STORAGE_KEY, JSON.stringify(state));
}

export function incrementFreeSearchState(
  storage: StorageLike,
  now: Date = new Date(),
): FreeSearchState {
  const current = readFreeSearchState(storage, now);
  const next = { ...current, count: current.count + 1 };
  writeFreeSearchState(storage, next);
  return next;
}

export function remainingFreeSearches(state: FreeSearchState): number {
  return Math.max(0, FREE_SEARCH_LIMIT - state.count);
}

