import type { ShopTab } from '../../../app/router';

/** Cross-file invariant: the role values are checked in SQL (shop_members) and here. */
export type ShopRole = 'owner' | 'manager' | 'accountant';
export type MemberRole = Exclude<ShopRole, 'owner'>;

export const isShopRole = (x: unknown): x is ShopRole => x === 'owner' || x === 'manager' || x === 'accountant';
export const isMemberRole = (x: unknown): x is MemberRole => x === 'manager' || x === 'accountant';

export const ROLE_LABEL: Record<MemberRole, string> = { manager: 'Υπεύθυνος καταστήματος', accountant: 'Λογιστής' };

const TABS: Record<ShopRole, readonly ShopTab[]> = {
  owner: ['today', 'history', 'settings', 'staff', 'devices'],
  manager: ['today', 'history', 'staff', 'devices'],
  accountant: ['history'],
};
const LANDING: Record<ShopRole, ShopTab> = { owner: 'settings', manager: 'today', accountant: 'history' };

export function allowedTabs(role: ShopRole): readonly ShopTab[] {
  return TABS[role];
}

export function landingTab(role: ShopRole): ShopTab {
  return LANDING[role];
}

export type RoleAction = 'eraseStaff' | 'correct' | 'manageMembers' | 'editShop';

export function can(role: ShopRole, action: RoleAction): boolean {
  if (action === 'correct') return role === 'owner' || role === 'manager';
  return role === 'owner';
}
