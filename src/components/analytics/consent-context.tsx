"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE,
  defaultConsent,
  denyAll,
  grantAll,
  parseConsent,
  serializeConsent,
} from "@/lib/analytics/consent";
import { applyConsentToTags } from "@/lib/analytics/client";
import type { ConsentState } from "@/lib/analytics/types";

interface ConsentContextValue {
  consent: ConsentState;
  /** True until the visitor has made an explicit choice (banner visible). */
  needsDecision: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  /** Persist a custom mix (analytics/marketing toggles). */
  save: (choice: { analytics: boolean; marketing: boolean }) => void;
  /** Re-open the preferences UI (e.g. from a footer "Çerez ayarları" link). */
  reopen: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

function writeConsentCookie(state: ConsentState): void {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(
    state
  )}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState>(defaultConsent);
  const [needsDecision, setNeedsDecision] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Hydrate from the cookie on mount and replay the decision into the tags.
  // Reading a first-party cookie on mount (not during render) is the correct way
  // to avoid an SSR/CSR hydration mismatch, so the synchronous setState here is
  // intentional external-system synchronisation.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const existing = parseConsent(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
        ?.split("=")
        .slice(1)
        .join("=")
    );
    if (existing) {
      setConsent(existing);
      applyConsentToTags(existing);
    } else {
      setNeedsDecision(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const commit = useCallback((state: ConsentState) => {
    setConsent(state);
    writeConsentCookie(state);
    applyConsentToTags(state);
    setNeedsDecision(false);
    setSettingsOpen(false);
  }, []);

  const acceptAll = useCallback(() => commit(grantAll()), [commit]);
  const rejectAll = useCallback(() => commit(denyAll()), [commit]);
  const save = useCallback(
    (choice: { analytics: boolean; marketing: boolean }) =>
      commit({
        necessary: true,
        analytics: choice.analytics,
        marketing: choice.marketing,
        version: defaultConsent().version,
        ts: Date.now(),
      }),
    [commit]
  );
  const reopen = useCallback(() => setSettingsOpen(true), []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      needsDecision,
      acceptAll,
      rejectAll,
      save,
      reopen,
      settingsOpen,
      setSettingsOpen,
    }),
    [consent, needsDecision, acceptAll, rejectAll, save, reopen, settingsOpen]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within <ConsentProvider>");
  return ctx;
}
