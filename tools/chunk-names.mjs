// chunk-names.mjs — what an emitted JS file may be CALLED.
//
// WHY. Rollup names a shared chunk after the first module it contains. The
// portal's biggest shared chunk — the Supabase client, auth, everything the
// entry imports statically — came out as `analytics-<hash>.js`, because
// src/js/analytics.js happened to be first. Measured 2026-09-21 on production:
// block that ONE file (what a content blocker does to anything that looks like
// tracking) and the whole portal never starts — the boot watchdog's failure
// bar, every button dead. On any other site a blocked analytics file costs the
// site its analytics; here it cost the site.
//
// So no file we ship may look like a tracker by name. The words below are the
// ones blocklists key on; a chunk carrying one is renamed `core`.
export const TRACKERISH = /analytic|track|telemetry|metric|beacon|pixel|stats?\b|\bads?\b|advert|banner|sponsor|collect|fingerprint/i;

export function safeChunkName(name) {
  return TRACKERISH.test(String(name || '')) ? 'core' : name;
}
