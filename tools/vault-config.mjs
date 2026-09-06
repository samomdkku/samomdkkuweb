// ============================================================
// vault-config.mjs — where SAMO's vault is, and what the env item is called.
//
// ONE HOME. The address appears in `skills/vaultwarden.md`, in nginx, and in
// two contributor-facing docs; a fourth copy typed into a tool is how a
// decaying fact becomes a bug (`.claude/rules/mistakes.md` class 6).
// `src/js/env-pull.test.js` asserts this file and the skill still agree.
//
// Not a secret: it is a path on the public site, and the vault publishes it
// itself at `/vault/api/config`. It lives here so nothing points at the wrong
// server, not to hide it.
// ============================================================

/**
 * ⚠️ NO TRAILING SLASH. The Bitwarden CLI stores this as `base` and derives
 * `<base>/api` and `<base>/identity` from it — which is exactly what Vaultwarden
 * serves here, verified against the live `/vault/api/config`. A trailing slash
 * produces `//api` and a confusing 404.
 */
export const VAULT_URL = 'https://samo.md.kku.ac.th/vault';

/**
 * The vault item whose **Notes** field holds the block `npm run env:share`
 * prints. One item, not one per value — whoever maintains it edits it in a
 * phone app, and anything cleverer is something to get wrong at 11pm.
 *
 * It belongs to the `Dev` collection. ⛔ NEVER `Infra`, which holds
 * production and this VM's own sudo password.
 */
export const VAULT_ITEM = 'samo-dev env';
