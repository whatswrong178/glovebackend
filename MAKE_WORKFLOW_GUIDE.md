# T-02.4 — Make.com 员工关怀自动化配置手册
## 生日祝福 + 入职周年纪念 双工作流

**架构说明**
- **触发** → Make.com Timer（每天 09:00 MY时间）
- **查询** → Supabase RPC（`fn_get_birthday_celebrants` / `fn_get_anniversary_celebrants`）
- **发信** → MediGlove `send-email` Edge Function（Resend，发件人 `care@yourdomain.com`）

---

## WORKFLOW 1：员工生日祝福

### 场景结构（按顺序连接以下模块）

```
[1] Schedule (Timer)
    ↓
[2] HTTP → Supabase RPC (查今日生日员工)
    ↓
[3] Iterator (逐条处理)
    ↓
[4] HTTP → MediGlove send-email Edge Function
```

---

### 模块 1：Schedule

| 设置项 | 值 |
|--------|----|
| Run scenario | Every day |
| Time | 09:00 |
| Timezone | Asia/Kuala_Lumpur |

---

### 模块 2：HTTP → Make a request（查生日员工）

| 设置项 | 值 |
|--------|-----|
| URL | `https://futwxbtfgvpeipmddbdt.supabase.co/rest/v1/rpc/fn_get_birthday_celebrants` |
| Method | POST |
| Headers | `apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dHd4YnRmZ3ZwZWlwbWRkYmR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njk3MTU2MCwiZXhwIjoyMDkyNTQ3NTYwfQ.g2-c-mahzlXqE06HLsSfByB5gdMIQCLdNuhHppYBfJ4` |
| Headers | `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dHd4YnRmZ3ZwZWlwbWRkYmR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njk3MTU2MCwiZXhwIjoyMDkyNTQ3NTYwfQ.g2-c-mahzlXqE06HLsSfByB5gdMIQCLdNuhHppYBfJ4` |
| Headers | `Content-Type: application/json` |
| Body type | Raw (JSON) |
| Body | `{"p_date": "{{formatDate(now; "YYYY-MM-DD")}}"}` |
| Parse response | Yes |

> ⚠️ 若今日无生日员工，RPC 返回空数组 `[]`，Iterator 自动跳过，不发任何邮件。

---

### 模块 3：Iterator

- **Array**: `{{2.data}}` （模块 2 的 HTTP 响应 body）
- Make.com 会对数组中每个员工对象逐条执行后续模块

---

### 模块 4：HTTP → Make a request（发生日邮件）

| 设置项 | 值 |
|--------|-----|
| URL | `https://futwxbtfgvpeipmddbdt.supabase.co/functions/v1/send-email` |
| Method | POST |
| Headers | `Content-Type: application/json` |
| Headers | `X-System-Secret: GloveBackend_082938457` |
| Body type | Raw (JSON) |

**Body（JSON）：**
```json
{
  "module": "hr",
  "to": ["{{3.email}}"],
  "templateName": "staff_birthday",
  "variables": {
    "StaffName":   "{{3.name}}",
    "Age":         "{{3.age}}",
    "Department":  "{{3.department}}",
    "CurrentYear": "{{formatDate(now; \"YYYY\")}}"
  }
}
```

> `3.email`, `3.name`, `3.age`, `3.department` 来自 Iterator 输出的当前员工对象。

---

## WORKFLOW 2：员工入职周年纪念

场景结构与 Workflow 1 完全相同，仅以下两处不同：

### 模块 2 差异（RPC 改为 anniversary）

| 设置项 | 值 |
|--------|-----|
| URL | `https://futwxbtfgvpeipmddbdt.supabase.co/rest/v1/rpc/fn_get_anniversary_celebrants` |
| Body | `{"p_date": "{{formatDate(now; "YYYY-MM-DD")}}"}` |

### 模块 4 差异（Template + Variables）

**Body（JSON）：**
```json
{
  "module": "hr",
  "to": ["{{3.email}}"],
  "templateName": "staff_anniversary",
  "variables": {
    "StaffName":    "{{3.name}}",
    "YearsServed":  "{{3.years_served}}",
    "YearsSuffix":  "{{if(3.years_served == 1; \"\"; \"s\")}}",
    "Department":   "{{3.department}}",
    "CurrentYear":  "{{formatDate(now; \"YYYY\")}}"
  }
}
```

---

## 通用注意事项

### Error Handling（在每个 HTTP 模块中配置）

在 Make.com 每个 HTTP 模块右键 → **Add error handler** → 选择 **Ignore**：
- 这样单个员工邮件失败不会中断整个场景

### 测试步骤

1. 在 Supabase Dashboard SQL Editor 临时插入一条今日生日员工：
   ```sql
   UPDATE staff
   SET birthday = (CURRENT_DATE - INTERVAL '25 years')  -- 今天生日，25岁
   WHERE id = '你的staff_id';
   ```

2. 在 Make.com → 点击 **Run once**（场景顶部）

3. 检查该员工邮箱是否收到生日邮件

4. 测试完成后恢复原始 birthday 值

### 发件人验证

生日/周年邮件均通过 `hr` 模块路由，发件人为：
```
care@yourdomain.com（MediGlove HR）
```
（来自 `email_routing` 表的 `module = 'hr'` 行）

---

## 完成 Checklist

- [ ] Workflow 1（生日）已在 Make.com 创建并激活
- [ ] Workflow 2（周年）已在 Make.com 创建并激活
- [ ] 两个 Workflow 的 Schedule 均设为 09:00 Asia/Kuala_Lumpur
- [ ] 测试员工收到生日邮件（HTML 渲染正确，姓名/年龄正确）
- [ ] 测试员工收到周年邮件（HTML 渲染正确，年数正确）
- [ ] Error handler 已配置为 Ignore（防止单条失败中断全局）
