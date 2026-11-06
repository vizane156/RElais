import React from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './Icon';
import { AudioMeter } from './AudioMeter';

const KEY_DEFS = [
  { id: 'listen', icon: 'mic', section: 'listen' },
  { id: 'translate', icon: 'dialogue', section: 'translate' },
  { id: 'speak', icon: 'speaker', section: 'speak' },
  { id: 'typespeak', icon: 'type', section: 'typespeak' },
  { id: 'record', icon: 'record', section: 'record' },
  { id: 'clone', icon: 'clone', planned: true },
];

export const Desk: React.FC = () => {
  const {
    t,
    caps,
    toggleCap,
    openSheet,
    who,
    setWho,
    langName,
    meterLevel,
    meterMode,
    lat,
    settings,
  } = useApp();

  const getMeterStateText = () => {
    switch (meterMode) {
      case 'idle':
        return t('level.idle');
      case 'live':
        return t('level.live');
      case 'speech':
        return t('level.speech');
      case 'muted':
        return t('level.muted');
      default:
        return '';
    }
  };

  return (
    <aside className="desk" aria-label={t('desk')}>
      <section>
        <h2>{t('desk')}</h2>
        <ul className="keys" id="keys">
          {KEY_DEFS.map((def) => {
            const cap = caps[def.id] || { id: def.id, enabled: false, state: 'off' };
            const isPlanned = !!def.planned;
            const isLive = cap.enabled && (cap.state === 'ready' || cap.state === 'loading');
            const stateText = isPlanned
              ? t('state.soon')
              : cap.enabled
              ? t(cap.state === 'loading' ? 'state.loading' : 'state.ready')
              : t('state.off');

            return (
              <li
                key={def.id}
                className="key"
                data-cap={def.id}
                data-state={isPlanned ? 'off' : cap.enabled ? cap.state : 'off'}
                data-planned={isPlanned ? '' : undefined}
              >
                <button
                  className="key-btn"
                  type="button"
                  role="switch"
                  aria-checked={isPlanned ? false : !!cap.enabled}
                  aria-disabled={isPlanned ? true : undefined}
                  aria-describedby={`key-${def.id}-state`}
                  title={t(`cap.${def.id}.tip`)}
                  onClick={() => toggleCap(def.id)}
                >
                  <span
                    className={`lamp ${isLive ? 'on' : ''}`}
                    aria-hidden="true"
                  />
                  <Icon name={def.icon} />
                  <span className="key-label">{t(`cap.${def.id}`)}</span>
                  <span className="key-state" id={`key-${def.id}-state`}>
                    {stateText}
                  </span>
                </button>

                {!isPlanned && (
                  <button
                    className="icon-btn sm key-gear"
                    type="button"
                    onClick={() => openSheet('settings', def.section)}
                    aria-label={t('key.settings', { name: t(`cap.${def.id}`) })}
                    title={t('key.settings', { name: t(`cap.${def.id}`) })}
                  >
                    <Icon name="settings" className="ic sm" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>{t('meeting.title')}</h2>
        <button
          className="btn"
          type="button"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.625rem 0.75rem',
            borderRadius: 'var(--r-md, 8px)',
            background: 'var(--bg-layer-2, #242936)',
            border: '1px solid var(--border-soft, #333a4d)',
            color: 'var(--text-1, #f0f3fa)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
          onClick={() => openSheet('meeting')}
        >
          <Icon name="meeting" />
          <span>{t('meeting.open_hub')}</span>
        </button>
      </section>

      <section>
        <h2>{t('who.title')}</h2>
        <div className="seg" id="who" role="radiogroup" aria-label={t('who.title')}>
          <button
            type="button"
            role="radio"
            aria-checked={who === 'auto'}
            onClick={() => setWho('auto')}
          >
            {t('who.auto')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={who === 'a'}
            data-side="a"
            onClick={() => setWho('a')}
          >
            <span className="swatch" aria-hidden="true"></span>
            {langName('a')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={who === 'b'}
            data-side="b"
            onClick={() => setWho('b')}
          >
            <span className="swatch" aria-hidden="true"></span>
            {langName('b')}
          </button>
        </div>
      </section>

      <section className="meter">
        <h2>{t('level.title')}</h2>
        <AudioMeter level={meterLevel} mode={meterMode} />
        <p className="meter-state" id="meterState">
          {getMeterStateText()}
        </p>
      </section>

      <section id="latBox" hidden={settings['ui.show_latency'] === false}>
        <h2>{t('lat.title')}</h2>
        <dl className="lat" id="lat">
          <div>
            <dt>{t('lat.stt')}</dt>
            <dd>{lat.stt != null ? `${Math.round(lat.stt)} ms` : '—'}</dd>
          </div>
          <div>
            <dt>{t('lat.mt')}</dt>
            <dd>{lat.mt != null ? `${Math.round(lat.mt)} ms` : '—'}</dd>
          </div>
          <div>
            <dt>{t('lat.tts')}</dt>
            <dd>{lat.tts != null ? `${Math.round(lat.tts)} ms` : '—'}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
};
