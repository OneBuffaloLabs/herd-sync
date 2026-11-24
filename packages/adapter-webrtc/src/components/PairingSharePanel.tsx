"use client";

// --- React ---
import React, { useState } from "react";

// --- Signaling ---
import { buildMailtoHref, buildPairingUrl, buildSmsHref } from "@/signaling/qr";

export interface PairingSharePanelProps {
  qrPayload: string;
  pin?: string;
  textClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
  inputStyle: React.CSSProperties;
  secondaryBtnStyle: React.CSSProperties;
  linkBtnStyle: React.CSSProperties;
}

/**
 * Fallback controls for pairing via 6-digit PIN, raw snippet, or #pair= shareable link.
 */
export function PairingSharePanel({
  qrPayload,
  pin,
  textClassName,
  inputClassName,
  buttonClassName,
  inputStyle,
  secondaryBtnStyle,
  linkBtnStyle
}: PairingSharePanelProps) {
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");

  const pairingUrl = qrPayload ? buildPairingUrl(qrPayload) : "";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleCopyPayload = async () => {
    if (!qrPayload) return;
    try {
      await navigator.clipboard.writeText(qrPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
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

  return (
    <div>
      {pin && (
        <div
          id="herd-sync-pin-display"
          style={{
            margin: "0.5rem 0",
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            border: "1px dashed #9ca3af",
            textAlign: "center"
          }}
        >
          <span className={textClassName} style={{ fontSize: "0.8rem", display: "block" }}>
            Same-device / tab quick PIN:
          </span>
          <strong
            style={{
              fontSize: "1.25rem",
              letterSpacing: "0.25em",
              fontFamily: "monospace"
            }}
          >
            {pin}
          </strong>
        </div>
      )}

      <div style={{ margin: "0.75rem 0", textAlign: "left" }}>
        <label
          htmlFor="herd-sync-qr-snippet"
          className={textClassName}
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
            className={inputClassName}
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
            className={buttonClassName}
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
          className={textClassName}
          style={{
            display: "block",
            fontSize: "0.85rem",
            fontWeight: 600,
            marginBottom: "0.25rem"
          }}
        >
          Send #pair= link via email or text:
        </label>
        <input
          id="herd-sync-email-input"
          type="email"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
          placeholder="Optional email address..."
          className={inputClassName}
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
            className={buttonClassName}
            onClick={() => void handleCopyLink()}
            style={{ ...secondaryBtnStyle, flex: 1 }}
          >
            {copiedLink ? "Link Copied!" : "Copy Link"}
          </button>
          <a
            id="herd-sync-email-link"
            href={buildMailtoHref(pairingUrl, recipientEmail)}
            className={buttonClassName}
            style={linkBtnStyle}
          >
            Email
          </a>
          <a
            id="herd-sync-sms-link"
            href={buildSmsHref(pairingUrl)}
            className={buttonClassName}
            style={linkBtnStyle}
          >
            Text
          </a>
          {canNativeShare && (
            <button
              id="herd-sync-share-btn"
              type="button"
              className={buttonClassName}
              onClick={() => void handleNativeShare()}
              style={{ ...secondaryBtnStyle, flex: 1 }}
            >
              Share
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
