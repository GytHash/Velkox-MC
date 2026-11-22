# Velkox VC Firestore Security Specification

## 1. Data Invariants
1. **PII Isolation**: User emails live exclusively in `/users/{userId}` and can only be read or written by `request.auth.uid == userId`. Group rosters and member records never contain email addresses.
2. **Invite Code Privacy**: `/groupCodes/{code}` allows single-document `get` only (no `list`), preventing enumeration of all active group codes.
3. **Group Membership Master Gate**: Reading `/groups/{groupId}` or `/groups/{groupId}/roster/public` requires verified membership in `/groups/{groupId}/members/{request.auth.uid}`.
4. **Role Integrity**: A user joining an existing group can only assign themselves `role: 'member'`. Only the creator of a new group (`groups/{groupId}.ownerId == request.auth.uid`) can create their membership with `role: 'owner'`.
5. **Cross-Member Invite Integrity**: A user can only create a VC invite under `/users/{targetUid}/vcInvites/{inviteId}` if BOTH the sender (`request.auth.uid`) and the recipient (`targetUid`) are members of `incoming().groupId`, and `incoming().fromUid == request.auth.uid`.
6. **Zero `get()`/`exists()` in `allow list`**: Every `allow list` rule evaluates purely against the document path (`userId == request.auth.uid`) or `resource.data`.
7. **Server Timestamps**: All `createdAt`, `updatedAt`, and `joinedAt` timestamps must equal `request.time`.

## 2. The Dirty Dozen Adversarial Payloads
1. **Shadow Field Injection on Profile**: `{ uid, email, displayName, mcUsername: "Steve", skinPreset: "steve", isAdmin: true, createdAt, updatedAt }` -> `PERMISSION_DENIED` (`hasOnly` blocks `isAdmin`).
2. **Identity Spoofing on Profile**: Creating `/users/victim_uid` with `uid: "victim_uid"` while signed in as `attacker_uid` -> `PERMISSION_DENIED`.
3. **PII Blanket Read**: Attempting `get` on `/users/victim_uid` as `attacker_uid` -> `PERMISSION_DENIED`.
4. **Unverified Email Write**: Creating a group with `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
5. **Group Code Enumeration**: Running `list` on `/groupCodes` -> `PERMISSION_DENIED`.
6. **Self-Promotion on Join**: Joining an existing group with `role: "owner"` in `/groups/{groupId}/members/{attacker}` -> `PERMISSION_DENIED`.
7. **Orphaned Group Without Code**: Creating `/groups/{groupId}` without atomically creating `/groupCodes/{code}` and `/groups/{groupId}/members/{uid}` -> `PERMISSION_DENIED` (`existsAfter` fails).
8. **Roster Tampering**: A regular member updating `/groups/{groupId}/roster/public` to overwrite another user's `members[victim]` entry -> `PERMISSION_DENIED` (`affectedKeys` on `members` map restricts to `request.auth.uid`).
9. **Spoofed VC Invite Sender**: Creating `/users/victim/vcInvites/inv1` with `fromUid: "someone_else"` -> `PERMISSION_DENIED`.
10. **Cross-Group Spam Invite**: Creating `/users/outsider/vcInvites/inv1` when `outsider` is not in `incoming().groupId` -> `PERMISSION_DENIED`.
11. **Timestamp Forgery**: Creating a group with a backdated client timestamp `createdAt` instead of `request.time` -> `PERMISSION_DENIED`.
12. **ID Poisoning**: Creating a document with a 1.5KB junk ID or disallowed characters `../etc/passwd` -> `PERMISSION_DENIED` (`isValidId` rejects).
