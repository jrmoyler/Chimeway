/**
 * Shared limits.
 *
 * These mirror constraints enforced in the database (`attachments_size_limit`,
 * `messages_body_len`). The server is authoritative - it rejects oversized
 * input regardless of the client - but the UI needs the same numbers to warn
 * before a round trip rather than after one.
 *
 * supabase/tests/contract.test.ts asserts these stay in step with the schema.
 */

/** Maximum size of a single attachment. Matches `attachments_size_limit`. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Maximum characters in a message body. Matches `messages_body_len`. */
export const MAX_MESSAGE_LENGTH = 4000;
