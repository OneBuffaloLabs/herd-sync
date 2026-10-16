"use client";

// --- React ---
import React, { useEffect, useRef, useState } from "react";

// --- Vendor ---
import jsQR from "jsqr";
import { QRCodeSVG } from "qrcode.react";

// --- HerdSync ---
import type { HerdSyncStatus } from "@onebuffalo/herd-sync";

// --- Signaling & Adapter ---
import { compressSDP, decompressSDP } from "@/signaling/qr";
import type { SyncStep } from "@/types";
import { WebRTCAdapter } from "@/WebRTCAdapter";

export interface SyncModalProps {
  adapter: WebRTCAdapter;
  onClose: () => void;
}

/**
 * QR Code based signaling dialog for establishing zero-backend WebRTC synchronization.
 */
export function SyncModal({ adapter, onClose }: SyncModalProps) {
  const [step, setStep] = useState<SyncStep>("SELECT");
  const [qrPayload, setQrPayload] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
        const decompressed = decompressSDP(code.data);
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
          maxWidth: "420px",
          width: "90%",
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
            <div style={{ padding: "1rem", display: "inline-block", margin: "1rem 0" }}>
              <QRCodeSVG value={qrPayload} size={250} level="L" includeMargin />
            </div>
            {step === "HOST_SHOW_QR" && (
              <div>
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
