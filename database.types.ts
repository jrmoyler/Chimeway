/**
 * Database row shapes.
 *
 * Hand-written to mirror supabase/migrations exactly. `npm run db:types`
 * regenerates this from a live database when the schema changes; the
 * generated output is checked against these names by the type checker, so a
 * migration that renames a column breaks the build rather than failing at
 * runtime.
 *
 * Row shapes are `type` aliases rather than `interface` declarations on
 * purpose. An interface carries no implicit index signature, so it is not
 * assignable to `Record<string, unknown>` - the constraint supabase-js applies
 * to every table. Declaring them as interfaces makes the whole schema fail
 * that constraint, which silently degrades every query's types to `never`
 * instead of producing an error that points at the cause.
 */

export type ChannelType = 'public' | 'private' | 'dm';
export type UserStatusValue = 'active' | 'idle' | 'dnd' | 'away' | 'offline';
export type MemberRole = 'owner' | 'admin' | 'member';

export type ProfileRow = {
  id: string;
  full_name: string;
  display_name: string;
  title: string;
  avatar_url: string | null;
  status: UserStatusValue;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRow = {
  id: string;
  name: string;
  initials: string;
  color: string;
  created_by: string;
  created_at: string;
};

export type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
};

export type ChannelRow = {
  id: string;
  workspace_id: string;
  type: ChannelType;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
};

export type ChannelMemberRow = {
  channel_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string;
};

export type MessageRow = {
  id: string;
  channel_id: string;
  parent_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

export type MessageReactionRow = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type AttachmentRow = {
  id: string;
  message_id: string;
  storage_path: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type UnreadCountRow = {
  channel_id: string;
  unread_count: number;
  has_mention: boolean;
};

export type SearchMessageRow = {
  id: string;
  channel_id: string;
  parent_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
  rank: number;
};

export type AiRequestRow = {
  id: string;
  user_id: string;
  kind: string;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string; display_name: string };
        Update: Partial<Omit<ProfileRow, 'id'>>;
        Relationships: [];
      };
      workspaces: {
        Row: WorkspaceRow;
        Insert: Omit<WorkspaceRow, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<WorkspaceRow, 'id'>>;
        Relationships: [];
      };
      workspace_members: {
        Row: WorkspaceMemberRow;
        Insert: Omit<WorkspaceMemberRow, 'joined_at' | 'role'> & {
          joined_at?: string;
          role?: MemberRole;
        };
        Update: Partial<WorkspaceMemberRow>;
        Relationships: [];
      };
      channels: {
        Row: ChannelRow;
        Insert: Omit<ChannelRow, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<ChannelRow, 'id'>>;
        Relationships: [];
      };
      channel_members: {
        Row: ChannelMemberRow;
        Insert: Omit<ChannelMemberRow, 'joined_at' | 'last_read_at'> & {
          joined_at?: string;
          last_read_at?: string;
        };
        Update: Partial<Pick<ChannelMemberRow, 'last_read_at'>>;
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: Omit<MessageRow, 'id' | 'created_at' | 'edited_at'> & {
          id?: string;
          created_at?: string;
        };
        // Only the body is client-editable; edited_at is set by a trigger.
        Update: Partial<Pick<MessageRow, 'body'>>;
        Relationships: [];
      };
      message_reactions: {
        Row: MessageReactionRow;
        Insert: Omit<MessageReactionRow, 'created_at'> & { created_at?: string };
        Update: Partial<MessageReactionRow>;
        Relationships: [];
      };
      attachments: {
        Row: AttachmentRow;
        Insert: Omit<AttachmentRow, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<AttachmentRow>;
        Relationships: [];
      };
      ai_requests: {
        Row: AiRequestRow;
        Insert: Omit<AiRequestRow, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<AiRequestRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_workspace: {
        Args: { p_name: string; p_initials?: string | null; p_color?: string };
        Returns: WorkspaceRow;
      };
      create_channel: {
        Args: {
          p_workspace_id: string;
          p_name: string;
          p_type?: ChannelType;
          p_description?: string;
        };
        Returns: ChannelRow;
      };
      create_dm: {
        Args: { p_workspace_id: string; p_user_ids: string[] };
        Returns: ChannelRow;
      };
      toggle_reaction: { Args: { p_message_id: string; p_emoji: string }; Returns: boolean };
      mark_channel_read: { Args: { p_channel_id: string }; Returns: undefined };
      unread_counts: { Args: { p_workspace_id: string }; Returns: UnreadCountRow[] };
      search_messages: {
        Args: { p_workspace_id: string; p_query: string; p_limit?: number };
        Returns: SearchMessageRow[];
      };
      record_ai_request: { Args: { p_kind: string }; Returns: number };
      send_message: {
        Args: {
          p_channel_id: string;
          p_body: string;
          p_parent_id?: string | null;
          p_attachments?: unknown;
        };
        Returns: MessageRow;
      };
    };
    Enums: {
      channel_type: ChannelType;
      user_status: UserStatusValue;
      member_role: MemberRole;
    };
    CompositeTypes: Record<string, never>;
  };
}
