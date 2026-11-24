import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PouchDB from "pouchdb-browser";
import type { HerdDoc, PouchDBCtor } from "@onebuffalolabs/herd-sync";
import { WebRTCAdapter, pruneSDP } from "@/WebRTCAdapter";
import { compressSDP } from "@/signaling/qr";

interface ItemDoc extends HerdDoc {
  name: string;
}

describe("WebRTCAdapter Conflict Resolution & Ingestion", () => {
  let db: PouchDB.Database<ItemDoc>;
  let adapter: WebRTCAdapter<ItemDoc>;

  beforeEach(() => {
    const Ctor = PouchDB as unknown as PouchDBCtor<ItemDoc>;
    db = new Ctor("test_webrtc_db");
    adapter = new WebRTCAdapter<ItemDoc>(db);
  });

  afterEach(async () => {
    await adapter.stop();
    await db.destroy();
  });

  it("should initialize in idle state", () => {
    expect(adapter.getStatus().state).toBe("idle");
  });

  it("should persist, read, and clear saved peer metadata in localStorage", () => {
    expect(adapter.getSavedPeer()).toBeNull();

    // @ts-expect-error - testing private savePeerRecord helper
    adapter.savePeerRecord("host", "peer-test-123");
    const saved = adapter.getSavedPeer();
    expect(saved).not.toBeNull();
    expect(saved?.peerId).toBe("peer-test-123");
    expect(saved?.role).toBe("host");

    adapter.clearSavedPeer();
    expect(adapter.getSavedPeer()).toBeNull();
  });

  it("should return false on reconnect when no saved peer exists", async () => {
    adapter.clearSavedPeer();
    const result = await adapter.reconnect();
    expect(result).toBe(false);
  });

  it("should preserve newer local revision when incoming doc has older updatedAt timestamp", async () => {
    const initialDoc: ItemDoc = {
      _id: "conflict_item",
      name: "Local Newer Version",
      updatedAt: "2026-10-16T12:00:00.000Z"
    };
    await db.put(initialDoc);

    const olderIncomingDoc: ItemDoc = {
      _id: "conflict_item",
      name: "Stale Remote Version",
      updatedAt: "2026-10-16T11:00:00.000Z"
    };

    // Simulate handleIncomingPayload through reflection
    // @ts-expect-error - testing private handleIncomingPayload directly
    await adapter.handleIncomingPayload({
      type: "SYNC_UPDATE",
      doc: olderIncomingDoc
    });

    const currentDoc = await db.get("conflict_item");
    expect(currentDoc.name).toBe("Local Newer Version");
  });

  it("should overwrite local document when incoming doc has newer updatedAt timestamp", async () => {
    const initialDoc: ItemDoc = {
      _id: "conflict_item_2",
      name: "Old Local",
      updatedAt: "2026-10-16T10:00:00.000Z"
    };
    await db.put(initialDoc);

    const newerIncomingDoc: ItemDoc = {
      _id: "conflict_item_2",
      name: "Newer Remote Winner",
      updatedAt: "2026-10-16T14:00:00.000Z"
    };

    // @ts-expect-error - testing private handleIncomingPayload directly
    await adapter.handleIncomingPayload({
      type: "SYNC_UPDATE",
      doc: newerIncomingDoc
    });

    const currentDoc = await db.get("conflict_item_2");
    expect(currentDoc.name).toBe("Newer Remote Winner");
  });
});

describe("pruneSDP", () => {
  it("removes m=audio and m=video sections, updates BUNDLE, and strips codec/trickle-ICE attributes", () => {
    const bloatedSdp = [
      "v=0",
      "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "a=group:BUNDLE 0 1 2",
      "a=extmap-allow-mixed",
      "a=msid-semantic: WMS stream1",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111 103",
      "c=IN IP4 0.0.0.0",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=rtcp-fb:111 transport-cc",
      "a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level",
      "a=mid:0",
      "a=ssrc:12345 cname:audio",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "c=IN IP4 0.0.0.0",
      "a=rtpmap:96 VP8/90000",
      "a=mid:1",
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "c=IN IP4 0.0.0.0",
      "a=ice-ufrag:x8F2",
      "a=ice-pwd:9gYhK20V12p0bLMNpq78abcdef",
      "a=ice-options:trickle",
      "a=fingerprint:sha-256 00:11:22:33",
      "a=setup:actpass",
      "a=mid:2",
      "a=sctp-port:5000",
      "a=max-message-size:262144",
      "a=end-of-candidates"
    ].join("\r\n");

    const pruned = pruneSDP(bloatedSdp);

    expect(pruned).not.toContain("m=audio");
    expect(pruned).not.toContain("m=video");
    expect(pruned).not.toContain("a=rtpmap:");
    expect(pruned).not.toContain("a=fmtp:");
    expect(pruned).not.toContain("a=rtcp-fb:");
    expect(pruned).not.toContain("a=extmap:");
    expect(pruned).not.toContain("a=extmap-allow-mixed");
    expect(pruned).not.toContain("a=ssrc:");
    expect(pruned).not.toContain("a=msid-semantic:");
    expect(pruned).not.toContain("a=ice-options:trickle");
    expect(pruned).not.toContain("a=end-of-candidates");

    expect(pruned).toContain("a=group:BUNDLE 2");
    expect(pruned).toContain("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
    expect(pruned).toContain("a=ice-ufrag:x8F2");
    expect(pruned).toContain("a=ice-pwd:9gYhK20V12p0bLMNpq78abcdef");
    expect(pruned).toContain("a=fingerprint:sha-256 00:11:22:33");
    expect(pruned).toContain("a=sctp-port:5000");
    expect(compressSDP(pruned).length).toBeLessThan(compressSDP(bloatedSdp).length);
  });

  it("keeps UDP host and primary srflx candidates while dropping TCP, relay, prflx, and extra srflx", () => {
    const sdpWithCandidates = [
      "v=0",
      "o=- 1 2 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "a=candidate:1 1 UDP 2122260223 192.168.1.150 54123 typ host",
      "a=candidate:2 1 TCP 1518280447 192.168.1.150 9 typ host tcptype active",
      "a=candidate:3 1 UDP 1686052607 198.51.100.45 54125 typ srflx raddr 192.168.1.150 rport 54123",
      "a=candidate:4 1 UDP 1686052606 198.51.100.46 54126 typ srflx raddr 10.0.0.12 rport 54124",
      "a=candidate:5 1 UDP 41885439 203.0.113.10 54127 typ relay raddr 198.51.100.45 rport 54125",
      "a=candidate:6 1 UDP 1853824767 198.51.100.99 54128 typ prflx raddr 192.168.1.150 rport 54123"
    ].join("\r\n");

    const pruned = pruneSDP(sdpWithCandidates);

    expect(pruned).toContain("a=candidate:1 1 UDP 2122260223 192.168.1.150 54123 typ host");
    expect(pruned).toContain(
      "a=candidate:3 1 UDP 1686052607 198.51.100.45 54125 typ srflx raddr 192.168.1.150 rport 54123"
    );
    expect(pruned).not.toContain("TCP");
    expect(pruned).not.toContain("a=candidate:4");
    expect(pruned).not.toContain("typ relay");
    expect(pruned).not.toContain("typ prflx");
  });
});
