import React from 'react';
import { useApp } from '../../context/AppContext';
import modelsData from '../../data/models.json';

export const SystemPanel: React.FC = () => {
  const { t } = useApp();

  const mtList = [
    { id: 'en-fr', lang: 'en → fr', mb: modelsData.mt['en-fr'].approx_mb, installed: true },
    { id: 'fr-en', lang: 'fr → en', mb: modelsData.mt['fr-en'].approx_mb, installed: true },
  ];

  const sttList = [
    { id: 'whisper-tiny', lang: 'auto', mb: modelsData.stt.tiny.approx_mb, installed: true },
    { id: 'whisper-base', lang: 'auto', mb: modelsData.stt.base.approx_mb, installed: true },
    { id: 'whisper-small', lang: 'auto', mb: modelsData.stt.small.approx_mb, installed: false },
  ];

  const ttsList = [
    { id: 'piper-lessac', lang: 'en', mb: 63, installed: true },
    { id: 'piper-siwis', lang: 'fr', mb: 63, installed: true },
    { id: 'kokoro-v1.0', lang: 'multi', mb: 340, installed: false },
  ];

  const renderGroup = (title: string, list: any[]) => (
    <React.Fragment key={title}>
      <h3>{title}</h3>
      <dl className="sys-list">
        {list.map((m) => (
          <div key={m.id}>
            <dt>{`${m.id}${m.lang ? ` (${m.lang})` : ''}`}</dt>
            <dd>
              ~{m.mb} Mo ·{' '}
              <span className={m.installed ? 'ok' : 'ko'}>
                {t(m.installed ? 'system.installed' : 'system.missing')}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </React.Fragment>
  );

  return (
    <div className="panel" id="panel-system">
      <dl className="sys-list">
        <div>
          <dt>{t('system.version')}</dt>
          <dd>0.1.0</dd>
        </div>
        <div>
          <dt>{t('system.engines')}</dt>
          <dd>{t('system.engines.mock')}</dd>
        </div>
        <div>
          <dt>{t('system.data')}</dt>
          <dd>
            <code>~/.local/share/relais</code>
          </dd>
        </div>
      </dl>

      {renderGroup(t('system.mt'), mtList)}
      {renderGroup(t('system.stt'), sttList)}
      {renderGroup(t('system.tts'), ttsList)}

      <p className="lede">{t('system.hint')}</p>
    </div>
  );
};
