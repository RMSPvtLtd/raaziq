import { Navigate, Outlet, Route, Routes } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { StagesProvider } from "@/hooks/useStages"
import { OpsAuthProvider } from "@/hooks/useOpsAuth"
import { WorkerAuthProvider } from "@/hooks/useWorkerAuth"
import { CustomerAuthProvider } from "@/hooks/useCustomerAuth"
import { OpsShell } from "@/components/layout/OpsShell"
import { PublicShell } from "@/components/layout/PublicShell"
import { CustomerShell } from "@/components/layout/CustomerShell"
import { ProtectedOpsRoute } from "@/components/shared/ProtectedOpsRoute"
import { ProtectedWorkerRoute } from "@/components/shared/ProtectedWorkerRoute"
import { ProtectedCustomerRoute } from "@/components/shared/ProtectedCustomerRoute"
import { OpsLoginPage } from "@/pages/OpsLoginPage"
import { OverviewPage } from "@/pages/OverviewPage"
import { ShipmentListPage } from "@/pages/ShipmentListPage"
import { ShipmentDetailPage } from "@/pages/ShipmentDetailPage"
import { InvoicePreviewPage } from "@/pages/InvoicePreviewPage"
import { QuoteFlowPage } from "@/pages/QuoteFlowPage"
import { InvoiceListPage } from "@/pages/InvoiceListPage"
import { InvoicePage } from "@/pages/InvoicePage"
import { TrackingPage } from "@/pages/TrackingPage"
import { WorkerLoginPage } from "@/pages/WorkerLoginPage"
import { WorkerQueuePage } from "@/pages/WorkerQueuePage"
import { WorkersAdminPage } from "@/pages/WorkersAdminPage"
import { CustomersAdminPage } from "@/pages/CustomersAdminPage"
import { RateCardsAdminPage } from "@/pages/RateCardsAdminPage"
import { AirlineSchedulesAdminPage } from "@/pages/AirlineSchedulesAdminPage"
import { InquiryQuotesPage } from "@/pages/InquiryQuotesPage"
import { QuotesLibraryPage } from "@/pages/QuotesLibraryPage"
import { CustomerLoginPage } from "@/pages/CustomerLoginPage"
import { CustomerShipmentsPage } from "@/pages/CustomerShipmentsPage"
import { CustomerShipmentDetailPage } from "@/pages/CustomerShipmentDetailPage"
import { CustomerQuotesPage } from "@/pages/CustomerQuotesPage"
import { CustomerQuoteDetailPage } from "@/pages/CustomerQuoteDetailPage"
import { CustomerInvoicesPage } from "@/pages/CustomerInvoicesPage"
import { CustomerInvoiceDetailPage } from "@/pages/CustomerInvoiceDetailPage"

// Wraps just the ops-facing routes in OpsAuthProvider -- a path-less layout
// route (same pattern OpsShell/PublicShell already use below) so it doesn't
// need a `/*` wildcard that would otherwise swallow the sibling /track,
// /worker/*, and /customer/* routes matched later in this tree.
function OpsAuthLayout() {
  return (
    <OpsAuthProvider>
      <Outlet />
    </OpsAuthProvider>
  )
}

function App() {
  return (
    <StagesProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />

        <Route element={<OpsAuthLayout />}>
          <Route path="/login" element={<OpsLoginPage />} />
          <Route
            element={
              <ProtectedOpsRoute>
                <OpsShell />
              </ProtectedOpsRoute>
            }
          >
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/shipments" element={<ShipmentListPage />} />
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            <Route path="/shipments/:id/generate-invoice" element={<InvoicePreviewPage />} />
            <Route path="/quotes" element={<QuotesLibraryPage />} />
            <Route path="/quotes/new" element={<QuoteFlowPage />} />
            <Route path="/inquiries/:id/quotes" element={<InquiryQuotesPage />} />
            <Route path="/quotes/:id" element={<QuoteFlowPage />} />
            <Route path="/invoices" element={<InvoiceListPage />} />
            <Route path="/invoices/:id" element={<InvoicePage />} />
            <Route path="/workers" element={<WorkersAdminPage />} />
            <Route path="/customers" element={<CustomersAdminPage />} />
            <Route path="/rate-cards" element={<RateCardsAdminPage />} />
            <Route path="/airline-schedules" element={<AirlineSchedulesAdminPage />} />
          </Route>
        </Route>

        <Route element={<PublicShell />}>
          <Route path="/track" element={<TrackingPage />} />
          <Route path="/track/sea" element={<TrackingPage />} />
          <Route path="/track/sea/:containerNumber" element={<TrackingPage />} />
          <Route path="/track/:reference" element={<TrackingPage />} />
        </Route>

        <Route
          path="/worker/*"
          element={
            <WorkerAuthProvider>
              <Routes>
                <Route path="login" element={<WorkerLoginPage />} />
                <Route
                  path="queue"
                  element={
                    <ProtectedWorkerRoute>
                      <WorkerQueuePage />
                    </ProtectedWorkerRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/worker/login" replace />} />
              </Routes>
            </WorkerAuthProvider>
          }
        />

        <Route
          path="/customer/*"
          element={
            <CustomerAuthProvider>
              <Routes>
                <Route path="login" element={<CustomerLoginPage />} />
                <Route
                  element={
                    <ProtectedCustomerRoute>
                      <CustomerShell />
                    </ProtectedCustomerRoute>
                  }
                >
                  <Route path="shipments" element={<CustomerShipmentsPage />} />
                  <Route path="shipments/:id" element={<CustomerShipmentDetailPage />} />
                  <Route path="quotes" element={<CustomerQuotesPage />} />
                  <Route path="quotes/:id" element={<CustomerQuoteDetailPage />} />
                  <Route path="invoices" element={<CustomerInvoicesPage />} />
                  <Route path="invoices/:id" element={<CustomerInvoiceDetailPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/customer/login" replace />} />
              </Routes>
            </CustomerAuthProvider>
          }
        />

        <Route path="*" element={<Navigate to="/shipments" replace />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </StagesProvider>
  )
}

export default App
