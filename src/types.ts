export type SkinPreset =
  | 'steve'
  | 'emerald'
  | 'diamond'
  | 'redstone'
  | 'gold'
  | 'obsidian'
  | 'amethyst'
  | 'creeper';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  mcUsername: string;
  skinPreset: SkinPreset;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface JoinedGroup {
  groupId: string;
  groupName: string;
  groupCode: string;
  role: 'owner' | 'member';
  joinedAt?: unknown;
}

export interface GroupData {
  id: string;
  name: string;
  motd: string;
  code: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RosterMember {
  uid: string;
  mcUsername: string;
  skinPreset: SkinPreset;
  role: 'owner' | 'member';
}

export interface OnlineMember {
  uid: string;
  mcUsername: string;
  skinPreset: string;
  role: 'owner' | 'member';
  currentChannelId: string | null;
}

export interface VcParticipant {
  uid: string;
  mcUsername: string;
  skinPreset: string;
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  speaking: boolean;
  joinedAt: number;
}

export interface TemporaryVC {
  id: string;
  groupId: string;
  name: string;
  ownerUid: string;
  ownerMcName: string;
  maxSlots: number;
  isLocked: boolean;
  invitedUids: string[];
  participants: VcParticipant[];
  createdAt: number;
}

export interface GroupRoomState {
  groupId: string;
  onlineMembers: OnlineMember[];
  channels: TemporaryVC[];
}

export interface VcInvite {
  inviteId: string;
  groupId: string;
  groupName: string;
  channelId: string;
  channelName: string;
  fromUid: string;
  fromMcName: string;
  status?: 'pending' | 'accepted' | 'declined';
  createdAt?: unknown;
}
