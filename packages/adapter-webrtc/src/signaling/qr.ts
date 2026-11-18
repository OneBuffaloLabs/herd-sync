// --- Vendor ---
import LZString from "lz-string";

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
