"use client";

// --- React ---
import React, { useEffect, useRef, useState } from "react";

// --- Vendor ---
import jsQR from "jsqr";

// --- Signaling ---
import {
  decompressSDP,
  extractPairingPayload,
  lookupPinPayload,
  parseQRChunk,
  reassembleChunks
} from "@/signaling/qr";

export interface QRScannerPanelProps {
  active: boolean;
  onSdpScanned: (sdp: string) => void;
  headingClassName?: string;
  textClassName?: string;
  inputClassName?: string;
  primaryButtonClassName?: string;
  errorTextClassName?: string;
  inputStyle: React.CSSProperties;
  primaryBtnStyle: React.CSSProperties;
  errorColor?: string;
}

/**
 * Camera QR scanner supporting both single-frame payloads and multi-frame animated QR streams,
 * plus 6-digit PIN and manual snippet/#pair= link fallbacks.
 */
export function QRScannerPanel({
  active,
  onSdpScanned,
  headingClassName,
  textClassName,
  inputClassName,
  primaryButtonClassName,
  errorTextClassName,
  inputStyle,
  primaryBtnStyle,
  errorColor = "#c62828"
}: QRScannerPanelProps) {
  const [manualPayload, setManualPayload] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ received: number; total: number } | null>(
    null
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chunkBufferRef = useRef<Map<number, string>>(new Map());
  const chunkTotalRef = useRef<number>(0);

  const handlePinConnect = async () => {
    const cleaned = pinInput.trim();
    if (!/^\d{6}$/.test(cleaned)) {
      setManualError("Enter a valid 6-digit PIN.");
      return;
    }
    setManualError(null);
    const payload = await lookupPinPayload(cleaned);
    if (!payload) {
      setManualError(
        "PIN not found on this device. Use the #pair= link or scan the QR code for cross-device pairing."
      );
      return;
    }
    const decompressed = decompressSDP(payload);
    if (!decompressed) {
      setManualError("Invalid PIN payload.");
      return;
    }
    setPinInput("");
    onSdpScanned(decompressed);
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
    onSdpScanned(decompressed);
  };

  useEffect(() => {
    if (!active) return;

    chunkBufferRef.current = new Map();
    chunkTotalRef.current = 0;
    setScanProgress(null);

    let animationFrameId: number;
    let stream: MediaStream | null = null;

    const startScanner = async () => {
      if (!videoRef.current) return;
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
        const chunk = parseQRChunk(code.data);
        if (chunk) {
          if (chunkTotalRef.current !== chunk.total) {
            chunkBufferRef.current = new Map();
            chunkTotalRef.current = chunk.total;
          }
          if (!chunkBufferRef.current.has(chunk.index)) {
            chunkBufferRef.current.set(chunk.index, chunk.data);
            setScanProgress({
              received: chunkBufferRef.current.size,
              total: chunk.total
            });
          }
          const fullPayload = reassembleChunks(chunkBufferRef.current, chunk.total);
          if (fullPayload) {
            const decompressed = decompressSDP(fullPayload);
            if (decompressed) {
              onSdpScanned(decompressed);
              return;
            }
          }
        } else {
          const extracted = extractPairingPayload(code.data);
          const decompressed = extracted ? decompressSDP(extracted) : null;
          if (decompressed) {
            onSdpScanned(decompressed);
            return;
          }
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
  }, [active, onSdpScanned]);

  return (
    <div>
      <h2 id="herd-sync-scan-heading" className={headingClassName}>
        Scan Peer QR Code
      </h2>
      <div
        id="herd-sync-scanner-container"
        style={{
          position: "relative",
          width: "100%",
          paddingTop: "100%",
          backgroundColor: "#000",
          margin: "0.75rem 0",
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

      {scanProgress && (
        <p
          id="herd-sync-scan-progress"
          className={textClassName}
          style={{ fontSize: "0.85rem", fontWeight: 600, margin: "0.25rem 0" }}
        >
          Scanned {scanProgress.received} / {scanProgress.total} frames...
        </p>
      )}

      <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
        <label
          htmlFor="herd-sync-pin-input"
          className={textClassName}
          style={{
            display: "block",
            fontSize: "0.85rem",
            fontWeight: 600,
            marginBottom: "0.25rem"
          }}
        >
          Or enter 6-digit PIN (same device):
        </label>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
          <input
            id="herd-sync-pin-input"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className={inputClassName}
            style={{
              ...inputStyle,
              flex: 1,
              fontFamily: "monospace",
              letterSpacing: "0.2em"
            }}
          />
          <button
            id="herd-sync-pin-connect-btn"
            type="button"
            className={primaryButtonClassName}
            onClick={() => void handlePinConnect()}
            style={{ ...primaryBtnStyle, padding: "0.4rem 0.75rem", whiteSpace: "nowrap" }}
          >
            Pair PIN
          </button>
        </div>
      </div>

      <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
        <label
          htmlFor="herd-sync-paste-snippet"
          className={textClassName}
          style={{
            display: "block",
            fontSize: "0.85rem",
            fontWeight: 600,
            marginBottom: "0.25rem"
          }}
        >
          Or paste pairing snippet / #pair= link:
        </label>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
          <textarea
            id="herd-sync-paste-snippet"
            value={manualPayload}
            onChange={(e) => setManualPayload(e.target.value)}
            placeholder="Paste compressed SDP snippet or #pair= link..."
            rows={2}
            className={inputClassName}
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
            className={primaryButtonClassName}
            onClick={handleManualConnect}
            style={{ ...primaryBtnStyle, padding: "0.4rem 0.75rem", whiteSpace: "nowrap" }}
          >
            Connect
          </button>
        </div>
        {manualError && (
          <p
            id="herd-sync-manual-error"
            className={errorTextClassName}
            style={{
              fontSize: "0.8rem",
              marginTop: "0.25rem",
              color: errorColor
            }}
          >
            {manualError}
          </p>
        )}
      </div>
    </div>
  );
}
