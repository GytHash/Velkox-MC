import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { GroupRoomState, TemporaryVC, VcInvite } from '../types';
import { playMcInvite, playMcJoin, playMcLeave } from '../utils/mcSound';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

interface UseVoiceEngineParams {
  user: User | null;
  mcUsername: string;
  skinPreset: string;
  activeGroupId: string | null;
  activeGroupRole: 'owner' | 'member';
  activeGroupOwnerId: string;
  onToast: (msg: string, tone?: 'info' | 'error' | 'emerald') => void;
  onLiveInvite: (invite: VcInvite) => void;
}

export function useVoiceEngine({
  user,
  mcUsername,
  skinPreset,
  activeGroupId,
  activeGroupRole,
  activeGroupOwnerId,
  onToast,
  onLiveInvite,
}: UseVoiceEngineParams) {
  const [wsConnected, setWsConnected] = useState(false);
  const [roomState, setRoomState] = useState<GroupRoomState | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [serverMuted, setServerMuted] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [masterVolume, setMasterVolume] = useState(1);

  const wsRef = useRef<WebSocket | null>(null);
  const authedRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserIntervalRef = useRef<number | null>(null);
  const speakingRef = useRef(false);

  const stateRef = useRef({
    uid: user?.uid || '',
    mcUsername,
    skinPreset,
    activeGroupId,
    activeGroupRole,
    activeGroupOwnerId,
    activeChannelId,
    muted,
    deafened,
    serverMuted,
    pushToTalk,
    pttActive,
    masterVolume,
  });

  stateRef.current = {
    uid: user?.uid || '',
    mcUsername,
    skinPreset,
    activeGroupId,
    activeGroupRole,
    activeGroupOwnerId,
    activeChannelId,
    muted,
    deafened,
    serverMuted,
    pushToTalk,
    pttActive,
    masterVolume,
  };

  const sendWs = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
    } catch {
      // ignore
    }
  }, []);

  const stopLocalAudio = useCallback(() => {
    if (analyserIntervalRef.current !== null) {
      window.clearInterval(analyserIntervalRef.current);
      analyserIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setMicLevel(0);
    speakingRef.current = false;
  }, []);

  const cleanupPeerConnections = useCallback(() => {
    for (const pc of peersRef.current.values()) {
      pc.close();
    }
    peersRef.current.clear();

    for (const audioEl of remoteAudiosRef.current.values()) {
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.remove();
    }
    remoteAudiosRef.current.clear();
  }, []);

  // Apply mic track enabled state whenever mute/deafen/serverMute/PTT changes
  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const canTransmit =
      !muted && !deafened && !serverMuted && (!pushToTalk || pttActive);
    stream.getAudioTracks().forEach((track) => {
      track.enabled = canTransmit;
    });
  }, [muted, deafened, serverMuted, pushToTalk, pttActive]);

  // Apply master volume & deafen to remote audio elements
  useEffect(() => {
    for (const audioEl of remoteAudiosRef.current.values()) {
      audioEl.muted = deafened;
      audioEl.volume = masterVolume;
    }
  }, [deafened, masterVolume]);

  // Push-to-Talk keyboard listener (Space or KeyV when not typing in inputs)
  useEffect(() => {
    if (!pushToTalk || !activeChannelId) {
      setPttActive(false);
      return;
    }
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === 'KeyV' || e.code === 'Space') {
        if (e.code === 'Space') e.preventDefault();
        setPttActive(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyV' || e.code === 'Space') {
        setPttActive(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pushToTalk, activeChannelId]);

  const ensureLocalMic = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) return localStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermissionError('Your browser does not support microphone capture.');
      return null;
    }
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedInputId
          ? {
              deviceId: { exact: selectedInputId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
        video: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setMicPermissionError(null);
      refreshDevices();

      const canTransmit =
        !stateRef.current.muted &&
        !stateRef.current.deafened &&
        !stateRef.current.serverMuted &&
        (!stateRef.current.pushToTalk || stateRef.current.pttActive);
      stream.getAudioTracks().forEach((t) => {
        t.enabled = canTransmit;
      });

      // Set up Web Audio Analyser for XP-style mic meter & live speaking indicator
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        analyserIntervalRef.current = window.setInterval(() => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          const level = Math.min(100, Math.round((avg / 64) * 100));
          const isTransmitting =
            !stateRef.current.muted &&
            !stateRef.current.deafened &&
            !stateRef.current.serverMuted &&
            (!stateRef.current.pushToTalk || stateRef.current.pttActive);
          const effectiveLevel = isTransmitting ? level : 0;
          setMicLevel(effectiveLevel);

          const nowSpeaking = isTransmitting && level > 14;
          if (nowSpeaking !== speakingRef.current) {
            speakingRef.current = nowSpeaking;
            if (stateRef.current.activeChannelId) {
              sendWs({
                type: 'vc:voice_state',
                speaking: nowSpeaking,
              });
            }
          }
        }, 120);
      }

      return stream;
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow mic access to transmit voice.'
          : 'Could not access microphone device.';
      setMicPermissionError(msg);
      onToast(msg, 'error');
      return null;
    }
  }, [selectedInputId, refreshDevices, sendWs, onToast]);

  const createPeerConnection = useCallback(
    (peerUid: string, channelId: string, initiator: boolean) => {
      const existing = peersRef.current.get(peerUid);
      if (existing) {
        existing.close();
      }
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peersRef.current.set(peerUid, pc);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendWs({
            type: 'rtc:signal',
            targetUid: peerUid,
            channelId,
            signal: { type: 'ice-candidate', candidate: event.candidate },
          });
        }
      };

      pc.ontrack = (event) => {
        let audioEl = remoteAudiosRef.current.get(peerUid);
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.setAttribute('playsinline', 'true');
          audioEl.muted = stateRef.current.deafened;
          audioEl.volume = stateRef.current.masterVolume;
          document.body.appendChild(audioEl);
          remoteAudiosRef.current.set(peerUid, audioEl);
        }
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          peersRef.current.delete(peerUid);
        }
      };

      if (initiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (pc.localDescription) {
              sendWs({
                type: 'rtc:signal',
                targetUid: peerUid,
                channelId,
                signal: { type: 'offer', sdp: pc.localDescription },
              });
            }
          })
          .catch(() => {});
      }

      return pc;
    },
    [sendWs]
  );

  // Connect WebSocket when user is signed in
  useEffect(() => {
    if (!user) {
      cleanupPeerConnections();
      stopLocalAudio();
      wsRef.current?.close();
      wsRef.current = null;
      authedRef.current = false;
      setWsConnected(false);
      setRoomState(null);
      setActiveChannelId(null);
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | null = null;

    const connect = async () => {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = async () => {
        try {
          const token = await user.getIdToken();
          ws.send(
            JSON.stringify({
              type: 'auth',
              token,
              mcUsername: stateRef.current.mcUsername,
              skinPreset: stateRef.current.skinPreset,
            })
          );
        } catch {
          ws.close();
        }
      };

      ws.onmessage = async (event) => {
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'auth:ok') {
          authedRef.current = true;
          setWsConnected(true);
          if (stateRef.current.activeGroupId) {
            ws.send(
              JSON.stringify({
                type: 'group:subscribe',
                groupId: stateRef.current.activeGroupId,
                role: stateRef.current.activeGroupRole,
                groupOwnerUid: stateRef.current.activeGroupOwnerId,
              })
            );
          }
          return;
        }

        if (msg.type === 'group:state') {
          setRoomState(msg.state as GroupRoomState);
          return;
        }

        if (msg.type === 'vc:joined') {
          setActiveChannelId(msg.channelId);
          setServerMuted(false);
          playMcJoin();
          await ensureLocalMic();
          const peers: { uid: string; mcUsername: string }[] = msg.existingPeers || [];
          for (const peer of peers) {
            const shouldInitiate = stateRef.current.uid < peer.uid;
            createPeerConnection(peer.uid, msg.channelId, shouldInitiate);
          }
          return;
        }

        if (msg.type === 'vc:peer_joined') {
          if (msg.channelId === stateRef.current.activeChannelId) {
            const shouldInitiate = stateRef.current.uid < msg.uid;
            createPeerConnection(msg.uid, msg.channelId, shouldInitiate);
          }
          return;
        }

        if (msg.type === 'vc:peer_left') {
          const pc = peersRef.current.get(msg.uid);
          if (pc) {
            pc.close();
            peersRef.current.delete(msg.uid);
          }
          const audioEl = remoteAudiosRef.current.get(msg.uid);
          if (audioEl) {
            audioEl.pause();
            audioEl.srcObject = null;
            audioEl.remove();
            remoteAudiosRef.current.delete(msg.uid);
          }
          return;
        }

        if (msg.type === 'rtc:signal') {
          const fromUid: string = msg.fromUid;
          const channelId: string = msg.channelId;
          const signal = msg.signal;
          if (!signal || channelId !== stateRef.current.activeChannelId) return;

          let pc = peersRef.current.get(fromUid);
          if (!pc) {
            pc = createPeerConnection(fromUid, channelId, false);
          }

          try {
            if (signal.type === 'offer' && signal.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              sendWs({
                type: 'rtc:signal',
                targetUid: fromUid,
                channelId,
                signal: { type: 'answer', sdp: pc.localDescription },
              });
            } else if (signal.type === 'answer' && signal.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            } else if (signal.type === 'ice-candidate' && signal.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
          } catch {
            // ignore transient signaling race
          }
          return;
        }

        if (msg.type === 'vc:server_muted') {
          setServerMuted(Boolean(msg.serverMuted));
          onToast(
            msg.serverMuted
              ? 'You were server-muted by the VC owner.'
              : 'The VC owner unmuted you.',
            msg.serverMuted ? 'error' : 'emerald'
          );
          return;
        }

        if (msg.type === 'vc:kicked') {
          cleanupPeerConnections();
          stopLocalAudio();
          setActiveChannelId(null);
          setServerMuted(false);
          playMcLeave();
          onToast(`Removed from "${msg.channelName}" by the VC owner.`, 'error');
          return;
        }

        if (msg.type === 'vc:closed') {
          cleanupPeerConnections();
          stopLocalAudio();
          setActiveChannelId(null);
          setServerMuted(false);
          playMcLeave();
          onToast(`Temporary VC "${msg.channelName}" was closed.`, 'info');
          return;
        }

        if (msg.type === 'vc:invite_received' && msg.invite) {
          playMcInvite();
          onLiveInvite(msg.invite as VcInvite);
          return;
        }

        if (msg.type === 'error' && msg.message) {
          onToast(msg.message, 'error');
        }
      };

      ws.onclose = () => {
        authedRef.current = false;
        setWsConnected(false);
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 2200);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      cleanupPeerConnections();
      stopLocalAudio();
      wsRef.current?.close();
    };
  }, [user, cleanupPeerConnections, stopLocalAudio, ensureLocalMic, createPeerConnection, sendWs, onToast, onLiveInvite]);

  // Subscribe to active group whenever it changes
  useEffect(() => {
    if (!authedRef.current || !activeGroupId) return;
    sendWs({
      type: 'group:subscribe',
      groupId: activeGroupId,
      role: activeGroupRole,
      groupOwnerUid: activeGroupOwnerId,
    });
  }, [activeGroupId, activeGroupRole, activeGroupOwnerId, wsConnected, sendWs]);

  // Sync live MC username & skin changes over WS
  useEffect(() => {
    if (!authedRef.current) return;
    sendWs({
      type: 'profile:update',
      mcUsername,
      skinPreset,
    });
  }, [mcUsername, skinPreset, sendWs]);

  const createTemporaryVc = useCallback(
    async (name: string, maxSlots: number, isLocked: boolean) => {
      await ensureLocalMic();
      sendWs({
        type: 'vc:create',
        name,
        maxSlots,
        isLocked,
        muted,
        deafened,
      });
    },
    [ensureLocalMic, sendWs, muted, deafened]
  );

  const joinTemporaryVc = useCallback(
    async (channelId: string) => {
      await ensureLocalMic();
      sendWs({
        type: 'vc:join',
        channelId,
        muted,
        deafened,
      });
    },
    [ensureLocalMic, sendWs, muted, deafened]
  );

  const leaveTemporaryVc = useCallback(() => {
    cleanupPeerConnections();
    stopLocalAudio();
    setActiveChannelId(null);
    setServerMuted(false);
    playMcLeave();
    sendWs({ type: 'vc:leave' });
  }, [cleanupPeerConnections, stopLocalAudio, sendWs]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      sendWs({ type: 'vc:voice_state', muted: next });
      return next;
    });
  }, [sendWs]);

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => {
      const next = !prev;
      sendWs({ type: 'vc:voice_state', deafened: next });
      return next;
    });
  }, [sendWs]);

  const switchAudioInput = useCallback(
    async (deviceId: string) => {
      setSelectedInputId(deviceId);
      if (activeChannelId) {
        stopLocalAudio();
        setTimeout(async () => {
          const stream = await ensureLocalMic();
          if (stream) {
            const newTrack = stream.getAudioTracks()[0];
            if (newTrack) {
              for (const pc of peersRef.current.values()) {
                const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
                if (sender) {
                  sender.replaceTrack(newTrack).catch(() => {});
                }
              }
            }
          }
        }, 80);
      }
    },
    [activeChannelId, stopLocalAudio, ensureLocalMic]
  );

  // VC Owner Actions & Member Invite Action
  const toggleLockVc = useCallback(
    (channelId: string) => sendWs({ type: 'vc:toggle_lock', channelId }),
    [sendWs]
  );
  const renameVc = useCallback(
    (channelId: string, name: string) => sendWs({ type: 'vc:rename', channelId, name }),
    [sendWs]
  );
  const serverMuteParticipant = useCallback(
    (channelId: string, targetUid: string, nextMuted: boolean) =>
      sendWs({ type: 'vc:server_mute', channelId, targetUid, serverMuted: nextMuted }),
    [sendWs]
  );
  const kickParticipant = useCallback(
    (channelId: string, targetUid: string) =>
      sendWs({ type: 'vc:kick', channelId, targetUid }),
    [sendWs]
  );
  const transferVcOwnership = useCallback(
    (channelId: string, targetUid: string) =>
      sendWs({ type: 'vc:transfer_owner', channelId, targetUid }),
    [sendWs]
  );
  const closeVc = useCallback(
    (channelId: string) => sendWs({ type: 'vc:close', channelId }),
    [sendWs]
  );
  const sendWsInvite = useCallback(
    (channelId: string, targetUid: string, groupName: string) =>
      sendWs({ type: 'vc:invite', channelId, targetUid, groupName }),
    [sendWs]
  );

  const activeChannel: TemporaryVC | null =
    roomState?.channels.find((c) => c.id === activeChannelId) || null;

  return {
    wsConnected,
    roomState,
    activeChannelId,
    activeChannel,
    muted,
    deafened,
    serverMuted,
    pushToTalk,
    setPushToTalk,
    pttActive,
    micLevel,
    micPermissionError,
    audioDevices,
    selectedInputId,
    switchAudioInput,
    masterVolume,
    setMasterVolume,
    refreshDevices,
    createTemporaryVc,
    joinTemporaryVc,
    leaveTemporaryVc,
    toggleMute,
    toggleDeafen,
    toggleLockVc,
    renameVc,
    serverMuteParticipant,
    kickParticipant,
    transferVcOwnership,
    closeVc,
    sendWsInvite,
  };
}
