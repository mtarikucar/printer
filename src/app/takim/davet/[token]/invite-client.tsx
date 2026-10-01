"use client";

import { useState, type JSX } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { fill } from "@/components/quote/format";
import { teamErrorText } from "@/components/quote/team-error";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Davetin KABUL edilmesi — KVKK bilgilendirmesi + zorunlu onay kutusu.
 *
 * Onay kutusu `z.literal(true)` ile uçta da zorunludur (`kvkkConsentField`);
 * burada devre dışı bir düğme tutmak o kapının kopyası değil, onun ekran
 * tarafındaki karşılığıdır — "varsayılan olarak onaylı" bir hâl YOKTUR, çünkü
 * onayın kanıtı kullanıcının eylemidir. Damgası
 * `customer_team_members.kvkk_acknowledged_at`.
 *
 * HAM TOKEN GÖVDEDE GİDER: adres çubuğu tarayıcı geçmişine, sunucu
 * günlüklerine ve `Referer` başlığına yazılır (ucun kendi gerekçesi).
 *
 * Takımın adı ancak KABULDEN SONRA, ucun cevabından yazılır: kabul etmeden
 * gösterilen bir ad, token'ı bir okuma ucuna çevirirdi.
 *
 * Ret cümlesi `teamErrorText` ile çözülür — takım ekranıyla AYNI yardımcı,
 * çünkü aynı uç ailesinden aynı kodlar geliyor.
 */
export function InviteAcceptClient({ token }: { token: string }): JSX.Element {
  const d = useDictionary();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customer/team/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token, kvkkConsent: consent }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(teamErrorText(d, body));
        return;
      }
      const team = body.team as { name?: unknown } | undefined;
      setJoined(typeof team?.name === "string" ? team.name : "");
    } catch {
      setError(d["common.error"]);
    } finally {
      setBusy(false);
    }
  };

  if (joined !== null) {
    return (
      <div className="rounded-2xl border border-border-default bg-bg-elevated p-6">
        <p role="status" className="text-sm text-text-primary">
          {fill(d["instantQuote.team.invite.accepted"], { team: joined })}
        </p>
        <Link href="/account/takim" className="btn-primary mt-5 inline-flex !px-5 !py-2.5 text-sm">
          {d["instantQuote.team.title"]}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border-default bg-bg-elevated p-6">
      <p className="text-sm text-text-secondary">{d["instantQuote.team.invite.acceptHint"]}</p>
      <label className="mt-5 flex items-start gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>{d["instantQuote.team.invite.kvkk"]}</span>
      </label>
      {/* Aydınlatma metnine bağlantı: takım paragrafı /privacy §5'te duruyor
          (bayrak kapısının TEK istisnası — bir yükümlülük, bir özellik ilanı
          değil). Cümle fiyat kapısı modalındaki üçlüden geliyor; ikinci bir
          kopya aynı metnin iki yerde ayrışması olurdu. */}
      <p className="mt-3 text-xs text-text-muted">
        {d["instantQuote.modal.kvkkPrefix"]}{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          {d["instantQuote.modal.kvkkLink"]}
        </Link>{" "}
        {d["instantQuote.modal.kvkkSuffix"]}
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-error-50 p-3 text-sm text-error">
          {error}
        </p>
      )}
      <Button type="button" onClick={() => void accept()} disabled={busy || !consent} className="mt-5">
        {d["instantQuote.team.invite.accept"]}
      </Button>
    </div>
  );
}
