// --- Vendor ---
import LZString from "lz-string";

// --- Types ---
import type { QRChunk } from "@/types";

const CHUNK_HEADER_REGEX = /^HS1:(\d+)\/(\d+):([\s\S]+)$/;
const PIN_CHANNEL_NAME = "herd-sync-pin";

/**
 * Compresses an SDP string into a URL-safe format suitable for dense QR codes.
 */
export function compressSDP(sdp: string): string {
  return LZString.compressToEncodedURIComponent(sdp);
}

/**
 * Decompresses an SDP payload from a scanned QR code.
 */
export function decompressSDP(compressed: string): string | null {
  return LZString.decompressFromEncodedURIComponent(compressed);
}

/**
 * Splits a compressed signaling payload into low-density QR frames (`HS1:<index>/<total>:<data>`).
 * Returns a single-element array when the payload already fits within `maxChunkLength`.
 */
export function chunkPayload(payload: string, maxChunkLength = 160): string[] {
  if (!payload || payload.length <= maxChunkLength) {
    return payload ? [payload] : [];
  }

  const total = Math.ceil(payload.length / maxChunkLength);
  const chunks: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const slice = payload.slice(i * maxChunkLength, (i + 1) * maxChunkLength);
    chunks.push(`HS1:${i + 1}/${total}:${slice}`);
  }
  return chunks;
}

/**
 * Parses a scanned animated QR frame (`HS1:<index>/<total>:<data>`), or returns null for non-chunked payloads.
 */
export function parseQRChunk(raw: string): QRChunk | null {
  const match = raw.trim().match(CHUNK_HEADER_REGEX);
  if (!match) return null;

  const index = Number.parseInt(match[1] ?? "", 10);
  const total = Number.parseInt(match[2] ?? "", 10);
  const data = match[3] ?? "";

  if (!Number.isFinite(index) || !Number.isFinite(total) || total < 2 || index < 1 || index > total) {
    return null;
  }

  return { index, total, data };
}

/**
 * Reassembles a complete payload from collected chunk frames, or returns null if any chunk is missing.
 */
export function reassembleChunks(chunks: Map<number, string>, total: number): string | null {
  if (total < 1 || chunks.size < total) return null;
  const parts: string[] = [];
  for (let i = 1; i <= total; i += 1) {
    const part = chunks.get(i);
    if (part === undefined) return null;
    parts.push(part);
  }
  return parts.join("");
}

/**
 * Generates a 6-digit numeric pairing PIN for same-device / local-tab quick pairing.
 */
export function generatePairingPin(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const num = (buf[0] ?? 0) % 1_000_000;
    return String(num).padStart(6, "0");
  }
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

/**
 * Broadcasts a 6-digit PIN mapping over BroadcastChannel so another tab/window on the same origin
 * can resolve the compressed SDP without scanning a QR code.
 */
export function broadcastPinPayload(pin: string, payload: string): () => void {
  if (typeof BroadcastChannel === "undefined" || !pin || !payload) {
    return () => {};
  }

  const channel = new BroadcastChannel(PIN_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<{ type?: string; pin?: string }>) => {
    if (event.data?.type === "PIN_LOOKUP" && event.data.pin === pin) {
      channel.postMessage({ type: "PIN_RESPONSE", pin, payload });
    }
  };

  return () => {
    channel.close();
  };
}

/**
 * Resolves a compressed SDP payload from a 6-digit PIN over BroadcastChannel.
 */
export function lookupPinPayload(pin: string, timeoutMs = 600): Promise<string | null> {
  const normalized = pin.trim();
  if (!/^\d{6}$/.test(normalized) || typeof BroadcastChannel === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const channel = new BroadcastChannel(PIN_CHANNEL_NAME);
    const timer = setTimeout(() => {
      channel.close();
      resolve(null);
    }, timeoutMs);

    channel.onmessage = (event: MessageEvent<{ type?: string; pin?: string; payload?: string }>) => {
      if (event.data?.type === "PIN_RESPONSE" && event.data.pin === normalized && event.data.payload) {
        clearTimeout(timer);
        channel.close();
        resolve(event.data.payload);
      }
    };

    channel.postMessage({ type: "PIN_LOOKUP", pin: normalized });
  });
}

/**
 * Builds a shareable URL containing the compressed pairing payload in the hash fragment.
 */
export function buildPairingUrl(compressed: string, baseUrl?: string): string {
  const resolvedBase =
    baseUrl ?? (typeof window !== "undefined" ? window.location.href.split("#")[0] : "");
  return `${resolvedBase}#pair=${compressed}`;
}

/**
 * Extracts a compressed SDP payload from either a pairing URL (#pair= / ?pair=) or raw snippet.
 */
export function extractPairingPayload(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/[?#&]pair=([^&#\s]+)/);
  if (match?.[1]) {
    return match[1];
  }

  return trimmed;
}

/**
 * Builds a mailto: URI for emailing a pairing link.
 */
export function buildMailtoHref(pairingUrl: string, recipientEmail = ""): string {
  const recipient = recipientEmail.trim() ? encodeURIComponent(recipientEmail.trim()) : "";
  const subject = encodeURIComponent("HerdSync Device Pairing Link");
  const body = encodeURIComponent(`Open this link on your other device to pair:\n\n${pairingUrl}`);
  return `mailto:${recipient}?subject=${subject}&body=${body}`;
}

/**
 * Builds an sms: URI for texting a pairing link.
 */
export function buildSmsHref(pairingUrl: string, phoneNumber = ""): string {
  const recipient = phoneNumber.trim() ? encodeURIComponent(phoneNumber.trim()) : "";
  const body = encodeURIComponent(`Open this link to pair with HerdSync: ${pairingUrl}`);
  return `sms:${recipient}?body=${body}`;
}
