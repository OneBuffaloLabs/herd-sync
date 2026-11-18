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

export interface SyncModalClassNames {
  overlay?: string;
  dialog?: string;
  heading?: string;
  text?: string;
  primaryButton?: string;
  secondaryButton?: string;
  input?: string;
  qrContainer?: string;
  closeButton?: string;
  errorText?: string;
  successHeading?: string;
}

export interface SyncModalColors {
  overlay?: string;
  background?: string;
  text?: string;
  border?: string;
  primary?: string;
  primaryText?: string;
  secondary?: string;
  secondaryText?: string;
  inputBackground?: string;
  qrBackground?: string;
  qrForeground?: string;
  success?: string;
  error?: string;
}

export interface SyncModalProps {
  adapter: WebRTCAdapter;
  onClose: () => void;
  initialPairingPayload?: string | null;
  classNames?: SyncModalClassNames;
  colors?: SyncModalColors;
}

/**
 * QR Code based signaling dialog for establishing zero-backend WebRTC synchronization.
 */
export function SyncModal({
  adapter,
  onClose,
  initialPairingPayload,
  classNames,
  colors
}: SyncModalProps) {
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

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    ...(colors?.overlay || !classNames?.overlay
      ? { backgroundColor: colors?.overlay ?? "rgba(0, 0, 0, 0.8)" }
      : {})
  };

  const dialogStyle: React.CSSProperties = {
    padding: "2rem",
    borderRadius: "12px",
    maxWidth: "460px",
    width: "90%",
    maxHeight: "90vh",
    overflowY: "auto",
    textAlign: "center",
    ...(colors?.background || !classNames?.dialog
      ? { backgroundColor: colors?.background ?? "#fff" }
      : {}),
    ...(colors?.text ? { color: colors.text } : {})
  };

  const primaryBtnStyle: React.CSSProperties = {
    padding: "0.5rem 1rem",
    cursor: "pointer",
    ...(colors?.primary ? { backgroundColor: colors.primary } : {}),
    ...(colors?.primaryText ? { color: colors.primaryText } : {})
  };

  const secondaryBtnStyle: React.CSSProperties = {
    padding: "0.4rem 0.6rem",
    cursor: "pointer",
    ...(colors?.secondary ? { backgroundColor: colors.secondary } : {}),
    ...(colors?.secondaryText ? { color: colors.secondaryText } : {}),
    ...(colors?.border ? { borderColor: colors.border } : {})
  };

  const inputStyle: React.CSSProperties = {
    fontSize: "0.8rem",
    padding: "0.4rem",
    borderRadius: "6px",
    ...(colors?.border || !classNames?.input
      ? { border: `1px solid ${colors?.border ?? "#ccc"}` }
      : {}),
    ...(colors?.inputBackground ? { backgroundColor: colors.inputBackground } : {}),
    ...(colors?.text ? { color: colors.text } : {})
  };

  const linkBtnStyle: React.CSSProperties = {
    flex: 1,
    padding: "0.4rem 0.6rem",
    borderRadius: "4px",
    textDecoration: "none",
    textAlign: "center",
    fontSize: "0.85rem",
    ...(colors?.border || !classNames?.secondaryButton
      ? { border: `1px solid ${colors?.border ?? "#ccc"}` }
      : {}),
    ...(colors?.secondary ? { backgroundColor: colors.secondary } : {}),
    ...(colors?.secondaryText || !classNames?.secondaryButton
      ? { color: colors?.secondaryText ?? "inherit" }
      : {})
  };

  return (
    <div id="herd-sync-overlay" className={classNames?.overlay} style={overlayStyle}>
      <div id="herd-sync-dialog" className={classNames?.dialog} style={dialogStyle}>
        {step === "SELECT" && (
          <div>
            <h2 id="herd-sync-select-heading" className={classNames?.heading}>
              P2P Device Sync
            </h2>
            <p id="herd-sync-select-text" className={classNames?.text}>
              Select your connection role for this device.
            </p>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "center",
                marginTop: "1.5rem"
              }}
            >
              <button
                id="herd-sync-host-btn"
                type="button"
                className={classNames?.primaryButton}
                onClick={() => void adapter.host()}
                style={primaryBtnStyle}
              >
                Host (Device A)
              </button>
              <button
                id="herd-sync-join-btn"
                type="button"
                className={classNames?.secondaryButton}
                onClick={() => setStep("JOIN_SCAN_QR")}
                style={primaryBtnStyle}
              >
                Join (Device B)
              </button>
            </div>
          </div>
        )}

        {(step === "HOST_SHOW_QR" || step === "JOIN_SHOW_QR") && (
          <div>
            <h2 id="herd-sync-qr-heading" className={classNames?.heading}>
              {step === "HOST_SHOW_QR" ? "Scan with Device B" : "Scan with Device A"}
            </h2>
            <div
              id="herd-sync-qr-container"
              className={classNames?.qrContainer}
              style={{
                padding: "1rem",
                display: "inline-block",
                margin: "0.75rem 0",
                ...(colors?.qrBackground ? { backgroundColor: colors.qrBackground } : {})
              }}
            >
              <QRCodeSVG
                value={qrPayload}
                size={320}
                level="L"
                includeMargin
                bgColor={colors?.qrBackground ?? "#FFFFFF"}
                fgColor={colors?.qrForeground ?? "#000000"}
              />
            </div>
            <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
              <label
                htmlFor="herd-sync-qr-snippet"
                className={classNames?.text}
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
                  className={classNames?.input}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                    resize: "none"
                  }}
                />
                <button
                  id="herd-sync-copy-snippet-btn"
                  type="button"
                  className={classNames?.secondaryButton}
                  onClick={() => void handleCopyPayload()}
                  style={{ ...secondaryBtnStyle, whiteSpace: "nowrap" }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
              <label
                htmlFor="herd-sync-email-input"
                className={classNames?.text}
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
                className={classNames?.input}
                style={{
                  ...inputStyle,
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: "0.5rem"
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  id="herd-sync-copy-link-btn"
                  type="button"
                  className={classNames?.secondaryButton}
                  onClick={() => void handleCopyLink()}
                  style={{ ...secondaryBtnStyle, flex: 1 }}
                >
                  {copiedLink ? "Link Copied!" : "Copy Link"}
                </button>
                <a
                  id="herd-sync-email-link"
                  href={buildMailtoHref(pairingUrl, recipientEmail)}
                  className={classNames?.secondaryButton}
                  style={linkBtnStyle}
                >
                  Email
                </a>
                <a
                  id="herd-sync-sms-link"
                  href={buildSmsHref(pairingUrl)}
                  className={classNames?.secondaryButton}
                  style={linkBtnStyle}
                >
                  Text
                </a>
                {canNativeShare && (
                  <button
                    id="herd-sync-share-btn"
                    type="button"
                    className={classNames?.secondaryButton}
                    onClick={() => void handleNativeShare()}
                    style={{ ...secondaryBtnStyle, flex: 1 }}
                  >
                    Share
                  </button>
                )}
              </div>
            </div>
            {step === "HOST_SHOW_QR" && (
              <div style={{ marginTop: "0.75rem" }}>
                <button
                  id="herd-sync-scanned-btn"
                  type="button"
                  className={classNames?.primaryButton}
                  onClick={() => setStep("HOST_SCAN_QR")}
                  style={primaryBtnStyle}
                >
                  I scanned this on Device B
                </button>
              </div>
            )}
          </div>
        )}

        {(step === "HOST_SCAN_QR" || step === "JOIN_SCAN_QR") && (
          <div>
            <h2 id="herd-sync-scan-heading" className={classNames?.heading}>
              Scan Peer QR Code
            </h2>
            <div
              id="herd-sync-scanner-container"
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
                id="herd-sync-scanner-video"
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
                className={classNames?.text}
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
                  className={classNames?.input}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                    resize: "none"
                  }}
                />
                <button
                  id="herd-sync-connect-btn"
                  type="button"
                  className={classNames?.primaryButton}
                  onClick={handleManualConnect}
                  style={{ ...primaryBtnStyle, padding: "0.4rem 0.75rem", whiteSpace: "nowrap" }}
                >
                  Connect
                </button>
              </div>
              {manualError && (
                <p
                  id="herd-sync-manual-error"
                  className={classNames?.errorText}
                  style={{
                    fontSize: "0.8rem",
                    marginTop: "0.25rem",
                    ...(colors?.error || !classNames?.errorText
                      ? { color: colors?.error ?? "#c62828" }
                      : {})
                  }}
                >
                  {manualError}
                </p>
              )}
            </div>
          </div>
        )}

        {step === "CONNECTED" && (
          <div>
            <h2
              id="herd-sync-connected-heading"
              className={classNames?.successHeading}
              style={
                colors?.success || !classNames?.successHeading
                  ? { color: colors?.success ?? "#2e7d32" }
                  : undefined
              }
            >
              Connected
            </h2>
            <p id="herd-sync-connected-text" className={classNames?.text}>
              Direct peer-to-peer WebRTC link established.
            </p>
          </div>
        )}

        <button
          id="herd-sync-close-btn"
          type="button"
          className={classNames?.closeButton}
          onClick={onClose}
          style={{
            marginTop: "2rem",
            width: "100%",
            padding: "0.5rem",
            cursor: "pointer",
            ...(colors?.secondary ? { backgroundColor: colors.secondary } : {}),
            ...(colors?.secondaryText ? { color: colors.secondaryText } : {})
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
