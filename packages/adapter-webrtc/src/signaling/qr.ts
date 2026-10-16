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
