"use client";

import { useState, useEffect } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";

interface ManufacturerProfile {
  id: string;
  email: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  taxId: string | null;
  taxIdType: "vkn" | "tckn" | null;
  requiresManualTaxReview: boolean;
  status: string;
  createdAt: string;
}

function formatTaxId(taxId: string, taxIdType: "vkn" | "tckn"): string {
  if (taxIdType === "vkn") return `VKN: ${taxId}`;
  // TCKN: keep first 5 and last 2 visible, mask middle 4
  return `TCKN: ${taxId.slice(0, 5)}****${taxId.slice(-2)}`;
}

export default function ManufacturerProfilePage() {
  const d = useDictionary();
  const [profile, setProfile] = useState<ManufacturerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/manufacturer/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          setError(
            (d["manufacturer.profile.loadError" as keyof typeof d] as string) ||
              "Failed to load profile"
          );
          return;
        }
        const data = await res.json();
        setProfile(data.manufacturer);
      })
      .catch(() => {
        setError(
          (d["common.error" as keyof typeof d] as string) ||
            "An error occurred"
        );
      })
      .finally(() => setLoading(false));
  }, [d]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-8">
        <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
          {error || "Failed to load profile"}
        </div>
      </div>
    );
  }

  const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    pending_approval: {
      label:
        (d["manufacturer.profile.statusPending" as keyof typeof d] as string) ||
        "Pending Approval",
      color: "bg-amber-100 text-amber-700",
    },
    active: {
      label:
        (d["manufacturer.profile.statusActive" as keyof typeof d] as string) ||
        "Active",
      color: "bg-emerald-100 text-emerald-700",
    },
    suspended: {
      label:
        (d["manufacturer.profile.statusSuspended" as keyof typeof d] as string) ||
        "Suspended",
      color: "bg-red-100 text-red-700",
    },
  };

  const statusInfo = STATUS_LABELS[profile.status] || {
    label: profile.status,
    color: "bg-gray-100 text-gray-700",
  };

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">
        {(d["manufacturer.profile.title" as keyof typeof d] as string) ||
          "Profile"}
      </h1>
      <p className="text-gray-500 mt-1">
        {(d["manufacturer.profile.subtitle" as keyof typeof d] as string) ||
          "Your manufacturer account details"}
      </p>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* Account Status */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-500">
              {(d["manufacturer.profile.accountStatus" as keyof typeof d] as string) ||
                "Account Status"}
            </p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}
          >
            {statusInfo.label}
          </span>
        </div>

        {/* Company Name */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {(d["manufacturer.profile.companyName" as keyof typeof d] as string) ||
              "Company Name"}
          </label>
          <p className="text-gray-900 font-medium">{profile.companyName}</p>
        </div>

        {/* Contact Person */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {(d["manufacturer.profile.contactPerson" as keyof typeof d] as string) ||
              "Contact Person"}
          </label>
          <p className="text-gray-900">{profile.contactPerson}</p>
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {(d["common.email" as keyof typeof d] as string) || "Email"}
          </label>
          <p className="text-gray-900">{profile.email}</p>
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {(d["common.phone" as keyof typeof d] as string) || "Phone"}
          </label>
          <p className="text-gray-900">{profile.phone}</p>
        </div>

        {/* Tax ID */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {(d["manufacturer.profile.taxId" as keyof typeof d] as string) ||
              "Tax ID"}
          </label>
          {profile.taxId && profile.taxIdType ? (
            <p className="text-gray-900 font-mono">
              {formatTaxId(profile.taxId, profile.taxIdType)}
            </p>
          ) : (
            <div>
              <p className="text-gray-400">—</p>
              <p className="mt-1 text-xs text-amber-700">
                {(d["manufacturer.profile.taxId.missing" as keyof typeof d] as string) ||
                  "Missing. To complete:"}{" "}
                <a
                  href="mailto:admin@figurunica.com"
                  className="font-semibold underline hover:text-amber-900"
                >
                  admin@figurunica.com
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Member Since */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {(d["manufacturer.profile.memberSince" as keyof typeof d] as string) ||
              "Member Since"}
          </label>
          <p className="text-gray-900">
            {new Date(profile.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Read-only notice */}
      <p className="mt-4 text-xs text-gray-400 text-center">
        {(d["manufacturer.profile.readOnlyNotice" as keyof typeof d] as string) ||
          "To update your profile information, please contact the administrator."}
      </p>
    </div>
  );
}
