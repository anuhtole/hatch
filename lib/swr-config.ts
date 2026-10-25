import useSWR, { SWRConfiguration, preload } from 'swr';

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
};

const base: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 5000,
  errorRetryCount: 2,
  errorRetryInterval: 1500,
};

/** Live data — refetches every 60s (todos, trackers, conversations). */
export function useLiveData<T>(url: string | null, opts?: SWRConfiguration) {
  return useSWR<T>(url, { ...base, refreshInterval: 60_000, ...opts });
}

/** Stable data — only refetches on focus/mount (briefing, stats, assignments). */
export function useStableData<T>(url: string | null, opts?: SWRConfiguration) {
  return useSWR<T>(url, { ...base, refreshInterval: 0, ...opts });
}

/** Static data — never auto-refreshes (accounts, session metadata). */
export function useStaticData<T>(url: string | null, opts?: SWRConfiguration) {
  return useSWR<T>(url, { ...base, revalidateOnFocus: false, refreshInterval: 0, ...opts });
}

/** Preload URLs into the SWR cache (call on nav-item hover). */
export function prefetchUrls(urls: string[]) {
  urls.forEach((url) => preload(url, fetcher));
}
