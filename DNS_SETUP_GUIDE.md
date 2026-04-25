# T-01.4 — DNS 配置物理步骤清单
## 企业级多别名收发邮件网关打通

**架构说明**
- **发信** → Resend API（经你的真实域名发送，完整 DKIM/SPF 签名）
- **收信** → Zoho Mail 免费版（单账号多别名机制，零成本接收所有模块邮件）
- **域名** → 本文以 `yourdomain.com` 占位，替换为你的真实域名

---

## PHASE 1：Zoho Mail 收信配置（MX + SPF + DKIM）

### 步骤 1-1：注册 Zoho Mail 免费版
1. 前往 https://www.zoho.com/mail/zohomail-pricing.html
2. 选择 **Forever Free（1 用户，5GB）**
3. 用现有 Google/Microsoft 账号注册，主账号邮件设为 `admin@yourdomain.com`

### 步骤 1-2：在域名托管商添加 MX 记录
> 登录你的域名托管商（Cloudflare / GoDaddy / Namecheap 等）→ DNS 管理

| 记录类型 | 主机名 | 值                   | 优先级 | TTL  |
|---------|--------|----------------------|--------|------|
| MX      | @      | mx.zoho.com          | 10     | 300  |
| MX      | @      | mx2.zoho.com         | 20     | 300  |
| MX      | @      | mx3.zoho.com         | 50     | 300  |

> ⚠️ 若你已有其他 MX 记录（如 Google Workspace），必须先删除，否则邮件路由冲突。

### 步骤 1-3：在 Zoho 控制台验证域名
1. Zoho Mail Admin Console → **Domains → Add Domain**
2. 输入 `yourdomain.com`，Zoho 会提供一条 TXT 验证记录，形如：
   ```
   zoho-verification=zmXXXXXXXX.zmverify.zoho.com
   ```
3. 在域名托管商添加该 TXT 记录，等待 10–30 分钟后点击 **Verify**

### 步骤 1-4：配置多别名（单账号收所有模块邮件）
Zoho Admin Console → **Users → admin@yourdomain.com → Add Email Alias**

添加以下别名（全部指向同一主收件箱）：

| 别名                          | 用途                    |
|-------------------------------|-------------------------|
| `finance@yourdomain.com`      | 财务模块发票/催款       |
| `info@yourdomain.com`         | 运营模块 e-DO/通知      |
| `care@yourdomain.com`         | HR 模块生日/入职关怀    |
| `admin@yourdomain.com`        | 采购模块 PO 审批        |

> ✅ 效果：发至任何别名的邮件，统一进入 `admin@yourdomain.com` 收件箱，员工一个账号管理全部。

### 步骤 1-5：Zoho DKIM（提升收信信誉）
Zoho Admin Console → **Email Authentication → DKIM → Generate New Key**

Zoho 会输出一条 TXT 记录，形如：
```
主机名: zoho._domainkey.yourdomain.com
值:     v=DKIM1; k=rsa; p=MIGfMA0...（Zoho 提供）
```
在域名托管商添加该 TXT 记录后，点击 Zoho 控制台的 **Verify** 按钮。

---

## PHASE 2：Resend 发信配置（SPF + DKIM + DMARC）

### 步骤 2-1：注册 Resend
1. 前往 https://resend.com → **Sign Up（免费 100 封/天）**
2. Dashboard → **Domains → Add Domain**
3. 输入 `yourdomain.com`，Resend 会显示需要添加的 DNS 记录

### 步骤 2-2：添加 Resend SPF 记录
> SPF 声明允许代表你域名发信的服务器。需要同时包含 Resend 和 Zoho（若 Zoho 也需要发信）。

在域名托管商添加或更新 TXT 记录：

| 记录类型 | 主机名 | 值                                                      | TTL  |
|---------|--------|---------------------------------------------------------|------|
| TXT     | @      | `v=spf1 include:_spf.resend.com include:zoho.com ~all` | 300  |

> ⚠️ 每个域名只能有一条 SPF TXT 记录（`v=spf1` 开头）。若已存在，合并 include 项，不能新增第二条。

### 步骤 2-3：添加 Resend DKIM 记录
Resend Dashboard 会提供 3 条 CNAME 记录，形如：

| 记录类型 | 主机名                                    | 值                                    | TTL  |
|---------|-------------------------------------------|---------------------------------------|------|
| CNAME   | `resend._domainkey.yourdomain.com`        | `resend._domainkey.resend.com`        | 300  |
| CNAME   | `resend1._domainkey.yourdomain.com`       | `resend1._domainkey.resend.com`       | 300  |
| CNAME   | `resend2._domainkey.yourdomain.com`       | `resend2._domainkey.resend.com`       | 300  |

> 实际值以 Resend Dashboard 显示为准，上表为示例格式。

### 步骤 2-4：添加 DMARC 记录
DMARC 告诉收件服务器如何处理未通过 SPF/DKIM 的邮件。

| 记录类型 | 主机名              | 值                                                                                   | TTL  |
|---------|---------------------|--------------------------------------------------------------------------------------|------|
| TXT     | `_dmarc`            | `v=DMARC1; p=quarantine; rua=mailto:admin@yourdomain.com; pct=100; adkim=s; aspf=s` | 300  |

参数说明：
- `p=quarantine`：未通过验证的邮件进入垃圾邮件（上线稳定后可升级为 `p=reject`）
- `rua=mailto:admin@yourdomain.com`：DMARC 每日汇报发至主收件箱
- `pct=100`：100% 邮件执行此策略

### 步骤 2-5：在 Resend Dashboard 验证域名
1. Resend → **Domains → yourdomain.com → Verify DNS Records**
2. 等待所有记录变为绿色 ✅（通常 5–30 分钟，最长 48 小时）
3. 验证通过后，Resend 会显示域名状态为 **Verified**

---

## PHASE 3：Supabase Edge Function 环境变量配置

登录 Supabase Dashboard → **Project → Settings → Edge Functions → Secrets**

添加以下 Secrets（不要写入代码或 .env，必须在 Supabase 后台设置）：

| Secret 名称               | 值来源                                    | 说明                              |
|---------------------------|-------------------------------------------|-----------------------------------|
| `RESEND_API_KEY`           | Resend Dashboard → API Keys → Create Key  | 格式：`re_xxxxxxxxxxxxxxxxxxxx`   |
| `SYSTEM_SECRET_KEY`        | 自定义随机字符串（至少 32 字符）          | Make.com Webhook 鉴权密钥         |
| `SUPABASE_URL`             | 自动注入（Supabase 内置）                  | 无需手动配置                      |
| `SUPABASE_SERVICE_ROLE_KEY`| Supabase → Settings → API → service_role | ⚠️ 绝不暴露到前端                 |

---

## PHASE 4：Make.com 调用 Edge Function 的 Webhook 配置

在 Make.com 场景中，用 **HTTP → Make a request** 模块调用此 Edge Function：

```
URL:    https://<your-project>.supabase.co/functions/v1/send-email
Method: POST
Headers:
  Content-Type:     application/json
  X-System-Secret:  {{your_SYSTEM_SECRET_KEY}}    ← 从 Make.com Data Store 读取
Body (JSON):
{
  "module":       "finance",
  "to":           ["{{client_email}}"],
  "templateName": "dunning_reminder",
  "variables": {
    "CustomerName":  "{{client_name}}",
    "InvoiceNo":     "{{invoice_no}}",
    "OverdueDays":   "{{overdue_days}}",
    "Amount":        "{{total_amount}}"
  }
}
```

---

## PHASE 5：验证全链路

### 发信验证
```bash
# 在本地调用 Edge Function（需要 Supabase CLI）
supabase functions invoke send-email \
  --data '{
    "module": "finance",
    "to": ["your-test-email@gmail.com"],
    "templateName": "invoice_reminder",
    "variables": { "CustomerName": "Test Corp", "InvoiceNo": "240601-0001" }
  }' \
  --env-file .env
```

### 收信验证
- 发送一封邮件到 `finance@yourdomain.com`
- 检查 `admin@yourdomain.com` 的 Zoho 收件箱是否收到

### DNS 验证工具
- **MX**: https://mxtoolbox.com/SuperTool.aspx → 输入域名查 MX
- **SPF**: https://mxtoolbox.com/spf.aspx
- **DKIM**: https://mxtoolbox.com/dkim.aspx → Selector 填 `resend`
- **DMARC**: https://mxtoolbox.com/dmarc.aspx
- **邮件信誉评分**: https://www.mail-tester.com （发一封测试邮件，目标 ≥ 9/10）

---

## 完成标准 Checklist

- [ ] Zoho MX 记录已添加（3条，优先级 10/20/50）
- [ ] Zoho 域名验证 TXT 已添加并通过
- [ ] 4个别名已在 Zoho 创建（finance / info / care / admin）
- [ ] Zoho DKIM TXT 已添加并通过
- [ ] Resend SPF TXT 已添加（包含 `include:_spf.resend.com`）
- [ ] Resend DKIM CNAME 记录（3条）已添加
- [ ] DMARC TXT 已添加
- [ ] Resend Dashboard 显示域名为 **Verified**
- [ ] Supabase Edge Function Secrets 已配置（4个）
- [ ] `send-email` Edge Function 测试调用返回 200 + resend_id
- [ ] 收信别名测试通过（finance@ 能在 Zoho 收到）
- [ ] mail-tester.com 评分 ≥ 9/10

---

> **上线后** 将所有 DNS 记录 TTL 从 300 改为 3600，减少 DNS 查询压力。
> **DMARC policy** 在运行稳定 2 周后从 `p=quarantine` 升级为 `p=reject`。
