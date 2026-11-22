/** Phones and tablets run a lighter world: mobile browsers kill a tab that uses more than roughly 1–1.5 GB. `?lite=1` forces it on desktop for testing. */
export const LITE = typeof window !== "undefined" && (matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("lite"));
