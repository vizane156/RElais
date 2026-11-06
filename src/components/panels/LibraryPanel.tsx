import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Icon } from '../Icon';
import { MicTap } from '../../audio/capture';
import { encodeWav, concatInt16, f32ToInt16, fileToWav } from '../../audio/wav';
import { AudioMeter } from '../AudioMeter';
import { VoiceRecording } from '../../services/storage';

const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const LibraryPanel: React.FC = () => {
  const {
    t,
    settings,
    sideLang,
    langName,
    recordings,
    saveRecording,
    updateRecordingName,
    deleteRecording,
    showToast,
  } = useApp();

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [meterVal, setMeterVal] = useState(0);
  const [review, setReview] = useState<{
    bytes: Uint8Array;
    url: string;
    duration: number;
    sampleRate: number;
  } | null>(null);
  const [reviewName, setReviewName] = useState('');
  const [reviewLang, setReviewLang] = useState<string>(sideLang('b'));

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const tapRef = useRef<MicTap | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (tapRef.current) tapRef.current.close();
      if (review?.url) URL.revokeObjectURL(review.url);
    };
  }, [review]);

  const startRecord = async () => {
    if (review) {
      URL.revokeObjectURL(review.url);
      setReview(null);
    }
    const tap = new MicTap();
    tapRef.current = tap;
    chunksRef.current = [];
    setRecordSeconds(0);

    try {
      await tap.open(settings['listen.device'] || '', (f) => {
        chunksRef.current.push(f32ToInt16(f));
        let sum = 0;
        for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
        setMeterVal(Math.sqrt(sum / f.length));
      });
      setIsRecording(true);
      const startT = performance.now();
      timerRef.current = setInterval(() => {
        setRecordSeconds((performance.now() - startT) / 1000);
      }, 200);
    } catch (err: any) {
      tap.close();
      showToast(err && err.code === 'no_mic_api' ? t('err.no_mic_api') : t('err.mic_denied'));
    }
  };

  const stopRecord = () => {
    if (!isRecording || !tapRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const tap = tapRef.current;
    const rate = tap.sampleRate || 44100;
    tap.close();
    setIsRecording(false);
    setMeterVal(0);

    const pcm = concatInt16(chunksRef.current);
    const duration = pcm.length / rate;
    if (duration > 0.3) {
      const bytes = encodeWav(pcm, rate);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setReview({ bytes, url, duration, sampleRate: rate });
      setReviewName(`Voix ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      setReviewLang(sideLang('b'));
    }
  };

  const handleKeepReview = () => {
    if (!review) return;
    const newRec: VoiceRecording = {
      id: `rec_${Date.now()}`,
      name: reviewName.trim() || 'Voix',
      kind: 'voice',
      lang: reviewLang,
      duration: review.duration,
      sampleRate: review.sampleRate,
      blobUrl: review.url,
      bytes: review.bytes,
      ts: Date.now(),
    };
    saveRecording(newRec);
    setReview(null);
  };

  const handleDiscardReview = () => {
    if (review) {
      URL.revokeObjectURL(review.url);
      setReview(null);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const wav = await fileToWav(file);
      const blob = new Blob([wav.bytes as unknown as BlobPart], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const newRec: VoiceRecording = {
        id: `rec_${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        kind: 'voice',
        lang: sideLang('b'),
        duration: wav.duration,
        sampleRate: wav.sampleRate,
        blobUrl: url,
        bytes: wav.bytes,
        ts: Date.now(),
      };
      saveRecording(newRec);
    } catch {
      showToast(t('library.decode_fail'));
    }
  };

  const togglePlayRecording = (rec: VoiceRecording) => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio();
    }
    const audio = audioPlayerRef.current;

    if (playingId === rec.id && !audio.paused) {
      audio.pause();
      setPlayingId(null);
      return;
    }

    let src = rec.blobUrl;
    if (!src && rec.bytes) {
      src = URL.createObjectURL(new Blob([rec.bytes as unknown as BlobPart], { type: 'audio/wav' }));
    }
    if (src) {
      audio.src = src;
      audio.play().catch(() => {});
      setPlayingId(rec.id);
      audio.onended = () => setPlayingId(null);
    }
  };

  return (
    <div className="panel" id="panel-library">
      <p className="lede">{t('library.intro')}</p>
      <p className="lede" style={{ fontSize: 'var(--t-sm)', fontStyle: 'italic' }}>
        {t('library.tip')}
      </p>

      {/* Voice Recorder */}
      <div className="recorder">
        <div className="rec-main">
          <button
            className="rec-btn"
            type="button"
            data-recording={isRecording ? 'true' : undefined}
            aria-label={isRecording ? t('library.stop') : t('library.record')}
            title={isRecording ? t('library.stop') : t('library.record')}
            onClick={isRecording ? stopRecord : startRecord}
          >
            <Icon name={isRecording ? 'stop' : 'record'} />
          </button>
          <span className="rec-timer" aria-live="off">
            {fmtTime(recordSeconds)}
          </span>
          <div className="rec-meter">
            <AudioMeter level={meterVal} mode={isRecording ? 'live' : 'idle'} />
          </div>
        </div>

        {review && (
          <div className="rec-review">
            <audio controls src={review.url} />
            <div className="row">
              <input
                type="text"
                value={reviewName}
                maxLength={80}
                placeholder={t('library.name')}
                onChange={(e) => setReviewName(e.target.value)}
                aria-label={t('library.name')}
              />
              <select
                value={reviewLang}
                onChange={(e) => setReviewLang(e.target.value)}
                aria-label={t('library.lang')}
              >
                <option value={sideLang('a')}>{langName('a')}</option>
                <option value={sideLang('b')}>{langName('b')}</option>
              </select>
            </div>
            <div className="row">
              <button className="btn primary" type="button" onClick={handleKeepReview}>
                <Icon name="check" className="ic sm" />
                {t('library.keep')}
              </button>
              <button className="btn quiet" type="button" onClick={handleDiscardReview}>
                {t('library.discard')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="row">
        <label className="btn quiet" style={{ cursor: 'pointer' }}>
          <Icon name="upload" className="ic sm" />
          {t('library.upload')}
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={handleUploadFile}
          />
        </label>
      </div>

      {/* Recordings list */}
      {recordings.length === 0 ? (
        <p className="empty-note">{t('library.empty')}</p>
      ) : (
        <ul className="lib-list">
          {recordings.map((rec) => {
            const side = rec.lang === sideLang('a') ? 'a' : 'b';
            const isPlaying = playingId === rec.id;

            return (
              <li key={rec.id} className="lib-item">
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={isPlaying ? t('library.pause') : t('library.play')}
                  title={isPlaying ? t('library.pause') : t('library.play')}
                  onClick={() => togglePlayRecording(rec)}
                >
                  <Icon name={isPlaying ? 'pause' : 'play'} />
                </button>

                <div>
                  <div className="name">
                    {editingId === rec.id ? (
                      <input
                        type="text"
                        value={editName}
                        maxLength={80}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => {
                          if (editName.trim()) updateRecordingName(rec.id, editName.trim());
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (editName.trim()) updateRecordingName(rec.id, editName.trim());
                            setEditingId(null);
                          }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                    ) : (
                      rec.name
                    )}
                  </div>

                  <div className="meta">
                    <span className="tag">{t(`library.kind.${rec.kind}`)}</span>
                    <span className="tag" data-side={side}>
                      {langName(side)}
                    </span>
                    <span>{t('library.duration', { s: rec.duration.toFixed(1) })}</span>
                  </div>
                </div>

                <div className="actions">
                  <button
                    className="icon-btn sm"
                    type="button"
                    title={t('library.rename')}
                    aria-label={t('library.rename')}
                    onClick={() => {
                      setEditingId(rec.id);
                      setEditName(rec.name);
                    }}
                  >
                    <Icon name="edit" className="ic sm" />
                  </button>

                  {rec.blobUrl && (
                    <a
                      className="icon-btn sm"
                      href={rec.blobUrl}
                      download={`${rec.name}.wav`}
                      title={t('library.download')}
                      aria-label={t('library.download')}
                    >
                      <Icon name="download" className="ic sm" />
                    </a>
                  )}

                  <button
                    className="icon-btn sm"
                    type="button"
                    title={t('btn.delete')}
                    aria-label={t('btn.delete')}
                    onClick={() => {
                      if (window.confirm(t('library.confirm_delete'))) {
                        deleteRecording(rec.id);
                      }
                    }}
                  >
                    <Icon name="trash" className="ic sm" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
