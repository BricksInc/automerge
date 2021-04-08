const Backend = require("./backend");
const { makeBloomFilter, BloomFilter, getChangesToSend } = require("./sync");
const { backendState } = require('./util')

/****

  export interface PeerState {
      sharedHeads: Hash[]
      theirNeed: Hash[]
      ourNeed: Hash[]
      have: SyncHave[]
      unappliedChanges: BinaryChange[]
  }

  interface SyncMessage {
      heads: Hash[]
      need: Hash[]
      have: SyncHave[]
      changes: Uint8Array[] // todo
  }

  interface SyncHave {
      lastSync: Hash[]
      bloom: Uint8Array
  }

*****/

function emptyPeerState() {
    return {
        sharedHeads: [],
        theirHeads: null,
        theirNeed: null,
        ourNeed: [],
        have: [],
        unappliedChanges: []
    };
}

function compareArrays(a, b) {
    return (a.length === b.length) && a.every((v, i) => v === b[i]);
}
/* generateSyncMessage plan:
  tell them what data we have / need
  and
  fulfill a request for have / need
  
  if they tell us about sharedHeads we don't recognize, we need to reset our shared peerState
  (something went wrong/stale)

  sync message
  heads: our current heads
  have: { ourCommonHeads + bloomFilter }
  needs: any holes we know about
  changes: anything passed in and/or getChangesToSend(state, message)

  peerState:
   - we want to avoid sending the same data over and over
   -- can we keep track of what data we've sent out but haven't had confirmed?
   -- TODO: implement peer state updating. for now, just pass it back.

  return a peerState & syncMessage and a peer state
*/
function generateSyncMessage(backend, peerState, changes) {
    peerState = peerState || emptyPeerState()
    changes = changes || []

    const { sharedHeads, ourNeed, theirHeads, theirNeed, have: theirHave, unappliedChanges } = peerState;
    const ourHeads = Backend.getHeads(backend)
    const state = backendState(backend)
    // if we need some particular keys, sending the bloom filter will cause retransmission
    // of data (since the bloom filter doesn't include data waiting to be applied)
    // also, we could be using other peers' have messages to reduce any risk of resending data
    // actually, thinking more about this we probably want to include queued data in our bloom filter
    // but... it will work without it, just risks lots of resent data if you have many peers
    const have = (!ourNeed.length) ? [makeBloomFilter(state, sharedHeads)] : [];
    // If the heads are equal, we're in sync and don't need to do anything further

    if (Array.isArray(theirHeads) && compareArrays(ourHeads, theirHeads) && ourNeed.length === 0) {
        return [peerState, null];
        // no need to send a sync message if we know we're synced!
    }

    // Fall back to a full re-sync if the sender's last sync state includes hashes
    // that we don't know. This could happen if we crashed after the last sync and
    // failed to persist changes that the other node already sent us.
    // XXX: do we need this?

    if (theirHave.length > 0) {
        const lastSync = theirHave[0].lastSync;
        if (!lastSync.every(hash => Backend.getChangeByHash(state, hash))) {
            // we need to queue them to send us a fresh sync message, the one they sent is uninteligible so we don't know what they need
            const dummySync = { heads: ourHeads, need: [], have: [{ lastSync: [], bloom: Uint8Array.of() }], changes: [] };
            return [peerState, dummySync];
        }
    }
    
    // FIXME: we currently ignore passed-in changes (local changes will fail)
    const changesToSend = Array.isArray(theirHave) && Array.isArray(theirNeed) ? getChangesToSend(state, theirHave, theirNeed) : []
    const heads = Backend.getHeads(backend)
    const syncMessage = {
        heads,
        have,
        need: ourNeed,
        changes: changesToSend
    };

    // Regular response to a sync message: send any changes that the other node
    // doesn't have. We leave the "have" field empty because the previous message
    // generated by `syncStart` already indicated what changes we have.
    return [peerState, syncMessage];
}
/* try this if for some reason we suspect advanceHeads is wrong. it should just result in fat bloom filters
function shittyAdvanceHeads(myOldHeads: Hash[], myNewHeads: Hash[], ourOldSharedHeads: Hash[]): Hash[] {
  const ourNewSharedHeads: Hash[] = []
  return ourNewSharedHeads
}*/
/* note that these implementations are slow because heads should be few */
/* to you, the future reader wondering why your code is slow: sorry about that */

function advanceHeads(myOldHeads, myNewHeads, ourOldSharedHeads) {
    const newHeads = myNewHeads.filter((head) => !myOldHeads.includes(head));
    const commonHeads = newHeads.filter((head) => myOldHeads.includes(head) && ourOldSharedHeads.includes(head));
    const advancedHeads = [...new Set([...newHeads, ...commonHeads])].sort();
    return advancedHeads;
}

function receiveSyncMessage(backend, message, oldPeerState) {
    let patch = null;
    oldPeerState = oldPeerState || emptyPeerState()
    let { unappliedChanges, ourNeed, sharedHeads } = oldPeerState;
    const { heads, changes } = message;
    const beforeHeads = Backend.getHeads(backend);
    // when we receive a sync message, first we apply any changes they sent us
    if (changes.length) {
        unappliedChanges = [...unappliedChanges, ...changes];
        ourNeed = Backend.getMissingDeps(backend, unappliedChanges, heads);
        if (ourNeed.length === 0) {
            [backend, patch] = Backend.applyChanges(backend, unappliedChanges);
            unappliedChanges = [];
            sharedHeads = advanceHeads(beforeHeads, Backend.getHeads(backend), sharedHeads);
        }
    }
    const newPeerState = {
        sharedHeads, // what we have in common to generate an efficient bloom filter
        have: message.have, // the information we need to calculate the changes they need
        theirHeads: message.heads,
        theirNeed: message.need,
        ourNeed, // specifically missing change (bloom filter false positives)
        unappliedChanges // the changes we can't use yet because of the above
    };
    return [backend, newPeerState, patch];
}

module.exports = { receiveSyncMessage, generateSyncMessage };

// TODO SYNC MESSAGE NEEDS SUPPORT FOR CHANGES IN ENCODE/DECODE
