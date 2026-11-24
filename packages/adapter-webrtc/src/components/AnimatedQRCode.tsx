"use client";

// --- React ---
import React, { useEffect, useMemo, useState } from "react";

// --- Vendor ---
import { QRCodeSVG } from "qrcode.react";

// --- Signaling ---
import { chunkPayload } from "@/signaling/qr";

export interface AnimatedQRCodeProps {
  payload: string;
  size?: number;
  intervalMs?: number;
  qrBackground?: string;
  qrForeground?: string;
  containerClassName?: string;
  buttonClassName?: string;
  textClassName?: string;
  secondaryBtnStyle?: React.CSSProperties;
}

/**
 * Renders a low-density QR code, automatically cycling through compressed chunks
 * when a signaling payload exceeds comfortable single-frame scan density.
 */
export function AnimatedQRCode({
  payload,
  size = 280,
  intervalMs = 550,
  qrBackground = "#FFFFFF",
  qrForeground = "#000000",
  containerClassName,
  buttonClassName,
  textClassName,
  secondaryBtnStyle
}: AnimatedQRCodeProps) {
  const chunks = useMemo(() => chunkPayload(payload, 160), [payload]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    setFrameIndex(0);
    setIsPaused(false);
  }, [payload]);

  useEffect(() => {
    if (chunks.length <= 1 || isPaused) return;
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % chunks.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [chunks, intervalMs, isPaused]);

  const activeValue = chunks[frameIndex] ?? payload;
  const isAnimated = chunks.length > 1;

  return (
    <div>
      <div
        id="herd-sync-qr-container"
        className={containerClassName}
        style={{
          padding: "1rem",
          display: "inline-block",
          margin: "0.5rem 0",
          backgroundColor: qrBackground,
          borderRadius: "8px"
        }}
      >
        <QRCodeSVG
          value={activeValue}
          size={size}
          level="L"
          includeMargin
          bgColor={qrBackground}
          fgColor={qrForeground}
        />
      </div>

      {isAnimated && (
        <div
          id="herd-sync-qr-stream-controls"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            marginBottom: "0.5rem"
          }}
        >
          <span className={textClassName} style={{ fontSize: "0.8rem", fontWeight: 600 }}>
            Animated QR: Frame {frameIndex + 1} of {chunks.length}
          </span>
          <button
            id="herd-sync-qr-pause-btn"
            type="button"
            className={buttonClassName}
            onClick={() => setIsPaused((prev) => !prev)}
            style={{
              ...secondaryBtnStyle,
              padding: "0.2rem 0.55rem",
              fontSize: "0.75rem"
            }}
          >
            {isPaused ? "Resume" : "Pause"}
          </button>
        </div>
      )}
    </div>
  );
}
