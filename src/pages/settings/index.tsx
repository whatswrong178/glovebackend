// ══════════════════════════════════════════════════════════════════════════════
// src/pages/settings/index.tsx — Admin Settings Centre
// MediGlove ERP · EPIC-09 / T-09.1, T-09.2, T-09.3, T-09.4
//
// Tabs:
//   1. System Params  — All v10 dynamic parameters (Admin edit)
//   2. Suppliers      — CRUD for suppliers table
//   3. Email Routing  — Module → sender mapping
//   4. Email Templates — HTML template editor with variable toolbar
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useCallback } from "react";
import {
  useList,
  useCreate,
  useUpdate,
  useDelete,
  useGetIdentity,
  useOne,
} from "@refinedev/core";
import type { StaffRole } from "../../types/staff";
import { supabaseClient } from "../../supabaseClient";
import { useCompanySettings } from "../../context/CompanySettingsContext";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
const COMPANY_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

interface CompanySettings {
  id:                  string;
  company_name:        string;
  registration_no:     string | null;
  gst_no:              string | null;
  address_line1:       string | null;
  address_line2:       string | null;
  city:                string | null;
  postcode:            string | null;
  state:               string | null;
  country:             string;
  phone:               string | null;
  fax:                 string | null;
  email:               string | null;
  website:             string | null;
  logo_url:            string | null;
  bank_name:           string | null;
  bank_account_name:   string | null;
  bank_account_no:     string | null;
  bank_swift_code:     string | null;
  updated_at:          string;
}

interface SystemParam {
  key:        string;   // PRIMARY KEY in DB
  value:      string;   // JSONB stored as string
  updated_at: string;
}

// Static descriptions (DB has no description column)
const PARAM_DESCRIPTIONS: Record<string, string> = {
  commission_rate_a:         "Category A product commission rate (e.g. 0.20 = 20%)",
  commission_rate_b:         "Category B product commission rate (e.g. 0.15 = 15%)",
  kam_bonus_rate_a:          "KAM bonus rate for Category A products",
  kam_bonus_rate_b:          "KAM bonus rate for Category B products",
  kam_threshold_days:        "Days without invoice before KAM bonus stops (default: 180)",
  leader_standard_threshold: "Leader standard monthly GMV threshold (default: RM 50,000)",
  leader_minimum_threshold:  "Leader minimum monthly GMV — admin-exemption floor (default: RM 35,000)",
  leader_mgmt_pct:           "Leader management override % of team revenue",
  leader_death_line_months:  "Consecutive failing months before leader is frozen (default: 2)",
  mentor_reward_rate:        "Mentor permanent reward rate on mentee team revenue (default: 0.005 = 0.5%)",
  spinoff_legacy_pct:        "Spinoff legacy commission percentage",
  min_order_boxes:           "Minimum boxes per order (default: 3)",
  free_shipping_boxes:       "Boxes required for free delivery in West Malaysia (default: 5)",
  a_ratio_threshold:         "A-class GMV ratio health threshold for Step Bonus (default: 0.70 = 70%)",
  ladder_matrix:             "JSON array of step bonus tiers: [{tier, threshold, reward}]",
  bounty_first_order:        "Bounty Tier 1 reward for first order ≥ min_order_boxes (RM)",
  bounty_90d_amount:         "Bounty Tier 2: cumulative GMV target within 90 days (RM)",
  bounty_90d_reward:         "Bounty Tier 2: reward amount (RM)",
  bounty_180d_amount:        "Bounty Tier 3: cumulative GMV target within 180 days (RM)",
  bounty_180d_reward:        "Bounty Tier 3: reward amount (RM)",
  bounty_365d_amount:        "Bounty Tier 4: cumulative GMV target within 365 days (RM)",
  bounty_365d_reward:        "Bounty Tier 4: reward amount (RM)",
  bounty_max:                "Maximum cumulative bounty per new client (RM)",
};

interface Supplier {
  id:             string;
  name:           string;
  email:          string | null;
  contact_person: string | null;
  contact_phone:  string | null;
  address:        string | null;
  is_active:      boolean;
  created_at:     string;
}

interface EmailRouting {
  id:           string;
  module:       string;
  sender_email: string;
  sender_name:  string;
}

interface EmailTemplate {
  id:         string;
  name:       string;
  subject:    string;
  html_body:  string;
  updated_at: string;
}

type SettingsTab = "company" | "params" | "suppliers" | "routing" | "templates";

// ─────────────────────────────────────────────────────────────────────────────
// Param group definitions (T-09.1)
// ─────────────────────────────────────────────────────────────────────────────
const PARAM_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: "Commission Rates",
    keys: ["commission_rate_a", "commission_rate_b", "kam_bonus_rate_a", "kam_bonus_rate_b", "kam_threshold_days"],
  },
  {
    label: "Leader Thresholds",
    keys: ["leader_standard_threshold", "leader_minimum_threshold", "leader_mgmt_pct", "leader_death_line_months"],
  },
  {
    label: "Mentor & Spinoff",
    keys: ["mentor_reward_rate", "spinoff_legacy_pct"],
  },
  {
    label: "Bounty",
    keys: [
      "bounty_first_order",
      "bounty_90d_amount",  "bounty_90d_reward",
      "bounty_180d_amount", "bounty_180d_reward",
      "bounty_365d_amount", "bounty_365d_reward",
      "bounty_max",
    ],
  },
  {
    label: "Order Rules",
    keys: ["min_order_boxes", "free_shipping_boxes"],
  },
  {
    label: "Step Bonus",
    keys: ["a_ratio_threshold", "ladder_matrix"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tab 0: Company Profile
// ─────────────────────────────────────────────────────────────────────────────
function CField({ label, value, onChange, type = "text", placeholder = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function CompanyProfileTab() {
  const { refetchSettings } = useCompanySettings();
  const { data, isLoading, refetch } = useOne<CompanySettings>({
    resource: "company_settings",
    id:       COMPANY_SINGLETON_ID,
  });
  const { mutate: updateCompany } = useUpdate();

  const [form,        setForm]        = useState<Partial<CompanySettings>>({});
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError,   setLogoError]   = useState("");
  const fileInputRef  = useRef<HTMLInputElement>(null);

  // Initialise form from fetched data (only once)
  const record = data?.data;
  const initialised = useRef(false);
  if (record && !initialised.current) {
    initialised.current = true;
    setForm({
      company_name:        record.company_name        ?? "",
      registration_no:     record.registration_no     ?? "",
      gst_no:              record.gst_no              ?? "",
      address_line1:       record.address_line1       ?? "",
      address_line2:       record.address_line2       ?? "",
      city:                record.city                ?? "",
      postcode:            record.postcode            ?? "",
      state:               record.state               ?? "",
      country:             record.country             ?? "Malaysia",
      phone:               record.phone               ?? "",
      fax:                 record.fax                 ?? "",
      email:               record.email               ?? "",
      website:             record.website             ?? "",
      logo_url:            record.logo_url            ?? "",
      bank_name:           record.bank_name           ?? "",
      bank_account_name:   record.bank_account_name   ?? "",
      bank_account_no:     record.bank_account_no     ?? "",
      bank_swift_code:     record.bank_swift_code     ?? "",
    });
  }

  const set = (field: keyof CompanySettings) => (v: string) => {
    setSaved(false);
    setForm(prev => ({ ...prev, [field]: v }));
  };

  const handleSave = () => {
    setSaving(true);
    updateCompany(
      { resource: "company_settings", id: COMPANY_SINGLETON_ID, values: form },
      {
        onSuccess: () => { setSaving(false); setSaved(true); refetch(); refetchSettings(); },
        onError:   () => setSaving(false),
      }
    );
  };

  const handleLogoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setLogoError("Logo must be under 2 MB"); return; }
    if (!file.type.startsWith("image/")) { setLogoError("File must be an image"); return; }

    setLogoError("");
    setLogoUploading(true);

    const ext      = file.name.split(".").pop();
    const path     = `logo/company-logo.${ext}`;
    const { error } = await supabaseClient.storage
      .from("company-assets")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (error) {
      setLogoError(error.message.includes("not found")
        ? 'Bucket "company-assets" not found. Create it in Supabase Dashboard → Storage → New Bucket (Public: ON).'
        : error.message);
      setLogoUploading(false);
      return;
    }

    const { data: urlData } = supabaseClient.storage
      .from("company-assets")
      .getPublicUrl(path);

    // Bust cache with timestamp
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    set("logo_url")(publicUrl);
    setSaved(false);
    setLogoUploading(false);
  }, []);

  if (isLoading) return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>;

  const logoUrl = form.logo_url ?? record?.logo_url ?? "";

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        This information is used on all printed documents — invoices, delivery orders, and receipts.
      </div>

      {/* Logo upload */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Company Logo</h3>
        <div className="flex items-start gap-5">
          {/* Preview */}
          <div className="w-32 h-20 border border-gray-200 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain p-1" />
              : <span className="text-xs text-gray-400 text-center px-2">No logo uploaded</span>
            }
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={logoUploading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                         rounded-lg transition-colors disabled:opacity-50"
            >
              {logoUploading ? "Uploading…" : "Upload Logo"}
            </button>
            <p className="text-xs text-gray-400">PNG or SVG recommended. Max 2 MB. Displayed on letterhead at ~120×48 px.</p>
            {logoError && <p className="text-xs text-red-500">{logoError}</p>}
            {logoUrl && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={logoUrl}
                  onChange={(e) => set("logo_url")(e.target.value)}
                  placeholder="Or paste a public image URL"
                  className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 text-gray-500 focus:outline-none"
                />
              </div>
            )}
            {!logoUrl && (
              <input
                type="text"
                value={form.logo_url ?? ""}
                onChange={(e) => set("logo_url")(e.target.value)}
                placeholder="Or paste a public image URL"
                className="w-full text-xs border border-gray-200 rounded px-2 py-1 text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            )}
          </div>
        </div>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Company Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <CField label="Company Name *"  value={form.company_name    ?? ""} onChange={set("company_name")} placeholder="MediGlove Sdn Bhd" />
          </div>
          <CField label="SSM / CCM Registration No." value={form.registration_no ?? ""} onChange={set("registration_no")} placeholder="1234567-X" />
          <CField label="GST / SST No."               value={form.gst_no          ?? ""} onChange={set("gst_no")}          placeholder="Leave blank if exempt" />
        </div>
      </div>

      {/* Address */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Registered Address</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <CField label="Address Line 1"  value={form.address_line1 ?? ""} onChange={set("address_line1")} placeholder="No. 1, Jalan ..." />
          </div>
          <div className="col-span-2">
            <CField label="Address Line 2"  value={form.address_line2 ?? ""} onChange={set("address_line2")} placeholder="Taman / Kompleks ..." />
          </div>
          <CField label="Postcode"  value={form.postcode ?? ""} onChange={set("postcode")} placeholder="50000" />
          <CField label="City"      value={form.city     ?? ""} onChange={set("city")}     placeholder="Kuala Lumpur" />
          <CField label="State"     value={form.state    ?? ""} onChange={set("state")}    placeholder="Wilayah Persekutuan" />
          <CField label="Country"   value={form.country  ?? "Malaysia"} onChange={set("country")} placeholder="Malaysia" />
        </div>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Contact Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <CField label="Phone"    value={form.phone   ?? ""} onChange={set("phone")}   type="tel"   placeholder="+603-XXXX XXXX" />
          <CField label="Fax"      value={form.fax     ?? ""} onChange={set("fax")}     type="tel"   placeholder="+603-XXXX XXXX" />
          <CField label="Email"    value={form.email   ?? ""} onChange={set("email")}   type="email" placeholder="info@mediglove.com" />
          <CField label="Website"  value={form.website ?? ""} onChange={set("website")} type="url"   placeholder="https://mediglove.com" />
        </div>
      </div>

      {/* Banking Details */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Banking Details</h3>
          <p className="text-xs text-gray-400 mt-0.5">Printed on invoices under "Payment Details". Leave blank to hide.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <CField label="Bank Name"         value={form.bank_name         ?? ""} onChange={set("bank_name")}         placeholder="Maybank / CIMB / Public Bank" />
          <CField label="Account Holder Name" value={form.bank_account_name ?? ""} onChange={set("bank_account_name")} placeholder="MediGlove Supply Sdn Bhd" />
          <CField label="Account Number"    value={form.bank_account_no   ?? ""} onChange={set("bank_account_no")}   placeholder="5123 4567 8901" />
          <CField label="SWIFT / BIC Code"  value={form.bank_swift_code   ?? ""} onChange={set("bank_swift_code")}   placeholder="MBBEMYKLXXX" />
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                     rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Company Profile"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: System Params
// ─────────────────────────────────────────────────────────────────────────────
function SystemParamsTab() {
  const { data, isLoading, refetch } = useList<SystemParam>({
    resource:   "system_params",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "key", order: "asc" }],
    // DB primary key is `key` (text), not `id` — alias it so Refine is happy
    meta:       { select: "key, value, updated_at" },
  });
  const { mutate: updateParam } = useUpdate();

  const params  = data?.data ?? [];
  // Refine maps the aliased `key` column; cast to access it
  const byKey   = Object.fromEntries(
    params.map(p => [(p as unknown as Record<string, string>).key ?? (p as unknown as Record<string, string>).id, p])
  );
  const [drafts, setDrafts]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState<Record<string, boolean>>({});
  const [saved,  setSaved]    = useState<Record<string, boolean>>({});

  const getValue = (key: string) =>
    drafts[key] ?? (byKey[key] as unknown as Record<string, string>)?.value ?? "";

  const handleSave = (key: string) => {
    const p = byKey[key];
    if (!p) return;
    setSaving(prev => ({ ...prev, [key]: true }));
    updateParam(
      {
        resource: "system_params",
        id:       key,          // PK is the key string itself
        values:   { value: drafts[key] ?? (p as unknown as Record<string, string>).value },
      },
      {
        onSuccess: () => {
          setSaving(prev => ({ ...prev, [key]: false }));
          setSaved(prev => ({ ...prev, [key]: true }));
          setDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
          refetch();
          setTimeout(() => setSaved(prev => ({ ...prev, [key]: false })), 1500);
        },
        onError: () => setSaving(prev => ({ ...prev, [key]: false })),
      }
    );
  };

  const isDirty = (key: string) =>
    key in drafts && drafts[key] !== (byKey[key] as unknown as Record<string, string>)?.value;

  if (isLoading) return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
        ⚠ Changes take effect immediately. Commission engine reads these at runtime.
        Verify values carefully before saving.
      </div>

      {PARAM_GROUPS.map((group) => {
        const groupParams = group.keys
          .map(k => byKey[k])
          .filter(Boolean) as unknown as Array<Record<string, string>>;

        if (groupParams.length === 0) return null;

        return (
          <div key={group.label} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-700">{group.label}</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {groupParams.map((p) => {
                const pk        = p.key ?? p.id;   // actual DB key string
                const isJson    = pk === "ladder_matrix";
                const dirty     = isDirty(pk);
                const isSaving  = saving[pk];
                const isSaved   = saved[pk];

                return (
                  <div key={pk} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-semibold text-gray-700 font-mono">
                            {pk}
                          </label>
                          {dirty && (
                            <span className="text-xs text-amber-600 font-medium">● unsaved</span>
                          )}
                          {isSaved && (
                            <span className="text-xs text-emerald-600 font-medium">✓ saved</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{PARAM_DESCRIPTIONS[pk] ?? ""}</p>
                        {isJson ? (
                          <textarea
                            value={getValue(pk)}
                            onChange={(e) => setDrafts(prev => ({ ...prev, [pk]: e.target.value }))}
                            rows={6}
                            className="mt-2 w-full text-xs font-mono border border-gray-300 rounded-lg px-3 py-2
                                       focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                          />
                        ) : (
                          <input
                            type="text"
                            value={getValue(pk)}
                            onChange={(e) => setDrafts(prev => ({ ...prev, [pk]: e.target.value }))}
                            className="mt-2 w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                                       focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                          />
                        )}
                      </div>
                      <button
                        onClick={() => handleSave(pk)}
                        disabled={!dirty || isSaving}
                        className="mt-6 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700
                                   rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      >
                        {isSaving ? "…" : "Save"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Suppliers (T-09.2)
// ─────────────────────────────────────────────────────────────────────────────

// MUST be defined at module level — defining inside SuppliersTab causes React
// to remount on every parent re-render → input loses focus after each keypress.
function SupplierField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

const EMPTY_SUPPLIER = {
  name: "", email: "", contact_person: "", contact_phone: "", address: "", is_active: true,
};

function SuppliersTab() {
  const { data, isLoading, refetch } = useList<Supplier>({
    resource:   "suppliers",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "name", order: "asc" }],
    filters:    [],
    meta:       { select: "id,name,email,contact_person,contact_phone,address,is_active,created_at" },
  });
  const { mutate: createSupplier } = useCreate();
  const { mutate: updateSupplier } = useUpdate();
  const { mutate: deleteSupplier } = useDelete();

  const suppliers = data?.data ?? [];
  const [showCreate, setShowCreate] = useState(false);
  const [form,       setForm]       = useState({ ...EMPTY_SUPPLIER });
  const [editId,     setEditId]     = useState<string | null>(null);
  const [editForm,   setEditForm]   = useState<Partial<Supplier>>({});
  const [saving,     setSaving]     = useState(false);
  const [filterActive, setFilterActive] = useState<"" | "true" | "false">("");

  const displayed = filterActive === ""
    ? suppliers
    : suppliers.filter(s => String(s.is_active) === filterActive);

  const handleCreate = () => {
    if (!form.name.trim()) return;
    setSaving(true);
    createSupplier(
      { resource: "suppliers", values: { ...form, name: form.name.trim() } },
      {
        onSuccess: () => { setShowCreate(false); setForm({ ...EMPTY_SUPPLIER }); setSaving(false); refetch(); },
        onError:   () => setSaving(false),
      }
    );
  };

  const handleUpdate = (id: string) => {
    setSaving(true);
    updateSupplier(
      { resource: "suppliers", id, values: editForm },
      {
        onSuccess: () => { setEditId(null); setSaving(false); refetch(); },
        onError:   () => setSaving(false),
      }
    );
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this supplier? Products referencing it will have supplier set to null.")) return;
    deleteSupplier(
      { resource: "suppliers", id },
      {
        onSuccess: () => refetch(),
        onError:   (err) => alert((err as unknown as Error).message ?? "Delete failed. This supplier may be referenced by existing products."),
      }
    );
  };

  if (isLoading) return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value as "" | "true" | "false")}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none"
          >
            <option value="">All Suppliers</option>
            <option value="true">Active Only</option>
            <option value="false">Inactive Only</option>
          </select>
          <span className="text-sm text-gray-500">{displayed.length} supplier{displayed.length !== 1 ? "s" : ""}</span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                     rounded-lg transition-colors"
        >
          + Add Supplier
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-900">New Supplier</h3>
          <div className="grid grid-cols-2 gap-4">
            <SupplierField label="Name *"          value={form.name}           onChange={v => setForm(f => ({ ...f, name: v }))} />
            <SupplierField label="Contact Person"  value={form.contact_person} onChange={v => setForm(f => ({ ...f, contact_person: v }))} />
            <SupplierField label="Email"           value={form.email}           onChange={v => setForm(f => ({ ...f, email: v }))} />
            <SupplierField label="Phone"           value={form.contact_phone}  onChange={v => setForm(f => ({ ...f, contact_phone: v }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={saving || !form.name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                         rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create Supplier"}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Contact</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {displayed.length === 0 && (
              <tr><td colSpan={5} className="text-center px-4 py-8 text-sm text-gray-400">No suppliers found.</td></tr>
            )}
            {displayed.map((s) => (
              <React.Fragment key={s.id}>
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {s.contact_person && <div>{s.contact_person}</div>}
                    {s.contact_phone  && <div>{s.contact_phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                    }`}>
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      onClick={() => { setEditId(s.id); setEditForm({ name: s.name, email: s.email ?? "", contact_person: s.contact_person ?? "", contact_phone: s.contact_phone ?? "", address: s.address ?? "", is_active: s.is_active }); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {editId === s.id && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-4 bg-blue-50">
                      <div className="grid grid-cols-2 gap-3 pt-3">
                        {(["name", "contact_person", "email", "contact_phone"] as const).map(f => (
                          <div key={f}>
                            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{f.replace(/_/g, " ")}</label>
                            <input
                              type="text"
                              value={(editForm as Record<string, string>)[f] ?? ""}
                              onChange={(e) => setEditForm(prev => ({ ...prev, [f]: e.target.value }))}
                              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        ))}
                        <div className="col-span-2">
                          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Address</label>
                          <textarea
                            value={editForm.address ?? ""}
                            onChange={(e) => setEditForm(prev => ({ ...prev, address: e.target.value }))}
                            rows={2}
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none resize-none"
                          />
                        </div>
                        <div className="col-span-2 flex items-center gap-3">
                          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editForm.is_active ?? true}
                              onChange={(e) => setEditForm(prev => ({ ...prev, is_active: e.target.checked }))}
                              className="w-4 h-4"
                            />
                            Active
                          </label>
                          <div className="flex-1" />
                          <button onClick={() => setEditId(null)} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                          <button
                            onClick={() => handleUpdate(s.id)}
                            disabled={saving}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save Changes"}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3: Email Routing (T-09.3)
// ─────────────────────────────────────────────────────────────────────────────
const MODULE_META: Record<string, { label: string; usage: string }> = {
  finance:    { label: "Finance",    usage: "Invoice, Receipt, AR Dunning" },
  operations: { label: "Operations", usage: "E-DO (Delivery Order)" },
  hr:         { label: "HR & Care",  usage: "Birthday, Anniversary, Welcome" },
  purchasing: { label: "Purchasing", usage: "Auto-PO to Suppliers" },
};

function EmailRoutingTab() {
  const { data, isLoading, refetch } = useList<EmailRouting>({
    resource:   "email_routing",
    pagination: { current: 1, pageSize: 50 },
    sorters:    [{ field: "module", order: "asc" }],
  });
  const { mutate: updateRouting } = useUpdate();
  const routes  = data?.data ?? [];
  const [drafts, setDrafts] = useState<Record<string, Partial<EmailRouting>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved,  setSaved]  = useState<Record<string, boolean>>({});

  const handleSave = (r: EmailRouting) => {
    const d = drafts[r.id] ?? {};
    setSaving(prev => ({ ...prev, [r.id]: true }));
    updateRouting(
      { resource: "email_routing", id: r.id, values: { ...r, ...d } },
      {
        onSuccess: () => {
          setSaving(prev => ({ ...prev, [r.id]: false }));
          setSaved(prev => ({ ...prev, [r.id]: true }));
          setDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n; });
          refetch();
          setTimeout(() => setSaved(prev => ({ ...prev, [r.id]: false })), 1500);
        },
        onError: () => setSaving(prev => ({ ...prev, [r.id]: false })),
      }
    );
  };

  const setDraft = (id: string, field: keyof EmailRouting, value: string) =>
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  if (isLoading) return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        Each module sends emails from a distinct sender identity. Changes affect all outgoing emails immediately.
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
        {routes.map((r) => {
          const meta    = MODULE_META[r.module] ?? { label: r.module, usage: "" };
          const d       = drafts[r.id] ?? {};
          const dirty   = Object.keys(d).length > 0;
          const isSaved = saved[r.id];

          return (
            <div key={r.id} className="px-5 py-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{meta.label}</span>
                    {dirty  && <span className="text-xs text-amber-600">● unsaved</span>}
                    {isSaved && <span className="text-xs text-emerald-600">✓ saved</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">Used for: {meta.usage}</p>
                </div>
                <button
                  onClick={() => handleSave(r)}
                  disabled={!dirty || saving[r.id]}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700
                             rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {saving[r.id] ? "…" : "Save"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Sender Email</label>
                  <input
                    type="email"
                    value={d.sender_email ?? r.sender_email}
                    onChange={(e) => setDraft(r.id, "sender_email", e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Sender Name</label>
                  <input
                    type="text"
                    value={d.sender_name ?? r.sender_name}
                    onChange={(e) => setDraft(r.id, "sender_name", e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4: Email Templates (T-09.4)
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATE_VARIABLES = [
  "{{clientName}}", "{{invoiceNo}}", "{{doNo}}", "{{total}}", "{{dueDate}}",
  "{{overdueDays}}", "{{creditTerms}}", "{{staffName}}", "{{role}}",
  "{{leaderName}}", "{{supplierName}}", "{{poNo}}", "{{poTotal}}",
  "{{logisticsName}}", "{{paidAt}}", "{{invoiceItems}}", "{{poItems}}",
];

function EmailTemplatesTab() {
  const { data, isLoading, refetch } = useList<EmailTemplate>({
    resource:   "email_templates",
    pagination: { current: 1, pageSize: 50 },
    sorters:    [{ field: "name", order: "asc" }],
  });
  const { mutate: updateTemplate } = useUpdate();

  const templates = data?.data ?? [];
  const [selected,   setSelected]   = useState<string | null>(null);
  const [subject,    setSubject]     = useState("");
  const [htmlBody,   setHtmlBody]    = useState("");
  const [saving,     setSaving]      = useState(false);
  const [saved,      setSaved]       = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectTemplate = (t: EmailTemplate) => {
    setSelected(t.id);
    setSubject(t.subject);
    setHtmlBody(t.html_body);
    setPreviewMode(false);
    setSaved(false);
  };

  const insertVariable = (v: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const newVal = htmlBody.slice(0, start) + v + htmlBody.slice(end);
    setHtmlBody(newVal);
    setTimeout(() => {
      ta.selectionStart = start + v.length;
      ta.selectionEnd   = start + v.length;
      ta.focus();
    }, 0);
  };

  const handleSave = () => {
    if (!selected) return;
    setSaving(true);
    updateTemplate(
      { resource: "email_templates", id: selected, values: { subject, html_body: htmlBody } },
      {
        onSuccess: () => { setSaving(false); setSaved(true); refetch(); },
        onError:   () => setSaving(false),
      }
    );
  };

  const currentTemplate = templates.find(t => t.id === selected);
  const isDirty = selected && currentTemplate &&
    (subject !== currentTemplate.subject || htmlBody !== currentTemplate.html_body);

  if (isLoading) return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="flex gap-5 h-full">
      {/* Template list sidebar */}
      <div className="w-48 flex-shrink-0 space-y-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Templates</p>
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTemplate(t)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selected === t.id
                ? "bg-blue-600 text-white font-medium"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Editor */}
      {selected ? (
        <div className="flex-1 min-w-0 space-y-4">
          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setSaved(false); }}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Variable toolbar */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Insert Variable</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  onClick={() => { insertVariable(v); setSaved(false); }}
                  className="px-2 py-1 text-xs font-mono bg-gray-100 hover:bg-blue-100
                             hover:text-blue-700 text-gray-600 rounded transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPreviewMode(false)}
              className={`text-xs font-medium px-3 py-1.5 rounded ${!previewMode ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              HTML Editor
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              className={`text-xs font-medium px-3 py-1.5 rounded ${previewMode ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              Preview
            </button>
          </div>

          {!previewMode ? (
            <textarea
              ref={textareaRef}
              value={htmlBody}
              onChange={(e) => { setHtmlBody(e.target.value); setSaved(false); }}
              rows={18}
              className="w-full text-xs font-mono border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              spellCheck={false}
            />
          ) : (
            <div className="border border-gray-200 rounded-lg p-4 bg-white min-h-[360px] overflow-auto">
              <div dangerouslySetInnerHTML={{ __html: htmlBody }} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {currentTemplate && `Last updated: ${new Date(currentTemplate.updated_at).toLocaleString("en-MY")}`}
            </span>
            <div className="flex items-center gap-3">
              {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
              {isDirty && !saved && <span className="text-xs text-amber-600">● Unsaved changes</span>}
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                           rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          ← Select a template to edit
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingsPage
// ─────────────────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isAdmin = identity?.role === "Admin";
  const [tab, setTab] = useState<SettingsTab>("company");

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-500">🔒 Settings are accessible to Admin only.</p>
      </div>
    );
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "company",   label: "🏢 Company Profile"  },
    { id: "params",    label: "⚙️ System Params"    },
    { id: "suppliers", label: "🏭 Suppliers"         },
    { id: "routing",   label: "📨 Email Routing"     },
    { id: "templates", label: "📝 Email Templates"   },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Admin control centre</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={tab === "templates" ? "min-h-[600px]" : ""}>
        {tab === "company"   && <CompanyProfileTab  />}
        {tab === "params"    && <SystemParamsTab    />}
        {tab === "suppliers" && <SuppliersTab       />}
        {tab === "routing"   && <EmailRoutingTab    />}
        {tab === "templates" && <EmailTemplatesTab  />}
      </div>
    </div>
  );
}
