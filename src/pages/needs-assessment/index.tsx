// ══════════════════════════════════════════════════════════════════════════════
// src/pages/needs-assessment/index.tsx — MediGlove ERP
// Customer Needs Assessment — 客户需求挖取问卷
//
// Features:
//   • 6-section form matching glove_needs_assessment.html
//   • Auto find-or-create client when header fields (店名+区域+日期) are complete
//   • Lead temperature scoring (Hot / Warm / Cold)
//   • Saves to needs_assessments table, links client_id
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useGetIdentity } from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
import type { StaffRole } from "../../types/staff";
import type { ClientRegion } from "../../types/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Identity { id: string; name: string; role: StaffRole; }

// ── Lead scoring (mirrors analyzeNeeds() from HTML) ──────────────────────────

function computeLeadScore(data: FormData): { score: number; temperature: "Hot" | "Warm" | "Cold" } {
  let score = 0;
  const fromRetail = data.supplierSources.some(
    (s) => s.includes("零售") || s.includes("Guardian") || s.includes("超市")
  );
  const fromOnline = data.supplierSources.some(
    (s) => s.includes("网购") || s.includes("Shopee")
  );
  const hasSupplier = data.supplierSources.some((s) => s.includes("固定供货商"));

  if (fromRetail || fromOnline) score += 30;
  if (hasSupplier && data.satisfaction <= 3 && data.satisfaction > 0) score += 25;
  if (data.painPoints.length >= 2) score += 20;
  if (data.satisfaction <= 2 && data.satisfaction > 0) score += 20;
  if (data.satisfaction === 3) score += 10;
  if (data.nextReorder.includes("星期")) score += 15;
  if (data.nextReorder.includes("月内")) score += 8;
  const wontSwitch = data.switchConditions.some(
    (s) => s.includes("没有") || s.includes("出问题")
  );
  if (data.switchConditions.length >= 2 && !wontSwitch) score += 10;
  if (data.todayActions.some((a) => a.includes("立刻"))) score += 20;

  score = Math.min(100, score);
  const temperature: "Hot" | "Warm" | "Cold" =
    score >= 70 ? "Hot" : score >= 40 ? "Warm" : "Cold";
  return { score, temperature };
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormData {
  // Header
  shopName:         string;
  contactName:      string;
  visitDate:        string;
  region:           ClientRegion | "";
  contactWhatsapp:  string;
  // S1
  industry:         string;
  // S2
  monthlyUsage:     string;
  gloveTypes:       string[];
  gloveSizes:       string[];
  // S3
  supplierSources:  string[];
  priceRange:       string;
  reorderTiming:    string;
  // S4
  painPoints:       string[];
  priorities:       string[];
  // S5
  switchConditions: string[];
  decisionMaker:    string;
  satisfaction:     number;
  // S6
  nextReorder:      string;
  todayActions:     string[];
  salesNotes:       string;
}

const EMPTY_FORM: FormData = {
  shopName: "", contactName: "", visitDate: new Date().toISOString().split("T")[0],
  region: "", contactWhatsapp: "", industry: "", monthlyUsage: "", gloveTypes: [],
  gloveSizes: [], supplierSources: [], priceRange: "", reorderTiming: "",
  painPoints: [], priorities: [], switchConditions: [], decisionMaker: "",
  satisfaction: 0, nextReorder: "", todayActions: [], salesNotes: "",
};

// ── Multi-select chip helper ───────────────────────────────────────────────────

function toggleArr(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function SectionCard({ num, title, badge, badgeColor, children }: {
  num: number; title: string; badge: string; badgeColor: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center">
          {num}
        </span>
        <span className="flex-1 font-semibold text-gray-900 text-sm">{title}</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeColor}`}>{badge}</span>
        <span className="text-gray-400 text-xs ml-1">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-5 pb-5 space-y-4 border-t border-gray-50">{children}</div>}
    </div>
  );
}

function QLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-gray-700 mt-4 mb-2">{children}</p>;
}

function ChipGroup({ options, selected, onToggle, radio = false }: {
  options: string[]; selected: string[]; onToggle: (v: string) => void; radio?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                        ${active
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-red-300 hover:text-red-600"}`}
          >
            {active && radio ? "● " : active ? "✓ " : ""}{opt}
          </button>
        );
      })}
    </div>
  );
}

function RadioGroup({ options, selected, onSelect }: {
  options: string[]; selected: string; onSelect: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                      ${selected === opt
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-red-300 hover:text-red-600"}`}
        >
          {selected === opt ? "● " : ""}{opt}
        </button>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function NeedsAssessmentPage() {
  const { data: identity } = useGetIdentity<Identity>();
  const [form,       setForm]       = useState<FormData>({ ...EMPTY_FORM });
  const [clientId,   setClientId]   = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [autoStatus, setAutoStatus] = useState<"idle" | "searching" | "found" | "created" | "error">("idle");
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const [result,     setResult]     = useState<{ score: number; temperature: "Hot" | "Warm" | "Cold" } | null>(null);

  const autoLookupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Set form field ──────────────────────────────────────────────────────────
  const set = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Auto find-or-create client ──────────────────────────────────────────────
  useEffect(() => {
    if (!form.shopName.trim() || !form.region || !form.visitDate || !identity?.id) {
      setAutoStatus("idle");
      setClientId(null);
      setClientName(null);
      return;
    }

    // Debounce 800ms
    if (autoLookupRef.current) clearTimeout(autoLookupRef.current);
    autoLookupRef.current = setTimeout(async () => {
      setAutoStatus("searching");
      try {
        // 1. Try to find existing client owned by this salesperson with same name
        const { data: existing } = await supabaseClient
          .from("clients")
          .select("id, name")
          .ilike("name", form.shopName.trim())
          .eq("owner_id", identity.id)
          .maybeSingle();

        if (existing) {
          setClientId(existing.id);
          setClientName(existing.name);
          setAutoStatus("found");
          return;
        }

        // 2. Create new client
        const { data: created, error } = await supabaseClient
          .from("clients")
          .insert({
            name:           form.shopName.trim(),
            region:         form.region,
            owner_id:       identity.id,
            created_by:     identity.id,
            contact_person: form.contactName.trim() || null,
            contact_phone:  form.contactWhatsapp.trim() || null,
            is_orphan:      false,
            credit_terms:   "Cash Term",
            neglect_index:  0,
          })
          .select("id, name")
          .single();

        if (error) throw error;
        setClientId(created.id);
        setClientName(created.name);
        setAutoStatus("created");
      } catch (err) {
        console.error("Client auto-create failed:", err);
        setAutoStatus("error");
      }
    }, 800);

    return () => { if (autoLookupRef.current) clearTimeout(autoLookupRef.current); };
  }, [form.shopName, form.region, form.visitDate, form.contactName, form.contactWhatsapp, identity?.id]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identity?.id) return;

    const { score, temperature } = computeLeadScore(form);
    setResult({ score, temperature });

    setSaving(true);
    setSaveError(null);

    const { error } = await supabaseClient.from("needs_assessments").insert({
      client_id:        clientId ?? null,
      created_by:       identity.id,
      visit_date:       form.visitDate,
      shop_name:        form.shopName.trim(),
      contact_name:     form.contactName.trim() || null,
      contact_whatsapp: form.contactWhatsapp.trim() || null,
      region:           form.region || null,
      industry:         form.industry || null,
      monthly_usage:    form.monthlyUsage || null,
      glove_types:      form.gloveTypes,
      glove_sizes:      form.gloveSizes,
      supplier_sources: form.supplierSources,
      price_range:      form.priceRange || null,
      reorder_timing:   form.reorderTiming || null,
      pain_points:      form.painPoints,
      priorities:       form.priorities,
      switch_conditions: form.switchConditions,
      decision_maker:   form.decisionMaker || null,
      satisfaction:     form.satisfaction || null,
      next_reorder:     form.nextReorder || null,
      today_actions:    form.todayActions,
      sales_notes:      form.salesNotes.trim() || null,
      lead_score:       score,
      lead_temperature: temperature,
    });

    setSaving(false);
    if (error) {
      setSaveError(error.message);
    } else {
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleReset = () => {
    setForm({ ...EMPTY_FORM });
    setClientId(null);
    setClientName(null);
    setAutoStatus("idle");
    setSaved(false);
    setSaveError(null);
    setResult(null);
  };

  // ── Saved confirmation screen ───────────────────────────────────────────────
  if (saved && result) {
    const tempMeta = {
      Hot:  { label: "🔥 热度高 (Hot)",    color: "bg-red-500",    text: "text-red-700",  bg: "bg-red-50 border-red-200"  },
      Warm: { label: "🌡️ 值得跟进 (Warm)", color: "bg-amber-400",  text: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
      Cold: { label: "❄️ 暂时观望 (Cold)", color: "bg-blue-400",   text: "text-blue-700",  bg: "bg-blue-50 border-blue-200"  },
    }[result.temperature];

    return (
      <div className="max-w-xl mx-auto mt-12 space-y-6">
        <div className={`rounded-2xl border p-8 text-center ${tempMeta.bg}`}>
          <div className="text-5xl mb-3">✅</div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">问卷已保存</h2>
          <p className="text-sm text-gray-500 mb-6">客户记录已{autoStatus === "created" ? "自动创建" : "关联"}</p>

          <div className="space-y-3 text-left bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">店名</span>
              <span className="font-medium text-gray-900">{form.shopName}</span>
            </div>
            {clientName && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">客户档案</span>
                <span className="font-medium text-emerald-700">✓ {clientName}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">客户热度</span>
              <span className={`font-bold ${tempMeta.text}`}>{tempMeta.label}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">评分</span>
              <span className="font-bold text-gray-900">{result.score} / 100</span>
            </div>
            {form.industry && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">行业</span>
                <span className="font-medium text-gray-900">{form.industry}</span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleReset}
          className="w-full py-3 bg-gray-900 text-white rounded-xl font-medium text-sm
                     hover:bg-gray-800 transition-colors"
        >
          ＋ 开始新的问卷
        </button>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-4 pb-12">

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">客户需求挖取问卷</h1>
        <p className="text-sm text-gray-500 mt-1">
          业务员：<strong>{identity?.name ?? "—"}</strong>
        </p>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠ 保存失败：{saveError}
        </div>
      )}

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">基本信息</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 店名 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              店名 / 诊所名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Klinik Sejahtera"
              value={form.shopName}
              onChange={(e) => set("shopName", e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* 联系人 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">联系人姓名</label>
            <input
              type="text"
              placeholder="Dr. / 老板 / 助理"
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* 拜访日期 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              拜访日期 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={form.visitDate}
              onChange={(e) => set("visitDate", e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* 区域 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              区域 (Region) <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={form.region}
              onChange={(e) => set("region", e.target.value as ClientRegion)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
            >
              <option value="">请选择…</option>
              <option value="West Malaysia">West Malaysia（马来半岛）</option>
              <option value="East Malaysia">East Malaysia（东马）</option>
            </select>
          </div>
        </div>

        {/* Auto-client status */}
        {autoStatus !== "idle" && (
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg
                          ${autoStatus === "found"   ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : autoStatus === "created" ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : autoStatus === "error"   ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-gray-50 text-gray-500 border border-gray-200"}`}>
            {autoStatus === "searching" && <span className="animate-spin">↻</span>}
            {autoStatus === "found"   && <span>✓</span>}
            {autoStatus === "created" && <span>＋</span>}
            {autoStatus === "error"   && <span>⚠</span>}
            <span>
              {autoStatus === "searching" && "正在查找客户档案…"}
              {autoStatus === "found"     && `已关联客户：${clientName}`}
              {autoStatus === "created"   && `已自动创建客户：${clientName}`}
              {autoStatus === "error"     && "客户档案创建失败，但问卷仍可提交"}
            </span>
          </div>
        )}
      </div>

      {/* ── S1: Industry ─────────────────────────────────────────────────── */}
      <SectionCard num={1} title="你们是做什么行业的？" badge="单选" badgeColor="bg-gray-100 text-gray-600">
        <QLabel>请选择最符合的行业类型：</QLabel>
        <RadioGroup
          options={[
            "🏥 私人诊所 (GP Clinic)",
            "🦷 牙科诊所 (Dental)",
            "💅 美容院 / Nail Salon",
            "🧖 Spa / 按摩中心",
            "💉 美容医学 (Aesthetic)",
            "🍽️ 餐饮 / 食品处理",
            "🧹 清洁 / 维修服务",
            "🏭 工厂 / 制造业",
            "🐾 兽医 / 宠物护理",
            "📦 其他",
          ]}
          selected={form.industry}
          onSelect={(v) => set("industry", v)}
        />
      </SectionCard>

      {/* ── S2: Usage ────────────────────────────────────────────────────── */}
      <SectionCard num={2} title="目前的手套使用情况" badge="关键信息" badgeColor="bg-red-100 text-red-700">
        <QLabel>2.1 每月大概用多少盒？（单选）</QLabel>
        <RadioGroup
          options={["少于 5 盒", "5 – 10 盒", "10 – 20 盒", "20 – 50 盒", "50 – 100 盒", "超过 100 盒"]}
          selected={form.monthlyUsage}
          onSelect={(v) => set("monthlyUsage", v)}
        />

        <QLabel>2.2 目前用的是哪种手套？（可多选）</QLabel>
        <ChipGroup
          options={["🔵 丁晴手套 (Nitrile)", "🟡 乳胶手套 (Latex)", "⚪ PE 薄膜手套", "❓ 不清楚 / 随便买"]}
          selected={form.gloveTypes}
          onToggle={(v) => set("gloveTypes", toggleArr(form.gloveTypes, v))}
        />

        <QLabel>2.3 偏好的尺码？（可多选）</QLabel>
        <ChipGroup
          options={["XS 特小", "S 小", "M 中", "L 大", "XL 特大", "多种混合"]}
          selected={form.gloveSizes}
          onToggle={(v) => set("gloveSizes", toggleArr(form.gloveSizes, v))}
        />
      </SectionCard>

      {/* ── S3: Procurement ──────────────────────────────────────────────── */}
      <SectionCard num={3} title="现有采购方式" badge="关键信息" badgeColor="bg-red-100 text-red-700">
        <QLabel>3.1 现在从哪里拿货？（可多选）</QLabel>
        <ChipGroup
          options={[
            "🏪 零售药房（Guardian、Watsons等）",
            "🛒 大型超市（Lotus、Aeon）",
            "🌐 网购（Shopee / Lazada）",
            "🚚 固定供货商上门送",
            "🏢 Medical supply company",
            "❓ 没有固定来源，随便找",
          ]}
          selected={form.supplierSources}
          onToggle={(v) => set("supplierSources", toggleArr(form.supplierSources, v))}
        />

        {(form.supplierSources.some((s) => s.includes("零售") || s.includes("超市") || s.includes("网购"))) && (
          <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700">
            💡 可以直接打价格牌："我们比零售便宜 20–30%，还送货上门"
          </div>
        )}
        {form.supplierSources.some((s) => s.includes("固定供货商")) && (
          <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-700">
            💡 用"备用供应商"策略切入，不要求立刻换
          </div>
        )}

        <QLabel>3.2 现在一盒手套大概花多少钱？（单选）</QLabel>
        <RadioGroup
          options={["RM 10 以下", "RM 10 – 15", "RM 15 – 18", "RM 18 – 22", "RM 22 以上", "不清楚"]}
          selected={form.priceRange}
          onSelect={(v) => set("priceRange", v)}
        />

        <QLabel>3.3 通常提前多久补货？（单选）</QLabel>
        <RadioGroup
          options={[
            "快用完才买（随时可能断货）",
            "剩1–2盒时补",
            "每月固定日期订购",
            "有备货习惯（存几箱）",
          ]}
          selected={form.reorderTiming}
          onSelect={(v) => set("reorderTiming", v)}
        />
      </SectionCard>

      {/* ── S4: Pain points ──────────────────────────────────────────────── */}
      <SectionCard num={4} title="目前的痛点与不满" badge="突破口" badgeColor="bg-amber-100 text-amber-700">
        <QLabel>4.1 遇到过哪些问题？（可多选）</QLabel>
        <ChipGroup
          options={[
            "📦 缺货问题：想买时买不到",
            "💸 价格不稳定：供应商经常涨价",
            "🔧 质量不稳定：不同批次参差不齐",
            "🚗 自取麻烦：需要自己开车去买",
            "📱 服务差：联系困难或响应慢",
            "🧤 尺码问题：想要的尺码没货",
            "🌡️ 过敏问题：员工对乳胶过敏",
            "✅ 目前没有什么大问题",
          ]}
          selected={form.painPoints}
          onToggle={(v) => set("painPoints", toggleArr(form.painPoints, v))}
        />

        <QLabel>4.2 最在乎哪方面？（可多选）</QLabel>
        <ChipGroup
          options={["价格", "质量", "送货速度", "服务态度", "付款方式", "品牌信誉"]}
          selected={form.priorities}
          onToggle={(v) => set("priorities", toggleArr(form.priorities, v))}
        />
      </SectionCard>

      {/* ── S5: Switch willingness ───────────────────────────────────────── */}
      <SectionCard num={5} title="切换供应商的意愿" badge="突破口" badgeColor="bg-amber-100 text-amber-700">
        <QLabel>5.1 什么情况下会考虑切换供应商？（可多选）</QLabel>
        <ChipGroup
          options={[
            "价格比现在便宜 10% 以上",
            "质量明显比现在更好",
            "隔天送货上门，免去自取麻烦",
            "允许小量订购（不用囤太多货）",
            "提供月结或灵活付款方式",
            "不会轻易换，除非现有的出问题",
            "目前没有切换的打算",
          ]}
          selected={form.switchConditions}
          onToggle={(v) => set("switchConditions", toggleArr(form.switchConditions, v))}
        />

        <QLabel>5.2 谁负责采购决定？（单选）</QLabel>
        <RadioGroup
          options={[
            "我本人（老板）",
            "需要问 Doctor",
            "Manager 决定",
            "我负责但需报价",
            "公司统一采购",
            "不清楚",
          ]}
          selected={form.decisionMaker}
          onSelect={(v) => set("decisionMaker", v)}
        />

        <QLabel>5.3 对现有供应商的满意程度（1=很不满意，5=非常满意）</QLabel>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set("satisfaction", n)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors
                          ${form.satisfaction === n
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-gray-500 border-gray-200 hover:border-red-300"}`}
            >
              {n}<br />
              <span className="text-base">{["😤","😒","😐","🙂","😊"][n-1]}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* ── S6: Next steps ───────────────────────────────────────────────── */}
      <SectionCard num={6} title="下一步行动" badge="成交导向" badgeColor="bg-emerald-100 text-emerald-700">
        <QLabel>6.1 预计下次补货时间？（单选）</QLabel>
        <RadioGroup
          options={[
            "这个星期内",
            "两个星期内",
            "这个月内",
            "下个月",
            "不确定",
          ]}
          selected={form.nextReorder}
          onSelect={(v) => set("nextReorder", v)}
        />

        <QLabel>6.2 今天的成果？（可多选）</QLabel>
        <ChipGroup
          options={[
            "📱 保存业务员 WhatsApp 联系方式",
            "📋 需要正式报价单",
            "🛒 有兴趣立刻下单试用",
            "📅 需要时间考虑，下次再联系",
            "👋 暂时不需要，留名片就好",
          ]}
          selected={form.todayActions}
          onToggle={(v) => set("todayActions", toggleArr(form.todayActions, v))}
        />

        <QLabel>客户 WhatsApp</QLabel>
        <input
          type="tel"
          placeholder="e.g. 012-3456789"
          value={form.contactWhatsapp}
          onChange={(e) => set("contactWhatsapp", e.target.value)}
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-red-500"
        />

        <QLabel>业务员笔记</QLabel>
        <textarea
          rows={3}
          placeholder="例如：老板态度友好，目前用Shopee买，价格RM20/盒，缺货过一次。下周一再跟进。"
          value={form.salesNotes}
          onChange={(e) => set("salesNotes", e.target.value)}
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
        />
      </SectionCard>

      {/* ── Submit ───────────────────────────────────────────────────────── */}
      <button
        type="submit"
        disabled={saving || !form.shopName.trim() || !form.region || !form.visitDate}
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed
                   text-white font-semibold rounded-xl transition-colors"
      >
        {saving ? "正在保存…" : "📊 生成需求分析并保存"}
      </button>
    </form>
  );
}
