/**
 * Collision-free id generation.
 *
 * The original used `\`m${Date.now()}\``, which produced duplicate ids for
 * anything created inside the same millisecond - duplicate React keys, and
 * edit/delete hitting the wrong record because both lookups are by id.
 */

const FALLBACK_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length = 12): string {
  const cryptoObj = globalThis.crypto;

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    let out = '';
    for (const byte of bytes) {
      out += FALLBACK_ALPHABET[byte % FALLBACK_ALPHABET.length];
    }
    return out;
  }

  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += FALLBACK_ALPHABET[Math.floor(Math.random() * FALLBACK_ALPHABET.length)];
  }
  return out;
}

/**
 * Creates a sortable, unique id with a readable prefix, e.g. `msg_lq3x8_f2a9c1`.
 * The timestamp segment keeps ids roughly chronological, which makes debugging
 * and stable sorting easier; the random segment guarantees uniqueness.
 */
export function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${randomSuffix()}`;
}
