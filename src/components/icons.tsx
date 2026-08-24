// Decorative-by-default icon set.
//
// Every lucide-react icon renders a bare <svg>. With no role and no name,
// Chrome maps that to `role=image` with an empty accessible name, so a screen
// reader announces "image" once per icon -- 71 times on /transactions/all. The
// axe scans never caught it: axe's `svg-img-alt` rule only fires on
// `svg[role="img"]`, and these have no role at all. It was found by the
// accessibility-tree audit in `docs/accessibility/probes/ax-tree-audit.mjs`.
//
// Every icon in this application is decorative: the audit found zero unnamed
// interactive controls, which means every icon-only control already carries its
// own label. So the right default is to hide icons from the accessibility tree
// entirely, and this module is where that default lives.
//
// Import icons from here, never from 'lucide-react' directly. The defaults are
// applied before the spread, so a call site that genuinely needs a meaningful
// icon can still pass `aria-hidden={false}` together with a label.
//
// Icons are re-exported one by one rather than with `export *` so the bundler
// keeps tree-shaking them; `npm run test:release-budget` guards the weight.

import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  Activity as ActivityBase,
  AlertTriangle as AlertTriangleBase,
  ArrowDown as ArrowDownBase,
  ArrowLeft as ArrowLeftBase,
  ArrowRight as ArrowRightBase,
  ArrowUp as ArrowUpBase,
  ArrowUpRight as ArrowUpRightBase,
  Ban as BanBase,
  BarChart3 as BarChart3Base,
  Beaker as BeakerBase,
  BookOpen as BookOpenBase,
  Briefcase as BriefcaseBase,
  Calculator as CalculatorBase,
  CalendarDays as CalendarDaysBase,
  Check as CheckBase,
  CheckCircle2 as CheckCircle2Base,
  ChevronDown as ChevronDownBase,
  ChevronLeft as ChevronLeftBase,
  ChevronRight as ChevronRightBase,
  ChevronUp as ChevronUpBase,
  ChevronsUpDown as ChevronsUpDownBase,
  Clock as ClockBase,
  Columns3 as Columns3Base,
  Copy as CopyBase,
  Database as DatabaseBase,
  Download as DownloadBase,
  EyeOff as EyeOffBase,
  FileCheck2 as FileCheck2Base,
  FileSpreadsheet as FileSpreadsheetBase,
  FileUp as FileUpBase,
  Info as InfoBase,
  KeyRound as KeyRoundBase,
  Laptop as LaptopBase,
  Layers as LayersBase,
  LayoutDashboard as LayoutDashboardBase,
  LineChart as LineChartBase,
  List as ListBase,
  LoaderCircle as LoaderCircleBase,
  LockKeyhole as LockKeyholeBase,
  LogOut as LogOutBase,
  Mail as MailBase,
  Minus as MinusBase,
  Monitor as MonitorBase,
  Moon as MoonBase,
  MoreVertical as MoreVerticalBase,
  PanelLeftClose as PanelLeftCloseBase,
  PanelLeftOpen as PanelLeftOpenBase,
  Pencil as PencilBase,
  Plus as PlusBase,
  PlusCircle as PlusCircleBase,
  RefreshCw as RefreshCwBase,
  RotateCcw as RotateCcwBase,
  Scale as ScaleBase,
  Search as SearchBase,
  Settings as SettingsBase,
  ShieldCheck as ShieldCheckBase,
  ShieldQuestion as ShieldQuestionBase,
  Sun as SunBase,
  Target as TargetBase,
  Trash2 as Trash2Base,
  TrendingDown as TrendingDownBase,
  TrendingUp as TrendingUpBase,
  TriangleAlert as TriangleAlertBase,
  Upload as UploadBase,
  UserRound as UserRoundBase,
  WalletCards as WalletCardsBase,
  Wifi as WifiBase,
  X as XBase,
} from 'lucide-react';

export type { LucideIcon, LucideProps };

function decorative(Base: LucideIcon, displayName: string): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <Base aria-hidden="true" focusable="false" {...props} ref={ref} />
  ));
  Icon.displayName = displayName;
  return Icon as unknown as LucideIcon;
}

export const Activity = decorative(ActivityBase, 'Activity');
export const AlertTriangle = decorative(AlertTriangleBase, 'AlertTriangle');
export const ArrowDown = decorative(ArrowDownBase, 'ArrowDown');
export const ArrowLeft = decorative(ArrowLeftBase, 'ArrowLeft');
export const ArrowRight = decorative(ArrowRightBase, 'ArrowRight');
export const ArrowUp = decorative(ArrowUpBase, 'ArrowUp');
export const ArrowUpRight = decorative(ArrowUpRightBase, 'ArrowUpRight');
export const Ban = decorative(BanBase, 'Ban');
export const BarChart3 = decorative(BarChart3Base, 'BarChart3');
export const Beaker = decorative(BeakerBase, 'Beaker');
export const BookOpen = decorative(BookOpenBase, 'BookOpen');
export const Briefcase = decorative(BriefcaseBase, 'Briefcase');
export const Calculator = decorative(CalculatorBase, 'Calculator');
export const CalendarDays = decorative(CalendarDaysBase, 'CalendarDays');
export const Check = decorative(CheckBase, 'Check');
export const CheckCircle2 = decorative(CheckCircle2Base, 'CheckCircle2');
export const ChevronDown = decorative(ChevronDownBase, 'ChevronDown');
export const ChevronLeft = decorative(ChevronLeftBase, 'ChevronLeft');
export const ChevronRight = decorative(ChevronRightBase, 'ChevronRight');
export const ChevronUp = decorative(ChevronUpBase, 'ChevronUp');
export const ChevronsUpDown = decorative(ChevronsUpDownBase, 'ChevronsUpDown');
export const Clock = decorative(ClockBase, 'Clock');
export const Columns3 = decorative(Columns3Base, 'Columns3');
export const Copy = decorative(CopyBase, 'Copy');
export const Database = decorative(DatabaseBase, 'Database');
export const Download = decorative(DownloadBase, 'Download');
export const EyeOff = decorative(EyeOffBase, 'EyeOff');
export const FileCheck2 = decorative(FileCheck2Base, 'FileCheck2');
export const FileSpreadsheet = decorative(FileSpreadsheetBase, 'FileSpreadsheet');
export const FileUp = decorative(FileUpBase, 'FileUp');
export const Info = decorative(InfoBase, 'Info');
export const KeyRound = decorative(KeyRoundBase, 'KeyRound');
export const Laptop = decorative(LaptopBase, 'Laptop');
export const Layers = decorative(LayersBase, 'Layers');
export const LayoutDashboard = decorative(LayoutDashboardBase, 'LayoutDashboard');
export const LineChart = decorative(LineChartBase, 'LineChart');
export const List = decorative(ListBase, 'List');
export const LoaderCircle = decorative(LoaderCircleBase, 'LoaderCircle');
export const LockKeyhole = decorative(LockKeyholeBase, 'LockKeyhole');
export const LogOut = decorative(LogOutBase, 'LogOut');
export const Mail = decorative(MailBase, 'Mail');
export const Minus = decorative(MinusBase, 'Minus');
export const Monitor = decorative(MonitorBase, 'Monitor');
export const Moon = decorative(MoonBase, 'Moon');
export const MoreVertical = decorative(MoreVerticalBase, 'MoreVertical');
export const PanelLeftClose = decorative(PanelLeftCloseBase, 'PanelLeftClose');
export const PanelLeftOpen = decorative(PanelLeftOpenBase, 'PanelLeftOpen');
export const Pencil = decorative(PencilBase, 'Pencil');
export const Plus = decorative(PlusBase, 'Plus');
export const PlusCircle = decorative(PlusCircleBase, 'PlusCircle');
export const RefreshCw = decorative(RefreshCwBase, 'RefreshCw');
export const RotateCcw = decorative(RotateCcwBase, 'RotateCcw');
export const Scale = decorative(ScaleBase, 'Scale');
export const Search = decorative(SearchBase, 'Search');
export const Settings = decorative(SettingsBase, 'Settings');
export const ShieldCheck = decorative(ShieldCheckBase, 'ShieldCheck');
export const ShieldQuestion = decorative(ShieldQuestionBase, 'ShieldQuestion');
export const Sun = decorative(SunBase, 'Sun');
export const Target = decorative(TargetBase, 'Target');
export const Trash2 = decorative(Trash2Base, 'Trash2');
export const TrendingDown = decorative(TrendingDownBase, 'TrendingDown');
export const TrendingUp = decorative(TrendingUpBase, 'TrendingUp');
export const TriangleAlert = decorative(TriangleAlertBase, 'TriangleAlert');
export const Upload = decorative(UploadBase, 'Upload');
export const UserRound = decorative(UserRoundBase, 'UserRound');
export const WalletCards = decorative(WalletCardsBase, 'WalletCards');
export const Wifi = decorative(WifiBase, 'Wifi');
export const X = decorative(XBase, 'X');
