"use strict";

// Shared in-memory state singletons used across the server modules.
const { PACKS } = require("../data/packs");

const packById = new Map(PACKS.map((pack) => [pack.id, pack]));
const botState = { username: process.env.BOT_USERNAME || "" };
const rooms = new Map();
const users = new Map();
const chats = new Map();

// Matchmaking shared state.
const matchQueue = [];
const matchAssignments = new Map();
// currentMatchRoomCode is reassigned at runtime, so keep it on a holder object
// to preserve a single shared reference across modules.
const mm = { currentMatchRoomCode: null };

// Chat id counters per room.
const chatIdCounters = new Map();

module.exports = {
  PACKS,
  packById,
  botState,
  rooms,
  users,
  chats,
  matchQueue,
  matchAssignments,
  mm,
  chatIdCounters,
};
