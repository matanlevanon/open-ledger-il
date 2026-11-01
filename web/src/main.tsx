import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { trackPressedButtons } from './lib/pressedButton';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
trackPressedButtons();

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
