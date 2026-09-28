// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { App } from '../../src/app/App';

afterEach(cleanup);

it('renders the register title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Κλείσιμο ταμείου' })).toBeTruthy();
});
