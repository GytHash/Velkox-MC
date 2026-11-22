import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  Check,
  Copy,
  Crown,
  HeadphoneOff,
  Headphones,
  KeyRound,
  Lock,
  LogOut,
  Mic,
  MicOff,
  Pencil,
  PhoneOff,
  Plus,
  Settings,
  Trash2,
  Unlock,
  UserPlus,
  UserX,
  VolumeX,
} from 'lucide-react';
import { auth, googleProvider } from './firebase';
import {
  createGroup,
  deleteGroup,
  dismissVcInvite,
  ensureUserProfile,
  joinGroupByCode,
  leaveGroup,
  sendPersistentVcInvite,
  subscribeGroupDetails,
  subscribeJoinedGroups,
  subscribeVcInvites,
  updateUserProfile,
} from './services/firestoreService';
import {
  GroupData,
  JoinedGroup,
  RosterMember,
  SkinPreset,
  UserProfile,
  VcInvite,
} from './types';
import { useVoiceEngine } from './hooks/useVoiceEngine';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TitleLoginScreen } from './components/TitleLoginScreen';
import { MinecraftAvatar } from './components/MinecraftAvatar';
import {
  CreateGroupModal,
  CreateVcModal,
  InvitePlayersModal,
  JoinGroupModal,
  ProfileSettingsModal,
} from './components/Modals';
import { getMcSfxEnabled, playMcClick, setMcSfxEnabled } from './utils/mcSound';

interface ToastBanner {
  id: string;
  message: string;
  tone: 'info' | 'error' | 'emerald';
}

function VelkoxAppContent() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [joinedGroups, setJoinedGroups] = useState<JoinedGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeGroupData, setActiveGroupData] = useState<GroupData | null>(null);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [firestoreInvites, setFirestoreInvites] = useState<VcInvite[]>([]);
  const [liveInvites, setLiveInvites] = useState<VcInvite[]>([]);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState(false);
  const [showCreateVc, setShowCreateVc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inviteChannelTarget, setInviteChannelTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(getMcSfxEnabled());
  const [toasts, setToasts] = useState<ToastBanner[]>([]);
  const [activeNavTab, setActiveNavTab] = useState<'channels' | 'roster'>('channels');
  const [pendingAutoJoinChannel, setPendingAutoJoinChannel] = useState<string | null>(null);

  const addToast = useCallback(
    (message: string, tone: 'info' | 'error' | 'emerald' = 'info') => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    []
  );

  const handleLiveInvite = useCallback((invite: VcInvite) => {
    setLiveInvites((prev) => {
      const filtered = prev.filter(
        (i) => !(i.channelId === invite.channelId && i.fromUid === invite.fromUid)
      );
      return [invite, ...filtered].slice(0, 6);
    });
  }, []);

  // Auth State Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        try {
          const loaded = await ensureUserProfile(fbUser);
          setProfile(loaded);
        } catch (err) {
          addToast(
            err instanceof Error ? err.message : 'Failed to load profile.',
            'error'
          );
        }
      } else {
        setProfile(null);
        setJoinedGroups([]);
        setActiveGroupId(null);
        setActiveGroupData(null);
        setRoster([]);
        setFirestoreInvites([]);
        setLiveInvites([]);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [addToast]);

  // Subscribe to user's joined groups & incoming persistent invites
  useEffect(() => {
    if (!user) return;
    const unsubGroups = subscribeJoinedGroups(user.uid, (groups) => {
      setJoinedGroups(groups);
      setActiveGroupId((prev) => {
        if (prev && groups.some((g) => g.groupId === prev)) return prev;
        return groups.length > 0 ? groups[0].groupId : null;
      });
    });
    const unsubInvites = subscribeVcInvites(user.uid, (invites) => {
      setFirestoreInvites(invites);
    });
    return () => {
      unsubGroups();
      unsubInvites();
    };
  }, [user]);

  // Subscribe to active group document & non-PII roster
  useEffect(() => {
    if (!user || !activeGroupId) {
      setActiveGroupData(null);
      setRoster([]);
      return;
    }
    return subscribeGroupDetails(activeGroupId, setActiveGroupData, setRoster);
  }, [user, activeGroupId]);

  const activeJoinedMeta = useMemo(
    () => joinedGroups.find((g) => g.groupId === activeGroupId) || null,
    [joinedGroups, activeGroupId]
  );

  const voice = useVoiceEngine({
    user,
    mcUsername: profile?.mcUsername || 'Player',
    skinPreset: profile?.skinPreset || 'steve',
    activeGroupId,
    activeGroupRole: activeJoinedMeta?.role || 'member',
    activeGroupOwnerId: activeGroupData?.ownerId || '',
    onToast: addToast,
    onLiveInvite: handleLiveInvite,
  });

  // Auto-join channel after accepting an invite from another group
  useEffect(() => {
    if (
      pendingAutoJoinChannel &&
      voice.roomState?.groupId === activeGroupId &&
      voice.roomState?.channels.some((c) => c.id === pendingAutoJoinChannel)
    ) {
      const target = pendingAutoJoinChannel;
      setPendingAutoJoinChannel(null);
      voice.joinTemporaryVc(target);
    }
  }, [pendingAutoJoinChannel, voice, activeGroupId]);

  // Keyboard shortcuts for Mute (M) and Deafen (D) when in VC
  useEffect(() => {
    if (!voice.activeChannelId) return;
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyM') {
        playMcClick();
        voice.toggleMute();
      } else if (e.code === 'KeyD') {
        playMcClick();
        voice.toggleDeafen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [voice]);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    playMcClick();
    if (voice.activeChannelId) voice.leaveTemporaryVc();
    await signOut(auth);
  };

  const handleCreateGroup = async (name: string, motd: string) => {
    if (!user || !profile) return;
    const result = await createGroup({
      uid: user.uid,
      mcUsername: profile.mcUsername,
      skinPreset: profile.skinPreset,
      name,
      motd,
    });
    setActiveGroupId(result.groupId);
    addToast(`Group created! Share code: ${result.code}`, 'emerald');
  };

  const handleJoinGroup = async (code: string) => {
    if (!user || !profile) return;
    const result = await joinGroupByCode({
      uid: user.uid,
      mcUsername: profile.mcUsername,
      skinPreset: profile.skinPreset,
      rawCode: code,
    });
    setActiveGroupId(result.groupId);
    addToast(`Joined "${result.groupName}"`, 'emerald');
  };

  const handleCopyGroupCode = async () => {
    if (!activeGroupData?.code) return;
    playMcClick();
    try {
      await navigator.clipboard.writeText(activeGroupData.code);
      setCopiedCode(true);
      addToast(`Copied group code ${activeGroupData.code}`, 'emerald');
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      addToast(`Group code: ${activeGroupData.code}`, 'info');
    }
  };

  const handleInviteMember = async (
    channelId: string,
    channelName: string,
    targetUid: string
  ) => {
    if (!user || !profile || !activeGroupData) return;
    // Instant WebSocket push + unlock access
    voice.sendWsInvite(channelId, targetUid, activeGroupData.name);
    // Persistent Firestore invite record
    try {
      await sendPersistentVcInvite({
        fromUid: user.uid,
        fromMcName: profile.mcUsername,
        targetUid,
        groupId: activeGroupData.id,
        groupName: activeGroupData.name,
        channelId,
        channelName,
      });
      addToast(`Invited player to "${channelName}"`, 'emerald');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Invite sent live, failed to archive.',
        'info'
      );
    }
  };

  // Merge live WebSocket invites + Firestore persistent invites without duplicates
  const mergedInvites = useMemo(() => {
    const map = new Map<string, VcInvite>();
    for (const inv of firestoreInvites) {
      map.set(`${inv.channelId}_${inv.fromUid}`, inv);
    }
    for (const inv of liveInvites) {
      map.set(`${inv.channelId}_${inv.fromUid}`, inv);
    }
    return Array.from(map.values());
  }, [firestoreInvites, liveInvites]);

  const handleAcceptInvite = async (invite: VcInvite) => {
    playMcClick();
    setLiveInvites((prev) => prev.filter((i) => i.channelId !== invite.channelId));
    if (user && !invite.inviteId.startsWith('ws_')) {
      dismissVcInvite(user.uid, invite.inviteId, 'accepted').catch(() => {});
    }
    if (activeGroupId !== invite.groupId) {
      setPendingAutoJoinChannel(invite.channelId);
      setActiveGroupId(invite.groupId);
    } else {
      await voice.joinTemporaryVc(invite.channelId);
    }
  };

  const handleDeclineInvite = async (invite: VcInvite) => {
    playMcClick();
    setLiveInvites((prev) => prev.filter((i) => i.channelId !== invite.channelId));
    if (user && !invite.inviteId.startsWith('ws_')) {
      dismissVcInvite(user.uid, invite.inviteId, 'declined').catch(() => {});
    }
  };

  const onlineUidSet = useMemo(
    () => new Set((voice.roomState?.onlineMembers || []).map((m) => m.uid)),
    [voice.roomState]
  );

  const onlineMemberChannelMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of voice.roomState?.onlineMembers || []) {
      map.set(m.uid, m.currentChannelId);
    }
    return map;
  }, [voice.roomState]);

  if (!authReady) {
    return (
      <div className="min-h-screen mc-deepslate-bg flex items-center justify-center">
        <div className="mc-panel px-8 py-6 text-center space-y-2">
          <div className="font-pixel text-base text-white">Velkox VC</div>
          <div className="text-xs text-[#9AA3B2]">Loading Minecraft voice client...</div>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <TitleLoginScreen
        onSignIn={handleGoogleSignIn}
        signingIn={signingIn}
        error={authError}
      />
    );
  }

  const channels = voice.roomState?.channels || [];
  const activeChannel = voice.activeChannel;
  const xpSegments = 12;
  const activeSegments = Math.round((voice.micLevel / 100) * xpSegments);

  return (
    <div className="min-h-screen mc-deepslate-bg flex flex-col">
      {/* Top Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-[#12151A]/95 border-b-2 border-black px-4 lg:px-8 py-3 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          <img
            src="/src/assets/images/velkox_emblem_1795361100969.jpg"
            alt="Velkox VC"
            referrerPolicy="no-referrer"
            className="w-8 h-8 border-2 border-black object-cover shrink-0"
          />
          <span className="font-pixel text-base text-white whitespace-nowrap shrink-0">
            Velkox VC
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#B8C0CC]">
          <button
            type="button"
            onClick={() => {
              playMcClick();
              setActiveNavTab('channels');
            }}
            className={`whitespace-nowrap shrink-0 cursor-pointer hover:text-white ${
              activeNavTab === 'channels' ? 'text-white underline underline-offset-4' : ''
            }`}
          >
            Voice Channels
          </button>
          <button
            type="button"
            onClick={() => {
              playMcClick();
              setActiveNavTab('roster');
            }}
            className={`whitespace-nowrap shrink-0 cursor-pointer hover:text-white ${
              activeNavTab === 'roster' ? 'text-white underline underline-offset-4' : ''
            }`}
          >
            Group Members ({roster.length})
          </button>
          <button
            type="button"
            onClick={() => {
              playMcClick();
              setShowJoinGroup(true);
            }}
            className="whitespace-nowrap shrink-0 cursor-pointer hover:text-white"
          >
            Join Code
          </button>
          <button
            type="button"
            onClick={() => {
              playMcClick();
              setShowSettings(true);
            }}
            className="whitespace-nowrap shrink-0 cursor-pointer hover:text-white"
          >
            Audio Setup
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              playMcClick();
              setShowSettings(true);
            }}
            className="mc-btn px-3 py-1.5 flex items-center gap-2.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MinecraftAvatar skinPreset={profile.skinPreset} size={20} />
            <span className="max-w-[120px] truncate">{profile.mcUsername}</span>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="mc-btn px-2.5 py-2 flex items-center justify-center cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main 3-Column Minecraft Java Workspace */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 p-4 lg:p-6 pb-28">
        {/* Left Sidebar: Groups (Minecraft Server List Style) */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="mc-panel p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-pixel text-sm text-white">Your Groups</h2>
              <span className="text-xs font-mono-tabular text-[#9AA3B2]">
                {joinedGroups.length}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  playMcClick();
                  setShowCreateGroup(true);
                }}
                className="mc-btn-emerald px-3 py-2 font-pixel text-xs flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Create</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playMcClick();
                  setShowJoinGroup(true);
                }}
                className="mc-btn px-3 py-2 font-pixel text-xs flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span>Join Code</span>
              </button>
            </div>

            <div className="space-y-2">
              {joinedGroups.length === 0 ? (
                <div className="mc-slot p-4 text-xs text-[#9AA3B2] leading-relaxed">
                  No groups yet. Create a new group or join one using an invite code.
                </div>
              ) : (
                joinedGroups.map((grp) => {
                  const isActive = grp.groupId === activeGroupId;
                  return (
                    <button
                      key={grp.groupId}
                      type="button"
                      onClick={() => {
                        playMcClick();
                        if (voice.activeChannelId && activeGroupId !== grp.groupId) {
                          voice.leaveTemporaryVc();
                        }
                        setActiveGroupId(grp.groupId);
                      }}
                      className={`w-full text-left p-3 border-2 transition-colors cursor-pointer ${
                        isActive
                          ? 'border-[#55FF55] bg-[#1A2818]'
                          : 'border-black bg-[#13161B] hover:border-[#6A7385]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-white truncate">
                          {grp.groupName}
                        </span>
                        {grp.role === 'owner' && (
                          <Crown className="w-3.5 h-3.5 text-[#FFAA00] shrink-0" />
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-[#9AA3B2] font-mono-tabular">
                        <span>{grp.groupCode}</span>
                        <span aria-hidden="true">·</span>
                        <span>{grp.role === 'owner' ? 'Owner' : 'Member'}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Pending VC Invites Panel */}
          <div className="mc-panel p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-pixel text-sm text-white">VC Invites</h2>
              <span className="text-xs font-mono-tabular text-[#FFAA00]">
                {mergedInvites.length}
              </span>
            </div>

            {mergedInvites.length === 0 ? (
              <p className="text-xs text-[#8D96A5]">
                Invites from group members to join their temporary VCs appear here.
              </p>
            ) : (
              <div className="space-y-2.5">
                {mergedInvites.map((inv) => (
                  <div key={`${inv.channelId}_${inv.fromUid}`} className="mc-slot p-3 space-y-2.5">
                    <div>
                      <div className="text-xs text-[#FFAA00] font-medium">
                        {inv.fromMcName} invited you
                      </div>
                      <div className="text-sm font-medium text-white truncate mt-0.5">
                        {inv.channelName}
                      </div>
                      <div className="text-xs text-[#9AA3B2] truncate">
                        in {inv.groupName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAcceptInvite(inv)}
                        className="mc-btn-emerald flex-1 py-1.5 font-pixel text-xs cursor-pointer"
                      >
                        Join VC
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeclineInvite(inv)}
                        className="mc-btn px-3 py-1.5 font-pixel text-xs cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Center Main Stage: Active Group & Temporary Voice Channels */}
        <main className="lg:col-span-6 space-y-5">
          {!activeGroupId || !activeGroupData ? (
            <div className="mc-panel p-8 lg:p-10 text-center space-y-6">
              <div className="mx-auto w-14 h-14 border-2 border-black bg-[#1B2219] flex items-center justify-center">
                <Mic className="w-7 h-7 text-[#55FF55]" />
              </div>
              <div className="space-y-2 max-w-md mx-auto">
                <h1 className="font-pixel text-xl text-white">
                  Ready to Voice Chat
                </h1>
                <p className="text-sm text-[#B8C0CC] leading-relaxed">
                  Create a voice group to generate a shareable join code, or enter a
                  friend&apos;s group code to start talking.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    playMcClick();
                    setShowCreateGroup(true);
                  }}
                  className="mc-btn-emerald px-5 py-2.5 font-pixel text-xs cursor-pointer"
                >
                  Create a Group
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playMcClick();
                    setShowJoinGroup(true);
                  }}
                  className="mc-btn px-5 py-2.5 font-pixel text-xs cursor-pointer"
                >
                  Join with Code
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Active Group Header */}
              <section className="mc-panel p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h1 className="font-pixel text-xl text-white truncate">
                        {activeGroupData.name}
                      </h1>
                    </div>
                    <p className="text-sm text-[#A9B2C0]">
                      {activeGroupData.motd || 'Minecraft Java voice chat lobby'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#9AA3B2] pt-1">
                      <span>
                        {activeGroupData.ownerId === user.uid
                          ? 'Group Owner'
                          : 'Group Member'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {voice.roomState?.onlineMembers.length || 1} online
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {channels.length} active VCs
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleCopyGroupCode}
                      className="mc-btn px-3.5 py-2 flex items-center gap-2 font-mono-tabular text-xs cursor-pointer whitespace-nowrap"
                    >
                      {copiedCode ? (
                        <Check className="w-3.5 h-3.5 text-[#55FF55]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>Code: {activeGroupData.code}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        playMcClick();
                        setShowCreateVc(true);
                      }}
                      className="mc-btn-emerald px-4 py-2 font-pixel text-xs flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>New Temp VC</span>
                    </button>

                    {activeGroupData.ownerId === user.uid ? (
                      <button
                        type="button"
                        title="Delete Group"
                        onClick={async () => {
                          playMcClick();
                          if (voice.activeChannelId) voice.leaveTemporaryVc();
                          await deleteGroup(
                            user.uid,
                            activeGroupData.id,
                            activeGroupData.code
                          );
                          addToast('Group deleted.', 'info');
                        }}
                        className="mc-btn-redstone px-3 py-2 flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          playMcClick();
                          if (voice.activeChannelId) voice.leaveTemporaryVc();
                          await leaveGroup(user.uid, activeGroupData.id);
                          addToast('Left group.', 'info');
                        }}
                        className="mc-btn px-3 py-2 text-xs font-pixel cursor-pointer"
                      >
                        Leave
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Temporary Voice Channels List */}
              <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h2 className="font-pixel text-sm text-white">
                    Temporary Voice Channels
                  </h2>
                  <span className="text-xs text-[#9AA3B2]">
                    Anyone in the group can create &amp; own a temporary VC
                  </span>
                </div>

                {channels.length === 0 ? (
                  <div className="mc-panel p-8 text-center space-y-4">
                    <p className="text-sm text-[#B8C0CC]">
                      No temporary voice channels are running right now. Launch one
                      and invite players from your group.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        playMcClick();
                        setShowCreateVc(true);
                      }}
                      className="mc-btn-emerald px-5 py-2.5 font-pixel text-xs cursor-pointer"
                    >
                      Create Temporary VC
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {channels.map((ch) => {
                      const isInside = voice.activeChannelId === ch.id;
                      const isVcOwner = ch.ownerUid === user.uid;
                      const isGroupOwner = activeGroupData.ownerId === user.uid;
                      const canManageVc = isVcOwner || isGroupOwner;
                      const canInviteToVc = isVcOwner || isInside;
                      const isFull =
                        ch.maxSlots > 0 && ch.participants.length >= ch.maxSlots;
                      const isInvited = ch.invitedUids.includes(user.uid);
                      const lockBlocked =
                        ch.isLocked && !isVcOwner && !isGroupOwner && !isInvited;

                      return (
                        <div
                          key={ch.id}
                          className={`mc-panel p-5 space-y-4 ${
                            isInside ? 'ring-2 ring-[#55FF55]' : ''
                          }`}
                        >
                          {/* Channel Header */}
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              {renamingChannelId === ch.id ? (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    playMcClick();
                                    if (renameValue.trim().length >= 2) {
                                      voice.renameVc(ch.id, renameValue.trim());
                                    }
                                    setRenamingChannelId(null);
                                  }}
                                  className="flex items-center gap-2"
                                >
                                  <input
                                    type="text"
                                    maxLength={32}
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    className="mc-input px-2.5 py-1 text-sm"
                                    autoFocus
                                  />
                                  <button
                                    type="submit"
                                    className="mc-btn-emerald px-3 py-1 font-pixel text-xs cursor-pointer"
                                  >
                                    Save
                                  </button>
                                </form>
                              ) : (
                                <div className="flex items-center gap-2">
                                  {ch.isLocked ? (
                                    <Lock className="w-4 h-4 text-[#FFAA00] shrink-0" />
                                  ) : (
                                    <Mic className="w-4 h-4 text-[#55FF55] shrink-0" />
                                  )}
                                  <h3 className="font-pixel text-base text-white truncate">
                                    {ch.name}
                                  </h3>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2 text-xs text-[#9AA3B2]">
                                <span>VC Owner: {ch.ownerMcName}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-tabular">
                                  {ch.participants.length}
                                  {ch.maxSlots > 0 ? ` / ${ch.maxSlots}` : ''} connected
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {ch.isLocked ? 'Invite-Only' : 'Open to Group'}
                                </span>
                              </div>
                            </div>

                            {/* Channel Action Controls */}
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {canInviteToVc && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    playMcClick();
                                    setInviteChannelTarget({
                                      id: ch.id,
                                      name: ch.name,
                                    });
                                  }}
                                  className="mc-btn px-3 py-1.5 font-pixel text-xs flex items-center gap-1.5 cursor-pointer"
                                >
                                  <UserPlus className="w-3.5 h-3.5" />
                                  <span>Invite</span>
                                </button>
                              )}

                              {canManageVc && (
                                <>
                                  <button
                                    type="button"
                                    title={ch.isLocked ? 'Unlock VC' : 'Lock VC'}
                                    onClick={() => {
                                      playMcClick();
                                      voice.toggleLockVc(ch.id);
                                    }}
                                    className="mc-btn px-2.5 py-1.5 flex items-center gap-1 font-pixel text-xs cursor-pointer"
                                  >
                                    {ch.isLocked ? (
                                      <Unlock className="w-3.5 h-3.5 text-[#55FF55]" />
                                    ) : (
                                      <Lock className="w-3.5 h-3.5 text-[#FFAA00]" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    title="Rename VC"
                                    onClick={() => {
                                      playMcClick();
                                      setRenamingChannelId(ch.id);
                                      setRenameValue(ch.name);
                                    }}
                                    className="mc-btn px-2.5 py-1.5 flex items-center justify-center cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Close Temporary VC"
                                    onClick={() => {
                                      playMcClick();
                                      voice.closeVc(ch.id);
                                    }}
                                    className="mc-btn-redstone px-2.5 py-1.5 font-pixel text-xs cursor-pointer"
                                  >
                                    Close
                                  </button>
                                </>
                              )}

                              {isInside ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    playMcClick();
                                    voice.leaveTemporaryVc();
                                  }}
                                  className="mc-btn-redstone px-3.5 py-1.5 font-pixel text-xs cursor-pointer"
                                >
                                  Leave VC
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isFull || lockBlocked}
                                  onClick={() => {
                                    playMcClick();
                                    voice.joinTemporaryVc(ch.id);
                                  }}
                                  className="mc-btn-emerald px-4 py-1.5 font-pixel text-xs cursor-pointer"
                                >
                                  {lockBlocked
                                    ? 'Locked'
                                    : isFull
                                    ? 'Full'
                                    : 'Join VC'}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Connected Players Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                            {ch.participants.map((p) => {
                              const isSelf = p.uid === user.uid;
                              return (
                                <div
                                  key={p.uid}
                                  className="mc-slot p-2.5 flex items-center justify-between gap-2"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <MinecraftAvatar
                                      skinPreset={p.skinPreset}
                                      size={32}
                                      speaking={p.speaking}
                                      muted={p.muted || p.serverMuted}
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm font-medium text-white truncate">
                                          {p.mcUsername}
                                        </span>
                                        {p.uid === ch.ownerUid && (
                                          <Crown
                                            className="w-3.5 h-3.5 text-[#FFAA00] shrink-0"
                                            aria-label="VC Owner"
                                          />
                                        )}
                                      </div>
                                      <div className="text-[11px] text-[#9AA3B2]">
                                        {p.serverMuted
                                          ? 'Server Muted'
                                          : p.deafened
                                          ? 'Deafened'
                                          : p.muted
                                          ? 'Muted'
                                          : p.speaking
                                          ? 'Speaking'
                                          : isSelf
                                          ? 'Connected (You)'
                                          : 'Listening'}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Owner Moderation Actions on Other Participants */}
                                  {canManageVc && !isSelf && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        title={
                                          p.serverMuted
                                            ? 'Unmute Player'
                                            : 'Server Mute Player'
                                        }
                                        onClick={() => {
                                          playMcClick();
                                          voice.serverMuteParticipant(
                                            ch.id,
                                            p.uid,
                                            !p.serverMuted
                                          );
                                        }}
                                        className="mc-btn w-7 h-7 flex items-center justify-center cursor-pointer"
                                      >
                                        <VolumeX
                                          className={`w-3.5 h-3.5 ${
                                            p.serverMuted ? 'text-[#FF5555]' : ''
                                          }`}
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        title="Transfer VC Ownership"
                                        onClick={() => {
                                          playMcClick();
                                          voice.transferVcOwnership(ch.id, p.uid);
                                        }}
                                        className="mc-btn w-7 h-7 flex items-center justify-center cursor-pointer"
                                      >
                                        <Crown className="w-3.5 h-3.5 text-[#FFAA00]" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Kick from VC"
                                        onClick={() => {
                                          playMcClick();
                                          voice.kickParticipant(ch.id, p.uid);
                                        }}
                                        className="mc-btn-redstone w-7 h-7 flex items-center justify-center cursor-pointer"
                                      >
                                        <UserX className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </main>

        {/* Right Panel: Group Roster & Quick Invites */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="mc-panel p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-pixel text-sm text-white">Group Roster</h2>
              <span className="text-xs font-mono-tabular text-[#55FF55]">
                {onlineUidSet.size} online
              </span>
            </div>

            {!activeGroupData ? (
              <p className="text-xs text-[#8D96A5]">
                Select or join a group to see members and invite them to your temporary VCs.
              </p>
            ) : (
              <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                {roster.map((member) => {
                  const isSelf = member.uid === user.uid;
                  const isOnline = onlineUidSet.has(member.uid);
                  const memberChannelId = onlineMemberChannelMap.get(member.uid);
                  const canQuickInvite =
                    !isSelf &&
                    activeChannel &&
                    memberChannelId !== activeChannel.id;

                  return (
                    <div
                      key={member.uid}
                      className="mc-slot p-2.5 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <MinecraftAvatar
                          skinPreset={member.skinPreset}
                          size={30}
                          speaking={false}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-sm font-medium truncate ${
                                isOnline ? 'text-white' : 'text-[#848E9E]'
                              }`}
                            >
                              {member.mcUsername}
                            </span>
                            {member.role === 'owner' && (
                              <Crown className="w-3 h-3 text-[#FFAA00] shrink-0" />
                            )}
                          </div>
                          <div className="text-[11px] text-[#8D96A5]">
                            {isSelf
                              ? 'You'
                              : memberChannelId
                              ? 'In voice chat'
                              : isOnline
                              ? 'Online in lobby'
                              : 'Offline'}
                          </div>
                        </div>
                      </div>

                      {canQuickInvite && (
                        <button
                          type="button"
                          onClick={() => {
                            playMcClick();
                            handleInviteMember(
                              activeChannel.id,
                              activeChannel.name,
                              member.uid
                            );
                          }}
                          className="mc-btn px-2.5 py-1 font-pixel text-[10px] shrink-0 cursor-pointer"
                        >
                          Invite
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom Minecraft Hotbar Voice HUD */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-[#111419]/95 border-t-2 border-black px-4 lg:px-8 py-3">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Connection & XP-Style Mic Meter */}
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <div className="font-pixel text-xs text-white truncate">
                {activeChannel ? activeChannel.name : 'Not Connected to VC'}
              </div>
              <div className="text-xs text-[#9AA3B2] truncate">
                {voice.micPermissionError
                  ? voice.micPermissionError
                  : activeChannel
                  ? voice.pushToTalk
                    ? voice.pttActive
                      ? 'Push-to-Talk transmitting'
                      : 'Hold Space or V to talk'
                    : voice.serverMuted
                    ? 'Server muted by VC owner'
                    : voice.muted
                    ? 'Microphone muted'
                    : 'Voice live'
                  : 'Join or create a temporary VC to talk'}
              </div>
            </div>

            {/* Minecraft Experience Bar Style Input Meter */}
            {activeChannel && (
              <div
                className="hidden sm:flex items-center gap-0.5 bg-black p-1 border border-[#3C424D]"
                title="Microphone input level"
              >
                {Array.from({ length: xpSegments }).map((_, idx) => (
                  <span
                    key={idx}
                    className={`w-2 h-3 ${
                      idx < activeSegments ? 'bg-[#55FF55]' : 'bg-[#1D2229]'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Hotbar Audio Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                playMcClick();
                voice.toggleMute();
              }}
              title="Toggle Mute (M)"
              className={`${
                voice.muted || voice.serverMuted ? 'mc-btn-redstone' : 'mc-btn'
              } px-3.5 py-2 flex items-center gap-2 font-pixel text-xs whitespace-nowrap cursor-pointer`}
            >
              {voice.muted || voice.serverMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4 text-[#55FF55]" />
              )}
              <span>{voice.muted ? 'Unmute' : 'Mute'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                playMcClick();
                voice.toggleDeafen();
              }}
              title="Toggle Deafen (D)"
              className={`${
                voice.deafened ? 'mc-btn-redstone' : 'mc-btn'
              } px-3.5 py-2 flex items-center gap-2 font-pixel text-xs whitespace-nowrap cursor-pointer`}
            >
              {voice.deafened ? (
                <HeadphoneOff className="w-4 h-4" />
              ) : (
                <Headphones className="w-4 h-4 text-[#55FFFF]" />
              )}
              <span>{voice.deafened ? 'Undeafen' : 'Deafen'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                playMcClick();
                setShowSettings(true);
              }}
              title="Audio & Skin Settings"
              className="mc-btn px-3 py-2 flex items-center justify-center cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>

            {activeChannel && (
              <button
                type="button"
                onClick={() => {
                  playMcClick();
                  voice.leaveTemporaryVc();
                }}
                className="mc-btn-redstone px-3.5 py-2 flex items-center gap-2 font-pixel text-xs whitespace-nowrap cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Minecraft Java Advancement-Style Toasts */}
      <div className="fixed top-20 right-4 z-40 space-y-2 max-w-xs w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`mc-panel p-3.5 pointer-events-auto border-2 ${
              t.tone === 'error'
                ? 'border-[#FF5555]'
                : t.tone === 'emerald'
                ? 'border-[#55FF55]'
                : 'border-[#FFAA00]'
            }`}
          >
            <div
              className={`font-pixel text-[11px] mb-0.5 ${
                t.tone === 'error'
                  ? 'text-[#FF5555]'
                  : t.tone === 'emerald'
                  ? 'text-[#55FF55]'
                  : 'text-[#FFAA00]'
              }`}
            >
              {t.tone === 'error' ? 'Notice' : 'Velkox VC'}
            </div>
            <div className="text-xs text-white leading-snug">{t.message}</div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showJoinGroup && (
        <JoinGroupModal
          onClose={() => setShowJoinGroup(false)}
          onJoin={handleJoinGroup}
        />
      )}

      {showCreateVc && (
        <CreateVcModal
          onClose={() => setShowCreateVc(false)}
          onCreateVc={voice.createTemporaryVc}
        />
      )}

      {inviteChannelTarget && activeGroupData && (
        <InvitePlayersModal
          channelName={inviteChannelTarget.name}
          roster={roster}
          onlineUids={onlineUidSet}
          currentParticipantUids={
            new Set(
              (
                channels.find((c) => c.id === inviteChannelTarget.id)
                  ?.participants || []
              ).map((p) => p.uid)
            )
          }
          selfUid={user.uid}
          onInvite={(targetUid) =>
            handleInviteMember(
              inviteChannelTarget.id,
              inviteChannelTarget.name,
              targetUid
            )
          }
          onClose={() => setInviteChannelTarget(null)}
        />
      )}

      {showSettings && (
        <ProfileSettingsModal
          mcUsername={profile.mcUsername}
          skinPreset={profile.skinPreset}
          displayName={profile.displayName}
          audioDevices={voice.audioDevices}
          selectedInputId={voice.selectedInputId}
          pushToTalk={voice.pushToTalk}
          masterVolume={voice.masterVolume}
          sfxEnabled={sfxEnabled}
          onSaveProfile={async (mcName, skin, dispName) => {
            await updateUserProfile(
              user.uid,
              { mcUsername: mcName, skinPreset: skin as SkinPreset, displayName: dispName },
              joinedGroups
            );
            setProfile((prev) =>
              prev ? { ...prev, mcUsername: mcName, skinPreset: skin as SkinPreset } : prev
            );
            addToast('Player profile updated.', 'emerald');
          }}
          onSelectInput={voice.switchAudioInput}
          onTogglePtt={voice.setPushToTalk}
          onChangeVolume={voice.setMasterVolume}
          onToggleSfx={(enabled) => {
            setSfxEnabled(enabled);
            setMcSfxEnabled(enabled);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <VelkoxAppContent />
    </ErrorBoundary>
  );
}
