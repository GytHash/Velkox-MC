import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load firebase-applet-config.json for projectId (verifyIdToken requires no IAM)
const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
let firebaseProjectId = '';
if (fs.existsSync(firebaseConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
  firebaseProjectId = cfg.projectId || '';
}

const adminApp = getApps().length
  ? getApp()
  : initializeApp(firebaseProjectId ? { projectId: firebaseProjectId } : undefined);
const adminAuth = getAuth(adminApp);

const PORT = Number(process.env.PORT) || 3000;

interface OnlineMember {
  uid: string;
  mcUsername: string;
  skinPreset: string;
  role: 'owner' | 'member';
  currentChannelId: string | null;
}

interface VcParticipant {
  uid: string;
  mcUsername: string;
  skinPreset: string;
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  speaking: boolean;
  joinedAt: number;
}

interface TemporaryVC {
  id: string;
  groupId: string;
  name: string;
  ownerUid: string;
  ownerMcName: string;
  maxSlots: number; // 0 = unlimited
  isLocked: boolean;
  invitedUids: Set<string>;
  participants: Map<string, VcParticipant>;
  createdAt: number;
}

interface GroupRoom {
  groupId: string;
  groupOwnerUid: string;
  onlineMembers: Map<string, OnlineMember>;
  channels: Map<string, TemporaryVC>;
}

interface ClientSession {
  ws: WebSocket;
  uid: string | null;
  mcUsername: string;
  skinPreset: string;
  groupId: string | null;
  channelId: string | null;
}

const groups = new Map<string, GroupRoom>();
const userSockets = new Map<string, Set<ClientSession>>();

function getOrCreateGroupRoom(groupId: string, groupOwnerUid = ''): GroupRoom {
  let room = groups.get(groupId);
  if (!room) {
    room = {
      groupId,
      groupOwnerUid,
      onlineMembers: new Map(),
      channels: new Map(),
    };
    groups.set(groupId, room);
  } else if (groupOwnerUid && !room.groupOwnerUid) {
    room.groupOwnerUid = groupOwnerUid;
  }
  return room;
}

function serializeGroupRoom(room: GroupRoom) {
  return {
    groupId: room.groupId,
    onlineMembers: Array.from(room.onlineMembers.values()),
    channels: Array.from(room.channels.values()).map((ch) => ({
      id: ch.id,
      groupId: ch.groupId,
      name: ch.name,
      ownerUid: ch.ownerUid,
      ownerMcName: ch.ownerMcName,
      maxSlots: ch.maxSlots,
      isLocked: ch.isLocked,
      invitedUids: Array.from(ch.invitedUids),
      participants: Array.from(ch.participants.values()),
      createdAt: ch.createdAt,
    })),
  };
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToGroup(groupId: string, payload: unknown) {
  const room = groups.get(groupId);
  if (!room) return;
  for (const uid of room.onlineMembers.keys()) {
    const sessions = userSockets.get(uid);
    if (!sessions) continue;
    for (const s of sessions) {
      if (s.groupId === groupId) {
        sendJson(s.ws, payload);
      }
    }
  }
}

function sendToUser(uid: string, payload: unknown) {
  const sessions = userSockets.get(uid);
  if (!sessions) return;
  for (const s of sessions) {
    sendJson(s.ws, payload);
  }
}

function removeFromCurrentChannel(session: ClientSession) {
  if (!session.uid || !session.groupId || !session.channelId) return;
  const room = groups.get(session.groupId);
  if (!room) {
    session.channelId = null;
    return;
  }

  const channel = room.channels.get(session.channelId);
  if (channel) {
    channel.participants.delete(session.uid);
    // Notify peers in that channel so WebRTC peer connections tear down cleanly
    for (const participant of channel.participants.values()) {
      sendToUser(participant.uid, {
        type: 'vc:peer_left',
        channelId: channel.id,
        uid: session.uid,
      });
    }

    // If empty, auto-destroy temporary VC
    if (channel.participants.size === 0) {
      room.channels.delete(channel.id);
    } else if (channel.ownerUid === session.uid) {
      // Transfer VC ownership to earliest remaining participant
      const nextOwner = Array.from(channel.participants.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      )[0];
      if (nextOwner) {
        channel.ownerUid = nextOwner.uid;
        channel.ownerMcName = nextOwner.mcUsername;
      }
    }
  }

  const member = room.onlineMembers.get(session.uid);
  if (member) {
    member.currentChannelId = null;
  }

  const oldGroupId = session.groupId;
  session.channelId = null;

  broadcastToGroup(oldGroupId, {
    type: 'group:state',
    state: serializeGroupRoom(room),
  });
}

function leaveCurrentGroup(session: ClientSession) {
  removeFromCurrentChannel(session);
  if (!session.uid || !session.groupId) return;

  const room = groups.get(session.groupId);
  if (room) {
    // Only remove from onlineMembers if user has no other active socket in this group
    const sessions = userSockets.get(session.uid);
    const hasAnotherSessionInGroup =
      sessions &&
      Array.from(sessions).some((s) => s !== session && s.groupId === session.groupId);

    if (!hasAnotherSessionInGroup) {
      room.onlineMembers.delete(session.uid);
    }

    broadcastToGroup(session.groupId, {
      type: 'group:state',
      state: serializeGroupRoom(room),
    });
  }
  session.groupId = null;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'velkox-vc' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const session: ClientSession = {
      ws,
      uid: null,
      mcUsername: 'Player',
      skinPreset: 'steve',
      groupId: null,
      channelId: null,
    };

    ws.on('message', async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!msg || typeof msg.type !== 'string') return;

      // 1. Authenticate session using real Firebase ID Token
      if (msg.type === 'auth') {
        try {
          if (typeof msg.token !== 'string' || !msg.token) {
            sendJson(ws, { type: 'error', message: 'Missing authentication token.' });
            return;
          }
          const decoded = await adminAuth.verifyIdToken(msg.token);
          session.uid = decoded.uid;
          session.mcUsername =
            typeof msg.mcUsername === 'string' && /^[a-zA-Z0-9_]{2,16}$/.test(msg.mcUsername)
              ? msg.mcUsername
              : 'Player';
          session.skinPreset =
            typeof msg.skinPreset === 'string' ? msg.skinPreset : 'steve';

          let set = userSockets.get(decoded.uid);
          if (!set) {
            set = new Set();
            userSockets.set(decoded.uid, set);
          }
          set.add(session);

          sendJson(ws, { type: 'auth:ok', uid: decoded.uid });
        } catch (err) {
          sendJson(ws, { type: 'error', message: 'Authentication verification failed.' });
        }
        return;
      }

      if (!session.uid) {
        sendJson(ws, { type: 'error', message: 'Authenticate before sending room commands.' });
        return;
      }

      // 2. Update profile metadata live
      if (msg.type === 'profile:update') {
        if (typeof msg.mcUsername === 'string' && /^[a-zA-Z0-9_]{2,16}$/.test(msg.mcUsername)) {
          session.mcUsername = msg.mcUsername;
        }
        if (typeof msg.skinPreset === 'string') {
          session.skinPreset = msg.skinPreset;
        }
        if (session.groupId) {
          const room = groups.get(session.groupId);
          if (room) {
            const member = room.onlineMembers.get(session.uid);
            if (member) {
              member.mcUsername = session.mcUsername;
              member.skinPreset = session.skinPreset;
            }
            if (session.channelId) {
              const ch = room.channels.get(session.channelId);
              const p = ch?.participants.get(session.uid);
              if (p) {
                p.mcUsername = session.mcUsername;
                p.skinPreset = session.skinPreset;
              }
              if (ch && ch.ownerUid === session.uid) {
                ch.ownerMcName = session.mcUsername;
              }
            }
            broadcastToGroup(session.groupId, {
              type: 'group:state',
              state: serializeGroupRoom(room),
            });
          }
        }
        return;
      }

      // 3. Subscribe / enter a Group workspace
      if (msg.type === 'group:subscribe') {
        const groupId = typeof msg.groupId === 'string' ? msg.groupId : '';
        if (!groupId || !/^[a-zA-Z0-9_-]{1,64}$/.test(groupId)) return;

        if (session.groupId && session.groupId !== groupId) {
          leaveCurrentGroup(session);
        }

        const role = msg.role === 'owner' ? 'owner' : 'member';
        const groupOwnerUid = role === 'owner' ? session.uid : (typeof msg.groupOwnerUid === 'string' ? msg.groupOwnerUid : '');
        const room = getOrCreateGroupRoom(groupId, groupOwnerUid);

        session.groupId = groupId;
        room.onlineMembers.set(session.uid, {
          uid: session.uid,
          mcUsername: session.mcUsername,
          skinPreset: session.skinPreset,
          role,
          currentChannelId: session.channelId,
        });

        broadcastToGroup(groupId, {
          type: 'group:state',
          state: serializeGroupRoom(room),
        });
        return;
      }

      // 4. Create a Temporary Voice Channel (any group member can create & own one!)
      if (msg.type === 'vc:create') {
        if (!session.groupId) return;
        const room = groups.get(session.groupId);
        if (!room) return;

        const rawName = typeof msg.name === 'string' ? msg.name.trim() : '';
        if (rawName.length < 2 || rawName.length > 32) {
          sendJson(ws, { type: 'error', message: 'Channel name must be 2–32 characters.' });
          return;
        }

        const maxSlots =
          typeof msg.maxSlots === 'number' && msg.maxSlots >= 0 && msg.maxSlots <= 16
            ? Math.floor(msg.maxSlots)
            : 0;
        const isLocked = Boolean(msg.isLocked);

        // Leave previous channel if currently in one
        removeFromCurrentChannel(session);

        const channelId = `vc_${crypto.randomBytes(6).toString('hex')}`;
        const newChannel: TemporaryVC = {
          id: channelId,
          groupId: session.groupId,
          name: rawName,
          ownerUid: session.uid,
          ownerMcName: session.mcUsername,
          maxSlots,
          isLocked,
          invitedUids: new Set([session.uid]),
          participants: new Map(),
          createdAt: Date.now(),
        };

        newChannel.participants.set(session.uid, {
          uid: session.uid,
          mcUsername: session.mcUsername,
          skinPreset: session.skinPreset,
          muted: Boolean(msg.muted),
          deafened: Boolean(msg.deafened),
          serverMuted: false,
          speaking: false,
          joinedAt: Date.now(),
        });

        room.channels.set(channelId, newChannel);
        session.channelId = channelId;

        const member = room.onlineMembers.get(session.uid);
        if (member) {
          member.currentChannelId = channelId;
        }

        sendJson(ws, {
          type: 'vc:joined',
          channelId,
          existingPeers: [],
        });

        broadcastToGroup(session.groupId, {
          type: 'group:state',
          state: serializeGroupRoom(room),
        });
        return;
      }

      // 5. Join an existing Temporary Voice Channel
      if (msg.type === 'vc:join') {
        if (!session.groupId) return;
        const room = groups.get(session.groupId);
        if (!room) return;

        const channelId = typeof msg.channelId === 'string' ? msg.channelId : '';
        const channel = room.channels.get(channelId);
        if (!channel) {
          sendJson(ws, { type: 'error', message: 'That temporary voice channel no longer exists.' });
          return;
        }

        if (session.channelId === channelId) return;

        const isGroupOwner = room.groupOwnerUid === session.uid;
        if (
          channel.isLocked &&
          channel.ownerUid !== session.uid &&
          !channel.invitedUids.has(session.uid) &&
          !isGroupOwner
        ) {
          sendJson(ws, {
            type: 'error',
            message: 'Channel is locked. Ask the VC owner to invite you or unlock it.',
          });
          return;
        }

        if (channel.maxSlots > 0 && channel.participants.size >= channel.maxSlots) {
          sendJson(ws, { type: 'error', message: 'This temporary voice channel is full.' });
          return;
        }

        removeFromCurrentChannel(session);

        const existingPeers = Array.from(channel.participants.values()).map((p) => ({
          uid: p.uid,
          mcUsername: p.mcUsername,
        }));

        channel.participants.set(session.uid, {
          uid: session.uid,
          mcUsername: session.mcUsername,
          skinPreset: session.skinPreset,
          muted: Boolean(msg.muted),
          deafened: Boolean(msg.deafened),
          serverMuted: false,
          speaking: false,
          joinedAt: Date.now(),
        });

        session.channelId = channelId;
        const member = room.onlineMembers.get(session.uid);
        if (member) {
          member.currentChannelId = channelId;
        }

        sendJson(ws, {
          type: 'vc:joined',
          channelId,
          existingPeers,
        });

        for (const peer of existingPeers) {
          sendToUser(peer.uid, {
            type: 'vc:peer_joined',
            channelId,
            uid: session.uid,
            mcUsername: session.mcUsername,
          });
        }

        broadcastToGroup(session.groupId, {
          type: 'group:state',
          state: serializeGroupRoom(room),
        });
        return;
      }

      // 6. Leave current Temporary Voice Channel
      if (msg.type === 'vc:leave') {
        removeFromCurrentChannel(session);
        return;
      }

      // 7. Update self mic/deafen/speaking state
      if (msg.type === 'vc:voice_state') {
        if (!session.groupId || !session.channelId) return;
        const room = groups.get(session.groupId);
        const channel = room?.channels.get(session.channelId);
        const participant = channel?.participants.get(session.uid);
        if (!room || !channel || !participant) return;

        if (typeof msg.muted === 'boolean') participant.muted = msg.muted;
        if (typeof msg.deafened === 'boolean') participant.deafened = msg.deafened;
        if (typeof msg.speaking === 'boolean') {
          participant.speaking = !participant.muted && !participant.serverMuted && msg.speaking;
        }

        broadcastToGroup(session.groupId, {
          type: 'group:state',
          state: serializeGroupRoom(room),
        });
        return;
      }

      // 8. Invite someone in the group to your VC (works for VC owner AND members in a VC!)
      if (msg.type === 'vc:invite') {
        if (!session.groupId) return;
        const room = groups.get(session.groupId);
        if (!room) return;

        const channelId = typeof msg.channelId === 'string' ? msg.channelId : session.channelId;
        const targetUid = typeof msg.targetUid === 'string' ? msg.targetUid : '';
        if (!channelId || !targetUid || targetUid === session.uid) return;

        const channel = room.channels.get(channelId);
        if (!channel) return;

        // Must be inside the VC or own the VC to invite someone to it
        if (channel.ownerUid !== session.uid && !channel.participants.has(session.uid)) {
          sendJson(ws, { type: 'error', message: 'Join or own this VC to send invites.' });
          return;
        }

        channel.invitedUids.add(targetUid);

        sendToUser(targetUid, {
          type: 'vc:invite_received',
          invite: {
            inviteId: `ws_${crypto.randomBytes(5).toString('hex')}`,
            groupId: session.groupId,
            groupName: typeof msg.groupName === 'string' ? msg.groupName : 'Voice Group',
            channelId: channel.id,
            channelName: channel.name,
            fromUid: session.uid,
            fromMcName: session.mcUsername,
            createdAt: Date.now(),
          },
        });

        broadcastToGroup(session.groupId, {
          type: 'group:state',
          state: serializeGroupRoom(room),
        });
        return;
      }

      // 9. Temporary VC Owner Controls (Lock, Rename, Server Mute, Kick, Transfer Ownership, Close)
      if (
        msg.type === 'vc:toggle_lock' ||
        msg.type === 'vc:rename' ||
        msg.type === 'vc:server_mute' ||
        msg.type === 'vc:kick' ||
        msg.type === 'vc:transfer_owner' ||
        msg.type === 'vc:close'
      ) {
        if (!session.groupId) return;
        const room = groups.get(session.groupId);
        if (!room) return;

        const channelId = typeof msg.channelId === 'string' ? msg.channelId : session.channelId;
        if (!channelId) return;
        const channel = room.channels.get(channelId);
        if (!channel) return;

        const isAuthorized = channel.ownerUid === session.uid || room.groupOwnerUid === session.uid;
        if (!isAuthorized) {
          sendJson(ws, { type: 'error', message: 'Only the VC owner can manage this channel.' });
          return;
        }

        if (msg.type === 'vc:toggle_lock') {
          channel.isLocked = !channel.isLocked;
        } else if (msg.type === 'vc:rename') {
          const nextName = typeof msg.name === 'string' ? msg.name.trim() : '';
          if (nextName.length >= 2 && nextName.length <= 32) {
            channel.name = nextName;
          }
        } else if (msg.type === 'vc:server_mute') {
          const targetUid = typeof msg.targetUid === 'string' ? msg.targetUid : '';
          const p = channel.participants.get(targetUid);
          if (p) {
            p.serverMuted = typeof msg.serverMuted === 'boolean' ? msg.serverMuted : !p.serverMuted;
            if (p.serverMuted) p.speaking = false;
            sendToUser(targetUid, {
              type: 'vc:server_muted',
              channelId: channel.id,
              serverMuted: p.serverMuted,
            });
          }
        } else if (msg.type === 'vc:kick') {
          const targetUid = typeof msg.targetUid === 'string' ? msg.targetUid : '';
          if (targetUid && targetUid !== session.uid && channel.participants.has(targetUid)) {
            channel.participants.delete(targetUid);
            channel.invitedUids.delete(targetUid);

            const targetSessions = userSockets.get(targetUid);
            if (targetSessions) {
              for (const s of targetSessions) {
                if (s.channelId === channel.id) {
                  s.channelId = null;
                }
              }
            }
            const m = room.onlineMembers.get(targetUid);
            if (m && m.currentChannelId === channel.id) {
              m.currentChannelId = null;
            }

            for (const remaining of channel.participants.values()) {
              sendToUser(remaining.uid, {
                type: 'vc:peer_left',
                channelId: channel.id,
                uid: targetUid,
              });
            }
            sendToUser(targetUid, {
              type: 'vc:kicked',
              channelId: channel.id,
              channelName: channel.name,
            });
          }
        } else if (msg.type === 'vc:transfer_owner') {
          const targetUid = typeof msg.targetUid === 'string' ? msg.targetUid : '';
          const p = channel.participants.get(targetUid);
          if (p) {
            channel.ownerUid = p.uid;
            channel.ownerMcName = p.mcUsername;
          }
        } else if (msg.type === 'vc:close') {
          const allParticipants = Array.from(channel.participants.values());
          for (const p of allParticipants) {
            const targetSessions = userSockets.get(p.uid);
            if (targetSessions) {
              for (const s of targetSessions) {
                if (s.channelId === channel.id) {
                  s.channelId = null;
                }
              }
            }
            const m = room.onlineMembers.get(p.uid);
            if (m && m.currentChannelId === channel.id) {
              m.currentChannelId = null;
            }
            sendToUser(p.uid, {
              type: 'vc:closed',
              channelId: channel.id,
              channelName: channel.name,
            });
          }
          room.channels.delete(channel.id);
        }

        broadcastToGroup(session.groupId, {
          type: 'group:state',
          state: serializeGroupRoom(room),
        });
        return;
      }

      // 10. WebRTC Signaling Relay (Offer / Answer / ICE Candidate)
      if (msg.type === 'rtc:signal') {
        if (!session.groupId || !session.channelId) return;
        const room = groups.get(session.groupId);
        const channel = room?.channels.get(session.channelId);
        if (!channel) return;

        const targetUid = typeof msg.targetUid === 'string' ? msg.targetUid : '';
        if (!targetUid || !channel.participants.has(targetUid)) return;

        sendToUser(targetUid, {
          type: 'rtc:signal',
          channelId: session.channelId,
          fromUid: session.uid,
          signal: msg.signal,
        });
      }
    });

    ws.on('close', () => {
      leaveCurrentGroup(session);
      if (session.uid) {
        const set = userSockets.get(session.uid);
        if (set) {
          set.delete(session);
          if (set.size === 0) {
            userSockets.delete(session.uid);
          }
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Velkox VC server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Velkox VC server:', err);
  process.exit(1);
});
