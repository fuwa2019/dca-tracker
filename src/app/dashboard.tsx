import { useDashboardModel } from './dashboard/model';
import { WorkbenchDashboard } from './dashboard/WorkbenchDashboard';

/** Task-oriented overview backed by the shared `useDashboardModel()`. */
export function DashboardPage() {
  const model = useDashboardModel();
  return <WorkbenchDashboard model={model} />;
}
