/**
 * Copy-paste signaling for WebRTC.
 *
 * No central signaling server needed. The host generates an SDP offer which
 * is displayed as text. The user shares this text (e.g. via Discord, pastebin,
 * etc.) to the peer. The peer pastes the offer, generates an answer, and
 * shares the answer text back. The host pastes the answer to complete the
 * WebRTC handshake.
 *
 * ICE candidates are gathered inline and appended to the SDP.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * Format an SDP offer/answer as a shareable text block.
 * Includes a brief header so users can identify what they're pasting.
 */
export function formatSDP(sdp: string, type: "offer" | "answer"): string {
  const header =
    type === "offer"
      ? "---CLOSEDFRONT HOST OFFER---"
      : "---CLOSEDFRONT PEER ANSWER---";
  return `${header}\n${sdp}\n${header}`;
}

/**
 * Parse a raw pasted text block and extract the SDP.
 * Returns null if the format is invalid.
 */
export function parseSDP(text: string): string | null {
  // Remove the header/footer lines if present
  const lines = text.trim().split("\n");
  const sdpLines = lines.filter(
    (l) => !l.startsWith("---CLOSEDFRONT") && l.trim().length > 0,
  );
  if (sdpLines.length === 0) return null;
  return sdpLines.join("\n");
}

/**
 * Create an RTCPeerConnection with default ICE servers.
 */
export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

/**
 * Asynchronously gather all ICE candidates from a PeerConnection.
 * Returns once the collection is complete or times out.
 */
export async function gatherIceCandidates(
  pc: RTCPeerConnection,
  timeoutMs = 5000,
): Promise<RTCIceCandidate[]> {
  const candidates: RTCIceCandidate[] = [];
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      candidates.push(event.candidate);
    }
  };
  // Wait a short while for ICE gathering
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") resolve();
    };
    setTimeout(resolve, timeoutMs);
  });
  return candidates;
}

/**
 * Create an SDP offer from the host side.
 * Returns the offer SDP string.
 */
export async function createOffer(
  pc: RTCPeerConnection,
): Promise<string> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await gatherIceCandidates(pc);
  if (!pc.localDescription) throw new Error("No local description after offer");
  return pc.localDescription.sdp;
}

/**
 * Accept an offer on the peer side and create an answer.
 * Returns the answer SDP string.
 */
export async function createAnswer(
  pc: RTCPeerConnection,
  offerSdp: string,
): Promise<string> {
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await gatherIceCandidates(pc);
  if (!pc.localDescription) throw new Error("No local description after answer");
  return pc.localDescription.sdp;
}

/**
 * Complete the handshake on the host side by setting the remote answer.
 */
export async function acceptAnswer(
  pc: RTCPeerConnection,
  answerSdp: string,
): Promise<void> {
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

/**
 * Wait for the ICE connection to reach a connected or completed state.
 */
export async function waitForConnection(
  pc: RTCPeerConnection,
  timeoutMs = 30000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === "connected") {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      reject(new Error("ICE connection timeout"));
    }, timeoutMs);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearTimeout(timeout);
        resolve();
      } else if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        clearTimeout(timeout);
        reject(new Error(`ICE connection failed: ${pc.connectionState}`));
      }
    };
  });
}
