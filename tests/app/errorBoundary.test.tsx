// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/app/ErrorBoundary';

afterEach(cleanup);

function Boom(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('does not claim the data was saved — a crash may happen before any save', () => {
    // React logs the thrown error to the console; that is expected noise for this test only.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Ανανέωσε τη σελίδα για να συνεχίσεις.')).toBeTruthy();
    expect(screen.queryByText(/αποθηκευτεί/)).toBeNull();
    spy.mockRestore();
  });
});
