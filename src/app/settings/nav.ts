import { Mail, Monitor, Scale, ShieldCheck, Target, UserRound, type LucideIcon } from '@/components/icons';

export interface SettingsPaneMeta {
  /** Path segment under `/settings`. */
  href: string;
  /** Nav row label and pane heading. */
  title: string;
  /** One line under the label in the nav row and under the pane heading. */
  subtitle: string;
  icon: LucideIcon;
}

export interface SettingsNavGroup {
  title: string;
  items: ReadonlyArray<SettingsPaneMeta>;
}

/**
 * The reference groups settings panes under quiet uppercase section labels
 * instead of tabs. Our surface has six concerns, so the groups stay small —
 * one nav row per concern, never a card that mixes two.
 */
export const SETTINGS_NAV: ReadonlyArray<SettingsNavGroup> = [
  {
    title: '投资',
    items: [
      { href: 'goal', title: '目标与定投', subtitle: '目标金额、月定投与概率规划', icon: Target },
      { href: 'basis', title: '口径与基准', subtitle: '成本口径、自选股与业绩基准', icon: Scale },
    ],
  },
  {
    title: '通知',
    items: [{ href: 'email', title: '邮件提醒', subtitle: '入金提醒的开关与收件地址', icon: Mail }],
  },
  {
    title: '数据与隐私',
    items: [{ href: 'share', title: '分享链接', subtitle: '只读分享的生成与撤销', icon: ShieldCheck }],
  },
  {
    title: '偏好',
    items: [{ href: 'appearance', title: '外观', subtitle: '浅色、深色或跟随系统', icon: Monitor }],
  },
  {
    title: '账户',
    items: [{ href: 'account', title: '登录身份', subtitle: '当前账号与退出登录', icon: UserRound }],
  },
];

/** The pane `/settings` resolves to once there is room for the nav column. */
export const FIRST_SETTINGS_PANE = SETTINGS_NAV[0].items[0].href;

export const SETTINGS_PANES: ReadonlyArray<SettingsPaneMeta> = SETTINGS_NAV.flatMap(
  (group) => group.items,
);
