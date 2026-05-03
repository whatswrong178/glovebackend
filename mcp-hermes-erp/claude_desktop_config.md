# Claude Desktop — MCP Server Registration

Add the following block to your Claude Desktop config file.

**Config file location:**
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS:   `~/Library/Application Support/Claude/claude_desktop_config.json`

---

## Snippet to add

```json
{
  "mcpServers": {
    "hermes-erp": {
      "command": "node",
      "args": [
        "C:\\Users\\Edward\\Documents\\Claude\\Projects\\Glove Backend Official\\mcp-hermes-erp\\dist\\index.js"
      ],
      "env": {
        "SUPABASE_URL": "https://your-project-id.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
  }
}
```

> ⚠️  Replace the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values with your real credentials from:
> **Supabase Dashboard → Project Settings → API**

---

## First-time setup

```powershell
# 1. Install dependencies
cd "C:\Users\Edward\Documents\Claude\Projects\Glove Backend Official\mcp-hermes-erp"
npm install

# 2. Build the server
npm run build

# 3. Verify the server starts correctly (Ctrl+C to stop)
$env:SUPABASE_URL="https://your-project-id.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node dist/index.js

# 4. Restart Claude Desktop — it will pick up the new MCP server automatically
```

---

## Available tools (15 total)

| Tool | Type | Description |
|------|------|-------------|
| `erp_list_clients` | Read | Paginated client list with search + region filter |
| `erp_get_client` | Read | Single client + recent assessments |
| `erp_create_client` | Write | Find-or-create client |
| `erp_list_products` | Read | Product catalogue with search + category filter |
| `erp_get_product` | Read | Single product by id or SKU |
| `erp_list_invoices` | Read | Invoices with status/date/rep filters |
| `erp_get_invoice` | Read | Single invoice + line items |
| `erp_create_invoice` | Write | Create invoice + auto-compute totals/commission |
| `erp_mark_invoice_paid` | Write ⚠️ | Mark paid → triggers commission eligibility (见款发佣则) |
| `erp_get_dashboard_kpis` | Read | Company-wide or per-staff KPIs |
| `erp_calculate_commission` | Read | Detailed commission breakdown by period |
| `erp_list_staff` | Read | All staff with roles |
| `erp_list_needs_assessments` | Read | Assessments with temperature/date filters |
| `erp_get_needs_assessment` | Read | Full assessment detail |
| `erp_create_needs_assessment` | Write | Submit assessment + auto-link client + score |

---

## Development (live reload)

```powershell
# Run with tsx for hot reload (no build step needed)
$env:SUPABASE_URL="..."
$env:SUPABASE_SERVICE_ROLE_KEY="..."
npm run dev
```
