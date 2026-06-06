import { useDashboardModel } from './dashboard/model';
import { DashboardVariantA } from './dashboard/VariantA';

/** Magazine-front dashboard. Data comes from the shared `useDashboardModel()`. */
export function DashboardPage() {
  const model = useDashboardModel();
  return <DashboardVariantA model={model} />;
}
