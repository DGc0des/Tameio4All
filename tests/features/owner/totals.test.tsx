// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShopConfig } from '../../../src/core/config';
import { joinJuicePreset } from '../../../src/core/presets';
import { applySettings } from '../../../src/features/owner/model/settingsDraft';
import { PreviewCard } from '../../../src/features/owner/settings/PreviewCard';
import { TotalsSection } from '../../../src/features/owner/settings/TotalsSection';

afterEach(cleanup);

function Harness({ initial }: { initial: ShopConfig }) {
  const [config, setConfig] = useState(initial);
  return (
    <>
      <TotalsSection config={config} dispatch={(a) => setConfig(applySettings(config, a).config)} errors={[]} />
      <PreviewCard config={config} />
      <output data-testid="json">{JSON.stringify(config.totals)}</output>
    </>
  );
}
const jj = (): ShopConfig => structuredClone(joinJuicePreset) as ShopConfig;
const totals = () => JSON.parse(screen.getByTestId('json').textContent ?? '[]') as ShopConfig['totals'];

describe('TotalsSection', () => {
  it('shows each total as a readable formula', () => {
    render(<Harness initial={jj()} />);
    const cash = screen.getByRole('group', { name: 'ΜΕΤΡΗΤΑ' });
    expect(cash.textContent).toContain('ΤΑΜΕΙΟ − Αρχικό ταμείο − Έξοδα');
  });

  it('builds a new total from + and − terms', () => {
    render(<Harness initial={jj()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Σύνολο' }));
    const group = screen.getByRole('group', { name: 'Νέο σύνολο' });
    fireEvent.change(within(group).getByLabelText('Όρος για Νέο σύνολο'), { target: { value: 'channel:wolt' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Πρόσθεση όρου' }));
    fireEvent.change(within(group).getByLabelText('Όρος για Νέο σύνολο'), { target: { value: 'channel:efood' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Αφαίρεση όρου' }));
    expect(group.textContent).toContain('WOLT − EFOOD');
    fireEvent.click(within(group).getByRole('button', { name: 'Αλλαγή πρόσημου EFOOD' }));
    expect(group.textContent).toContain('WOLT + EFOOD');
    fireEvent.click(within(group).getByRole('button', { name: 'Διαγραφή όρου WOLT' }));
    expect(totals().at(-1)?.terms).toEqual([{ sign: 1, ref: { kind: 'channel', id: 'efood' } }]);
  });

  it('renames, flags and removes totals', () => {
    render(<Harness initial={jj()} />);
    const lim = screen.getByRole('group', { name: 'ΕΣΟΔΑ LIM' });
    fireEvent.click(within(lim).getByLabelText('Στην κοινοποίηση'));
    expect(totals().find((t) => t.id === 'income_lim')?.showInShare).toBe(true);
    fireEvent.change(within(lim).getByLabelText('Όνομα συνόλου ΕΣΟΔΑ LIM'), { target: { value: 'ΕΣΟΔΑ' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'ΕΣΟΔΑ' })).getByRole('button', { name: 'Διαγραφή συνόλου ΕΣΟΔΑ' }));
    expect(totals().some((t) => t.id === 'income_lim')).toBe(false);
  });
});

describe('PreviewCard', () => {
  it('computes totals from sample amounts', () => {
    render(<Harness initial={jj()} />);
    const preview = screen.getByRole('region', { name: 'Δοκιμή με ποσά' });
    fireEvent.change(within(preview).getByLabelText('Δοκιμή: Μετρημένα'), { target: { value: '1500' } });
    fireEvent.change(within(preview).getByLabelText('Δοκιμή: myPos'), { target: { value: '310,25' } });
    expect(within(preview).getByLabelText('Αποτέλεσμα ΤΑΜΕΙΟ').textContent).toBe('1.810,25€');
    expect(within(preview).getByLabelText('Αποτέλεσμα ΜΕΤΡΗΤΑ').textContent).toBe('500,00€');
  });

  it('flags a sample it cannot use', () => {
    render(<Harness initial={jj()} />);
    const preview = screen.getByRole('region', { name: 'Δοκιμή με ποσά' });
    fireEvent.change(within(preview).getByLabelText('Δοκιμή: Μετρημένα'), { target: { value: '10,02' } });
    expect((within(preview).getByLabelText('Δοκιμή: Μετρημένα') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });
});
