"use client";

// --- React ---
import React, { useCallback, useEffect, useState } from "react";

// --- HerdSync ---
import type { HerdSyncStatus } from "@onebuffalolabs/herd-sync";

// --- Signaling & Adapter ---
import {
  broadcastPinPayload,
  compressSDP,
  decompressSDP,
  extractPairingPayload,
  generatePairingPin
} from "@/signaling/qr";
import type { PairedPeerRecord, SyncStep } from "@/types";
import { WebRTCAdapter } from "@/WebRTCAdapter";

// --- Components ---
import { AnimatedQRCode } from "@/components/AnimatedQRCode";
import { PairingSharePanel } from "@/components/PairingSharePanel";
import { QRScannerPanel } from "@/components/QRScannerPanel";
import { SyncFloatingWidget } from "@/components/SyncFloatingWidget";

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
  floatingWidget?: string;
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
  defaultMinimized?: boolean;
  classNames?: SyncModalClassNames;
  colors?: SyncModalColors;
}

/**
 * Non-blocking QR Code & PIN signaling dialog for zero-backend WebRTC synchronization.
 * Minimizing or closing preserves the active peer connection and background replication.
 */
export function SyncModal({
  adapter,
  onClose,
  initialPairingPayload,
  defaultMinimized = false,
  classNames,
  colors
}: SyncModalProps) {
  const initialStatus = adapter.getStatus();
  const isInitiallyConnected =
    initialStatus.state === "connected" || initialStatus.state === "syncing";

  const [step, setStep] = useState<SyncStep>(isInitiallyConnected ? "CONNECTED" : "SELECT");
  const [status, setStatus] = useState<HerdSyncStatus>(initialStatus);
  const [isMinimized, setIsMinimized] = useState<boolean>(defaultMinimized);
  const [qrPayload, setQrPayload] = useState<string>("");
  const [pairingPin, setPairingPin] = useState<string>("");
  const [savedPeer, setSavedPeer] = useState<PairedPeerRecord | null>(() => adapter.getSavedPeer());

  useEffect(() => {
    adapter.onOfferCreated = (sdp: string) => {
      setQrPayload(compressSDP(sdp));
      setPairingPin(generatePairingPin());
      setStep("HOST_SHOW_QR");
    };
    adapter.onAnswerCreated = (sdp: string) => {
      setQrPayload(compressSDP(sdp));
      setPairingPin(generatePairingPin());
      setStep("JOIN_SHOW_QR");
    };

    const unsubscribe = adapter.subscribe((nextStatus: HerdSyncStatus) => {
      setStatus(nextStatus);
      if (nextStatus.state === "connected" || nextStatus.state === "syncing") {
        setStep("CONNECTED");
        setSavedPeer(adapter.getSavedPeer());
      }
    });

    return () => {
      unsubscribe();
    };
  }, [adapter]);

  useEffect(() => {
    if (!pairingPin || !qrPayload) return;
    if (step !== "HOST_SHOW_QR" && step !== "JOIN_SHOW_QR") return;
    return broadcastPinPayload(pairingPin, qrPayload);
  }, [pairingPin, qrPayload, step]);

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

  const handleSdpScanned = useCallback(
    (sdp: string) => {
      if (step === "JOIN_SCAN_QR") {
        void adapter.join(sdp);
      } else if (step === "HOST_SCAN_QR") {
        void adapter.complete(sdp);
      }
    },
    [adapter, step]
  );

  const handleDisconnect = () => {
    void adapter.stop();
    setStep("SELECT");
  };

  const handleReconnect = () => {
    void adapter.reconnect();
  };

  const handleForgetPeer = () => {
    adapter.clearSavedPeer();
    setSavedPeer(null);
  };

  if (isMinimized) {
    return (
      <SyncFloatingWidget
        status={status}
        onExpand={() => setIsMinimized(false)}
        className={classNames?.floatingWidget}
        colors={colors}
      />
    );
  }

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
    padding: "1.75rem",
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <button
            id="herd-sync-minimize-btn"
            type="button"
            className={classNames?.secondaryButton}
            onClick={() => setIsMinimized(true)}
            style={{ ...secondaryBtnStyle, fontSize: "0.8rem" }}
          >
            Minimize
          </button>
        </div>

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
                marginTop: "1.25rem"
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

            {savedPeer && (
              <div
                id="herd-sync-reconnect-card"
                style={{
                  marginTop: "1.25rem",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  border: `1px solid ${colors?.border ?? "#d1d5db"}`,
                  textAlign: "left"
                }}
              >
                <p className={classNames?.text} style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                  Previously paired as <strong>{savedPeer.role}</strong> (last active{" "}
                  {new Date(savedPeer.lastConnectedAt).toLocaleString()}).
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    id="herd-sync-reconnect-btn"
                    type="button"
                    className={classNames?.primaryButton}
                    onClick={handleReconnect}
                    style={{ ...primaryBtnStyle, flex: 1 }}
                  >
                    Reconnect
                  </button>
                  <button
                    id="herd-sync-forget-peer-btn"
                    type="button"
                    className={classNames?.secondaryButton}
                    onClick={handleForgetPeer}
                    style={secondaryBtnStyle}
                  >
                    Forget
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {(step === "HOST_SHOW_QR" || step === "JOIN_SHOW_QR") && (
          <div>
            <h2 id="herd-sync-qr-heading" className={classNames?.heading}>
              {step === "HOST_SHOW_QR" ? "Scan with Device B" : "Scan with Device A"}
            </h2>
            <AnimatedQRCode
              payload={qrPayload}
              qrBackground={colors?.qrBackground}
              qrForeground={colors?.qrForeground}
              containerClassName={classNames?.qrContainer}
              buttonClassName={classNames?.secondaryButton}
              textClassName={classNames?.text}
              secondaryBtnStyle={secondaryBtnStyle}
            />
            <PairingSharePanel
              qrPayload={qrPayload}
              pin={pairingPin}
              textClassName={classNames?.text}
              inputClassName={classNames?.input}
              buttonClassName={classNames?.secondaryButton}
              inputStyle={inputStyle}
              secondaryBtnStyle={secondaryBtnStyle}
              linkBtnStyle={linkBtnStyle}
            />
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
          <QRScannerPanel
            active={step === "HOST_SCAN_QR" || step === "JOIN_SCAN_QR"}
            onSdpScanned={handleSdpScanned}
            headingClassName={classNames?.heading}
            textClassName={classNames?.text}
            inputClassName={classNames?.input}
            primaryButtonClassName={classNames?.primaryButton}
            errorTextClassName={classNames?.errorText}
            inputStyle={inputStyle}
            primaryBtnStyle={primaryBtnStyle}
            errorColor={colors?.error}
          />
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
              Direct peer-to-peer WebRTC link active. Minimize or close to keep syncing in the
              background.
            </p>
            <button
              id="herd-sync-disconnect-btn"
              type="button"
              className={classNames?.secondaryButton}
              onClick={handleDisconnect}
              style={{ ...secondaryBtnStyle, marginTop: "0.75rem" }}
            >
              Disconnect Peer
            </button>
          </div>
        )}

        <button
          id="herd-sync-close-btn"
          type="button"
          className={classNames?.closeButton}
          onClick={onClose}
          style={{
            marginTop: "1.5rem",
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
