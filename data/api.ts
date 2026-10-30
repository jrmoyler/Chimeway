import { isSupabaseConfigured } from '../lib/supabase';
import * as local from './localApi';
import * as remote from './remoteApi';

/**
 * The backend the app talks to, chosen once at startup.
 *
 * With Supabase configured, every call goes to the real project. Without it -
 * a deployment with no backend yet - the app runs in local mode against this
 * browser's storage, so it is usable instead of stopping at a setup screen.
 * `localApi` is typed against `remoteApi` here, so the two cannot drift apart.
 */

export { ApiError } from './errors';
export type { ChannelBundle } from './remoteApi';

export const isLocalMode = !isSupabaseConfigured;

const backend: typeof remote = isLocalMode ? local : remote;

export const {
  signUp,
  signIn,
  signOut,
  fetchProfiles,
  updateProfile,
  setStatus,
  fetchWorkspaces,
  createWorkspace,
  fetchChannels,
  createChannel,
  createDm,
  joinChannel,
  markChannelRead,
  fetchUnreadCounts,
  fetchMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  searchMessages,
  signedAttachmentUrl,
  requestAiSummary,
  countRecentAiRequests,
} = backend;
