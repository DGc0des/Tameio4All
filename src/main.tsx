import '@fontsource/inter/greek-400.css';
import '@fontsource/inter/greek-500.css';
import '@fontsource/inter/greek-600.css';
import '@fontsource/inter/greek-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './app/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
