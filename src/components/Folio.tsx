import React, { useEffect, useRef } from 'react';
import { useApp, UtteranceItem } from '../context/AppContext';
import { Icon } from './Icon';

const HELLO: Record<string, string> = { en: 'Hello.', fr: 'Bonjour.' };

const formatClock = (ms: number) => {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const Folio: React.FC = () => {
  const {
    t,
    settings,
    utterances,
    sideLang,
    langName,
    speakText,
    showToast,
    capOn,
  } = useApp();

  const folioRef = useRef<HTMLDivElement | null>(null);

  const left = (settings['pair.left'] || 'a') as 'a' | 'b';
  const right = left === 'a' ? 'b' : 'a';
  const me = (settings['pair.me'] || 'b') as 'a' | 'b';

  // Auto-scroll to bottom on new utterance
  useEffect(() => {
    if (folioRef.current) {
      folioRef.current.scrollTop = folioRef.current.scrollHeight;
    }
  }, [utterances]);

  const copyTranslation = async (text?: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('folio.copied'), 1800);
    } catch {
      /* clipboard write denied */
    }
  };

  const isTranslateOn = capOn('translate');

  return (
    <>
      <div className="folio-head" id="folioHead" data-left={left}>
        <div className="col-title" id="titleA" data-side="a">
          {langName('a')}
        </div>
        <div className="col-title" id="titleB" data-side="b">
          {langName('b')}
        </div>
      </div>

      <div
        className="folio"
        id="folio"
        data-left={left}
        role="log"
        aria-live="polite"
        tabIndex={0}
        ref={folioRef}
      >
        {utterances.length === 0 ? (
          <div className="folio-empty">
            <div className="empty-pair" aria-hidden="true">
              <span data-side={left} lang={sideLang(left)}>
                {HELLO[sideLang(left)] || 'Hello.'}
              </span>
              <span data-side={right} lang={sideLang(right)}>
                {HELLO[sideLang(right)] || 'Bonjour.'}
              </span>
            </div>
            <div className="empty-text">
              <div>
                <h2>{t('folio.empty.title')}</h2>
                <p>{t('folio.empty.body')}</p>
              </div>
            </div>
          </div>
        ) : (
          utterances.map((item) => {
            const saidSide = item.side;
            const heardSide = item.side === 'a' ? 'b' : 'a';
            const hasTr = !!(item.translation && item.translation.trim());

            return (
              <article
                key={item.key}
                className="utt enter"
                data-key={item.key}
                data-state={item.state}
              >
                <div className="stamp">
                  {item.state === 'live' ? (
                    <span className="lamp on" aria-hidden="true" />
                  ) : (
                    formatClock(item.ts)
                  )}
                </div>

                {/* Cell Side A */}
                <div
                  className={`cell ${saidSide === 'a' ? 'said' : 'heard'} ${
                    'a' === me ? 'mine' : 'other-lang'
                  }`}
                  data-side="a"
                  lang={sideLang('a')}
                  aria-label={langName('a')}
                >
                  <p
                    className={`line ${item.state === 'final' && heardSide === 'a' && hasTr ? 'wipe' : ''}`}
                    data-placeholder={
                      saidSide !== 'a' && !hasTr
                        ? item.state === 'final' && !isTranslateOn
                          ? t('folio.notranslate')
                          : item.state === 'final'
                          ? ''
                          : t('folio.pending')
                        : undefined
                    }
                  >
                    {saidSide === 'a' ? item.text : item.translation || ''}
                  </p>

                  {heardSide === 'a' && item.state === 'final' && hasTr && (
                    <div className="tools">
                      <button
                        className="icon-btn sm"
                        type="button"
                        title={t('folio.replay')}
                        aria-label={t('folio.replay')}
                        onClick={() => speakText(item.translation!, sideLang('a'))}
                      >
                        <Icon name="play" className="ic sm" />
                      </button>
                      <button
                        className="icon-btn sm"
                        type="button"
                        title={t('folio.copy')}
                        aria-label={t('folio.copy')}
                        onClick={() => copyTranslation(item.translation)}
                      >
                        <Icon name="copy" className="ic sm" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Cell Side B */}
                <div
                  className={`cell ${saidSide === 'b' ? 'said' : 'heard'} ${
                    'b' === me ? 'mine' : 'other-lang'
                  }`}
                  data-side="b"
                  lang={sideLang('b')}
                  aria-label={langName('b')}
                >
                  <p
                    className={`line ${item.state === 'final' && heardSide === 'b' && hasTr ? 'wipe' : ''}`}
                    data-placeholder={
                      saidSide !== 'b' && !hasTr
                        ? item.state === 'final' && !isTranslateOn
                          ? t('folio.notranslate')
                          : item.state === 'final'
                          ? ''
                          : t('folio.pending')
                        : undefined
                    }
                  >
                    {saidSide === 'b' ? item.text : item.translation || ''}
                  </p>

                  {heardSide === 'b' && item.state === 'final' && hasTr && (
                    <div className="tools">
                      <button
                        className="icon-btn sm"
                        type="button"
                        title={t('folio.replay')}
                        aria-label={t('folio.replay')}
                        onClick={() => speakText(item.translation!, sideLang('b'))}
                      >
                        <Icon name="play" className="ic sm" />
                      </button>
                      <button
                        className="icon-btn sm"
                        type="button"
                        title={t('folio.copy')}
                        aria-label={t('folio.copy')}
                        onClick={() => copyTranslation(item.translation)}
                      >
                        <Icon name="copy" className="ic sm" />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
};
