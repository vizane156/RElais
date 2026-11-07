import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Icon } from '../Icon';
import {
  MeetingService,
  MeetingSession,
  MeetingSpeaker,
  MeetingUtterance,
  ActionItem,
  createSpeaker,
} from '../../services/meeting';
import { VibeVoiceAdapter } from '../../services/vibeVoiceService';

const formatDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const MeetingPanel: React.FC = () => {
  const {
    t,
    showToast,
    addOrUpdateUtterance,
    speechService,
    capOn,
    capture,
  } = useApp();

  const [session, setSession] = useState<MeetingSession>(() => MeetingService.getStoredSession());
  const [meetingState, setMeetingState] = useState<'idle' | 'recording' | 'paused' | 'stopped'>('idle');
  const [activeSpeakerId, setActiveSpeakerId] = useState<string>(
    () => session.speakers[0]?.id || 'spk-1'
  );
  const [sttEngine, setSttEngine] = useState<'webspeech' | 'vibevoice'>('vibevoice');
  const [vibeVoiceStatus, setVibeVoiceStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(session.title);

  // New action item input
  const [newActionText, setNewActionText] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState('');

  // Q&A assistant
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Save session on change
  useEffect(() => {
    MeetingService.saveSession(session);
  }, [session]);

  // Duration timer when recording
  useEffect(() => {
    if (meetingState === 'recording') {
      timerRef.current = setInterval(() => {
        setSession((prev) => ({
          ...prev,
          duration: prev.duration + 1,
        }));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [meetingState]);

  // Dual Engine Speech Recognition when recording (VibeVoice BitNet + WebSpeech fallback)
  useEffect(() => {
    let vibeVoiceAdapter: VibeVoiceAdapter | null = null;
    let isMounted = true;

    if (meetingState === 'recording') {
      const activeSpeaker = session.speakers.find((s) => s.id === activeSpeakerId) || session.speakers[0];

      if (sttEngine === 'vibevoice') {
        // Démarre la capture PCM 16kHz
        capture.open('').catch((err) => {
          console.warn('Impossible d\'ouvrir le micro pour VibeVoice:', err);
        });

        vibeVoiceAdapter = new VibeVoiceAdapter(capture, {
          onTranscription: (res) => {
            if (!isMounted) return;
            if (res.segments && res.segments.length > 0) {
              res.segments.forEach((seg) => {
                if (seg.text.trim()) {
                  // Trouve ou assigne l'interlocuteur diarizé
                  const spk = session.speakers.find((s) => s.id === seg.speakerId) || activeSpeaker;
                  const newUtt: MeetingUtterance = {
                    id: `utt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                    speakerId: spk.id,
                    speakerName: seg.speakerName || spk.name,
                    text: seg.text.trim(),
                    ts: Date.now(),
                    lang: 'fr',
                  };
                  setSession((prev) => ({
                    ...prev,
                    utterances: [...prev.utterances, newUtt],
                  }));
                }
              });
            } else if (res.text.trim()) {
              const newUtt: MeetingUtterance = {
                id: `utt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                speakerId: activeSpeaker.id,
                speakerName: activeSpeaker.name,
                text: res.text.trim(),
                ts: Date.now(),
                lang: 'fr',
              };
              setSession((prev) => ({
                ...prev,
                utterances: [...prev.utterances, newUtt],
              }));
            }
          },
          onStatusChange: (status) => {
            if (isMounted) setVibeVoiceStatus(status);
          },
          onError: (err) => {
            console.warn('[Meeting] VibeVoice indisponible, bascule douce sur Web Speech:', err);
            // Repli automatique sans interrompre la session
            speechService.startRecognition({
              lang: 'fr',
              onResult: (text: string, isFinal: boolean) => {
                if (isFinal && text.trim()) {
                  const newUtt: MeetingUtterance = {
                    id: `utt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                    speakerId: activeSpeaker.id,
                    speakerName: activeSpeaker.name,
                    text: text.trim(),
                    ts: Date.now(),
                    lang: 'fr',
                  };
                  setSession((prev) => ({
                    ...prev,
                    utterances: [...prev.utterances, newUtt],
                  }));
                }
              },
            });
          },
        });

        vibeVoiceAdapter.connect().catch(() => {});
      } else {
        // Mode direct Web Speech API
        speechService.startRecognition({
          lang: 'fr',
          onResult: (text: string, isFinal: boolean) => {
            if (isFinal && text.trim()) {
              const newUtt: MeetingUtterance = {
                id: `utt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                speakerId: activeSpeaker.id,
                speakerName: activeSpeaker.name,
                text: text.trim(),
                ts: Date.now(),
                lang: 'fr',
              };
              setSession((prev) => ({
                ...prev,
                utterances: [...prev.utterances, newUtt],
              }));
            }
          },
        });
      }

      return () => {
        isMounted = false;
        if (vibeVoiceAdapter) vibeVoiceAdapter.disconnect();
        speechService.stopRecognition();
      };
    } else {
      setVibeVoiceStatus('disconnected');
      speechService.stopRecognition();
    }
  }, [meetingState, sttEngine, activeSpeakerId, session.speakers, capture, speechService]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptEndRef.current && meetingState === 'recording') {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session.utterances, meetingState]);

  // Actions de contrôle
  const handleStart = () => {
    setMeetingState('recording');
  };

  const handlePause = () => {
    setMeetingState('paused');
  };

  const handleResume = () => {
    setMeetingState('recording');
  };

  const handleStop = () => {
    setMeetingState('stopped');
    handleGenerateNotes();
  };

  const handleNewMeeting = () => {
    if (session.utterances.length > 0 && !window.confirm('Créer une nouvelle réunion ? La réunion actuelle sera réinitialisée.')) {
      return;
    }
    setMeetingState('idle');
    const newSess: MeetingSession = {
      id: `mtg_${Date.now()}`,
      title: "Nouvelle Réunion",
      date: Date.now(),
      duration: 0,
      speakers: session.speakers,
      utterances: [],
    };
    setSession(newSess);
    setTitleInput(newSess.title);
    setAnswer('');
  };

  const handleLoadSample = () => {
    const sample = MeetingService.getSampleMeeting();
    setSession(sample);
    setTitleInput(sample.title);
    setMeetingState('stopped');
    showToast(t('meeting.sample_demo'));
    MeetingService.generateNotes(sample).then((notes) => {
      setSession((prev) => ({ ...prev, notes }));
    });
  };

  const handleAddSpeaker = () => {
    if (!newSpeakerName.trim()) return;
    const spk = createSpeaker(newSpeakerName, session.speakers.length);
    setSession((prev) => ({
      ...prev,
      speakers: [...prev.speakers, spk],
    }));
    setActiveSpeakerId(spk.id);
    setNewSpeakerName('');
  };

  const handleReassignSpeaker = (uttId: string, targetSpeakerId: string) => {
    const target = session.speakers.find((s) => s.id === targetSpeakerId);
    if (!target) return;
    setSession((prev) => ({
      ...prev,
      utterances: prev.utterances.map((u) =>
        u.id === uttId ? { ...u, speakerId: target.id, speakerName: target.name } : u
      ),
    }));
  };

  const handleGenerateNotes = async () => {
    if (session.utterances.length === 0) {
      showToast(t('meeting.no_transcript'));
      return;
    }
    setIsGeneratingNotes(true);
    try {
      const notes = await MeetingService.generateNotes(session);
      setSession((prev) => ({ ...prev, notes }));
      showToast(t('meeting.notes_copied'), 2000);
    } catch {
      showToast(t('err.load'));
    } finally {
      setIsGeneratingNotes(false);
    }
  };

  const handleToggleAction = (actionId: string) => {
    setSession((prev) => {
      if (!prev.notes) return prev;
      const nextActions = prev.notes.actionItems.map((a) =>
        a.id === actionId ? { ...a, done: !a.done } : a
      );
      return {
        ...prev,
        notes: { ...prev.notes, actionItems: nextActions },
      };
    });
  };

  const handleAddActionItem = () => {
    if (!newActionText.trim()) return;
    const newAction: ActionItem = {
      id: `act_${Date.now()}`,
      text: newActionText.trim(),
      assignee: newActionAssignee.trim() || session.speakers[0]?.name || 'Tous',
      done: false,
      priority: 'normal',
    };
    setSession((prev) => {
      const currentNotes = prev.notes || {
        title: prev.title,
        summary: '',
        keyPoints: [],
        actionItems: [],
        decisions: [],
        tags: [],
        generatedAt: Date.now(),
      };
      return {
        ...prev,
        notes: {
          ...currentNotes,
          actionItems: [...currentNotes.actionItems, newAction],
        },
      };
    });
    setNewActionText('');
  };

  const handleAskAssistant = () => {
    if (!question.trim()) return;
    const ans = MeetingService.answerQuestion(question, session);
    setAnswer(ans);
  };

  // Exports
  const handleExportMarkdown = () => {
    const md = MeetingService.exportMarkdown(session);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/\s+/g, '_')}_OtterNotes.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportText = () => {
    let txt = `REUNION : ${session.title}\nDate: ${new Date(session.date).toLocaleString()}\n\n`;
    txt += `PARTICIPANTS : ${session.speakers.map((s) => s.name).join(', ')}\n\n`;
    if (session.notes) {
      txt += `RESUME EXECUTIF :\n${session.notes.summary}\n\n`;
      txt += `ACTIONS A FAIRE :\n${session.notes.actionItems.map((a) => `- [${a.done ? 'FAIT' : 'A FAIRE'}] ${a.assignee}: ${a.text}`).join('\n')}\n\n`;
    }
    txt += `TRANSCRIPTION :\n`;
    session.utterances.forEach((u) => {
      txt += `[${new Date(u.ts).toLocaleTimeString()}] ${u.speakerName}: ${u.text}\n`;
    });
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/\s+/g, '_')}_Transcription.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyNotes = async () => {
    if (!session.notes) return;
    let text = `${session.title}\n\n${session.notes.summary}\n\n`;
    text += `Actions :\n${session.notes.actionItems.map((a) => `• [${a.done ? 'x' : ' '}] ${a.assignee}: ${a.text}`).join('\n')}\n\n`;
    if (session.notes.decisions.length) {
      text += `Décisions :\n${session.notes.decisions.map((d) => `• ${d}`).join('\n')}\n`;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('meeting.notes_copied'), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleImportToFolio = () => {
    if (session.utterances.length === 0) return;
    session.utterances.forEach((u, i) => {
      addOrUpdateUtterance({
        key: `mtg_${u.id}`,
        side: i % 2 === 0 ? 'a' : 'b',
        text: `[${u.speakerName}] ${u.text}`,
        state: 'final',
        ts: u.ts,
      });
    });
    showToast(t('meeting.import_folio_done'), 2500);
  };

  const filteredUtterances = session.utterances.filter((u) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return u.text.toLowerCase().includes(q) || u.speakerName.toLowerCase().includes(q);
  });

  return (
    <div className="panel" id="panel-meeting" style={{ display: 'grid', gap: 'var(--s4)' }}>
      {/* Bannière d'illustration Hub Réunion */}
      <div
        className="meeting-hero-banner"
        style={{
          position: 'relative',
          borderRadius: 'var(--r-m, 10px)',
          overflow: 'hidden',
          border: '1px solid var(--rule-2, rgba(255,255,255,0.08))',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          maxHeight: '190px',
          display: 'flex',
          alignItems: 'flex-end',
        }}
      >
        <img
          src="/assets/hub_reunion_banner.jpg"
          alt="Illustration Hub Réunion Relais — Transcription, Ondes Vocales & Prise de Notes IA"
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '190px',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(15,17,23,0.85) 0%, rgba(15,17,23,0.2) 50%, transparent 100%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '0.85rem',
            left: '1rem',
            right: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.65rem',
                background: 'rgba(20, 24, 35, 0.75)',
                backdropFilter: 'blur(8px)',
                borderRadius: '999px',
                border: '1px solid rgba(255,255,255,0.15)',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '0.02em',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2C3FD4', boxShadow: '0 0 6px #2C3FD4' }} />
              Hub Réunion & Diarisation
            </span>
          </div>
          <span
            style={{
              padding: '0.25rem 0.55rem',
              background: 'rgba(20, 24, 35, 0.75)',
              backdropFilter: 'blur(8px)',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.12)',
              fontSize: '0.72rem',
              color: 'var(--ink-2, #cbd5e1)',
              fontWeight: 600,
            }}
          >
            VibeVoice-ASR • Notes IA
          </span>
        </div>
      </div>

      {/* En-tête de réunion Otter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s2)', borderBottom: '1px solid var(--rule)', paddingBottom: 'var(--s3)' }}>
        <div>
          {isEditingTitle ? (
            <input
              type="text"
              value={titleInput}
              autoFocus
              maxLength={80}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={() => {
                if (titleInput.trim()) setSession((prev) => ({ ...prev, title: titleInput.trim() }));
                setIsEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (titleInput.trim()) setSession((prev) => ({ ...prev, title: titleInput.trim() }));
                  setIsEditingTitle(false);
                }
              }}
              style={{ fontSize: '1.2rem', fontWeight: 750, minWidth: '16rem' }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, cursor: 'pointer' }} onClick={() => setIsEditingTitle(true)} title="Cliquer pour renommer">
                {session.title}
              </h3>
              <button className="icon-btn sm" type="button" onClick={() => setIsEditingTitle(true)} title="Renommer">
                <Icon name="edit" className="ic sm" />
              </button>
            </div>
          )}
          <div style={{ fontSize: 'var(--t-sm)', color: 'var(--ink-2)', marginTop: '0.2rem' }}>
            <span>{new Date(session.date).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <span style={{ margin: '0 0.5rem' }}>•</span>
            <span>{t('meeting.duration')} : <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(session.duration)}</strong></span>
          </div>
        </div>

        {/* Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span
            className="tag"
            style={{
              padding: '0.3rem 0.7rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              borderColor: meetingState === 'recording' ? '#0F9D58' : meetingState === 'paused' ? '#E4580A' : 'var(--rule-2)',
              color: meetingState === 'recording' ? '#0F9D58' : meetingState === 'paused' ? '#E4580A' : 'var(--ink-2)',
              fontWeight: 700,
            }}
          >
            <span
              style={{
                width: '0.6rem',
                height: '0.6rem',
                borderRadius: '50%',
                backgroundColor: meetingState === 'recording' ? '#0F9D58' : meetingState === 'paused' ? '#E4580A' : 'var(--ink-3)',
                boxShadow: meetingState === 'recording' ? '0 0 6px #0F9D58' : 'none',
              }}
            />
            {meetingState === 'recording' ? t('meeting.live') : meetingState === 'paused' ? t('meeting.paused') : t('meeting.stopped')}
          </span>
        </div>
      </div>

      {/* Barre de contrôle Otter */}
      <div className="row" style={{ gap: '0.5rem' }}>
        {meetingState === 'idle' && (
          <button className="btn primary" type="button" onClick={handleStart}>
            <Icon name="record" className="ic sm" />
            {t('meeting.start')}
          </button>
        )}

        {meetingState === 'recording' && (
          <>
            <button className="btn" type="button" onClick={handlePause}>
              <Icon name="pause" className="ic sm" />
              {t('meeting.pause')}
            </button>
            <button className="btn danger" type="button" onClick={handleStop}>
              <Icon name="stop" className="ic sm" />
              {t('meeting.stop')}
            </button>
          </>
        )}

        {meetingState === 'paused' && (
          <>
            <button className="btn primary" type="button" onClick={handleResume}>
              <Icon name="play" className="ic sm" />
              {t('meeting.resume')}
            </button>
            <button className="btn danger" type="button" onClick={handleStop}>
              <Icon name="stop" className="ic sm" />
              {t('meeting.stop')}
            </button>
          </>
        )}

        {meetingState === 'stopped' && (
          <button className="btn" type="button" onClick={handleStart}>
            <Icon name="record" className="ic sm" />
            {t('meeting.resume')}
          </button>
        )}

        <button className="btn quiet" type="button" onClick={handleLoadSample} title="Charge un dialogue réaliste de réunion">
          <Icon name="meeting" className="ic sm" />
          {t('meeting.sample_demo')}
        </button>

        <button className="btn quiet" type="button" onClick={handleNewMeeting}>
          <Icon name="plus" className="ic sm" />
          Nouvelle réunion
        </button>

        {/* Engine Switcher (VibeVoice BitNet vs Web Speech) */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--ink-2)', fontWeight: 600 }}>{t('meeting.engine')}:</span>
          <div className="seg" role="radiogroup" style={{ display: 'inline-flex' }}>
            <button
              type="button"
              role="radio"
              aria-checked={sttEngine === 'vibevoice'}
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.76rem', fontWeight: 600 }}
              onClick={() => setSttEngine('vibevoice')}
              title="VibeVoice BitNet ASR & Diarisation multi-locuteurs"
            >
              VibeVoice BitNet
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={sttEngine === 'webspeech'}
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.76rem', fontWeight: 600 }}
              onClick={() => setSttEngine('webspeech')}
              title="Web Speech API du navigateur"
            >
              Web Speech
            </button>
          </div>
        </div>
      </div>

      {/* VibeVoice Status Banner */}
      {sttEngine === 'vibevoice' && (
        <div
          style={{
            fontSize: '0.78rem',
            padding: '0.4rem 0.75rem',
            borderRadius: 'var(--r-sm, 4px)',
            background: vibeVoiceStatus === 'connected' ? 'rgba(15, 157, 88, 0.12)' : 'var(--lift, #202430)',
            border: `1px solid ${vibeVoiceStatus === 'connected' ? '#0F9D58' : 'var(--rule)'}`,
            color: vibeVoiceStatus === 'connected' ? '#0F9D58' : 'var(--ink-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <span>
            {vibeVoiceStatus === 'connected'
              ? `⚡ ${t('meeting.vibevoice_connected')}`
              : vibeVoiceStatus === 'connecting'
              ? '⏳ Connexion au service VibeVoice BitNet (ws://localhost:8000)...'
              : `ℹ️ ${t('meeting.vibevoice_fallback')}`}
          </span>
          <span style={{ opacity: 0.75, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            {vibeVoiceStatus === 'connected' ? 'Port 8000 (Docker CPU)' : 'Mode résilient actif'}
          </span>
        </div>
      )}

      {/* Attribution des interlocuteurs (Speaker Diarization) */}
      <div style={{ padding: 'var(--s3)', background: 'var(--lift)', borderRadius: 'var(--r-m)', border: '1px solid var(--rule)' }}>
        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 'var(--s2)' }}>
          {t('meeting.current_speaker')} :
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
          {session.speakers.map((spk, spkIdx) => {
            const isSelected = activeSpeakerId === spk.id;
            return (
              <button
                key={`spk-btn-${spk.id || spkIdx}-${spkIdx}`}
                type="button"
                onClick={() => setActiveSpeakerId(spk.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '999px',
                  border: `2px solid ${spk.color}`,
                  background: isSelected ? spk.color : 'transparent',
                  color: isSelected ? '#ffffff' : 'var(--ink)',
                  fontWeight: 650,
                  fontSize: 'var(--t-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {spk.avatarUrl ? (
                  <img
                    src={spk.avatarUrl}
                    alt={spk.name}
                    style={{
                      width: '1.45rem',
                      height: '1.45rem',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '1.5px solid rgba(255,255,255,0.7)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: '1.25rem',
                      height: '1.25rem',
                      borderRadius: '50%',
                      backgroundColor: isSelected ? 'rgba(255,255,255,0.3)' : spk.color,
                      color: '#ffffff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                    }}
                  >
                    {spk.initial}
                  </span>
                )}
                {spk.name}
              </button>
            );
          })}

          {/* Ajout d'interlocuteur */}
          <div style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', marginLeft: 'auto' }}>
            <input
              type="text"
              placeholder={t('meeting.speaker_name')}
              value={newSpeakerName}
              maxLength={30}
              onChange={(e) => setNewSpeakerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSpeaker();
              }}
              style={{ padding: '0.25rem 0.5rem', fontSize: 'var(--t-xs)', width: '9rem' }}
            />
            <button className="btn sm quiet" type="button" onClick={handleAddSpeaker} style={{ padding: '0.25rem 0.5rem', fontSize: 'var(--t-xs)' }}>
              <Icon name="plus" className="ic sm" />
              {t('meeting.add_speaker')}
            </button>
          </div>
        </div>
      </div>

      {/* Transcription en direct */}
      <section style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-m)', overflow: 'hidden', background: 'var(--paper)' }}>
        <div style={{ padding: 'var(--s2) var(--s3)', background: 'var(--paper-2)', borderBottom: '1px solid var(--rule)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Icon name="mic" className="ic sm" />
            <h4 style={{ margin: 0, fontSize: 'var(--t-sm)', fontWeight: 700 }}>
              {t('meeting.transcript')} ({session.utterances.length})
            </h4>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '20rem' }}>
            <input
              type="search"
              placeholder={t('meeting.search_ph')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '0.3rem 0.6rem', fontSize: 'var(--t-xs)' }}
            />
          </div>
        </div>

        <div style={{ maxHeight: '280px', overflowY: 'auto', padding: 'var(--s3)', display: 'grid', gap: 'var(--s3)' }}>
          {filteredUtterances.length === 0 ? (
            <p className="empty-note" style={{ textAlign: 'center', margin: 'var(--s4) 0' }}>
              {t('meeting.no_transcript')}
            </p>
          ) : (
            filteredUtterances.map((u, uIdx) => {
              const spk = session.speakers.find((s) => s.id === u.speakerId) || {
                name: u.speakerName,
                color: 'var(--ink)',
                initial: u.speakerName.charAt(0).toUpperCase(),
                avatarUrl: undefined,
              };

              return (
                <div
                  key={`mtg-u-${u.id || uIdx}-${uIdx}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr)',
                    gap: '0.75rem',
                    alignItems: 'start',
                    padding: '0.6rem 0.75rem',
                    borderRadius: 'var(--r-s)',
                    background: 'var(--lift)',
                    borderLeft: `4px solid ${spk.color}`,
                  }}
                >
                  <div
                    style={{
                      width: '2.4rem',
                      height: '2.4rem',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      backgroundColor: spk.color,
                      border: `2px solid ${spk.color}`,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.22)',
                      flexShrink: 0,
                    }}
                  >
                    {spk.avatarUrl ? (
                      <img
                        src={spk.avatarUrl}
                        alt={spk.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#fff',
                          fontWeight: 750,
                          fontSize: '0.85rem',
                        }}
                      >
                        {spk.initial}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 750, fontSize: 'var(--t-sm)', color: spk.color }}>
                        {u.speakerName}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                          {new Date(u.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>

                        {/* Réassigner l'interlocuteur */}
                        <select
                          value={u.speakerId}
                          onChange={(e) => handleReassignSpeaker(u.id, e.target.value)}
                          aria-label={t('meeting.reassign')}
                          style={{ padding: '0 0.3rem', fontSize: '0.7rem', height: '1.4rem' }}
                        >
                          {session.speakers.map((s, sIdx) => (
                            <option key={`reassign-spk-${s.id || sIdx}-${sIdx}`} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: 'var(--t-md)', lineHeight: 1.45, overflowWrap: 'break-word' }}>
                      {u.text}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={transcriptEndRef} />
        </div>
      </section>

      {/* Bouton de génération de notes automatiques Otter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)', alignItems: 'center' }}>
        <button
          className="btn primary"
          type="button"
          disabled={session.utterances.length === 0 || isGeneratingNotes}
          onClick={handleGenerateNotes}
          style={{ flex: 1, minWidth: '15rem', padding: '0.7rem 1.2rem' }}
        >
          <Icon name="meeting" />
          <span>{isGeneratingNotes ? t('meeting.generating_notes') : t('meeting.generate_notes')}</span>
        </button>

        <button
          className="btn quiet"
          type="button"
          onClick={handleImportToFolio}
          disabled={session.utterances.length === 0}
          title={t('meeting.import_folio')}
        >
          <Icon name="dialogue" className="ic sm" />
          {t('meeting.import_folio')}
        </button>
      </div>

      {/* Section Compte-rendu intelligent & Actions Otter */}
      {session.notes && (
        <section
          style={{
            border: '1.5px solid var(--ink)',
            borderRadius: 'var(--r-m)',
            padding: 'var(--s4)',
            background: 'var(--lift)',
            display: 'grid',
            gap: 'var(--s4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--rule)', paddingBottom: 'var(--s2)' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icon name="meeting" />
              {t('meeting.notes_title')}
            </h3>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button className="icon-btn sm" type="button" onClick={handleCopyNotes} title={t('meeting.copy_notes')}>
                <Icon name="copy" className="ic sm" />
              </button>
              <button className="icon-btn sm" type="button" onClick={handleExportMarkdown} title={t('meeting.export_md')}>
                <Icon name="download" className="ic sm" />
              </button>
            </div>
          </div>

          {/* Tags */}
          {session.notes.tags && session.notes.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {session.notes.tags.map((tag, tagIdx) => (
                <span
                  key={`tag-${tag}-${tagIdx}`}
                  className="tag"
                  style={{
                    backgroundColor: 'var(--paper)',
                    color: 'var(--ink)',
                    fontWeight: 650,
                    padding: '0.2rem 0.5rem',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Résumé Exécutif */}
          <div>
            <h4 style={{ margin: '0 0 var(--s1) 0', fontSize: 'var(--t-sm)', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('meeting.summary')}
            </h4>
            <p style={{ margin: 0, fontSize: 'var(--t-md)', lineHeight: 1.5, background: 'var(--paper)', padding: 'var(--s3)', borderRadius: 'var(--r-s)', borderLeft: '4px solid var(--lamp)' }}>
              {session.notes.summary}
            </p>
          </div>

          {/* Points Clés */}
          {session.notes.keyPoints && session.notes.keyPoints.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 var(--s2) 0', fontSize: 'var(--t-sm)', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('meeting.key_points')}
              </h4>
              <ul style={{ margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
                {session.notes.keyPoints.map((point, idx) => (
                  <li
                    key={`kp-${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'start',
                      gap: '0.5rem',
                      background: 'var(--paper)',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--r-s)',
                    }}
                  >
                    <span style={{ color: 'var(--ink-2)', fontWeight: 700 }}>•</span>
                    <span style={{ fontSize: 'var(--t-sm)', lineHeight: 1.4 }}>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Plan d'actions & Tâches interactif */}
          <div>
            <h4 style={{ margin: '0 0 var(--s2) 0', fontSize: 'var(--t-sm)', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('meeting.action_items')} ({session.notes.actionItems.length})
            </h4>

            <div style={{ display: 'grid', gap: '0.4rem', marginBottom: 'var(--s3)' }}>
              {session.notes.actionItems.map((act, actIdx) => (
                <div
                  key={`act-${act.id || actIdx}-${actIdx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    background: 'var(--paper)',
                    padding: '0.55rem 0.8rem',
                    borderRadius: 'var(--r-s)',
                    border: '1px solid var(--rule-2)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={act.done}
                    onChange={() => handleToggleAction(act.id)}
                    style={{ width: '1.15rem', height: '1.15rem', cursor: 'pointer', accentColor: 'var(--ink)' }}
                  />
                  <span
                    style={{
                      flex: 1,
                      textDecoration: act.done ? 'line-through' : 'none',
                      color: act.done ? 'var(--ink-3)' : 'var(--ink)',
                      fontSize: 'var(--t-sm)',
                      lineHeight: 1.35,
                    }}
                  >
                    {act.text}
                  </span>
                  {act.assignee && (
                    <span
                      className="tag"
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        backgroundColor: 'var(--lift)',
                      }}
                    >
                      {act.assignee}
                    </span>
                  )}
                  {act.priority === 'high' && (
                    <span
                      className="tag"
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 750,
                        color: 'var(--warn)',
                        borderColor: 'var(--warn)',
                      }}
                    >
                      Prioritaire
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Ajouter une action */}
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                placeholder={t('meeting.action_placeholder')}
                value={newActionText}
                onChange={(e) => setNewActionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddActionItem();
                }}
                style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: 'var(--t-xs)' }}
              />
              <select
                value={newActionAssignee}
                onChange={(e) => setNewActionAssignee(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', fontSize: 'var(--t-xs)', maxWidth: '9rem' }}
              >
                <option value="">{t('meeting.assignee')}...</option>
                {session.speakers.map((s, sIdx) => (
                  <option key={`act-spk-${s.id || sIdx}-${sIdx}`} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="btn quiet" type="button" onClick={handleAddActionItem}>
                <Icon name="plus" className="ic sm" />
                {t('meeting.add_action')}
              </button>
            </div>
          </div>

          {/* Décisions Clés */}
          {session.notes.decisions && session.notes.decisions.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 var(--s2) 0', fontSize: 'var(--t-sm)', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('meeting.decisions')}
              </h4>
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                {session.notes.decisions.map((dec, idx) => (
                  <div
                    key={`dec-${idx}`}
                    style={{
                      background: 'var(--paper)',
                      padding: '0.6rem 0.8rem',
                      borderRadius: 'var(--r-s)',
                      borderLeft: '4px solid #0F9D58',
                      fontSize: 'var(--t-sm)',
                    }}
                  >
                    ✓ {dec}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assistant Q&A Otter */}
          <div style={{ marginTop: 'var(--s2)', borderTop: '1px solid var(--rule)', paddingTop: 'var(--s3)' }}>
            <h4 style={{ margin: '0 0 var(--s2) 0', fontSize: 'var(--t-sm)', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Assistant Otter AI - Poser une question
            </h4>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                placeholder={t('meeting.ask_otter')}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskAssistant();
                }}
                style={{ flex: 1, padding: '0.45rem 0.7rem', fontSize: 'var(--t-sm)' }}
              />
              <button className="btn primary" type="button" onClick={handleAskAssistant}>
                {t('meeting.ask_btn')}
              </button>
            </div>

            {answer && (
              <div style={{ marginTop: 'var(--s2)', background: 'var(--paper)', padding: 'var(--s3)', borderRadius: 'var(--r-s)', borderLeft: '4px solid #2C3FD4', whiteSpace: 'pre-wrap', fontSize: 'var(--t-sm)', lineHeight: 1.45 }}>
                <strong>Réponse Otter :</strong>
                <p style={{ margin: '0.3rem 0 0 0' }}>{answer}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Boutons d'export et partage */}
      <div className="row" style={{ marginTop: 'var(--s2)' }}>
        <button className="btn quiet" type="button" onClick={handleExportMarkdown} disabled={session.utterances.length === 0}>
          <Icon name="download" className="ic sm" />
          {t('meeting.export_md')}
        </button>

        <button className="btn quiet" type="button" onClick={handleExportText} disabled={session.utterances.length === 0}>
          <Icon name="download" className="ic sm" />
          {t('meeting.export_txt')}
        </button>
      </div>
    </div>
  );
};
