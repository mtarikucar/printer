"use client";

import { useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Card, Input, FormField, Textarea } from "@/components/ui";
import { PhoneInput, phoneInputToE164, e164ToPhoneInput } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";

type Address = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  adres: string;
  mahalle: string | null;
  ilce: string;
  il: string;
  postaKodu: string;
  isDefault: boolean;
  createdAt: string;
};

type FormState = {
  label: string;
  fullName: string;
  phone: string;
  adres: string;
  mahalle: string;
  ilce: string;
  il: string;
  postaKodu: string;
  isDefault: boolean;
};

const emptyForm: FormState = {
  label: "",
  fullName: "",
  phone: "",
  adres: "",
  mahalle: "",
  ilce: "",
  il: "",
  postaKodu: "",
  isDefault: false,
};

export function AddressBookPanel() {
  const d = useDictionary();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phoneNational, setPhoneNational] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/customer/addresses");
      if (res.ok) {
        const data = await res.json();
        setAddresses(data.addresses);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const startAdd = () => {
    setForm(emptyForm);
    setPhoneCountry(DEFAULT_COUNTRY);
    setPhoneNational("");
    setEditingId(null);
    setAdding(true);
    setError(null);
  };

  const startEdit = (a: Address) => {
    const phoneSeed = e164ToPhoneInput(a.phone);
    setPhoneCountry(phoneSeed.country);
    setPhoneNational(phoneSeed.nationalNumber);
    setForm({
      label: a.label,
      fullName: a.fullName,
      phone: a.phone,
      adres: a.adres,
      mahalle: a.mahalle ?? "",
      ilce: a.ilce,
      il: a.il,
      postaKodu: a.postaKodu,
      isDefault: a.isDefault,
    });
    setEditingId(a.id);
    setAdding(false);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setAdding(false);
    setError(null);
  };

  const submit = async () => {
    const phoneE164 = phoneInputToE164(phoneCountry, phoneNational);
    if (!phoneE164) {
      setError("Geçerli bir telefon numarası girin");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        label: form.label,
        fullName: form.fullName,
        phone: phoneE164,
        adres: form.adres,
        mahalle: form.mahalle || null,
        ilce: form.ilce,
        il: form.il,
        postaKodu: form.postaKodu,
        isDefault: form.isDefault,
      };
      const url = editingId
        ? `/api/customer/addresses/${editingId}`
        : "/api/customer/addresses";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(d["account.addresses.saveFailed"]);
        return;
      }
      cancelEdit();
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(d["account.addresses.confirmDelete"])) return;
    await fetch(`/api/customer/addresses/${id}`, { method: "DELETE" });
    await refresh();
  };

  const makeDefault = async (id: string) => {
    await fetch(`/api/customer/addresses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ makeDefault: true }),
    });
    await refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {d["account.addresses.intro"]}
        </p>
        {!adding && !editingId && (
          <Button onClick={startAdd} size="sm">
            {d["account.addresses.add"]}
          </Button>
        )}
      </div>

      {(adding || editingId) && (
        <AddressForm
          form={form}
          setForm={setForm}
          phoneCountry={phoneCountry}
          phoneNational={phoneNational}
          onPhoneCountryChange={setPhoneCountry}
          onPhoneNationalChange={setPhoneNational}
          saving={saving}
          error={error}
          onSubmit={submit}
          onCancel={cancelEdit}
          isEditing={!!editingId}
        />
      )}

      {addresses.length === 0 && !adding && (
        <Card padding="lg" className="text-center">
          <p className="text-sm text-text-muted">
            {d["account.addresses.empty"]}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {addresses.map((a) => (
          <Card key={a.id} padding="md">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-text-primary">{a.label}</h3>
                  {a.isDefault && (
                    <span className="text-xs bg-green-500/10 text-green-600 border border-green-500/20 rounded-full px-2 py-0.5">
                      {d["account.addresses.default"]}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary mt-1">{a.fullName}</p>
                <p className="text-xs text-text-muted">{a.phone}</p>
              </div>
            </div>
            <div className="text-sm text-text-secondary space-y-0.5 mb-4">
              <p>{a.adres}</p>
              {a.mahalle && <p className="text-text-muted">{a.mahalle}</p>}
              <p>
                {a.ilce}, {a.il} {a.postaKodu}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-3 border-t border-bg-subtle">
              <button
                onClick={() => startEdit(a)}
                className="text-xs text-text-secondary hover:text-text-primary"
              >
                {d["common.edit"]}
              </button>
              {!a.isDefault && (
                <button
                  onClick={() => makeDefault(a.id)}
                  className="text-xs text-blue-500 hover:text-blue-600"
                >
                  {d["account.addresses.makeDefault"]}
                </button>
              )}
              <button
                onClick={() => remove(a.id)}
                className="text-xs text-red-500 hover:text-red-600 ml-auto"
              >
                {d["common.delete"]}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AddressForm({
  form,
  setForm,
  phoneCountry,
  phoneNational,
  onPhoneCountryChange,
  onPhoneNationalChange,
  saving,
  error,
  onSubmit,
  onCancel,
  isEditing,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  phoneCountry: CountryCode;
  phoneNational: string;
  onPhoneCountryChange: (c: CountryCode) => void;
  onPhoneNationalChange: (v: string) => void;
  saving: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  isEditing: boolean;
}) {
  const d = useDictionary();
  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm({ ...form, [k]: v });

  return (
    <Card padding="md" className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label={d["account.addresses.field.label"]}>
          <Input
            type="text"
            value={form.label}
            onChange={(e) => upd("label", e.target.value)}
            placeholder={d["account.addresses.field.labelPlaceholder"]}
          />
        </FormField>
        <FormField label={d["account.addresses.field.fullName"]}>
          <Input
            type="text"
            value={form.fullName}
            onChange={(e) => upd("fullName", e.target.value)}
          />
        </FormField>
        <FormField label={d["account.addresses.field.phone"]}>
          <PhoneInput
            country={phoneCountry}
            nationalNumber={phoneNational}
            onCountryChange={onPhoneCountryChange}
            onNationalNumberChange={onPhoneNationalChange}
          />
        </FormField>
        <FormField label={d["account.addresses.field.postaKodu"]}>
          <Input
            type="text"
            value={form.postaKodu}
            onChange={(e) => upd("postaKodu", e.target.value)}
          />
        </FormField>
        <FormField
          label={d["account.addresses.field.adres"]}
          className="sm:col-span-2"
        >
          <Textarea
            value={form.adres}
            onChange={(e) => upd("adres", e.target.value)}
            rows={2}
          />
        </FormField>
        <FormField label={d["account.addresses.field.mahalle"]}>
          <Input
            type="text"
            value={form.mahalle}
            onChange={(e) => upd("mahalle", e.target.value)}
          />
        </FormField>
        <FormField label={d["account.addresses.field.ilce"]}>
          <Input
            type="text"
            value={form.ilce}
            onChange={(e) => upd("ilce", e.target.value)}
          />
        </FormField>
        <FormField label={d["account.addresses.field.il"]}>
          <Input
            type="text"
            value={form.il}
            onChange={(e) => upd("il", e.target.value)}
          />
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => upd("isDefault", e.target.checked)}
        />
        {d["account.addresses.makeDefault"]}
      </label>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex gap-2 justify-end">
        <Button onClick={onCancel} variant="secondary" size="sm" disabled={saving}>
          {d["common.cancel"]}
        </Button>
        <Button onClick={onSubmit} size="sm" loading={saving}>
          {saving
            ? d["common.loading"]
            : isEditing
              ? d["common.save"]
              : d["account.addresses.add"]}
        </Button>
      </div>
    </Card>
  );
}
