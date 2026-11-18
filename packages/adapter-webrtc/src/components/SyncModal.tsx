"use client";

// --- React ---
import React, { useEffect, useRef, useState } from "react";

// --- Vendor ---
import jsQR from "jsqr";
import { QRCodeSVG } from "qrcode.react";

// --- HerdSync ---
import type { HerdSyncStatus } from "@onebuffalolabs/herd-sync";

// --- Signaling & Adapter ---
import {
  buildMailtoHref,
  buildPairingUrl,
  buildSmsHref,
  compressSDP,
  decompressSDP,
  extractPairingPayload
} from "@/signaling/qr";
import type { SyncStep } from "@/types";
import { WebRTCAdapter } from "@/WebRTCAdapter";

export interface SyncModalProps {
  adapter: WebRTCAdapter;
  onClose: () => void;
  initialPairingPayload?: string | null;
}

/**
 * QR Code based signaling dialog for establishing zero-backend WebRTC synchronization.
 */
export function SyncModal({ adapter, onClose, initialPairingPayload }: SyncModalProps) {
  const [step, setStep] = useState<SyncStep>("SELECT");
  const [qrPayload, setQrPayload] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [recipientEmail, setRecipientEmail] = useState<string>("");
  const [manualPayload, setManualPayload] = useState<string>("");
  const [manualError, setManualError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pairingUrl = qrPayload ? buildPairingUrl(qrPayload) : "";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleCopyPayload = async () => {
    if (!qrPayload) return;
    try {
      await navigator.clipboard.writeText(qrPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable; user can still select and copy from the textarea
    }
  };

  const handleCopyLink = async () => {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const handleNativeShare = async () => {
    if (!pairingUrl || !canNativeShare) return;
    try {
      await navigator.share({
        title: "HerdSync Device Pairing",
        text: "Open this link on your other device to pair:",
        url: pairingUrl
      });
    } catch {
      // Share cancelled or unavailable
    }
  };

  const handleManualConnect = () => {
    const extracted = extractPairingPayload(manualPayload);
    if (!extracted) {
      setManualError("Paste a pairing snippet or link first.");
      return;
    }
    const decompressed = decompressSDP(extracted);
    if (!decompressed) {
      setManualError("Invalid pairing snippet or link.");
      return;
    }
    setManualError(null);
    setManualPayload("");
    if (step === "JOIN_SCAN_QR") {
      void adapter.join(decompressed);
    } else if (step === "HOST_SCAN_QR") {
      void adapter.complete(decompressed);
    }
  };

  useEffect(() => {
    adapter.onOfferCreated = (sdp: string) => {
      setQrPayload(compressSDP(sdp));
      setStep("HOST_SHOW_QR");
    };
    adapter.onAnswerCreated = (sdp: string) => {
      setQrPayload(compressSDP(sdp));
      setStep("JOIN_SHOW_QR");
    };

    const unsubscribe = adapter.subscribe((status: HerdSyncStatus) => {
      if (status.state === "connected") {
        setStep("CONNECTED");
      }
    });

    return () => {
      unsubscribe();
    };
  }, [adapter]);

  useEffect(() => {
    const rawSource =
      initialPairingPayload ?? (typeof window !== "undefined" ? window.location.hash : "");
    const extracted = rawSource ? extractPairingPayload(rawSource) : null;
    if (!extracted) return;

    const decompressed = decompressSDP(extracted);
    if (!decompressed) return;

    if (!initialPairingPayload && typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    void adapter.join(decompressed);
  }, [adapter, initialPairingPayload]);

  useEffect(() => {
    let animationFrameId: number;
    let stream: MediaStream | null = null;

    const startScanner = async () => {
      if ((step !== "HOST_SCAN_QR" && step !== "JOIN_SCAN_QR") || !videoRef.current) {
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
          tick();
        }
      } catch {
        // Camera permissions denied or unavailable
      }
    };

    const tick = () => {
      if (
        !videoRef.current ||
        !canvasRef.current ||
        videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA
      ) {
        animationFrameId = requestAnimationFrame(tick);
        return;
      }

      const canvas = canvasRef.current;
      const video = videoRef.current;
      const ctx = canvas.getContext("2d");

      if (!ctx) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert"
      });

      if (code && code.data) {
        const extracted = extractPairingPayload(code.data);
        const decompressed = extracted ? decompressSDP(extracted) : null;
        if (decompressed) {
          if (step === "JOIN_SCAN_QR") {
            void adapter.join(decompressed);
          } else if (step === "HOST_SCAN_QR") {
            void adapter.complete(decompressed);
          }
          return;
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    void startScanner();

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [step, adapter]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          padding: "2rem",
          borderRadius: "12px",
          maxWidth: "460px",
          width: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
          textAlign: "center"
        }}
      >
        {step === "SELECT" && (
          <div>
            <h2>P2P Device Sync</h2>
            <p>Select your connection role for this device.</p>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "center",
                marginTop: "1.5rem"
              }}
            >
              <button
                type="button"
                onClick={() => void adapter.host()}
                style={{ padding: "0.5rem 1rem", cursor: "pointer" }}
              >
                Host (Device A)
              </button>
              <button
                type="button"
                onClick={() => setStep("JOIN_SCAN_QR")}
                style={{ padding: "0.5rem 1rem", cursor: "pointer" }}
              >
                Join (Device B)
              </button>
            </div>
          </div>
        )}

        {(step === "HOST_SHOW_QR" || step === "JOIN_SHOW_QR") && (
          <div>
            <h2>{step === "HOST_SHOW_QR" ? "Scan with Device B" : "Scan with Device A"}</h2>
            <div style={{ padding: "1rem", display: "inline-block", margin: "0.75rem 0" }}>
              <QRCodeSVG value={qrPayload} size={320} level="L" includeMargin />
            </div>
            <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
              <label
                htmlFor="herd-sync-qr-snippet"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem"
                }}
              >
                Or copy pairing snippet:
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                <textarea
                  id="herd-sync-qr-snippet"
                  readOnly
                  value={qrPayload}
                  rows={2}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{
                    flex: 1,
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                    padding: "0.4rem",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    resize: "none"
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleCopyPayload()}
                  style={{ padding: "0.4rem 0.75rem", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
              <label
                htmlFor="herd-sync-email-input"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem"
                }}
              >
                Send pairing link via email or text:
              </label>
              <input
                id="herd-sync-email-input"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="Optional email address..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontSize: "0.8rem",
                  padding: "0.4rem",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  marginBottom: "0.5rem"
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  style={{ flex: 1, padding: "0.4rem 0.6rem", cursor: "pointer" }}
                >
                  {copiedLink ? "Link Copied!" : "Copy Link"}
                </button>
                <a
                  href={buildMailtoHref(pairingUrl, recipientEmail)}
                  style={{
                    flex: 1,
                    padding: "0.4rem 0.6rem",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    textDecoration: "none",
                    color: "inherit",
                    textAlign: "center",
                    fontSize: "0.85rem"
                  }}
                >
                  Email
                </a>
                <a
                  href={buildSmsHref(pairingUrl)}
                  style={{
                    flex: 1,
                    padding: "0.4rem 0.6rem",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    textDecoration: "none",
                    color: "inherit",
                    textAlign: "center",
                    fontSize: "0.85rem"
                  }}
                >
                  Text
                </a>
                {canNativeShare && (
                  <button
                    type="button"
                    onClick={() => void handleNativeShare()}
                    style={{ flex: 1, padding: "0.4rem 0.6rem", cursor: "pointer" }}
                  >
                    Share
                  </button>
                )}
              </div>
            </div>
            {step === "HOST_SHOW_QR" && (
              <div style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setStep("HOST_SCAN_QR")}
                  style={{ padding: "0.5rem 1rem", cursor: "pointer" }}
                >
                  I scanned this on Device B
                </button>
              </div>
            )}
          </div>
        )}

        {(step === "HOST_SCAN_QR" || step === "JOIN_SCAN_QR") && (
          <div>
            <h2>Scan Peer QR Code</h2>
            <div
              style={{
                position: "relative",
                width: "100%",
                paddingTop: "100%",
                backgroundColor: "#000",
                margin: "1rem 0",
                overflow: "hidden",
                borderRadius: "8px"
              }}
            >
              <video
                ref={videoRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover"
                }}
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>
            <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
              <label
                htmlFor="herd-sync-paste-snippet"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem"
                }}
              >
                Or paste pairing snippet:
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                <textarea
                  id="herd-sync-paste-snippet"
                  value={manualPayload}
                  onChange={(e) => setManualPayload(e.target.value)}
                  placeholder="Paste compressed SDP snippet..."
                  rows={2}
                  style={{
                    flex: 1,
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                    padding: "0.4rem",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    resize: "none"
                  }}
                />
                <button
                  type="button"
                  onClick={handleManualConnect}
                  style={{ padding: "0.4rem 0.75rem", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Connect
                </button>
              </div>
              {manualError && (
                <p style={{ color: "#c62828", fontSize: "0.8rem", marginTop: "0.25rem" }}>
                  {manualError}
                </p>
              )}
            </div>
          </div>
        )}

        {step === "CONNECTED" && (
          <div>
            <h2 style={{ color: "#2e7d32" }}>Connected</h2>
            <p>Direct peer-to-peer WebRTC link established.</p>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{ marginTop: "2rem", width: "100%", padding: "0.5rem", cursor: "pointer" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
