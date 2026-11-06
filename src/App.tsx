import React from 'react';
import { useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Desk } from './components/Desk';
import { Folio } from './components/Folio';
import { Compose } from './components/Compose';
import { Sheet } from './components/Sheet';
import { Toasts } from './components/Toasts';

export const AppContent: React.FC = () => {
  const { t } = useApp();

  return (
    <>
      <a className="skip" href="#folio">
        {t('a11y.skip')}
      </a>

      <div className="app" id="app">
        <Header />

        <div className="shell">
          <Desk />

          <main className="page">
            <Folio />
            <Compose />
          </main>
        </div>
      </div>

      <Sheet />
      <Toasts />
    </>
  );
};

export default function App() {
  return <AppContent />;
}
