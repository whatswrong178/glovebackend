// ══════════════════════════════════════════════════════════════════════════════
// src/pages/clients/edit.tsx — Client Edit / Request-to-Edit
// MediGlove ERP · EPIC-04 / T-04.2
//
// Admin: writes directly to clients table via useUpdate.
// Sales/Leader (non-Admin): creates an edit_request row with requested_changes JSONB.
//   → Admin/HR reviews and approves/rejects in ClientShowPage.
//
// Only editable fields are exposed here. SSM uniqueness server-error is surfaced.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { useOne, useUpdate, useCreate, useGetIdentity, useNavigation } from "@refinedev/core";
import { useParams } from "react-router-dom";
import type { Client, ClientFormValues, CreditTerms, ClientRegion } from "../../types/client";
import type { StaffRole } from "../../types/staff";

export function ClientEditPage() {
  const { id }   = useParams<{ id: string }>();
  const { show, list } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isAdmin = identity?.role === "Admin";

  const { mutate: updateClient, isLoading: isSaving }  = useUpdate();
  const { mutate: createRequest, isLoading: isRequesting } = useCreate();

  const [form,     setForm]     = useState<ClientFormValues | null>(null);
  const [original, setOriginal] = useState<ClientFormValues | null>(null);
  const [initDone, setInitDone] = useState(false);
  const [errors,   setErrors]   = useState<Partial<Record<keyof ClientFormValues, string>>>({});
  const [serverError, setServerError] = useState("");
  const [submitted,   setSubmitted]   = useState(false);

  const { data: clientData, isLoading } = useOne<Client>({
    resource: "clients",
    id:       id!,
    meta: {
      select: "id,name,ssm_no,region,credit_terms,contact_person,contact_email,contact_phone,owner_id",
    },
  });

  useEffect(() => {
    const c = clientData?.data;
    if (c && !initDone) {
      const vals: ClientFormValues = {
        name:           c.name,
        ssm_no:         c.ssm_no ?? "",
        region:         c.region,
        credit_terms:   c.credit_terms,
        contact_person: c.contact_person ?? "",
        contact_email:  c.contact_email  ?? "",
        contact_phone:  c.contact_phone  ?? "",
        address:        (c as any).address ?? "",
        owner_id:       c.owner_id ?? "",
      };
      setForm(vals);
      setOriginal(vals);
      setInitDone(true);
    }
  }, [clientData, initDone]);

  if (isLoading || !form || !original) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        Loading client…
      </div>
    );
  }

  const set = (field: keyof ClientFormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => prev ? { ...prev, [field]: e.target.value } : prev);
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError("");
  };

  // Compute diff between original and current form
  const computeDiff = (): Record<string, unknown> => {
    if (!form || !original) return {};
    const diff: Record<string, unknown> = {};
    const keys = Object.keys(form) as (keyof ClientFormValues)[];
    for (const k of keys) {
      if (form[k] !== original[k]) {
        diff[k] = form[k] === "" ? null : form[k];
      }
    }
    return diff;
  };

  const validate = (): boolean => {
    if (!form) return false;
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
    if (!form || !validate()) return;

    const diff = computeDiff();
    if (Object.keys(diff).length === 0) {
      show("clients", id!);
      return;
    }

    if (isAdmin) {
      // Direct update
      updateClient(
        {
          resource: "clients",
          id:       id!,
          values: {
            name:           form.name.trim(),
            ssm_no:         form.ssm_no.trim() || null,
            region:         form.region as ClientRegion,
            credit_terms:   form.credit_terms as CreditTerms,
            contact_person: form.contact_person.trim() || null,
            contact_email:  form.contact_email.trim()  || null,
            contact_phone:  form.contact_phone.trim()  || null,
            address:        (form as any).address?.trim() || null,
          },
        },
        {
          onSuccess: () => show("clients", id!),
          onError:   (err) => {
            const msg = (err as { message?: string })?.message ?? "";
            if (msg.includes("clients_ssm_no_key")) {
              setServerError("This SSM number is already registered to another client.");
            } else {
              setServerError(msg || "Update failed. Please try again.");
            }
          },
        }
      );
    } else {
      // Submit edit request
      createRequest(
        {
          resource: "edit_requests",
          values: {
            client_id:          id,
            requested_by:       identity?.id,
            requested_changes:  diff,
            status:             "Pending",
          },
        },
        {
          onSuccess: () => setSubmitted(true),
          onError:   (err) => {
            setServerError((err as { message?: string })?.message ?? "Failed to submit request.");
          },
        }
      );
    }
  };

  if (submitted) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => show("clients", id!)} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Client
          </button>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center space-y-3">
          <div className="text-3xl">✓</div>
          <h2 className="text-lg font-bold text-emerald-800">Edit Request Submitted</h2>
          <p className="text-sm text-emerald-700">
            Your changes have been sent to Admin/HR for review. You will be notified once approved.
          </p>
          <button
            onClick={() => show("clients", id!)}
            className="mt-4 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Back to Client
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => show("clients", id!)}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to Client
        </button>
        <h1 className="text-xl font-bold text-gray-900">
          {isAdmin ? "Edit Client" : "Request Client Edit"}
        </h1>
      </div>

      {!isAdmin && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
          ℹ️ You don't have direct edit access. Your changes will be submitted as an <strong>edit request</strong> for Admin/HR approval. Only fields you change will be included.
        </div>
      )}

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
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                        focus:ring-blue-500 ${errors.name ? "border-red-400" : "border-gray-300"}`}
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* SSM */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            SSM / Clinic Licence No.
          </label>
          <input
            type="text"
            value={form.ssm_no}
            onChange={set("ssm_no")}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
        </div>

        {/* Region + Credit */}
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
              <option value="Cash Term">Cash Term</option>
              <option value="30 Days">30 Days</option>
              <option value="60 Days">60 Days</option>
              <option value="90 Days">90 Days</option>
            </select>
          </div>
        </div>

        {/* Contact */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Contact Person
          </label>
          <input
            type="text"
            value={form.contact_person}
            onChange={set("contact_person")}
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
            value={(form as any).address ?? ""}
            onChange={set("address" as any)}
            rows={3}
            placeholder="e.g. No. 12, Jalan Utama 1, Taman Maju, 47810 Petaling Jaya, Selangor"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">Used on printed invoices and delivery orders.</p>
        </div>

        {/* Change diff preview for non-admin */}
        {!isAdmin && (() => {
          const diff = computeDiff();
          const diffKeys = Object.keys(diff);
          return diffKeys.length > 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
              <p className="font-semibold text-gray-600 mb-2">Changes to be submitted:</p>
              {diffKeys.map((k) => (
                <div key={k} className="flex gap-2">
                  <span className="font-mono text-gray-500 w-32">{k}</span>
                  <span className="text-gray-400 line-through">{String(original[k as keyof ClientFormValues] || "—")}</span>
                  <span>→</span>
                  <span className="text-blue-700">{String(diff[k] ?? "—")}</span>
                </div>
              ))}
            </div>
          ) : null;
        })()}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => show("clients", id!)}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                       hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || isRequesting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                       rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving || isRequesting
              ? "Saving…"
              : isAdmin ? "Save Changes" : "Submit Edit Request"}
          </button>
        </div>
      </form>
    </div>
  );
}
