import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  GroupData,
  JoinedGroup,
  RosterMember,
  SkinPreset,
  UserProfile,
  VcInvite,
} from '../types';

const VALID_SKINS: SkinPreset[] = [
  'steve',
  'emerald',
  'diamond',
  'redstone',
  'gold',
  'obsidian',
  'amethyst',
  'creeper',
];

export function sanitizeMcUsername(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
  if (cleaned.length >= 2) return cleaned;
  return 'Builder' + Math.floor(100 + Math.random() * 900);
}

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = `${prefix}_`;
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateGroupCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function ensureUserProfile(firebaseUser: User): Promise<UserProfile> {
  const userPath = `users/${firebaseUser.uid}`;
  const userRef = doc(db, 'users', firebaseUser.uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (snap.exists()) {
    return snap.data() as UserProfile;
  }

  const baseName =
    firebaseUser.displayName ||
    (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Player');
  const mcUsername = sanitizeMcUsername(baseName);
  const displayName = (firebaseUser.displayName || mcUsername).slice(0, 80);
  const email = (firebaseUser.email || 'player@velkox.local').slice(0, 256);

  const profile: UserProfile = {
    uid: firebaseUser.uid,
    email,
    displayName,
    mcUsername,
    skinPreset: 'emerald',
  };

  try {
    await setDoc(userRef, {
      ...profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userPath);
  }

  return profile;
}

export async function updateUserProfile(
  uid: string,
  updates: { mcUsername: string; skinPreset: SkinPreset; displayName: string },
  joinedGroups: JoinedGroup[]
): Promise<void> {
  const safeMcName = sanitizeMcUsername(updates.mcUsername);
  const safeSkin: SkinPreset = VALID_SKINS.includes(updates.skinPreset)
    ? updates.skinPreset
    : 'steve';
  const safeDisplay = updates.displayName.trim().slice(0, 80) || safeMcName;

  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      mcUsername: safeMcName,
      skinPreset: safeSkin,
      displayName: safeDisplay,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }

  // Propagate identity changes to joined groups
  for (const grp of joinedGroups) {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'groups', grp.groupId, 'members', uid), {
        mcUsername: safeMcName,
        skinPreset: safeSkin,
      });
      batch.update(doc(db, 'groups', grp.groupId, 'roster', 'public'), {
        [`members.${uid}`]: {
          uid,
          mcUsername: safeMcName,
          skinPreset: safeSkin,
          role: grp.role,
        },
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch {
      // Non-fatal if user left or group was deleted concurrently
    }
  }
}

export function subscribeJoinedGroups(
  uid: string,
  onChange: (groups: JoinedGroup[]) => void
): Unsubscribe {
  const path = `users/${uid}/joinedGroups`;
  const q = query(collection(db, 'users', uid, 'joinedGroups'), orderBy('joinedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: JoinedGroup[] = snapshot.docs.map((d) => d.data() as JoinedGroup);
      onChange(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeGroupDetails(
  groupId: string,
  onGroup: (group: GroupData | null) => void,
  onRoster: (members: RosterMember[]) => void
): Unsubscribe {
  const groupPath = `groups/${groupId}`;
  const rosterPath = `groups/${groupId}/roster/public`;

  const unsubGroup = onSnapshot(
    doc(db, 'groups', groupId),
    (snap) => {
      onGroup(snap.exists() ? (snap.data() as GroupData) : null);
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, groupPath);
    }
  );

  const unsubRoster = onSnapshot(
    doc(db, 'groups', groupId, 'roster', 'public'),
    (snap) => {
      if (!snap.exists()) {
        onRoster([]);
        return;
      }
      const data = snap.data() as { members?: Record<string, RosterMember> };
      const list = Object.values(data.members || {}).sort((a, b) => {
        if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
        return a.mcUsername.localeCompare(b.mcUsername);
      });
      onRoster(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, rosterPath);
    }
  );

  return () => {
    unsubGroup();
    unsubRoster();
  };
}

export async function createGroup(params: {
  uid: string;
  mcUsername: string;
  skinPreset: SkinPreset;
  name: string;
  motd: string;
}): Promise<{ groupId: string; code: string }> {
  const groupName = params.name.trim().slice(0, 40);
  if (groupName.length < 2) {
    throw new Error('Group name must be at least 2 characters.');
  }
  const motd = params.motd.trim().slice(0, 100);
  const groupId = generateId('grp');

  // Generate an unused 6-character code
  let code = generateGroupCode();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const existingCode = await getDoc(doc(db, 'groupCodes', code));
      if (!existingCode.exists()) break;
      code = generateGroupCode();
    } catch {
      break;
    }
  }

  const batch = writeBatch(db);
  batch.set(doc(db, 'groupCodes', code), {
    code,
    groupId,
    groupName,
    ownerId: params.uid,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'groups', groupId), {
    id: groupId,
    name: groupName,
    motd,
    code,
    ownerId: params.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'groups', groupId, 'members', params.uid), {
    uid: params.uid,
    mcUsername: params.mcUsername,
    skinPreset: params.skinPreset,
    role: 'owner',
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'groups', groupId, 'roster', 'public'), {
    groupId,
    members: {
      [params.uid]: {
        uid: params.uid,
        mcUsername: params.mcUsername,
        skinPreset: params.skinPreset,
        role: 'owner',
      },
    },
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', params.uid, 'joinedGroups', groupId), {
    groupId,
    groupName,
    groupCode: code,
    role: 'owner',
    joinedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `groups/${groupId}`);
  }

  return { groupId, code };
}

export async function joinGroupByCode(params: {
  uid: string;
  mcUsername: string;
  skinPreset: SkinPreset;
  rawCode: string;
}): Promise<{ groupId: string; groupName: string }> {
  const code = params.rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6,8}$/.test(code)) {
    throw new Error('Enter a valid 6–8 character group code.');
  }

  let codeSnap;
  try {
    codeSnap = await getDoc(doc(db, 'groupCodes', code));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `groupCodes/${code}`);
  }

  if (!codeSnap.exists()) {
    throw new Error(`No group found for code "${code}".`);
  }

  const lookup = codeSnap.data() as {
    groupId: string;
    groupName: string;
    ownerId: string;
  };

  // Check if user is already a member
  let memberSnap;
  try {
    memberSnap = await getDoc(doc(db, 'groups', lookup.groupId, 'members', params.uid));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.GET,
      `groups/${lookup.groupId}/members/${params.uid}`
    );
  }

  if (memberSnap.exists()) {
    return { groupId: lookup.groupId, groupName: lookup.groupName };
  }

  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', lookup.groupId, 'members', params.uid), {
    uid: params.uid,
    mcUsername: params.mcUsername,
    skinPreset: params.skinPreset,
    role: 'member',
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', params.uid, 'joinedGroups', lookup.groupId), {
    groupId: lookup.groupId,
    groupName: lookup.groupName,
    groupCode: code,
    role: 'member',
    joinedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'groups', lookup.groupId, 'roster', 'public'), {
    [`members.${params.uid}`]: {
      uid: params.uid,
      mcUsername: params.mcUsername,
      skinPreset: params.skinPreset,
      role: 'member',
    },
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `groups/${lookup.groupId}`);
  }

  return { groupId: lookup.groupId, groupName: lookup.groupName };
}

export async function leaveGroup(uid: string, groupId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'groups', groupId, 'roster', 'public'), {
    [`members.${uid}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
  batch.delete(doc(db, 'groups', groupId, 'members', uid));
  batch.delete(doc(db, 'users', uid, 'joinedGroups', groupId));

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `groups/${groupId}/members/${uid}`);
  }
}

export async function deleteGroup(uid: string, groupId: string, code: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', uid, 'joinedGroups', groupId));
    await deleteDoc(doc(db, 'groups', groupId, 'roster', 'public'));
    await deleteDoc(doc(db, 'groups', groupId, 'members', uid));
    await deleteDoc(doc(db, 'groupCodes', code));
    await deleteDoc(doc(db, 'groups', groupId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `groups/${groupId}`);
  }
}

export async function sendPersistentVcInvite(params: {
  fromUid: string;
  fromMcName: string;
  targetUid: string;
  groupId: string;
  groupName: string;
  channelId: string;
  channelName: string;
}): Promise<void> {
  const inviteId = generateId('inv');
  const path = `users/${params.targetUid}/vcInvites/${inviteId}`;
  try {
    await setDoc(doc(db, 'users', params.targetUid, 'vcInvites', inviteId), {
      inviteId,
      groupId: params.groupId,
      groupName: params.groupName.slice(0, 40),
      channelId: params.channelId,
      channelName: params.channelName.slice(0, 32),
      fromUid: params.fromUid,
      fromMcName: params.fromMcName,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeVcInvites(
  uid: string,
  onChange: (invites: VcInvite[]) => void
): Unsubscribe {
  const path = `users/${uid}/vcInvites`;
  const q = query(collection(db, 'users', uid, 'vcInvites'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as VcInvite)
        .filter((inv) => inv.status === 'pending');
      onChange(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function dismissVcInvite(
  uid: string,
  inviteId: string,
  status: 'accepted' | 'declined'
): Promise<void> {
  const path = `users/${uid}/vcInvites/${inviteId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'vcInvites', inviteId), { status });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
