// ══════════════════════════════════════════════════════════════════════════════
// src/pages/playbook/index.tsx — Multimedia Marketing Knowledge Base
// MediGlove ERP · EPIC-03 / T-03.3
//
// Layout:
//   Left panel: dual-layer category tree (mainCategory > subCategory)
//   Right panel: material grid with type icons, search, type filter
//
// Features:
//   • 7 material types: PDF / Video / Image / Script / Article / Comic / Music
//   • Admin: Upload modal (drag-drop, Supabase Storage), Edit, Delete
//   • Leader/Sales/HR/Logistics: read-only, file open in new tab
//   • Protected by SecurityShield (no screenshots, no recording)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  useList, useCreate, useUpdate, useDelete, useGetIdentity,
} from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
import type { StaffRole } from "../../types/staff";

// ── Types ─────────────────────────────────────────────────────────────────────

type MaterialType = "PDF" | "Video" | "Image" | "Script" | "Article" | "Comic" | "Music";

interface PlaybookMaterial {
  id:          string;
  title:       string;
  category:    string;
  subcategory: string | null;
  file_url:    string;
  type:        MaterialType;
  uploaded_by: string;
  created_at:  string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<MaterialType, { icon: string; color: string; label: string }> = {
  PDF:     { icon: "📄", color: "bg-red-100 text-red-700",       label: "PDF"     },
  Video:   { icon: "🎬", color: "bg-blue-100 text-blue-700",     label: "Video"   },
  Image:   { icon: "🖼️", color: "bg-emerald-100 text-emerald-700", label: "Image" },
  Script:  { icon: "📝", color: "bg-amber-100 text-amber-700",   label: "Script"  },
  Article: { icon: "📰", color: "bg-purple-100 text-purple-700", label: "Article" },
  Comic:   { icon: "🎨", color: "bg-pink-100 text-pink-700",     label: "Comic"   },
  Music:   { icon: "🎵", color: "bg-cyan-100 text-cyan-700",     label: "Music"   },
};

const ALL_TYPES: MaterialType[] = ["PDF", "Video", "Image", "Script", "Article", "Comic", "Music"];
const STORAGE_BUCKET = "playbook-materials";

// ── Upload Modal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  onClose:    () => void;
  onSuccess:  () => void;
  categories: string[];
  supabase:   typeof supabaseClient;
}

function UploadModal({ onClose, onSuccess, categories, supabase }: UploadModalProps) {
  const { mutate: createRow } = useCreate();

  const [title,       setTitle]       = useState("");
  const [category,    setCategory]    = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [type,        setType]        = useState<MaterialType>("PDF");
  const [file,        setFile]        = useState<File | null>(null);
  const [isDragging,  setIsDragging]  = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [error,       setError]       = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveCategory = category === "__new__" ? newCategory.trim() : category;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!title.trim())      { setError("Title is required"); return; }
    if (!effectiveCategory) { setError("Category is required"); return; }
    if (!file)              { setError("Please select a file"); return; }

    setUploading(true);
    try {
      const safeName    = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storagePath = `${effectiveCategory}/${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, { upsert: false });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      createRow(
        {
          resource: "playbook_materials",
          values: {
            title:       title.trim(),
            category:    effectiveCategory,
            subcategory: subcategory.trim() || null,
            file_url:    urlData.publicUrl,
            type,
          },
        },
        {
          onSuccess: () => { onSuccess(); onClose(); },
          onError:   (err) => { setError(String(err.message)); setUploading(false); },
        }
      );
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Upload Material</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Nitrile Glove Sales Script Q2 2025"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Type chips */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Type <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border
                              transition-colors ${type === t
                                ? `${TYPE_META[t].color} border-current`
                                : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                >
                  {TYPE_META[t].icon} {t}
                </button>
              ))}
            </div>
          </div>

          {/* Category / Subcategory */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select…</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">＋ New category</option>
              </select>
              {category === "__new__" && (
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Category name"
                  className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-3 py-2
                             focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Sub-category
              </label>
              <input
                type="text"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                placeholder="Optional"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* File drop zone */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              File <span className="text-red-500">*</span>
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors
                          ${isDragging
                            ? "border-blue-400 bg-blue-50"
                            : file
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }}
                className="hidden"
              />
              {file ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-emerald-700">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Drop file here or click to browse</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                         hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={uploading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                         rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

interface EditModalProps {
  material:   PlaybookMaterial;
  onClose:    () => void;
  categories: string[];
}

function EditModal({ material, onClose, categories }: EditModalProps) {
  const { mutate: updateRow, isLoading } = useUpdate();
  const [title,       setTitle]       = useState(material.title);
  const [category,    setCategory]    = useState(material.category);
  const [subcategory, setSubcategory] = useState(material.subcategory ?? "");
  const [type,        setType]        = useState<MaterialType>(material.type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateRow(
      {
        resource: "playbook_materials",
        id:       material.id,
        values:   { title: title.trim(), category: category.trim(), subcategory: subcategory.trim() || null, type },
      },
      { onSuccess: onClose }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Edit Material</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Type</label>
            <div className="flex flex-wrap gap-2">
              {ALL_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors
                              ${type === t ? `${TYPE_META[t].color} border-current` : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                  {TYPE_META[t].icon} {t}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Category</label>
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                list="cat-edit-list"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <datalist id="cat-edit-list">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Sub-category</label>
              <input type="text" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
              {isLoading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── PlaybookPage ──────────────────────────────────────────────────────────────

export function PlaybookPage() {
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const supabase            = supabaseClient;
  const { mutate: deleteMaterial } = useDelete();

  const isAdmin = identity?.role === "Admin";

  const [search,           setSearch]          = useState("");
  const [typeFilter,       setTypeFilter]       = useState<MaterialType | "">("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSub,      setSelectedSub]      = useState<string | null>(null);
  const [showUpload,       setShowUpload]       = useState(false);
  const [editTarget,       setEditTarget]       = useState<PlaybookMaterial | null>(null);
  const [uploadVersion,    setUploadVersion]    = useState(0);

  const { data, isLoading } = useList<PlaybookMaterial>({
    resource:   "playbook_materials",
    pagination: { current: 1, pageSize: 1000 },
    sorters:    [{ field: "category", order: "asc" }, { field: "title", order: "asc" }],
    meta:       { select: "id,title,category,subcategory,file_url,type,uploaded_by,created_at" },
    queryOptions: { cacheTime: 0, staleTime: 0 },
  });

  const allMaterials = (data?.data ?? []) as unknown as PlaybookMaterial[];

  // Category tree
  const categoryTree = useMemo(() => {
    const tree: Record<string, Set<string>> = {};
    allMaterials.forEach((m) => {
      if (!tree[m.category]) tree[m.category] = new Set();
      if (m.subcategory) tree[m.category].add(m.subcategory);
    });
    return tree;
  }, [allMaterials]);

  const categories = Object.keys(categoryTree).sort();

  // Filtered list
  const filtered = allMaterials.filter((m) => {
    if (selectedCategory && m.category !== selectedCategory) return false;
    if (selectedSub      && m.subcategory !== selectedSub)  return false;
    if (typeFilter       && m.type !== typeFilter)          return false;
    if (search) {
      if (!m.title.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const handleDelete = useCallback((m: PlaybookMaterial) => {
    if (!window.confirm(`Delete "${m.title}"?\n\nThis cannot be undone.`)) return;
    deleteMaterial({ resource: "playbook_materials", id: m.id });
  }, [deleteMaterial]);

  const handleCategoryClick = (cat: string) => {
    if (selectedCategory === cat && selectedSub === null) {
      setSelectedCategory(null);
    } else {
      setSelectedCategory(cat);
      setSelectedSub(null);
    }
  };

  return (
    <>
      {showUpload && isAdmin && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => setUploadVersion((v) => v + 1)}
          categories={categories}
          supabase={supabase}
        />
      )}
      {editTarget && isAdmin && (
        <EditModal
          material={editTarget}
          onClose={() => setEditTarget(null)}
          categories={categories}
        />
      )}

      <div className="flex gap-4" style={{ height: "calc(100vh - 120px)" }}>

        {/* ── Category tree sidebar ──────────────────────────────────────── */}
        <aside className="w-52 flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100
                          overflow-y-auto p-3">
          <p className="px-2 py-1 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Categories
          </p>

          {/* All */}
          <button
            onClick={() => { setSelectedCategory(null); setSelectedSub(null); }}
            className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors
                        ${selectedCategory === null
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-gray-600 hover:bg-gray-50"}`}
          >
            📚 All
            <span className="ml-1 text-xs text-gray-400">({allMaterials.length})</span>
          </button>

          {isLoading && <p className="text-xs text-gray-400 px-2 mt-2">Loading…</p>}

          {categories.map((cat) => {
            const subcats   = Array.from(categoryTree[cat]).sort();
            const isActive  = selectedCategory === cat;
            const catCount  = allMaterials.filter((m) => m.category === cat).length;

            return (
              <div key={cat} className="mt-0.5">
                <button
                  onClick={() => handleCategoryClick(cat)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors
                              ${isActive && selectedSub === null
                                ? "bg-blue-50 text-blue-700 font-medium"
                                : "text-gray-600 hover:bg-gray-50"}`}
                >
                  <span className="block truncate">
                    {isActive ? "▾" : "▸"} {cat}
                    <span className="ml-1 text-xs text-gray-400">({catCount})</span>
                  </span>
                </button>

                {isActive && subcats.length > 0 && (
                  <div className="ml-3 mt-0.5 space-y-0.5">
                    {subcats.map((sub) => {
                      const subCount = allMaterials.filter(
                        (m) => m.category === cat && m.subcategory === sub
                      ).length;
                      return (
                        <button
                          key={sub}
                          onClick={() => setSelectedSub(selectedSub === sub ? null : sub)}
                          className={`w-full text-left px-2 py-1 rounded-lg text-xs transition-colors
                                      ${selectedSub === sub
                                        ? "bg-blue-50 text-blue-700 font-medium"
                                        : "text-gray-500 hover:bg-gray-50"}`}
                        >
                          {sub} <span className="text-gray-400">({subCount})</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* ── Main content area ─────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">

          {/* Top bar: search + type filters + upload */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              placeholder="Search materials…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[180px] text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setTypeFilter("")}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors
                            ${typeFilter === ""
                              ? "bg-gray-700 text-white border-gray-700"
                              : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >
                All types
              </button>
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border
                              transition-colors ${typeFilter === t
                                ? `${TYPE_META[t].color} border-current`
                                : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                >
                  {TYPE_META[t].icon} {t}
                </button>
              ))}
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowUpload(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700
                           text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
              >
                <span className="text-base leading-none">＋</span>
                Upload
              </button>
            )}
          </div>

          {/* Active filters breadcrumb */}
          {(selectedCategory || typeFilter) && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>Showing:</span>
              {selectedCategory && (
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {selectedCategory}{selectedSub ? ` › ${selectedSub}` : ""}
                </span>
              )}
              {typeFilter && (
                <span className={`px-2 py-0.5 rounded-full font-medium ${TYPE_META[typeFilter].color}`}>
                  {TYPE_META[typeFilter].icon} {typeFilter}
                </span>
              )}
              <span className="text-gray-400">
                — {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          {/* Grid */}
          <div className="flex-1 overflow-y-auto pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                Loading materials…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-sm text-gray-400 gap-2">
                <span className="text-3xl">📚</span>
                <span>No materials found</span>
                {isAdmin && (
                  <button
                    onClick={() => setShowUpload(true)}
                    className="mt-2 text-sm text-blue-600 hover:text-blue-700"
                  >
                    Upload the first one →
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filtered.map((m) => {
                  const meta = TYPE_META[m.type];
                  return (
                    <div
                      key={m.id}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col
                                 gap-3 hover:border-blue-200 transition-colors group"
                    >
                      {/* Type badge + admin actions */}
                      <div className="flex items-start justify-between">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}>
                          {meta.icon} {meta.label}
                        </span>
                        {isAdmin && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditTarget(m)}
                              className="text-xs px-1.5 py-0.5 rounded border border-gray-200
                                         text-gray-500 hover:bg-gray-100 transition-colors"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDelete(m)}
                              className="text-xs px-1.5 py-0.5 rounded border border-red-200
                                         text-red-500 hover:bg-red-50 transition-colors"
                            >
                              🗑
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Title */}
                      <p className="text-sm font-medium text-gray-900 leading-tight line-clamp-2 flex-1">
                        {m.title}
                      </p>

                      {/* Sub-category tag */}
                      {m.subcategory && (
                        <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded self-start">
                          {m.subcategory}
                        </span>
                      )}

                      {/* Footer: date + open link */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-50 mt-auto">
                        <span className="text-xs text-gray-400">
                          {new Date(m.created_at).toLocaleDateString("en-MY", {
                            day: "2-digit", month: "short", year: "numeric",
                          })}
                        </span>
                        <a
                          href={m.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                        >
                          Open ↗
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
