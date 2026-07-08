import type { GameConfig, Turn } from "../core/Schemas";

/**
 * P2P game mode: the host runs the authoritative game loop in their browser
 * and relays turns/intents via WebRTC DataChannels to connected peers.
 */

/** Messages sent between host and peer over the DataChannel */
export type P2PMessage =
  | P2PJoinMessage
  | P2PJoinedMessage
  | P2PIntentMessage
  | P2PTurnMessage
  | P2PStartMessage
  | P2PLobbyInfoMessage
  | P2PErrorMessage
  | P2PPingMessage
  | P2PDisconnectMessage;

export interface P2PJoinMessage {
  type: "p2p_join";
  username: string;
  clientID: string;
}

export interface P2PJoinedMessage {
  type: "p2p_joined";
  clientID: string;
  players: P2PPlayerInfo[];
}

export interface P2PIntentMessage {
  type: "p2p_intent";
  intent: any; // Intent type from Schemas
}

export interface P2PTurnMessage {
  type: "p2p_turn";
  turn: Turn;
}

export interface P2PStartMessage {
  type: "p2p_start";
  gameStartInfo: any; // ServerStartGameMessage equivalent
  turns: Turn[];
}

export interface P2PLobbyInfoMessage {
  type: "p2p_lobby_info";
  hostPlayer: P2PPlayerInfo;
  players: P2PPlayerInfo[];
}

export interface P2PErrorMessage {
  type: "p2p_error";
  error: string;
}

export interface P2PPingMessage {
  type: "p2p_ping";
}

export interface P2PDisconnectMessage {
  type: "p2p_disconnect";
  reason?: string;
}

export interface P2PPlayerInfo {
  clientID: string;
  username: string;
  connected: boolean;
}

/** Configuration for a P2P host game */
export interface P2PHostConfig {
  gameConfig: Partial<GameConfig>;
  hostPlayerName: string;
}

/** Result of signaling exchange */
export interface SignalingResult {
  /** The SDP offer/answer as a string */
  sdp: string;
  /** ICE candidates collected so far */
  candidates?: RTCIceCandidate[];
}
