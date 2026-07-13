import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import { CartProvider } from './coupon/CartContext.tsx';
import { LanguageProvider } from './i18n/LanguageContext.tsx';
import { SoundProvider } from './settings/SoundContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <SoundProvider>
          <AuthProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </AuthProvider>
        </SoundProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
);
