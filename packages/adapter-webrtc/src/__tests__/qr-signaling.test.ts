import { describe, expect, it } from "vitest";
import {
  buildMailtoHref,
  buildPairingUrl,
  buildSmsHref,
  chunkPayload,
  compressSDP,
  decompressSDP,
  extractPairingPayload,
  generatePairingPin,
  parseQRChunk,
  reassembleChunks
} from "@/signaling/qr";

describe("WebRTC QR Signaling SDP Compression", () => {
  // Realistic multi-line WebRTC offer payload (~2KB)
  const fullRealisticSdp = [
    "v=0",
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=extmap-allow-mixed",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel 1098",
    "c=IN IP4 0.0.0.0",
    "a=ice-ufrag:x8F2",
    "a=ice-pwd:9gYhK20V12p0bLMNpq78abcdef1234567890",
    "a=ice-options:trickle",
    "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
    "a=setup:actpass",
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "a=candidate:1 1 UDP 2122260223 192.168.1.150 54123 typ host",
    "a=candidate:2 1 UDP 2122194687 10.0.0.12 54124 typ host",
    "a=candidate:3 1 UDP 1686052607 198.51.100.45 54125 typ srflx raddr 192.168.1.150 rport 54123",
    "a=candidate:4 1 TCP 1518280447 192.168.1.150 9 typ host tcptype active",
    "a=candidate:5 1 TCP 1518214911 10.0.0.12 9 typ host tcptype active"
  ].join("\r\n");

  it("should compress a realistic SDP payload and reduce overall string length", () => {
    // Repeat candidate blocks to match typical 2KB production SDP bundle sizes
    const productionSdp = `${fullRealisticSdp}\r\n${fullRealisticSdp}`;
    const compressed = compressSDP(productionSdp);

    expect(compressed).toBeDefined();
    expect(typeof compressed).toBe("string");
    expect(compressed.length).toBeLessThan(productionSdp.length);

    const decompressed = decompressSDP(compressed);
    expect(decompressed).toBe(productionSdp);
  });

  it("should decompress back to original value without data loss for short payloads", () => {
    const shortSdp = "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0";
    const compressed = compressSDP(shortSdp);
    const decompressed = decompressSDP(compressed);

    expect(decompressed).toBe(shortSdp);
  });

  it("should return null when decompressing invalid or corrupted payloads", () => {
    const corruptedPayload = "???%%%INVALID_URI_COMPONENT%%%???";
    const decompressed = decompressSDP(corruptedPayload);
    expect(decompressed).toBeNull();
  });

  it("should handle empty strings safely", () => {
    const compressed = compressSDP("");
    const decompressed = decompressSDP(compressed);
    expect(decompressed).toBe("");
  });

  it("should build and extract #pair= pairing URLs", () => {
    const payload = compressSDP("v=0\r\ns=-");
    const url = buildPairingUrl(payload, "https://example.com/sync");
    expect(url).toBe(`https://example.com/sync#pair=${payload}`);
    expect(extractPairingPayload(url)).toBe(payload);
    expect(extractPairingPayload(`https://example.com/sync?pair=${payload}`)).toBe(payload);
    expect(extractPairingPayload(`  ${payload}  `)).toBe(payload);
    expect(extractPairingPayload("   ")).toBeNull();
  });

  it("should build mailto and sms URIs with encoded pairing URLs", () => {
    const url = "https://example.com/#pair=abc123";
    const mailto = buildMailtoHref(url, "peer@example.com");
    expect(mailto).toContain("mailto:peer%40example.com?");
    expect(mailto).toContain(encodeURIComponent(url));

    const mailtoNoRecipient = buildMailtoHref(url);
    expect(mailtoNoRecipient.startsWith("mailto:?")).toBe(true);

    const sms = buildSmsHref(url);
    expect(sms.startsWith("sms:?body=")).toBe(true);
    expect(sms).toContain(encodeURIComponent(url));
  });

  it("should split large payloads into HS1 animated QR chunks and reassemble them in any order", () => {
    const compressed = compressSDP(fullRealisticSdp);
    const chunks = chunkPayload(compressed, 100);

    expect(chunks.length).toBeGreaterThan(1);

    const parsedMap = new Map<number, string>();
    for (const frame of [...chunks].reverse()) {
      const parsed = parseQRChunk(frame);
      expect(parsed).not.toBeNull();
      if (parsed) {
        parsedMap.set(parsed.index, parsed.data);
      }
    }

    const total = parseQRChunk(chunks[0] ?? "")?.total ?? 0;
    const reassembled = reassembleChunks(parsedMap, total);
    expect(reassembled).toBe(compressed);
    expect(decompressSDP(reassembled ?? "")).toBe(fullRealisticSdp);
  });

  it("should keep short payloads as a single unchunked frame and reject incomplete chunk sets", () => {
    const shortPayload = "abc123";
    expect(chunkPayload(shortPayload, 160)).toEqual([shortPayload]);
    expect(parseQRChunk(shortPayload)).toBeNull();

    const partial = new Map<number, string>([[1, "part1"]]);
    expect(reassembleChunks(partial, 2)).toBeNull();
  });

  it("should generate a 6-digit numeric pairing PIN", () => {
    const pin = generatePairingPin();
    expect(pin).toMatch(/^\d{6}$/);
  });
});
