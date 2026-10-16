import { describe, expect, it } from "vitest";
import { compressSDP, decompressSDP } from "@/signaling/qr";

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
});
