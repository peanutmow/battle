import { P2PHost } from "../p2p/P2PHost";
import { P2PPeer } from "../p2p/P2PPeer";

/**
 * Global P2P context for passing P2PHost/P2PPeer instances
 * between modals and the Transport/ClientGameRunner.
 */
class P2PContextManager {
  private _host: P2PHost | null = null;
  private _peer: P2PPeer | null = null;

  setHost(host: P2PHost) {
    this._host = host;
  }

  getHost(): P2PHost | null {
    return this._host;
  }

  setPeer(peer: P2PPeer) {
    this._peer = peer;
  }

  getPeer(): P2PPeer | null {
    return this._peer;
  }

  clear() {
    this._host = null;
    this._peer = null;
  }
}

export const p2pContext = new P2PContextManager();
