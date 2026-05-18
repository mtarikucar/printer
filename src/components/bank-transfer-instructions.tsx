"use client";

import { useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Card } from "@/components/ui";

interface BankInfo {
  bankName: string;
  accountHolder: string;
  iban: string;
  branch: string;
}

interface Props {
  orderNumber: string;
  bank: BankInfo;
  finalAmountKurus: number;
  deadline: string | null;
  receiptUploadedAt: string | null;
  receiptUrl: string | null;
}

function formatAmount(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function useCountdown(deadlineIso: string | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineIso) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [deadlineIso]);

  if (!deadlineIso) return null;
  const target = new Date(deadlineIso).getTime();
  const diffMs = target - now;
  if (diffMs <= 0) return { expired: true, hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { expired: false, hours, minutes };
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const d = useDictionary();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
        <p className="font-mono text-sm text-text-primary break-all">{value}</p>
      </div>
      <Button
        type="button"
        onClick={handleCopy}
        variant="secondary"
        size="sm"
        className="shrink-0 !px-3 !py-1.5 text-xs"
      >
        {copied ? d["bankTransfer.copied"] : d["bankTransfer.copy"]}
      </Button>
    </div>
  );
}

export function BankTransferInstructions({
  orderNumber,
  bank,
  finalAmountKurus,
  deadline,
  receiptUploadedAt,
  receiptUrl,
}: Props) {
  const d = useDictionary();
  const countdown = useCountdown(deadline);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [receiptLocalUrl, setReceiptLocalUrl] = useState<string | null>(
    receiptUrl
  );
  const [receiptLocalAt, setReceiptLocalAt] = useState<string | null>(
    receiptUploadedAt
  );

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(
        `/api/customer/orders/${orderNumber}/receipt`,
        { method: "POST", body: formData }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || d["bankTransfer.uploadFailed"]);
      }
      setReceiptLocalUrl(data.receiptUrl ?? null);
      setReceiptLocalAt(new Date().toISOString());
      setFile(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      setUploadError(msg || d["bankTransfer.uploadFailed"]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card elevated className="p-6 sm:p-8 border-l-4 border-amber-500 animate-fade-in-up">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
          <svg
            className="w-5 h-5 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-serif text-text-primary">
            {d["bankTransfer.title"]}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            {d["bankTransfer.subtitle"]}
          </p>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl p-4 sm:p-5 space-y-1">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            {d["bankTransfer.amount"]}
          </span>
          <span className="font-mono text-2xl font-bold text-green-500">
            {formatAmount(finalAmountKurus)}
          </span>
        </div>
        <CopyableField label={d["bankTransfer.bank"]} value={bank.bankName} />
        <CopyableField label={d["bankTransfer.iban"]} value={bank.iban} />
        <CopyableField
          label={d["bankTransfer.accountHolder"]}
          value={bank.accountHolder}
        />
        {bank.branch && (
          <CopyableField
            label={d["bankTransfer.branch"]}
            value={bank.branch}
          />
        )}
        <CopyableField label={d["bankTransfer.reference"]} value={orderNumber} />
      </div>

      {countdown && (
        <p
          className={`mt-4 text-sm ${
            countdown.expired ? "text-red-500" : "text-text-secondary"
          }`}
        >
          <strong>{d["bankTransfer.deadline"]}:</strong>{" "}
          {countdown.expired
            ? d["bankTransfer.expired"]
            : `${countdown.hours} sa ${countdown.minutes} dk`}
        </p>
      )}

      <div className="mt-6 border-t border-bg-subtle pt-5">
        <h3 className="font-medium text-text-primary mb-1">
          {d["bankTransfer.uploadReceipt"]}
        </h3>
        <p className="text-xs text-text-secondary mb-3">
          {d["bankTransfer.uploadDesc"]}
        </p>
        {receiptLocalUrl ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10">
            <svg
              className="w-5 h-5 text-green-500 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-green-600 font-medium">
                {d["bankTransfer.receiptReceived"]}
              </p>
              {receiptLocalAt && (
                <p className="text-xs text-text-muted">
                  {new Date(receiptLocalAt).toLocaleString("tr-TR")}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              <Button
                type="button"
                onClick={handleUpload}
                disabled={!file}
                loading={uploading}
                size="sm"
                className="!px-4"
              >
                {uploading
                  ? d["bankTransfer.uploading"]
                  : d["bankTransfer.uploadButton"]}
              </Button>
            </div>
            {uploadError && (
              <p className="text-sm text-error mt-2">{uploadError}</p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
