import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '@/app/login';
import { DashboardPage } from '@/app/dashboard';
import { PerformancePage } from '@/app/performance';
import { TransactionsPage } from '@/app/transactions';
import { TransactionsAllPage } from '@/app/transactions-all';
import { CashflowsPage } from '@/app/cashflows';
import { ExposurePage } from '@/app/exposure';
import {
  SettingsLayout,
  SettingsIndex,
  GoalPane,
  BasisPane,
  EmailPane,
  SharePane,
  AppearancePane,
  AccountPane,
} from '@/app/settings';
import { SharePage } from '@/app/share';
import { DataHealthPage } from '@/app/data-health';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { LOCAL_MODE } from '@/lib/localMode';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={LOCAL_MODE ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/share/:token" element={<SharePage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/exposure" element={<ExposurePage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/transactions/all" element={<TransactionsAllPage />} />
        <Route path="/cashflows" element={LOCAL_MODE ? <Navigate to="/transactions" replace /> : <CashflowsPage />} />
        <Route path="/health" element={<DataHealthPage />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<SettingsIndex />} />
          <Route path="goal" element={<GoalPane />} />
          <Route path="basis" element={<BasisPane />} />
          <Route path="email" element={<EmailPane />} />
          <Route path="share" element={<SharePane />} />
          <Route path="appearance" element={<AppearancePane />} />
          <Route path="account" element={<AccountPane />} />
          <Route path="*" element={<Navigate to="/settings" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
