"use client";

// --- React ---
import React from "react";

// --- HerdSync ---
import type { HerdSyncStatus } from "@onebuffalolabs/herd-sync";

export interface SyncFloatingWidgetColors {
  background?: string;
  text?: string;
  border?: string;
  success?: string;
  error?: string;
  primary?: string;
}

export interface SyncFloatingWidgetProps {
  status: HerdSyncStatus;
  onExpand: () => void;
  className?: string;
  colors?: SyncFloatingWidgetColors;
}

const STATE_LABELS: Record<HerdSyncStatus["state"], string> = {
  uninitialized: "P2P Initializing",
  idle: "P2P Idle",
  connecting: "Connecting...",
  connected: "P2P Connected",
  syncing: "Syncing...",
  paused: "Sync Paused",
  disconnected: "Disconnected",
  error: "Sync Error",
  denied: "Sync Denied"
};

/**
 * Non-blocking corner indicator showing live background P2P sync status.
 */
export function SyncFloatingWidget({
  status,
  onExpand,
  className,
  colors
}: SyncFloatingWidgetProps) {
  const dotColor =
    status.state === "connected" || status.state === "syncing"
      ? (colors?.success ?? "#2e7d32")
      : status.state === "error" || status.state === "denied"
        ? (colors?.error ?? "#c62828")
        : status.state === "connecting"
          ? (colors?.primary ?? "#ed6c02")
          : "#757575";

  const widgetStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "1.25rem",
    right: "1.25rem",
    zIndex: 9998,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.6rem 0.95rem",
    borderRadius: "9999px",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.18)",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 600,
    ...(colors?.background || !className
      ? { backgroundColor: colors?.background ?? "#ffffff" }
      : {}),
    ...(colors?.text || !className ? { color: colors?.text ?? "#111827" } : {}),
    ...(colors?.border || !className
      ? { border: `1px solid ${colors?.border ?? "#d1d5db"}` }
      : {})
  };

  return (
    <button
      id="herd-sync-floating-widget"
      type="button"
      onClick={onExpand}
      className={className}
      style={widgetStyle}
      aria-label={`Open P2P Sync (${STATE_LABELS[status.state]})`}
    >
      <span
        aria-hidden="true"
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: dotColor,
          flexShrink: 0
        }}
      />
      <span>{STATE_LABELS[status.state]}</span>
      {status.lastSyncedAt && (
        <span style={{ fontSize: "0.75rem", fontWeight: 400, opacity: 0.75 }}>
          &bull; {new Date(status.lastSyncedAt).toLocaleTimeString()}
        </span>
      )}
    </button>
  );
}
