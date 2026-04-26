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
import { InvoiceListPage }    from "./pages/invoices/list";
import { InvoiceCreatePage }  from "./pages/invoices/create";
import { DOListPage }         from "./pages/deliveryOrders/list";
import { HRListPage }             from "./pages/hr/list";
import { HRCreatePage }           from "./pages/hr/create";
import { HREditPage }             from "./pages/hr/edit";
import { HRShowPage }             from "./pages/hr/show";
import { LeaderPerformancePage }  from "./pages/hr/leader-performance";
import { PlaybookPage }       from "./pages/playbook";
import { ReportsPage }        from "./pages/reports";
import { SettingsPage }       from "./pages/settings";
import { LoginPage }          from "./pages/auth/login";

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  return (
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
              <Route path="/products/create"       element={<ProductCreatePage />} />
              <Route path="/products/:id/edit"     element={<ProductEditPage />} />
              <Route path="/products/:id"          element={<ProductShowPage />} />

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
              <Route path="/playbook" element={<PlaybookPage />} />
              <Route path="/reports"  element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />

              {/* Fallback → dashboard */}
              <Route path="*" element={<NavigateToResource resource="dashboard" />} />
            </Route>

            {/* ── Public route ─────────────────────────────────── */}
            <Route path="/login" element={<LoginPage />} />

            {/* ── Unauthenticated catch-all ─────────────────────── */}
            <Route path="*" element={<CatchAllNavigate to="/login" />} />
          </Routes>

          <UnsavedChangesNotifier />
          <DocumentTitleHandler />
          </SecurityShield>
        </Refine>
    </BrowserRouter>
  );
}
