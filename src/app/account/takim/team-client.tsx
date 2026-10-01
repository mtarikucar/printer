"use client";

import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea, FormField } from "@/components/ui";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { fill } from "@/components/quote/format";
import { teamErrorText } from "@/components/quote/team-error";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import {
  TEAM_INVITE_ROLES,
  TEAM_ROLES,
  canAssignRole,
  canDeleteTeam,
  canEditTeamProfile,
  canInvite,
  canLeave,
  canRemoveMember,
  canTransferOwnership,
  type TeamInviteRole,
  type TeamRole,
} from "@/lib/config/quote-team";
import { INVOICE_TYPES, type CustomerQuoteListItem, type InvoiceType } from "@/lib/config/quote-types";
import type { TurkishAddress } from "@/lib/db/schema";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteListTable } from "@/app/account/teklifler/quotes-client";

/**
 * `/account/takim` — takımın tek ekranı.
 *
 * ─── EKRAN BİR KOLAYLIKTIR, GÜVENLİK SINIRI UÇLARDADIR ────────────────────
 *
 * Buradaki her `can*` kapısı, UCUN uyguladığı kapının AYNI yüklemini okur
 * (`src/lib/config/quote-team.ts`) ve yalnız ÇİZMEMEYE karar verir. Yetkisi
 * olmayan birinin isteği, düğme gizlenmese de 403 ile döner (T-3); gizlemenin
 * sebebi ölü düğme bırakmamaktır. Rol SUNUCUDAN prop olarak gelir
 * (`page.tsx`), istemci onu türetmez — "takım sahibi miyim" sorusunun cevabı
 * bir satır gerçeğidir, tarayıcının çıkarımı değil.
 *
 * ─── EKRANDA PARA ARİTMETİĞİ YOK ──────────────────────────────────────────
 *
 * Tutarlar uçtan kuruş olarak gelir ve yalnız `formatCurrency` ile basılır:
 * çarpma, bölme, oran ya da toplam YOKTUR (program değişmezi). Sipariş
 * listesinin tutarı `orders.amount_kurus`un kendisidir.
 *
 * ─── GENİŞLİKLER SARMALAYICIDA ────────────────────────────────────────────
 *
 * `.input-base{width:100%}` paylaşılan `<Input>`te Tailwind `w-*`/`flex-1`i
 * EZİYOR; genişlik ızgaraya/sarmalayıcıya yazılır, alana asla
 * ([[input-base-width-trap]]).
 */

export interface TeamMemberView {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  /** ISO dize: `Date` nesnesi sunucu/istemci sınırında bir saat dilimi tuzağı. */
  joinedAt: string;
}

export interface TeamInviteView {
  id: string;
  email: string;
  role: TeamInviteRole;
  expiresAt: string;
}

/** Takımın müşteriye giden yüzü — KVKK damgası ve `ownerUserId` yok. */
export interface TeamProfileView {
  id: string;
  name: string;
  invoiceType: InvoiceType;
  companyName: string | null;
  taxId: string | null;
  taxIdType: "vkn" | "tckn" | null;
  taxOffice: string | null;
  billingAddress: TurkishAddress | null;
  shippingAddress: TurkishAddress | null;
  memberCanCheckout: boolean;
}

export interface TeamClientProps {
  team: TeamProfileView | null;
  role: TeamRole | null;
  members: TeamMemberView[];
  invites: TeamInviteView[];
  sessionUserId: string;
}

/** Takım sipariş satırı (`GET /api/customer/team/orders`) — kişisel veri YOK. */
interface TeamOrderRow {
  orderNumber: string;
  status: string;
  amountKurus: number;
  paidAt: string;
  trackingNumber: string | null;
  quoteNumber: string;
  quoteTitle: string | null;
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-2xl border border-border-default bg-bg-elevated p-6">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Notice({ tone, children }: { tone: "error" | "ok"; children: ReactNode }): JSX.Element {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl p-3 text-sm ${
        tone === "error" ? "bg-error-50 text-error" : "bg-success-50 text-success"
      }`}
    >
      {children}
    </p>
  );
}

/** Türkiye adresi için altı alan; iki form (fatura + teslimat) paylaşıyor. */
function AddressFields({
  d,
  value,
  onChange,
}: {
  d: Dictionary;
  value: TurkishAddress;
  onChange: (next: TurkishAddress) => void;
}): JSX.Element {
  const set = (patch: Partial<TurkishAddress>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <FormField label={d["shop.checkout.address"]}>
        <Textarea rows={2} value={value.adres} onChange={(e) => set({ adres: e.target.value })} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={d["shop.checkout.province"]}>
          <Select
            value={value.il}
            onChange={(e) => set({ il: e.target.value, ilce: "" })}
          >
            <option value="">{d["shop.checkout.province"]}</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={d["shop.checkout.district"]}>
          <Select
            value={value.ilce}
            onChange={(e) => set({ ilce: e.target.value })}
            disabled={!value.il}
          >
            <option value="">{d["shop.checkout.district"]}</option>
            {(DISTRICTS[value.il] ?? []).map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={d["shop.checkout.neighborhood"]}>
          <Input
            value={value.mahalle ?? ""}
            onChange={(e) => set({ mahalle: e.target.value })}
          />
        </FormField>
        <FormField label={d["shop.checkout.postalCode"]}>
          <Input
            value={value.postaKodu}
            inputMode="numeric"
            onChange={(e) => set({ postaKodu: e.target.value })}
          />
        </FormField>
      </div>
      <FormField label={d["common.phone"]}>
        <Input value={value.telefon} onChange={(e) => set({ telefon: e.target.value })} />
      </FormField>
    </div>
  );
}

const EMPTY_ADDRESS: TurkishAddress = {
  adres: "",
  mahalle: "",
  ilce: "",
  il: "",
  postaKodu: "",
  telefon: "",
};

/** Takımı olmayan müşteri: tek form, zorunlu KVKK onayı. */
function CreateTeamForm({ onDone }: { onDone: () => void }): JSX.Element {
  const d = useDictionary();
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customer/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, kvkkConsent: consent }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(teamErrorText(d, body));
        return;
      }
      onDone();
    } catch {
      setError(d["common.error"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={d["instantQuote.team.create.title"]}>
      <p className="mb-4 text-sm text-text-secondary">{d["instantQuote.team.empty"]}</p>
      <form onSubmit={submit} className="max-w-md space-y-4">
        <FormField label={d["instantQuote.team.create.name"]} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={d["instantQuote.team.create.namePlaceholder"]}
            required
            minLength={2}
            maxLength={80}
          />
        </FormField>
        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
            className="mt-0.5"
          />
          <span>{d["instantQuote.team.create.kvkk"]}</span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy || !consent}>
          {d["instantQuote.team.create.submit"]}
        </Button>
      </form>
    </Section>
  );
}

/** Davet formu — Turnstile + alıcı adresi + rol. YALNIZ `canInvite` çizer. */
function InviteForm({ onDone }: { onDone: () => void }): JSX.Element {
  const d = useDictionary();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamInviteRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const res = await fetch("/api/customer/team/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, role, turnstileToken: token }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(teamErrorText(d, body));
        return;
      }
      setSent(
        body.renewed === true
          ? d["instantQuote.team.invite.renewed"]
          : fill(d["instantQuote.team.invite.sent"], { email })
      );
      setEmail("");
      onDone();
    } catch {
      setError(d["common.error"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={d["instantQuote.team.invite.email"]} required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={160}
          />
        </FormField>
        <FormField
          label={d["instantQuote.team.invite.role"]}
          hint={d[`instantQuote.team.roleHint.${role}`]}
        >
          <Select value={role} onChange={(e) => setRole(e.target.value as TeamInviteRole)}>
            {TEAM_INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {d[`instantQuote.team.role.${r}`]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {sent && <Notice tone="ok">{sent}</Notice>}
      <Turnstile ref={turnstileRef} />
      <Button type="submit" disabled={busy}>
        {d["instantQuote.team.invite.submit"]}
      </Button>
    </form>
  );
}

/** Takım teklifleri: kişisel listenin AYNI tablosu, takım satırlarıyla. */
function TeamQuotes(): JSX.Element {
  const d = useDictionary();
  const [items, setItems] = useState<CustomerQuoteListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/customer/quotes?page=1", { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { items: CustomerQuoteListItem[] };
        // SÜZGEÇ EKRANDA ve bu bilinçli: liste ucu kişisel + takım tekliflerini
        // birlikte döndürüyor (`teamScope`) ve ikinci bir uç aynı sorgunun
        // ikinci kopyası olurdu. `teamName` dolu satır = takıma bağlı satır.
        if (!cancelled) setItems(body.items.filter((item) => item.teamName !== null));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <Notice tone="error">{d["instantQuote.account.quotes.loadFailed"]}</Notice>;
  if (items === null) return <div className="skeleton h-12 rounded-xl" aria-busy="true" />;
  if (items.length === 0)
    return <p className="text-sm text-text-secondary">{d["instantQuote.team.quote.listEmpty"]}</p>;
  return <QuoteListTable items={items} />;
}

/** Takım siparişleri: SALT OKUNUR. Eylem düğmesi YOK — ve olmayacak. */
function TeamOrders(): JSX.Element {
  const d = useDictionary();
  const [rows, setRows] = useState<TeamOrderRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/customer/team/orders", { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { orders: TeamOrderRow[] };
        if (!cancelled) setRows(body.orders);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {/* SALT OKUNUR OLDUĞU, LİSTE GELMEDEN ÖNCE de yazılır: cümle listenin
          bir açıklaması değil, bu yüzeyin SÖZLEŞMESİ (eylemler ödeyenin
          hakkı). Yüklenirken gizlemek, cümleyi listesi boş olan takımda hiç
          göstermemek olurdu. */}
      <p className="mb-4 text-xs text-text-muted">{d["instantQuote.team.orders.readOnly"]}</p>
      {failed ? (
        <Notice tone="error">{d["instantQuote.team.orders.loadFailed"]}</Notice>
      ) : rows === null ? (
        <div className="skeleton h-12 rounded-xl" aria-busy="true" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary">{d["instantQuote.team.orders.empty"]}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border-default text-xs text-text-muted">
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.orders.column.order"]}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.orders.column.quote"]}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.orders.column.status"]}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.orders.column.total"]}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.orders.column.paidAt"]}
                </th>
                <th scope="col" className="py-3 font-medium">
                  {d["instantQuote.team.orders.column.tracking"]}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderNumber} className="border-b border-bg-subtle align-middle">
                  <td className="py-3 pr-4 font-mono text-[13px] text-text-primary">
                    {row.orderNumber}
                  </td>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/teklif/${encodeURIComponent(row.quoteNumber)}`}
                      className="font-mono text-[13px] text-green-600 underline-offset-4 hover:underline"
                    >
                      {row.quoteNumber}
                    </Link>
                    {row.quoteTitle && (
                      <div className="text-xs text-text-muted">{row.quoteTitle}</div>
                    )}
                  </td>
                  {/* Durum etiketi mevcut `status.*` kümesinden okunur (depo
                      deseni); tanınmayan bir durumda ham değer basılır —
                      uydurulmuş bir etiket, yanlış bir söz olurdu. */}
                  <td className="py-3 pr-4 text-text-secondary">
                    {d[`status.${row.status}` as keyof Dictionary] ?? row.status}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[13px] tabular-nums text-text-primary">
                    {formatCurrency(row.amountKurus, "tr")}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">{formatDate(row.paidAt, "tr")}</td>
                  <td className="py-3 font-mono text-[13px] text-text-secondary">
                    {row.trackingNumber ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function TeamClient({
  team,
  role,
  members,
  invites,
  sessionUserId,
}: TeamClientProps): JSX.Element {
  const d = useDictionary();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Paylaşılan bilgiler formunun yerel hâli; prop değiştiğinde (yazımdan sonra
  // `router.refresh()`) yeniden kurulsun diye `team.id` + `name` anahtarlı.
  const [profile, setProfile] = useState(() => team);
  useEffect(() => setProfile(team), [team]);

  /** Bir yazımı koşar, cevabı çevirir ve sunucu propslarını tazeler. */
  const run = useCallback(
    async (path: string, init: RequestInit): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setSaved(false);
      try {
        const res = await fetch(path, { credentials: "same-origin", ...init });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setError(teamErrorText(d, body));
          return false;
        }
        setSaved(true);
        router.refresh();
        return true;
      } catch {
        setError(d["common.error"]);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [d, router]
  );

  const patchTeam = (patch: Record<string, unknown>) =>
    run("/api/customer/team", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });

  if (team === null || role === null) {
    return <CreateTeamForm onDone={() => router.refresh()} />;
  }

  const editable = canEditTeamProfile(role);
  const form = profile ?? team;

  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      {saved && !error && <Notice tone="ok">{d["instantQuote.team.profile.saved"]}</Notice>}

      {/* ── Üyeler ───────────────────────────────────────────────────────── */}
      <Section title={d["instantQuote.team.member.title"]}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border-default text-xs text-text-muted">
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.create.name"]}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.invite.email"]}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.invite.role"]}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {d["instantQuote.team.member.joinedAt"]}
                </th>
                <th scope="col" className="py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                // DEĞİŞMEZ: satır YALNIZ ad + e-posta + rol (+ katılma anı)
                // taşır. Telefon ve kişisel adres takımla PAYLAŞILMAZ.
                const self = member.userId === sessionUserId;
                // Rol seçicinin kapısı: aktörün bu hedefe VEREBİLECEĞİ en az
                // bir rol var mı. Boş bir seçici göstermek, ölü bir kontrol
                // bırakmak olurdu.
                const assignable = TEAM_ROLES.filter((next) =>
                  canAssignRole(role, member.role, next)
                );
                return (
                  <tr key={member.userId} className="border-b border-bg-subtle align-middle">
                    <td className="py-3 pr-4 text-text-primary">
                      {member.name}
                      {self && (
                        <span className="ml-1 text-xs text-text-muted">
                          {d["instantQuote.team.member.you"]}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-text-secondary">{member.email}</td>
                    <td className="py-3 pr-4">
                      {assignable.length > 0 ? (
                        <Select
                          value={member.role}
                          disabled={busy}
                          onChange={(e) =>
                            void run(
                              `/api/customer/team/members/${encodeURIComponent(member.userId)}`,
                              {
                                method: "PATCH",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ role: e.target.value }),
                              }
                            )
                          }
                        >
                          {[member.role, ...assignable.filter((r) => r !== member.role)].map(
                            (r) => (
                              <option key={r} value={r}>
                                {d[`instantQuote.team.role.${r}`]}
                              </option>
                            )
                          )}
                        </Select>
                      ) : (
                        <span className="text-text-secondary">
                          {d[`instantQuote.team.role.${member.role}`]}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-text-secondary">
                      {formatDate(member.joinedAt, "tr")}
                    </td>
                    <td className="py-3 whitespace-nowrap text-right">
                      {canTransferOwnership(role) && !self && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                fill(d["instantQuote.team.member.transferConfirm"], {
                                  name: member.name,
                                })
                              )
                            )
                              return;
                            void run(
                              `/api/customer/team/members/${encodeURIComponent(member.userId)}`,
                              {
                                method: "PATCH",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ role: "owner" }),
                              }
                            );
                          }}
                          className="text-xs text-text-secondary underline-offset-4 hover:underline disabled:opacity-50"
                        >
                          {d["instantQuote.team.member.transfer"]}
                        </button>
                      )}
                      {!self && canRemoveMember(role, member.role) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                fill(d["instantQuote.team.member.removeConfirm"], {
                                  name: member.name,
                                })
                              )
                            )
                              return;
                            void run(
                              `/api/customer/team/members/${encodeURIComponent(member.userId)}`,
                              { method: "DELETE" }
                            );
                          }}
                          className="ml-3 text-xs text-error underline-offset-4 hover:underline disabled:opacity-50"
                        >
                          {d["instantQuote.team.member.remove"]}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-text-muted">
          {d["instantQuote.team.member.privacyNote"]}
        </p>
        {canLeave(role) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(d["instantQuote.team.member.leaveConfirm"])) return;
              void run(`/api/customer/team/members/${encodeURIComponent(sessionUserId)}`, {
                method: "DELETE",
              });
            }}
            className="mt-4 text-xs text-error underline-offset-4 hover:underline disabled:opacity-50"
          >
            {d["instantQuote.team.member.leave"]}
          </button>
        )}
      </Section>

      {/* ── Davetler (yalnız owner/admin) ────────────────────────────────── */}
      {canInvite(role) && (
        <Section title={d["instantQuote.team.invite.title"]}>
          <InviteForm onDone={() => router.refresh()} />
          <h3 className="mt-6 text-xs font-semibold text-text-secondary">
            {d["instantQuote.team.invite.pending"]}
          </h3>
          {invites.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">
              {d["instantQuote.team.invite.none"]}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-bg-subtle text-sm">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="text-text-primary">{invite.email}</span>
                  <span className="text-xs text-text-muted">
                    {d[`instantQuote.team.role.${invite.role}`]} ·{" "}
                    {d["instantQuote.team.invite.expiresAt"]}:{" "}
                    {formatDate(invite.expiresAt, "tr")}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(`/api/customer/team/invites/${encodeURIComponent(invite.id)}`, {
                        method: "DELETE",
                      })
                    }
                    className="text-xs text-error underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    {d["instantQuote.team.invite.revoke"]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* ── Paylaşılan bilgiler (yalnız owner/admin) ─────────────────────── */}
      {editable && (
        <Section title={d["instantQuote.team.profile.title"]}>
          <div className="max-w-md space-y-4">
            <FormField label={d["instantQuote.team.create.name"]}>
              <Input
                value={form.name}
                onChange={(e) => setProfile({ ...form, name: e.target.value })}
                onBlur={() => {
                  if (form.name !== team.name) void patchTeam({ name: form.name });
                }}
                minLength={2}
                maxLength={80}
              />
            </FormField>
            <label className="flex items-start gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={form.memberCanCheckout}
                disabled={busy}
                onChange={(e) => void patchTeam({ memberCanCheckout: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                {d["instantQuote.team.profile.memberCanCheckout"]}
                <span className="block text-xs text-text-muted">
                  {d["instantQuote.team.profile.memberCanCheckoutHint"]}
                </span>
              </span>
            </label>
          </div>

          <h3 className="mt-6 text-xs font-semibold text-text-secondary">
            {d["instantQuote.checkout.invoice.title"]}
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            {d["instantQuote.team.profile.invoiceNote"]}
          </p>
          <div className="mt-3 grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={d["instantQuote.checkout.invoice.title"]}>
              <Select
                value={form.invoiceType}
                onChange={(e) => setProfile({ ...form, invoiceType: e.target.value as InvoiceType })}
              >
                {INVOICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {d[`instantQuote.checkout.invoice.${t}`]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={d["instantQuote.checkout.invoice.companyName"]}>
              <Input
                value={form.companyName ?? ""}
                onChange={(e) => setProfile({ ...form, companyName: e.target.value })}
                maxLength={200}
              />
            </FormField>
            <FormField label={d["instantQuote.checkout.invoice.taxId"]}>
              <Input
                value={form.taxId ?? ""}
                onChange={(e) => setProfile({ ...form, taxId: e.target.value })}
                maxLength={20}
              />
            </FormField>
            <FormField label={d["instantQuote.checkout.invoice.taxOffice"]}>
              <Input
                value={form.taxOffice ?? ""}
                onChange={(e) => setProfile({ ...form, taxOffice: e.target.value })}
                maxLength={120}
              />
            </FormField>
          </div>

          <h3 className="mt-6 text-xs font-semibold text-text-secondary">
            {d["instantQuote.team.profile.billingTitle"]}
          </h3>
          <div className="mt-3 max-w-xl">
            <AddressFields
              d={d}
              value={form.billingAddress ?? EMPTY_ADDRESS}
              onChange={(next) => setProfile({ ...form, billingAddress: next })}
            />
          </div>

          <h3 className="mt-6 text-xs font-semibold text-text-secondary">
            {d["instantQuote.team.profile.shippingTitle"]}
          </h3>
          {/* TESLİMAT ADRESİ YALNIZ ÖN DOLDURUR: `quotes`ta `shipping_address`
              kolonu YOKTUR ve teslimat adresi ödeme sırasında müşteriden
              alınıp doğrudan taslağa yazılıyor. Bu ekran `order_drafts`
              yazımına DOKUNMAZ; cümle o yüzden burada duruyor. */}
          <p className="mt-1 text-xs text-text-muted">
            {d["instantQuote.team.profile.shippingNote"]}
          </p>
          <div className="mt-3 max-w-xl">
            <AddressFields
              d={d}
              value={form.shippingAddress ?? EMPTY_ADDRESS}
              onChange={(next) => setProfile({ ...form, shippingAddress: next })}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void patchTeam({
                  name: form.name,
                  invoiceType: form.invoiceType,
                  companyName: form.companyName,
                  taxId: form.taxId,
                  taxOffice: form.taxOffice,
                  billingAddress: form.billingAddress,
                  shippingAddress: form.shippingAddress,
                })
              }
            >
              {d["instantQuote.team.profile.save"]}
            </Button>
            {canDeleteTeam(role) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(d["instantQuote.team.profile.deleteConfirm"])) return;
                  void run("/api/customer/team", { method: "DELETE" });
                }}
                className="text-xs text-error underline-offset-4 hover:underline disabled:opacity-50"
              >
                {d["instantQuote.team.profile.deleteTeam"]}
              </button>
            )}
          </div>
        </Section>
      )}

      {/* ── Takım teklifleri ve siparişleri: DÖRT ROL DE OKUR ───────────── */}
      <Section title={d["instantQuote.team.quote.listTitle"]}>
        <TeamQuotes />
      </Section>
      <Section title={d["instantQuote.team.orders.title"]}>
        <TeamOrders />
      </Section>
    </div>
  );
}
