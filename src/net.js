// Peer-to-peer multiplayer over WebRTC, using PeerJS's free public signalling server.
// Every player talks to every other player directly (full mesh). One player at a time also
// holds the room's "lobby" id, which only hands new arrivals the list of who is already in.

const PREFIX = 'epam-city-';
const MAX_PLAYERS = 8;
const PEER_TIMEOUT = 12;   // seconds without any message before a player is considered gone

// Google's public STUN servers find a direct route between most home/office networks.
// Strict corporate firewalls may need a TURN relay: create a free one (e.g. metered.ca's
// free tier) and add it here as { urls: 'turn:...', username: '...', credential: '...' }.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomRoomCode() {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}
export function normalizeRoomCode(text) {
  return (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
export function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

export class Network {
  // hello: {name, avatar} sent to everyone; stream: local microphone MediaStream or null
  constructor({ code, hello, stream }) {
    this.code = code;
    this.lobbyId = PREFIX + code;
    this.hello = { ...hello, mic: !!stream };
    this.stream = stream;
    this.conns = new Map();     // peer id -> DataConnection
    this.calls = new Map();     // peer id -> MediaConnection
    this.players = new Map();   // peer id -> { hello, lastSeen }
    this.handlers = {};
    this.peer = null;
    this.lobby = null;
    this.Peer = null;
    this.closed = false;
  }

  on(event, fn) { (this.handlers[event] ??= []).push(fn); }
  emit(event, ...args) { for (const fn of this.handlers[event] ?? []) fn(...args); }

  get id() { return this.peer?.id; }
  get count() { return this.players.size + 1; }

  async start() {
    const mod = await import('peerjs');
    this.Peer = mod.Peer ?? mod.default;
    this.peer = new this.Peer({ config: { iceServers: ICE_SERVERS }, debug: 1 });
    this.peer.on('open', () => this.connectLobby());
    this.peer.on('connection', conn => this.acceptConnection(conn));
    this.peer.on('call', call => {
      this.setupCall(call);   // listen before answering so the first 'stream' event isn't missed
      call.answer(this.stream ?? undefined);
    });
    this.peer.on('disconnected', () => { if (!this.closed) this.peer.reconnect(); });
    this.peer.on('error', err => this.onPeerError(err));
    this.watchdog = setInterval(() => this.checkTimeouts(), 2000);
    addEventListener('pagehide', () => this.leave());
  }

  onPeerError(err) {
    if (err.type === 'peer-unavailable') {
      // nobody holds the lobby yet (or the holder just left): we start the room ourselves
      if (String(err.message).includes(this.lobbyId)) this.claimLobby(true);
      return;
    }
    if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      this.emit('status', 'Multiplayer server unreachable — retrying…');
      return;
    }
    if (err.type === 'browser-incompatible') this.emit('status', 'This browser does not support WebRTC multiplayer.');
    console.warn('PeerJS error', err.type, err);
  }

  connectLobby() {
    const conn = this.peer.connect(this.lobbyId, { serialization: 'json', reliable: true });
    conn.on('data', msg => {
      if (msg.type === 'full') this.emit('status', `Room ${this.code} is full (${MAX_PLAYERS} players).`);
      if (msg.type === 'roster') {
        for (const id of msg.ids) if (id !== this.id && !this.conns.has(id)) this.connectTo(id);
      }
      conn.close();
    });
  }

  // Try to become the room's lobby. Losing the race is fine: someone else holds it.
  claimLobby(retryJoin = false) {
    if (this.lobby || this.closed) return;
    const lobby = new this.Peer(this.lobbyId, { config: { iceServers: ICE_SERVERS }, debug: 1 });
    this.lobby = lobby;
    lobby.on('open', () => {
      if (retryJoin && this.players.size === 0) this.emit('status', `Room ${this.code} is open. Share the invite link!`);
    });
    lobby.on('connection', conn => {
      conn.on('open', () => {
        const ids = [this.id, ...this.players.keys()].filter(Boolean);
        conn.send(this.count >= MAX_PLAYERS ? { type: 'full' } : { type: 'roster', ids });
        setTimeout(() => conn.close(), 1500);
      });
    });
    lobby.on('error', err => {
      if (err.type === 'unavailable-id') {
        lobby.destroy();
        this.lobby = null;
        // someone else just opened the room at the same moment: join theirs instead
        if (retryJoin) setTimeout(() => this.connectLobby(), 800);
      }
    });
    lobby.on('disconnected', () => { if (!this.closed && !lobby.destroyed) lobby.reconnect(); });
  }

  connectTo(id) {
    const conn = this.peer.connect(id, { serialization: 'json', reliable: true });
    this.setupConnection(conn);
  }

  acceptConnection(conn) {
    if (this.count >= MAX_PLAYERS) { conn.on('open', () => conn.close()); return; }
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.send({ type: 'hello', ...this.hello });
    });
    conn.on('data', msg => this.receive(conn.peer, msg));
    conn.on('close', () => this.drop(conn.peer));
    conn.on('error', () => this.drop(conn.peer));
  }

  receive(id, msg) {
    const player = this.players.get(id);
    if (player) player.lastSeen = performance.now();
    switch (msg?.type) {
      case 'hello':
        if (player) return;
        this.players.set(id, { hello: msg, lastSeen: performance.now() });
        this.emit('join', id, msg);
        if (this.shouldCall(id, msg)) this.setupCall(this.peer.call(id, this.stream));
        break;
      case 'state': if (player) this.emit('state', id, msg); break;
      case 'mute': if (player) this.emit('mute', id, msg.muted); break;
      case 'bye': this.drop(id); break;
      default: break;
    }
  }

  // Exactly one side starts the voice call: the one with a mic, lower id wins if both have one.
  shouldCall(id, theirHello) {
    if (!this.stream) return false;
    return !theirHello.mic || this.id < id;
  }

  setupCall(call) {
    if (!call) return;
    this.calls.set(call.peer, call);
    call.on('stream', stream => this.emit('stream', call.peer, stream));
    call.on('error', err => console.warn('Voice call failed', err));
  }

  drop(id) {
    if (this.closed) return;
    this.conns.get(id)?.close();
    this.conns.delete(id);
    this.calls.get(id)?.close();
    this.calls.delete(id);
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.emit('leave', id, player.hello);
    // if they were holding the lobby, someone has to take it over so new players can still join
    setTimeout(() => this.claimLobby(), 500 + Math.random() * 1500);
  }

  checkTimeouts() {
    const now = performance.now();
    for (const [id, p] of this.players) if (now - p.lastSeen > PEER_TIMEOUT * 1000) this.drop(id);
  }

  broadcast(msg) {
    for (const conn of this.conns.values()) if (conn.open) conn.send(msg);
  }

  leave() {
    if (this.closed) return;
    this.broadcast({ type: 'bye' });
    this.closed = true;
    clearInterval(this.watchdog);
    this.lobby?.destroy();
    this.peer?.destroy();
  }
}
