import { describe, expect, it } from 'vitest';
import { allowedTabs, can, isMemberRole, isShopRole, landingTab, ROLE_LABEL } from '../../../src/features/owner/model/roles';

describe('roles', () => {
  it('lists tabs per role', () => {
    expect(allowedTabs('owner')).toEqual(['today', 'history', 'settings', 'staff', 'devices']);
    expect(allowedTabs('manager')).toEqual(['today', 'history', 'staff', 'devices']);
    expect(allowedTabs('accountant')).toEqual(['history']);
  });
  it('picks the landing tab', () => {
    expect(landingTab('owner')).toBe('settings');
    expect(landingTab('manager')).toBe('today');
    expect(landingTab('accountant')).toBe('history');
  });
  it('can()', () => {
    expect(can('manager', 'eraseStaff')).toBe(false);
    expect(can('owner', 'eraseStaff')).toBe(true);
    expect(can('manager', 'correct')).toBe(true);
    expect(can('owner', 'correct')).toBe(true);
    expect(can('accountant', 'correct')).toBe(false);
    expect(can('manager', 'manageMembers')).toBe(false);
    expect(can('owner', 'editShop')).toBe(true);
    expect(can('accountant', 'editShop')).toBe(false);
  });
  it('guards', () => {
    expect(isShopRole('owner')).toBe(true);
    expect(isMemberRole('owner')).toBe(false);
    expect(isMemberRole('manager')).toBe(true);
    expect(isShopRole('admin')).toBe(false);
    expect(isShopRole(null)).toBe(false);
  });
  it('labels', () => {
    expect(ROLE_LABEL).toEqual({ manager: 'Υπεύθυνος καταστήματος', accountant: 'Λογιστής' });
  });
});
