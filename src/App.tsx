import { Routes, Route, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';

// Page placeholders — real implementations land in Phase 3
import { LoginPage } from '@/app/login';
import { DashboardPage } from '@/app/dashboard';
import { TransactionsPage } from '@/app/transactions';
import { TransactionsAllPage } from '@/app/transactions-all';
import { CashflowsPage } from '@/app/cashflows';
import { RebalancePage } from '@/app/rebalance';
import { SettingsPage } from '@/app/settings';
import { SharePage } from '@/app/share';
import { DataHealthPage } from '@/app/data-health';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';

export default function App() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="h-full"
      >
        <Routes location={location}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/share/:token" element={<SharePage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/all" element={<TransactionsAllPage />} />
            <Route path="/cashflows" element={<CashflowsPage />} />
            <Route path="/rebalance" element={<RebalancePage />} />
            <Route path="/health" element={<DataHealthPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}
