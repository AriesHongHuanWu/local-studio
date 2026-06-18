import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Design tokens FIRST (single source of truth), then fonts + global reset.
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/global.css';

import App from './App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
