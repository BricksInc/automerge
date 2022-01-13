const { init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch, getHeads, getAllChanges, getChanges, getChangesAdded, getChangeByHash, getMissingDeps, getMaxOps, getClock, getMaxOp,} = require("./backend")
const { receiveSyncMessage, generateSyncMessage, encodeSyncMessage, decodeSyncMessage, encodeSyncState, decodeSyncState, initSyncState } = require('./sync')

module.exports = {
  init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch, getMaxOps, getClock, getMaxOp,
  getHeads, getAllChanges, getChanges, getChangesAdded, getChangeByHash, getMissingDeps,
  receiveSyncMessage, generateSyncMessage, encodeSyncMessage, decodeSyncMessage, encodeSyncState, decodeSyncState, initSyncState
}
