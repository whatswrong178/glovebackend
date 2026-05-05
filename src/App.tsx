import React from "react";
import { Refine, Authenticated } from "@refinedev/core";
import { dataProvider, liveProvider } from "@refinedev/supabase";
import routerBindings, {
  NavigateToResource,
  CatchAllNavigate,
  UnsavedChangesNotifier,
  DocumentTitleHandler,
} from "@refinedev/react-router-v6";
import { BrowserRouter, Route, Routes, Outlet } from "react-router-dom";

import { supabaseClient } from "./supabaseClient";
import { authProvider } from "./authProvider";
import { SecurityShield } from "./components/SecurityShield";
import Layout from "./components/Layout";
import { CompanySettingsProvider } from "./context/CompanySettingsContext";

// ── Page imports ──────────────────────────────────────────────────────────────
import { DashboardPage }      from "./pages/dashboard";
import { ClientListPage }     from "./pages/clients/list";
import { ClientCreatePage }   from "./pages/clients/create";
import { ClientShowPage }     from "./pages/clients/show";
import { ClientEditPage }     from "./pages/clients/edit";
import { ProductListPage }    from "./pages/products/list";
import { ProductCreatePage }  from "./pages/products/create";
import { ProductEditPage }    from "./pages/products/edit";
import { ProductShowPage }    from "./pages/products/show";
import { ProductImportPage }  from "./pages/products/import";
import { ProductBulkCreatePage } from "./pages/products/bulk-create";
import { POListPage }         from "./pages/purchaseOrders/list";
import { POShowPage }         from "./pages/purchaseOrders/show";
import { InvoiceListPage }    from "./pages/invoices/list";
import { InvoiceCreatePage }  from "./pages/invoices/create";
import { DOListPage }         from "./pages/deliveryOrders/list";
import { HRListPage }             from "./pages/hr/list";
import { HRCreatePage }           from "./pages/hr/create";
import { HREditPage }             from "./pages/hr/edit";
import { HRShowPage }             from "./pages/hr/show";
import { LeaderPerformancePage }  from "./pages/hr/leader-performance";
import { PlaybookPage }         from "./pages/playbook";
import { NeedsAssessmentPage } from "./pages/needs-assessment";
import { ReportsPage }          from "./pages/reports";
import { SettingsPage }       from "./pages/settings";
import { LoginPage }          from "./pages/auth/login";
import { ResetPasswordPage }  from "./pages/auth/reset-password";

// ─────────────────────────────────────────────────────────────────────────────
// Error Boundary — catches render crashes and shows the error instead of blank
// ─────────────────────────────────────────────────────────────────────────────
class ReportsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="m-6 p-5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 space-y-2">
          <p className="font-bold text-red-800">⚠ Reports crashed — please share this with your developer:</p>
          <pre className="text-xs bg-red-100 rounded p-3 overflow-x-auto whitespace-pre-wrap">{this.state.error}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <CompanySettingsProvider>
    <BrowserRouter>
        <Refine
          dataProvider={dataProvider(supabaseClient)}
          liveProvider={liveProvider(supabaseClient)}
          authProvider={authProvider}
          routerProvider={routerBindings}
          resources={[
            {
              name:       "dashboard",
              list:       "/",
              meta:       { label: "Dashboard", icon: "🏠" },
            },
            {
              name:       "clients",
              list:       "/clients",
              create:     "/clients/create",
              edit:       "/clients/:id/edit",
              show:       "/clients/:id",
              meta:       { label: "Clients", icon: "👥" },
            },
            {
              name:       "products",
              list:       "/products",
              create:     "/products/create",
              edit:       "/products/:id/edit",
              show:       "/products/:id",
              meta:       { label: "Products", icon: "📦" },
            },
            {
              name:       "purchase_orders",
              list:       "/purchase-orders",
              show:       "/purchase-orders/:id",
              meta:       { label: "Purchase Orders", icon: "🛒" },
            },
            {
              name:       "invoices",
              list:       "/invoices",
              create:     "/invoices/create",
              meta:       { label: "Invoices", icon: "🧾" },
            },
            {
              name:       "delivery_orders",
              list:       "/delivery-orders",
              meta:       { label: "Delivery Orders", icon: "🚚" },
            },
            {
              name:       "staff",
              list:       "/hr",
              create:     "/hr/create",
              edit:       "/hr/:id/edit",
              show:       "/hr/:id",
              meta:       { label: "HR", icon: "🏢" },
            },
            {
              name:       "playbook",
              list:       "/playbook",
              meta:       { label: "Playbook", icon: "📚" },
            },
            {
              name:       "needs-assessment",
              list:       "/needs-assessment",
              meta:       { label: "需求问卷", icon: "📋" },
            },
            {
              name:       "reports",
              list:       "/reports",
              meta:       { label: "Reports", icon: "📊" },
            },
            {
              name:       "settings",
              list:       "/settings",
              meta:       { label: "Settings", icon: "⚙️" },
            },
          ]}
          options={{
            syncWithLocation: true,
            warnWhenUnsavedChanges: true,
            liveMode: "auto",
            projectId: "mediglove-erp",
          }}
        >
          {/* T-01.2: SecurityShield must be inside <Refine> so useGetIdentity
              has access to Refine's QueryClientProvider */}
          <SecurityShield>
          <Routes>
            {/* ── Authenticated routes ─────────────────────────── */}
            <Route
              element={
                <Authenticated
                  key="authenticated-routes"
                  fallback={<CatchAllNavigate to="/login" />}
                >
                  <Layout>
                    <Outlet />
                  </Layout>
                </Authenticated>
              }
            >
              <Route index element={<DashboardPage />} />

              {/* Clients (T-04.1–T-04.5) */}
              <Route path="/clients"            element={<ClientListPage />} />
              <Route path="/clients/create"     element={<ClientCreatePage />} />
              <Route path="/clients/:id/edit"   element={<ClientEditPage />} />
              <Route path="/clients/:id"        element={<ClientShowPage />} />

              {/* Products (T-03.1 / T-03.2) */}
              <Route path="/products"              element={<ProductListPage />} />
              <Route path="/products/import"       element={<ProductImportPage />} />
              <Route path="/products/bulk-create"  element={<ProductBulkCreatePage />} />
              <Route path="/products/create"       element={<ProductCreatePage />} />
              <Route path="/products/:id/edit"     element={<ProductEditPage />} />
              <Route path="/products/:id"          element={<ProductShowPage />} />

              {/* Purchase Orders */}
              <Route path="/purchase-orders"       element={<POListPage />} />
              <Route path="/purchase-orders/:id"   element={<POShowPage />} />

              {/* Invoices */}
              <Route path="/invoices"        element={<InvoiceListPage />} />
              <Route path="/invoices/create" element={<InvoiceCreatePage />} />

              {/* Delivery Orders */}
              <Route path="/delivery-orders" element={<DOListPage />} />

              {/* HR — Staff Management (T-02.1) */}
              <Route path="/hr"                     element={<HRListPage />} />
              <Route path="/hr/create"              element={<HRCreatePage />} />
              <Route path="/hr/leader-performance"  element={<LeaderPerformancePage />} />
              <Route path="/hr/:id/edit"            element={<HREditPage />} />
              <Route path="/hr/:id"                 element={<HRShowPage />} />

              {/* Other modules */}
              <Route path="/playbook"          element={<PlaybookPage />} />
              <Route path="/needs-assessment"  element={<NeedsAssessmentPage />} />
              <Route path="/reports"           element={<ReportsErrorBoundary><ReportsPage /></ReportsErrorBoundary>} />
              <Route path="/settings"          element={<SettingsPage />} />

              {/* Fallback → dashboard */}
              <Route path="*" element={<NavigateToResource resource="dashboard" />} />
            </Route>

            {/* ── Public routes ────────────────────────────────── */}
            <Route path="/login"          element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* ── Unauthenticated catch-all ─────────────────────── */}
            <Route path="*" element={<CatchAllNavigate to="/login" />} />
          </Routes>

          <UnsavedChangesNotifier />
          <DocumentTitleHandler />
          </SecurityShield>
        </Refine>
    </BrowserRouter>
    </CompanySettingsProvider>
  );
}
