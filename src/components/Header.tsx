import React from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './Icon';

export const Header: React.FC = () => {
  const {
    t,
    pair,
    settings,
    swapPair,
    conn,
    openSheet,
  } = useApp();

  const leftSide = settings['pair.left'] || 'a';
  const rightSide = leftSide === 'a' ? 'b' : 'a';

  const leftLangName = pair.names[pair[leftSide as 'a' | 'b']] || pair[leftSide as 'a' | 'b'];
  const rightLangName = pair.names[pair[rightSide as 'a' | 'b']] || pair[rightSide as 'a' | 'b'];

  return (
    <header className="bar">
      <div className="brand">
        <img
          src="/assets/relais_logo_relief_transparent.png"
          alt="Relais"
          className="brand-logo-relief"
        />
        <span className="brand-name">Relais</span>
      </div>

      <div className="pair" role="group">
        <span className="lang-tag" id="tagLeft" data-side={leftSide}>
          {leftLangName}
        </span>
        <button
          className="icon-btn"
          id="swap"
          type="button"
          onClick={swapPair}
          aria-label={t('pair.swap')}
          title={t('pair.swap')}
        >
          <Icon name="swap" />
        </button>
        <span className="lang-tag" id="tagRight" data-side={rightSide}>
          {rightLangName}
        </span>
      </div>

      <div className="bar-end">
        <span
          className="conn"
          id="conn"
          data-state={conn}
          role="status"
          title={conn === 'closed' ? t('conn.hint') : t('conn.open')}
        >
          <span className="dot" aria-hidden="true"></span>
          <span className="conn-text" id="connText">
            {t(`conn.${conn}`)}
          </span>
        </span>

        <button
          className="icon-btn"
          type="button"
          onClick={() => openSheet('meeting')}
          aria-label={t('top.meeting')}
          title={t('top.meeting')}
        >
          <Icon name="meeting" />
        </button>

        <button
          className="icon-btn"
          type="button"
          onClick={() => openSheet('library')}
          aria-label={t('top.library')}
          title={t('top.library')}
        >
          <Icon name="wave" />
        </button>

        <button
          className="icon-btn"
          type="button"
          onClick={() => openSheet('history')}
          aria-label={t('top.history')}
          title={t('top.history')}
        >
          <Icon name="clock" />
        </button>

        <button
          className="icon-btn"
          type="button"
          onClick={() => openSheet('glossary')}
          aria-label={t('top.glossary')}
          title={t('top.glossary')}
        >
          <Icon name="book" />
        </button>

        <button
          className="icon-btn"
          type="button"
          onClick={() => openSheet('settings')}
          aria-label={t('top.settings')}
          title={t('top.settings')}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
};
