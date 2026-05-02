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

// ── Sales Training Tab ────────────────────────────────────────────────────────

type TrainingTab = "mindset" | "flow" | "scripts" | "objections" | "roleplay" | "tools";

const TRAINING_TABS: { id: TrainingTab; label: string; icon: string }[] = [
  { id: "mindset",    label: "心态准备", icon: "🧠" },
  { id: "flow",       label: "拜访流程", icon: "🗺️" },
  { id: "scripts",    label: "话术剧本", icon: "💬" },
  { id: "objections", label: "拒绝应对", icon: "🛡️" },
  { id: "roleplay",   label: "实战模拟", icon: "🎭" },
  { id: "tools",      label: "武器装备", icon: "🎒" },
];

function ScriptBlock({ label, side, children }: {
  label: string; side: "you" | "them" | "note"; children: React.ReactNode;
}) {
  const colors = {
    you:  { bar: "border-red-500",   bg: "bg-red-50",   text: "text-red-700"   },
    them: { bar: "border-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
    note: { bar: "border-blue-400",  bg: "bg-blue-50",  text: "text-blue-700"  },
  }[side];
  return (
    <div className={`border-l-4 ${colors.bar} ${colors.bg} rounded-r-lg px-4 py-3 my-2`}>
      <p className={`text-xs font-bold uppercase tracking-widest mb-1.5 ${colors.text}`}>{label}</p>
      <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{children}</p>
    </div>
  );
}

function TrainingCard({ title, icon, iconBg, children }: {
  title: string; icon: string; iconBg: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center text-base`}>{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MindsetItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-emerald-500 font-bold flex-shrink-0">✓</span>
      <div>
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function ObjAccordion({ q, a, note }: { q: string; a: string; note?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-medium text-gray-800">💬 "{q}"</span>
        <span className="text-gray-400 text-sm flex-shrink-0 ml-2">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-gray-50">
          <ScriptBlock label="▶ 应对话术" side="you">{a}</ScriptBlock>
          {note && <ScriptBlock label="📋 补充说明" side="note">{note}</ScriptBlock>}
        </div>
      )}
    </div>
  );
}

function RoleplayCard({ title, icon, iconBg, scenario, steps }: {
  title: string; icon: string; iconBg: string; scenario: string; steps: string[];
}) {
  return (
    <TrainingCard title={title} icon={icon} iconBg={iconBg}>
      <p className="text-xs text-gray-500 italic">{scenario}</p>
      <ul className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-700">
            <span className="font-bold text-gray-400 flex-shrink-0">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </TrainingCard>
  );
}

function SalesTrainingTab() {
  const [activeTab, setActiveTab] = React.useState<TrainingTab>("mindset");

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-4 flex-shrink-0">
        {TRAINING_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
                        whitespace-nowrap transition-colors flex-shrink-0
                        ${activeTab === t.id
                          ? "bg-gray-900 text-white"
                          : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-8">

        {/* ── 心态准备 ─────────────────────────────────────────────────── */}
        {activeTab === "mindset" && (
          <>
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
              <p className="text-sm font-bold text-red-800 mb-2">🚨 出门前先解决这个问题</p>
              <div className="space-y-1 text-sm text-red-700">
                <p>✗ "万一被拒绝怎么办？"</p>
                <p>✗ "他们会不会觉得我很烦？"</p>
                <p className="mt-2 font-medium">→ 你去的目的不是卖东西。你去的目的是帮他们解决采购问题，省钱，省时间。</p>
                <p className="mt-1 font-medium">→ 他拒绝你 = 他拒绝了他自己省钱的机会。那是他的损失，不是你的失败。</p>
              </div>
            </div>

            <TrainingCard title="重新框架：你提供的是价值" icon="💡" iconBg="bg-blue-100">
              <div className="space-y-3">
                <MindsetItem
                  title="被拒绝是正常的"
                  desc="10家里有6家会拒绝。这是行业平均。目标是找到那4家，不是让10家都答应。"
                />
                <MindsetItem
                  title="你只需要说对3句话"
                  desc="开场 → 切入点 → 行动呼吁。其余都是配角。背熟这3句，其余自然说。"
                />
                <MindsetItem
                  title="身体语言比话术重要"
                  desc="抬头、微笑、眼神接触。紧张时放慢说话速度。深呼吸。慢说显得更自信。"
                />
                <MindsetItem
                  title="每次拜访都是练习"
                  desc="第1次很烂是正常的。第5次会好一些。第20次你会轻松自如。不要停下来。"
                />
              </div>
            </TrainingCard>

            <TrainingCard title="出门前的5分钟仪式" icon="⚡" iconBg="bg-amber-100">
              <ul className="space-y-1.5 text-sm text-gray-700">
                {[
                  "确认样品、报价单、名片都在包里",
                  "今日目标：拜访10家，拿到2个WhatsApp联系方式",
                  "对着镜子微笑3秒（真的有效）",
                  "深呼吸，然后出发",
                ].map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-emerald-500 font-bold flex-shrink-0">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </TrainingCard>
          </>
        )}

        {/* ── 拜访流程 ─────────────────────────────────────────────────── */}
        {activeTab === "flow" && (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 text-sm text-blue-800">
              <strong>今天目标：</strong>不是要他立刻买。目标是取得WhatsApp联系方式或留下样品。
            </div>

            {[
              {
                step: 1, title: "停车 / 进门", icon: "🚗", iconBg: "bg-gray-100",
                content: (
                  <ul className="space-y-1 text-sm text-gray-700">
                    <li>• 着装整洁，面带微笑</li>
                    <li>• 手持样品袋（显示你有备而来）</li>
                    <li>• 观察门口——是否有其他供应商的贴纸？</li>
                  </ul>
                ),
              },
              {
                step: 2, title: "开场打招呼", icon: "👋", iconBg: "bg-blue-100",
                content: (
                  <div className="space-y-2">
                    <ScriptBlock label="▶ 普通话版" side="you">
                      你好！不好意思打扰一下，我是附近手套供应商，专门服务诊所和美容院这一带的。我们最近在这个区域推广，想来跟你们认识一下，顺便带了样品给你们试试看。
                    </ScriptBlock>
                    <ScriptBlock label="▶ 马来语版" side="you">
                      Hai, maaf ganggu ya. Saya dari supplier sarung tangan medical, kami ada supply untuk klinik dan salun kecantikan area sini. Saya nak perkenalkan diri dan bawa sample untuk korang cuba.
                    </ScriptBlock>
                    <ScriptBlock label="▶ 英语版" side="you">
                      Hi, sorry to disturb. I'm from a medical glove supplier servicing clinics and beauty salons in this area. Just wanted to introduce ourselves and drop off some samples for you to try.
                    </ScriptBlock>
                  </div>
                ),
              },
              {
                step: 3, title: "需求挖掘（问1–2个问题）", icon: "🔍", iconBg: "bg-purple-100",
                content: (
                  <ScriptBlock label="▶ 关键问题（选1–2个问）" side="you">
                    {`你们现在手套是从哪里拿货的？\n\n你们一个月大概用多少盒？\n\n有没有遇到货不够用、或者质量不稳定的情况？`}
                  </ScriptBlock>
                ),
              },
              {
                step: 4, title: "产品展示 + 报价", icon: "🧤", iconBg: "bg-emerald-100",
                content: (
                  <div className="space-y-2">
                    <ScriptBlock label="▶ 展示话术" side="you">
                      {`这是我们的丁晴手套，你试试看手感。质量很稳定，我们很多诊所客户都在用。\n\n价格方面，如果你们一次拿一箱（10盒），丁晴是RM17.50一盒，乳胶是RM19.00一盒。量更大我们可以再谈。`}
                    </ScriptBlock>
                    <div className="bg-gray-50 rounded-lg p-3 text-xs font-mono space-y-1 text-gray-700">
                      <p>🔵 丁晴手套 (Nitrile)  → RM 17.50 / 盒</p>
                      <p>🟡 乳胶手套 (Latex)    → RM 19.00 / 盒</p>
                      <p>📦 一箱 = 10盒，隔天送货</p>
                    </div>
                  </div>
                ),
              },
              {
                step: 5, title: "收尾 / 取得联系方式", icon: "🤝", iconBg: "bg-amber-100",
                content: (
                  <div className="space-y-2">
                    <ScriptBlock label="▶ 收尾话术 A（他有兴趣）" side="you">
                      这样吧，我把我的WhatsApp给你，你有需要随时联系我。你们什么时候会需要补货？我到时候再跟进你。
                    </ScriptBlock>
                    <ScriptBlock label="▶ 收尾话术 B（他犹豫）" side="you">
                      没关系，我把这盒样品留给你们用用看。如果质量OK，到时候再联系我就好。我先把报价发给你WhatsApp，方便的话给我你号码？
                    </ScriptBlock>
                  </div>
                ),
              },
              {
                step: 6, title: "离开后发WhatsApp", icon: "📱", iconBg: "bg-green-100",
                content: (
                  <ScriptBlock label="▶ 第一条WhatsApp（当天发）" side="you">
                    {`你好，我是刚才来拜访的[名字]，手套供应商 😊\n报价如下：\n🔵 丁晴手套: RM17.50/盒\n🟡 乳胶手套: RM19.00/盒\n📦 一箱10盒，隔天送货\n有需要补货随时告诉我，谢谢！`}
                  </ScriptBlock>
                ),
              },
            ].map(({ step, title, icon, iconBg, content }) => (
              <TrainingCard key={step} title={`步骤 ${step}：${title}`} icon={icon} iconBg={iconBg}>
                {content}
              </TrainingCard>
            ))}
          </>
        )}

        {/* ── 话术剧本 ─────────────────────────────────────────────────── */}
        {activeTab === "scripts" && (
          <>
            <TrainingCard title="场景：私人诊所 (GP Clinic)" icon="🏥" iconBg="bg-blue-100">
              <ScriptBlock label="▶ 你" side="you">
                你好！不好意思打扰，我是手套供应商。你们诊所一般用哪种手套？我们有Nitrile和Latex，质量很稳定，很多GP Clinic在用。
              </ScriptBlock>
              <ScriptBlock label="▶ 常见回应" side="them">有固定供应商了。</ScriptBlock>
              <ScriptBlock label="▶ 你" side="you">
                太好了，说明你们对质量有要求。我不是要取代你们的供应商——我是想让你们多一个备选。把我号码存着，万一货不够或者想比较价格，随时联系我就好。
              </ScriptBlock>
            </TrainingCard>

            <TrainingCard title="场景：美容院 / Nail Salon" icon="💅" iconBg="bg-pink-100">
              <ScriptBlock label="▶ 你" side="you">
                你好！我是手套供应商，专门服务附近的美容院。你们每个月大概用多少盒？我们有PE手套和Nitrile，价格比超市便宜20–30%，还送货上门。
              </ScriptBlock>
              <ScriptBlock label="▶ 你（追问）" side="you">
                你们现在从哪里拿货？超市买的话我们肯定有更好的价格，而且不用自己去搬。
              </ScriptBlock>
            </TrainingCard>

            <TrainingCard title="场景：牙科诊所" icon="🦷" iconBg="bg-amber-100">
              <ScriptBlock label="▶ 你" side="you">
                你好，我是专门供应医疗手套的，你们牙科诊所通常用Nitrile对吧？我们的质量很稳定，有医疗级认证，价格RM17.50/盒。可以先拿一盒样品试试吗？
              </ScriptBlock>
            </TrainingCard>

            <TrainingCard title="场景：Receptionist 挡在前面" icon="🚧" iconBg="bg-red-100">
              <ScriptBlock label="▶ 你" side="you">
                你好，我是手套供应商，想跟你们老板/经理介绍一下我们的产品，方便吗？
              </ScriptBlock>
              <ScriptBlock label="▶ Receptionist" side="them">老板不在 / 很忙 / 你留资料吧。</ScriptBlock>
              <ScriptBlock label="▶ 你" side="you">
                好的，我把报价单留在这里，你有空帮我递给老板。如果老板有兴趣，随时联系我。谢谢你哦，真的。
              </ScriptBlock>
            </TrainingCard>

            <TrainingCard title="WhatsApp 跟进话术" icon="📱" iconBg="bg-green-100">
              <ScriptBlock label="▶ 第一次跟进（拜访后当天）" side="you">
                {`你好 [名字]，我是刚才来拜访的 [你的名字]，手套供应商。\n\n正式报价：\n🔵 丁晴手套：RM17.50/盒\n🟡 乳胶手套：RM19.00/盒\n📦 最低订量：1箱（10盒）\n🚚 隔天送货（KL/PJ area）\n\n有任何问题随时问我！😊`}
              </ScriptBlock>
              <ScriptBlock label="▶ 3天后跟进（如果没回复）" side="you">
                你好，想跟进一下上次的手套样品——有机会试用了吗？质量如果OK，随时告诉我下单就好了。
              </ScriptBlock>
              <ScriptBlock label="▶ 1周后跟进（最后一次）" side="you">
                你好！月底快到了，这个月手套还够用吗？如果要补货我这边随时可以安排。这是我们本月报价供你参考 🙏
              </ScriptBlock>
            </TrainingCard>
          </>
        )}

        {/* ── 拒绝应对 ─────────────────────────────────────────────────── */}
        {activeTab === "objections" && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
              <strong>原则：</strong>客户说"不"时，90%情况下有标准应对。不要争辩，先认同，再切入。
            </div>
            <div className="space-y-2">
              <ObjAccordion
                q="我们有固定供应商了"
                a="有的太好了，说明你们对质量是有要求的。我不是来取代你们现有供应商的——我是想让你们多一个备选。供应商缺货、涨价、或者服务不好的时候，你有另一个选择。只需要把我的号码存着就好，不用立刻改变什么。"
              />
              <ObjAccordion
                q="你们太贵了 / 别人更便宜"
                a={`便宜多少？（让他说价格）\n\n我明白。便宜当然好，但手套这个东西，质量差一盒可能要多用两倍。你们用的量不少，品质不稳定代价更高。这是我们的样品，你先试试，如果真的一样好，我们可以再谈价格。`}
                note="如果他坚持要你配合价格：你们一个月大概拿几箱？如果量到了，我可以帮你申请更好的价格。但我需要知道你们的月用量才能谈。"
              />
              <ObjAccordion
                q="我现在很忙"
                a="没问题，我不占用你时间。我只做一件事——把样品留在这里，你有空看看。如果质量好，WhatsApp我就行了，我送货上门，你不用花时间出去买。"
              />
              <ObjAccordion
                q="要问老板 / 我做不了决定"
                a="好的，完全理解。方便的话，让我把报价直接发给老板的WhatsApp，这样他看了有问题可以直接问我，不用你中间传话——这样是不是比较方便？"
                note="如果他不给老板号码：好的，那我把报价单留在这，你有空帮我递给老板。我什么时候方便再跟进？"
              />
              <ObjAccordion
                q="我们不急，还有很多货"
                a="好的，那就更好了——你们现在不急，可以先比较比较。我把样品和报价留给你，等你们这批用完了，可以对比看看价格和质量。到时候有需要直接WhatsApp我，很方便。"
              />
              <ObjAccordion
                q="没听过你们 / 你们是什么公司"
                a="我们是本地供应商，专注服务KL/PJ这一带的诊所和美容院。虽然不是大品牌，但服务很直接——你直接WhatsApp我，我直接送货，没有中间商。很多客户反而喜欢这种方式，因为有问题直接解决。"
              />
              <ObjAccordion
                q="不需要，谢谢"
                a="好的，没问题，谢谢你的时间。我把名片留在这，万一哪天有需要，随时找我。祝生意兴隆！"
              />
            </div>
          </>
        )}

        {/* ── 实战模拟 ─────────────────────────────────────────────────── */}
        {activeTab === "roleplay" && (
          <>
            <TrainingCard title="训练方法" icon="📋" iconBg="bg-blue-100">
              <ul className="space-y-1.5 text-sm text-gray-700">
                {[
                  "找同事扮演客户，进行角色扮演",
                  "先朗读话术3遍，再自然说（不用背字对字）",
                  "录音回听——找出停顿/语气问题",
                  "每个场景练到30秒内说完开场白",
                  "出门前先演练1次再出发",
                ].map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-bold text-blue-500 flex-shrink-0">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </TrainingCard>

            <RoleplayCard
              title="场景一：一切顺利"
              icon="🎯"
              iconBg="bg-emerald-100"
              scenario="客户友好，有兴趣，愿意留WhatsApp"
              steps={[
                "开场白（普通话/BM/英语，选一）",
                "问需求：'你们现在从哪里拿货？'",
                "展示样品 + 报价（RM17.50 / RM19.00）",
                "收尾A：'我把我的WhatsApp给你…'",
                "记录店名、联系人、下次跟进时间",
              ]}
            />

            <RoleplayCard
              title="场景二：连环拒绝"
              icon="💢"
              iconBg="bg-red-100"
              scenario="客户连续说不，态度冷淡"
              steps={[
                "保持微笑，不慌乱",
                "每个拒绝用对应话术应对（见拒绝应对）",
                "最多尝试2次，然后优雅撤退",
                "留下样品/名片：'谢谢你的时间，祝生意兴隆'",
                "不要在意——下一家可能是你的大客户",
              ]}
            />

            <RoleplayCard
              title="场景三：价格博弈"
              icon="🔄"
              iconBg="bg-cyan-100"
              scenario="客户一直压价，要求配合现有供应商价格"
              steps={[
                "先问：'你们现在买多少钱一盒？'（让他先说）",
                "如果差距不大：'这个价格我帮你申请一下，但需要知道月用量'",
                "如果差距很大：强调质量 + 服务 + 送货上门的价值",
                "实在不行：'你先用这盒样品，质量好了再谈价格'",
                "不要在第一次见面就破价——先建立关系",
              ]}
            />
          </>
        )}

        {/* ── 武器装备 ─────────────────────────────────────────────────── */}
        {activeTab === "tools" && (
          <>
            <TrainingCard title="随身必备清单" icon="🎒" iconBg="bg-blue-100">
              <ul className="space-y-2">
                {[
                  { item: "丁晴手套样品（至少2–3盒）",       essential: true  },
                  { item: "乳胶手套样品（至少1–2盒）",       essential: true  },
                  { item: "报价单（印好，10张以上）",         essential: true  },
                  { item: "名片（50张）",                    essential: true  },
                  { item: "WhatsApp设置好：头像+专业签名",   essential: true  },
                  { item: "笔记本/手机备注客户信息",         essential: false },
                  { item: "水（长时间拜访补水）",            essential: false },
                ].map(({ item, essential }, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className={essential ? "text-emerald-500 font-bold" : "text-gray-400"}>
                      {essential ? "✓" : "○"}
                    </span>
                    <span className={essential ? "text-gray-800" : "text-gray-500"}>{item}</span>
                    {essential && <span className="text-xs text-red-500 font-medium ml-auto">必备</span>}
                  </li>
                ))}
              </ul>
            </TrainingCard>

            <TrainingCard title="报价单格式参考" icon="📋" iconBg="bg-amber-100">
              <div className="bg-gray-50 rounded-lg p-4 font-mono text-xs text-gray-700 space-y-1.5">
                <p className="font-bold text-gray-900 text-sm mb-2">MediGlove 手套报价单</p>
                <p>─────────────────────────</p>
                <p>产品           | 单价      | 每箱</p>
                <p>─────────────────────────</p>
                <p>丁晴手套 Nitrile  | RM17.50/盒 | 10盒/箱</p>
                <p>乳胶手套 Latex    | RM19.00/盒 | 10盒/箱</p>
                <p>─────────────────────────</p>
                <p>📦 最低订量：1箱（10盒）</p>
                <p>🚚 隔天送货（KL/PJ area）</p>
                <p>💳 付款：转账/现金</p>
                <p>─────────────────────────</p>
                <p>联系：[你的名字] [你的WhatsApp]</p>
              </div>
            </TrainingCard>

            <TrainingCard title="每日拜访记录" icon="📊" iconBg="bg-green-100">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      {["店名", "联系人", "电话", "反应", "下次跟进"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-semibold text-gray-600 border border-gray-200">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {["1","2","3"].map((n) => (
                      <tr key={n}>
                        {Array(5).fill("").map((_, i) => (
                          <td key={i} className="px-2 py-2 border border-gray-200 text-gray-400">—</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">每次拜访后立即记录，不要靠记忆。</p>
            </TrainingCard>

            <TrainingCard title="每日KPI目标" icon="🎯" iconBg="bg-cyan-100">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "拜访家数",       target: "10 家",  color: "bg-blue-50 border-blue-200  text-blue-800"  },
                  { label: "拿到WhatsApp",   target: "2 个",   color: "bg-emerald-50 border-emerald-200 text-emerald-800" },
                  { label: "留下样品",       target: "3 份",   color: "bg-amber-50 border-amber-200 text-amber-800" },
                  { label: "下单/试单目标",  target: "1 单",   color: "bg-red-50 border-red-200 text-red-800"   },
                ].map(({ label, target, color }) => (
                  <div key={label} className={`rounded-lg border p-3 ${color}`}>
                    <p className="text-xs font-medium opacity-70">{label}</p>
                    <p className="text-xl font-bold mt-0.5">{target}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3">
                💡 做到10家拜访，即使全被拒绝，也是正常的练习。持续做，数字会改善。
              </p>
            </TrainingCard>
          </>
        )}

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
  const [viewMode,         setViewMode]         = useState<"materials" | "training">("materials");

  const { data, isLoading, refetch } = useList<PlaybookMaterial>({
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
    deleteMaterial(
      { resource: "playbook_materials", id: m.id },
      {
        onSuccess: () => refetch(),
        onError:   (err) => alert((err as unknown as Error).message ?? "Delete failed."),
      }
    );
  }, [deleteMaterial, refetch]);

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

      {/* ── View mode tab bar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setViewMode("materials")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors
                      ${viewMode === "materials"
                        ? "bg-gray-900 text-white"
                        : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
        >
          🗂️ Materials Library
        </button>
        <button
          onClick={() => setViewMode("training")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors
                      ${viewMode === "training"
                        ? "bg-gray-900 text-white"
                        : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
        >
          📚 Sales Training 销售培训
        </button>
      </div>

      {/* ── Sales Training view ───────────────────────────────────────── */}
      {viewMode === "training" && (
        <div style={{ height: "calc(100vh - 180px)" }}>
          <SalesTrainingTab />
        </div>
      )}

      {/* ── Materials Library view ────────────────────────────────────── */}
      {viewMode === "materials" && (
      <div className="flex gap-4" style={{ height: "calc(100vh - 180px)" }}>

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
      )} {/* end viewMode === "materials" */}
    </>
  );
}
