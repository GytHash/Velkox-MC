import React, { useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { RosterMember, SkinPreset } from '../types';
import { MinecraftAvatar, SKIN_PALETTES } from './MinecraftAvatar';
import { playMcClick } from '../utils/mcSound';

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const ModalShell: React.FC<ModalShellProps> = ({ title, onClose, children }) => (
  <div
    className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
  >
    <div className="mc-panel w-full max-w-md p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
        <h2 className="font-pixel text-base text-white">{title}</h2>
        <button
          type="button"
          onClick={() => {
            playMcClick();
            onClose();
          }}
          aria-label="Close dialog"
          className="mc-btn w-8 h-8 flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export const CreateGroupModal: React.FC<{
  onClose: () => void;
  onCreate: (name: string, motd: string) => Promise<void>;
}> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [motd, setMotd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    playMcClick();
    if (name.trim().length < 2) {
      setError('Group name must be at least 2 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onCreate(name.trim(), motd.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Create Voice Group" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
            Group Name (2–40 chars)
          </label>
          <input
            type="text"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Emerald SMP Squad"
            className="mc-input w-full px-3 py-2.5 text-sm"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
            Server MOTD (Optional)
          </label>
          <input
            type="text"
            maxLength={100}
            value={motd}
            onChange={(e) => setMotd(e.target.value)}
            placeholder="e.g. Survival nights & Bedwars duos"
            className="mc-input w-full px-3 py-2.5 text-sm"
          />
        </div>
        {error && <p className="text-xs text-[#FF6B6B]">{error}</p>}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              playMcClick();
              onClose();
            }}
            className="mc-btn px-4 py-2 font-pixel text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="mc-btn-emerald px-5 py-2 font-pixel text-xs cursor-pointer"
          >
            {loading ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export const JoinGroupModal: React.FC<{
  onClose: () => void;
  onJoin: (code: string) => Promise<void>;
}> = ({ onClose, onJoin }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    playMcClick();
    setLoading(true);
    setError(null);
    try {
      await onJoin(code);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join group.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Join Group by Code" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
            Enter 6-Character Group Code
          </label>
          <input
            type="text"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. VKX492"
            className="mc-input w-full px-3 py-3 text-center font-mono-tabular text-lg tracking-widest uppercase"
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-[#FF6B6B]">{error}</p>}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              playMcClick();
              onClose();
            }}
            className="mc-btn px-4 py-2 font-pixel text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || code.trim().length < 6}
            className="mc-btn-emerald px-5 py-2 font-pixel text-xs cursor-pointer"
          >
            {loading ? 'Joining...' : 'Join Group'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export const CreateVcModal: React.FC<{
  onClose: () => void;
  onCreateVc: (name: string, maxSlots: number, isLocked: boolean) => Promise<void>;
}> = ({ onClose, onCreateVc }) => {
  const [name, setName] = useState('');
  const [maxSlots, setMaxSlots] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    playMcClick();
    if (name.trim().length < 2) {
      setError('Channel name must be at least 2 characters.');
      return;
    }
    await onCreateVc(name.trim(), maxSlots, isLocked);
    onClose();
  };

  return (
    <ModalShell title="New Temporary VC" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
            Voice Channel Name (2–32 chars)
          </label>
          <input
            type="text"
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nether Fortress Raid"
            className="mc-input w-full px-3 py-2.5 text-sm"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
              Player Limit
            </label>
            <select
              value={maxSlots}
              onChange={(e) => setMaxSlots(Number(e.target.value))}
              className="mc-input w-full px-3 py-2.5 text-sm"
            >
              <option value={0}>Unlimited</option>
              <option value={2}>2 Players (Duo)</option>
              <option value={4}>4 Players (Squad)</option>
              <option value={8}>8 Players</option>
              <option value={16}>16 Players</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
              Access Mode
            </label>
            <select
              value={isLocked ? 'locked' : 'open'}
              onChange={(e) => setIsLocked(e.target.value === 'locked')}
              className="mc-input w-full px-3 py-2.5 text-sm"
            >
              <option value="open">Open to Group</option>
              <option value="locked">Invite-Only (Locked)</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-[#9AA3B2] leading-relaxed">
          You become the owner of this temporary VC and can lock it, mute or kick
          players, and invite anyone in the group. It closes automatically when empty.
        </p>

        {error && <p className="text-xs text-[#FF6B6B]">{error}</p>}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              playMcClick();
              onClose();
            }}
            className="mc-btn px-4 py-2 font-pixel text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="mc-btn-emerald px-5 py-2 font-pixel text-xs cursor-pointer"
          >
            Launch VC
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export const InvitePlayersModal: React.FC<{
  channelName: string;
  roster: RosterMember[];
  onlineUids: Set<string>;
  currentParticipantUids: Set<string>;
  selfUid: string;
  onInvite: (targetUid: string) => Promise<void>;
  onClose: () => void;
}> = ({
  channelName,
  roster,
  onlineUids,
  currentParticipantUids,
  selfUid,
  onInvite,
  onClose,
}) => {
  const [invitedSet, setInvitedSet] = useState<Set<string>>(new Set());

  const candidates = roster.filter(
    (m) => m.uid !== selfUid && !currentParticipantUids.has(m.uid)
  );

  return (
    <ModalShell title={`Invite to "${channelName}"`} onClose={onClose}>
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {candidates.length === 0 ? (
          <div className="mc-slot p-4 text-center text-sm text-[#9AA3B2]">
            Everyone in this group is already in your voice channel, or no other
            members have joined the group yet. Share the Group Code to bring friends in.
          </div>
        ) : (
          candidates.map((member) => {
            const isOnline = onlineUids.has(member.uid);
            const sent = invitedSet.has(member.uid);
            return (
              <div
                key={member.uid}
                className="mc-slot p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <MinecraftAvatar skinPreset={member.skinPreset} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {member.mcUsername}
                    </div>
                    <div className="text-xs text-[#9AA3B2]">
                      {isOnline ? 'Online in group' : 'Offline'} ·{' '}
                      {member.role === 'owner' ? 'Group Owner' : 'Member'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={sent}
                  onClick={async () => {
                    playMcClick();
                    setInvitedSet((prev) => new Set(prev).add(member.uid));
                    await onInvite(member.uid);
                  }}
                  className={`${
                    sent ? 'mc-btn' : 'mc-btn-emerald'
                  } px-3 py-1.5 font-pixel text-xs shrink-0 cursor-pointer`}
                >
                  {sent ? 'Invited' : 'Invite'}
                </button>
              </div>
            );
          })
        )}
      </div>
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => {
            playMcClick();
            onClose();
          }}
          className="mc-btn px-4 py-2 font-pixel text-xs cursor-pointer"
        >
          Done
        </button>
      </div>
    </ModalShell>
  );
};

export const ProfileSettingsModal: React.FC<{
  mcUsername: string;
  skinPreset: SkinPreset;
  displayName: string;
  audioDevices: MediaDeviceInfo[];
  selectedInputId: string;
  pushToTalk: boolean;
  masterVolume: number;
  sfxEnabled: boolean;
  onSaveProfile: (mcUsername: string, skinPreset: SkinPreset, displayName: string) => Promise<void>;
  onSelectInput: (deviceId: string) => void;
  onTogglePtt: (enabled: boolean) => void;
  onChangeVolume: (vol: number) => void;
  onToggleSfx: (enabled: boolean) => void;
  onClose: () => void;
}> = ({
  mcUsername,
  skinPreset,
  displayName,
  audioDevices,
  selectedInputId,
  pushToTalk,
  masterVolume,
  sfxEnabled,
  onSaveProfile,
  onSelectInput,
  onTogglePtt,
  onChangeVolume,
  onToggleSfx,
  onClose,
}) => {
  const [nameInput, setNameInput] = useState(mcUsername);
  const [skinInput, setSkinInput] = useState<SkinPreset>(skinPreset);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    playMcClick();
    if (!/^[a-zA-Z0-9_]{2,16}$/.test(nameInput.trim())) {
      setError('Minecraft username must be 2–16 letters, numbers, or underscores.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSaveProfile(nameInput.trim(), skinInput, displayName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Player & Audio Settings" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
            Minecraft Username (2–16 chars, A–Z / 0–9 / _)
          </label>
          <input
            type="text"
            maxLength={16}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="mc-input w-full px-3 py-2 text-sm font-mono-tabular"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#C7CDD6] mb-2">
            Voxel Skin Head
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(SKIN_PALETTES) as SkinPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  playMcClick();
                  setSkinInput(preset);
                }}
                className={`p-2 border-2 flex flex-col items-center gap-1.5 cursor-pointer transition-colors ${
                  skinInput === preset
                    ? 'border-[#55FF55] bg-[#1E2E1A]'
                    : 'border-black bg-[#13161B] hover:border-[#6A7385]'
                }`}
              >
                <MinecraftAvatar skinPreset={preset} size={32} />
                <span className="text-[11px] text-[#D0D6E0] truncate w-full text-center">
                  {preset}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 pt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#C7CDD6] mb-1.5">
              Microphone Input Device
            </label>
            <select
              value={selectedInputId}
              onChange={(e) => onSelectInput(e.target.value)}
              className="mc-input w-full px-3 py-2 text-sm"
            >
              <option value="">Default System Microphone</option>
              {audioDevices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-white">Push-to-Talk (Hold Space or V)</div>
              <div className="text-xs text-[#9AA3B2]">
                Only transmit voice while holding your key
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                playMcClick();
                onTogglePtt(!pushToTalk);
              }}
              className={`${
                pushToTalk ? 'mc-btn-emerald' : 'mc-btn'
              } px-3 py-1.5 font-pixel text-xs cursor-pointer shrink-0`}
            >
              {pushToTalk ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-white">
              <Volume2 className="w-4 h-4 text-[#55FFFF]" />
              <span>Voice Output Volume</span>
            </div>
            <div className="flex items-center gap-2 w-40">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={masterVolume}
                onChange={(e) => onChangeVolume(Number(e.target.value))}
                className="w-full accent-[#55FF55]"
              />
              <span className="text-xs font-mono-tabular w-9 text-right">
                {Math.round(masterVolume * 100)}%
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-white">UI Stone Click Sound FX</div>
            <button
              type="button"
              onClick={() => onToggleSfx(!sfxEnabled)}
              className={`${
                sfxEnabled ? 'mc-btn-emerald' : 'mc-btn'
              } px-3 py-1.5 font-pixel text-xs cursor-pointer shrink-0`}
            >
              {sfxEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-[#FF6B6B]">{error}</p>}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              playMcClick();
              onClose();
            }}
            className="mc-btn px-4 py-2 font-pixel text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="mc-btn-emerald px-5 py-2 font-pixel text-xs cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
