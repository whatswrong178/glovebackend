// ══════════════════════════════════════════════════════════════════════════════
// src/pages/clients/create.tsx — Create Client
// MediGlove ERP · EPIC-04 / T-04.1 / T-04.3
//
// Mandatory: name, region, credit_terms.
// Optional: ssm_no (unique), contact_person, contact_email, contact_phone.
// created_by = current user (immutable). owner_id = current user (Admin can reassign).
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useCreate, useList, useGetIdentity, useNavigation } from "@refinedev/core";
import type { ClientFormValues, CreditTerms, ClientRegion } from "../../types/client";
import type { StaffRole, Staff } from "../../types/staff";

export function ClientCreatePage() {
  const { list } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isAdmin = identity?.role === "Admin";

  const { mutate: createClient, isLoading: isSaving } = useCreate();

  const [form, setForm] = useState<ClientFormValues>({
    name:           "",
    ssm_no:         "",
    region:         "",
    credit_terms:   "Cash Term",
    contact_person: "",
    contact_email:  "",
    contact_phone:  "",
    address:        "",
    owner_id:       identity?.id ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ClientFormValues, string>>>({});
  const [serverError, setServerError] = useState<string>("");

  // Admin: fetch staff list to allow owner assignment
  const { data: staffData } = useList<Staff>({
    resource:   "staff",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "name", order: "asc" }],
    filters:    [{ field: "status", operator: "eq", value: "Active" }],
    meta:       { select: "id,name,role" },
    queryOptions: { enabled: isAdmin },
  });
  const staffList = staffData?.data ?? [];

  const set = (field: keyof ClientFormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError("");
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!form.name.trim())  newErrors.name   = "Client name is required";
    if (!form.region)       newErrors.region = "Region is required";
    if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email)) {
      newErrors.contact_email = "Invalid email format";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const ownerId = isAdmin ? (form.owner_id || identity?.id) : identity?.id;

    createClient(
      {
        resource: "clients",
        values: {
          name:           form.name.trim(),
          ssm_no:         form.ssm_no.trim() || null,
          region:         form.region as ClientRegion,
          credit_terms:   form.credit_terms as CreditTerms,
          contact_person: form.contact_person.trim() || null,
          contact_email:  form.contact_email.trim() || null,
          contact_phone:  form.contact_phone.trim() || null,
          address:        form.address.trim() || null,
          created_by:     identity?.id,
          owner_id:       ownerId,
          is_orphan:      false,
          neglect_index:  0,
        },
      },
      {
        onSuccess: () => list("clients"),
        onError:   (err) => {
          const msg = (err as { message?: string })?.message ?? "";
          if (msg.includes("clients_ssm_no_key")) {
            setServerError("This SSM number is already registered to another client.");
          } else {
            setServerError(msg || "Failed to create client. Please try again.");
          }
        },
      }
    );
  };

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => list("clients")}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Clients
        </button>
        <h1 className="text-xl font-bold text-gray-900">Add Client</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">

        {serverError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            ⚠️ {serverError}
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Client Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={set("name")}
            placeholder="e.g. KK Clinic Sdn Bhd"
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                        focus:ring-blue-500 ${errors.name ? "border-red-400" : "border-gray-300"}`}
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* SSM No */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            SSM / Clinic Licence No.
          </label>
          <input
            type="text"
            value={form.ssm_no}
            onChange={set("ssm_no")}
            placeholder="e.g. 1234567-X"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
          <p className="text-xs text-gray-400 mt-1">Must be unique across all clients. Leave blank if not applicable.</p>
        </div>

        {/* Region + Credit Terms */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Region <span className="text-red-500">*</span>
            </label>
            <select
              value={form.region}
              onChange={set("region")}
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                          focus:ring-blue-500 bg-white ${errors.region ? "border-red-400" : "border-gray-300"}`}
            >
              <option value="">Select region…</option>
              <option value="West Malaysia">West Malaysia</option>
              <option value="East Malaysia">East Malaysia</option>
            </select>
            {errors.region && <p className="text-xs text-red-500 mt-1">{errors.region}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Credit Terms <span className="text-red-500">*</span>
            </label>
            <select
              value={form.credit_terms}
              onChange={set("credit_terms")}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="Cash Term">Cash Term (Due on delivery)</option>
              <option value="30 Days">30 Days</option>
              <option value="60 Days">60 Days</option>
              <option value="90 Days">90 Days</option>
            </select>
          </div>
        </div>

        {/* Contact details */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Contact Person
          </label>
          <input
            type="text"
            value={form.contact_person}
            onChange={set("contact_person")}
            placeholder="e.g. Dr. Lim Ah Kow"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Contact Email
            </label>
            <input
              type="email"
              value={form.contact_email}
              onChange={set("contact_email")}
              placeholder="clinic@example.com"
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                          focus:ring-blue-500 ${errors.contact_email ? "border-red-400" : "border-gray-300"}`}
            />
            {errors.contact_email && <p className="text-xs text-red-500 mt-1">{errors.contact_email}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Contact Phone
            </label>
            <input
              type="text"
              value={form.contact_phone}
              onChange={set("contact_phone")}
              placeholder="+60 12-345 6789"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Address */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Address
          </label>
          <textarea
            value={form.address}
            onChange={set("address")}
            rows={3}
            placeholder="e.g. No. 12, Jalan Utama 1, Taman Maju, 47810 Petaling Jaya, Selangor"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">Used on printed invoices and delivery orders.</p>
        </div>

        {/* Owner assignment (Admin only) */}
        {isAdmin && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Assign Owner
            </label>
            <select
              value={form.owner_id}
              onChange={set("owner_id")}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">No owner (Public Pool)</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Leave blank to place client in the Public Pool immediately.</p>
          </div>
        )}

        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
          <strong>Ownership rules:</strong> You will be recorded as the creator of this client.
          {!isAdmin && " You will also be set as the initial owner."}
          {" "}Neglect Index starts at 0 (Healthy). It rises each time a non-owner raises an invoice for this client.
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => list("clients")}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                       hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                       rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Create Client"}
          </button>
        </div>
      </form>
    </div>
  );
}
