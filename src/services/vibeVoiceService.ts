/**
 * Adaptateur Client Frontend Relais pour VibeVoice-ASR-BitNet
 * Gère le streaming audio PCM 16kHz vers l'API FastAPI en WebSocket avec
 * reconnexion automatique, réconciliation des chunks, diarisation des locuteurs
 * et respect strict de l'Echo-guard.
 */

import { Capture } from '../audio/capture';

export interface VibeVoiceSpeakerSegment {
  speakerId: string;
  speakerName: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
}

export interface VibeVoiceTranscriptionResult {
  sessionId: string;
  segments: VibeVoiceSpeakerSegment[];
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface VibeVoiceConfig {
  serverUrl?: string; // e.g. ws://localhost:8000/api/v1/stt/vibevoice-stream
  httpFallbackUrl?: string; // e.g. http://localhost:8000/api/v1/stt/transcribe
  sampleRate?: number; // 16000 Hz
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  onTranscription?: (result: VibeVoiceTranscriptionResult) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

export class VibeVoiceAdapter {
  private config: Required<Omit<VibeVoiceConfig, 'onTranscription' | 'onError' | 'onStatusChange'>> & {
    onTranscription?: (result: VibeVoiceTranscriptionResult) => void;
    onError?: (error: Error) => void;
    onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  };

  private ws: WebSocket | null = null;
  private capture: Capture | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private isExplicitlyClosed = false;
  private isEchoGuarded = false;
  private audioChunkQueue: ArrayBufferLike[] = [];
  private sessionId: string;

  constructor(capture: Capture, config: VibeVoiceConfig = {}) {
    this.capture = capture;
    this.sessionId = `vv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.config = {
      serverUrl: config.serverUrl || 'ws://localhost:8000/api/v1/stt/vibevoice-stream',
      httpFallbackUrl: config.httpFallbackUrl || 'http://localhost:8000/api/v1/stt/transcribe',
      sampleRate: config.sampleRate || 16000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      reconnectBaseDelayMs: config.reconnectBaseDelayMs ?? 1000,
      onTranscription: config.onTranscription,
      onError: config.onError,
      onStatusChange: config.onStatusChange,
    };

    this.bindCaptureEvents();
  }

  /**
   * Associe la source audio Relais à l'adaptateur
   */
  private bindCaptureEvents() {
    if (!this.capture) return;

    // Écoute les paquets PCM 16kHz
    this.capture.addEventListener('frames', ((e: CustomEvent<Int16Array>) => {
      if (this.isEchoGuarded || !e.detail) return;
      this.sendAudioChunk(e.detail.buffer);
    }) as EventListener);

    // Écoute les changements de mute (Echo-guard actif lorsque Relais parle)
    this.capture.addEventListener('muted', ((e: CustomEvent<boolean>) => {
      this.setEchoGuard(e.detail);
    }) as EventListener);
  }

  /**
   * Active ou désactive l'Echo-guard : bloque l'envoi de paquets audio pendant le TTS
   */
  public setEchoGuard(isMuted: boolean) {
    this.isEchoGuarded = isMuted;
    if (isMuted && this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Notifie le backend VibeVoice pour qu'il sépare le segment de parole
      this.ws.send(JSON.stringify({ type: 'echo_guard', active: true }));
    }
  }

  /**
   * Établit la connexion WebSocket avec le service VibeVoice
   */
  public async connect(): Promise<void> {
    this.isExplicitlyClosed = false;
    this.notifyStatus('connecting');

    try {
      this.ws = new WebSocket(`${this.config.serverUrl}?session_id=${this.sessionId}&sample_rate=${this.config.sampleRate}`);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.notifyStatus('connected');
        this.flushQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            if (data.type === 'transcription' && this.config.onTranscription) {
              this.config.onTranscription({
                sessionId: data.sessionId || this.sessionId,
                segments: data.segments || [],
                text: data.text || '',
                isFinal: !!data.isFinal,
                timestamp: data.timestamp || Date.now(),
              });
            }
          }
        } catch (err) {
          console.warn('[VibeVoice] Erreur de parsing du message reçu:', err);
        }
      };

      this.ws.onerror = (e) => {
        const error = new Error(`Erreur WebSocket VibeVoice: ${e}`);
        if (this.config.onError) this.config.onError(error);
        this.notifyStatus('error');
      };

      this.ws.onclose = () => {
        this.notifyStatus('disconnected');
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (err: any) {
      this.notifyStatus('error');
      if (this.config.onError) this.config.onError(err);
      this.scheduleReconnect();
    }
  }

  /**
   * Envoi d'un chunk audio binaire vers le backend
   */
  private sendAudioChunk(buffer: ArrayBufferLike) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    } else {
      // Mise en mémoire tampon résiliente (max 50 paquets ~ 1 sec) en cas de micro-coupure
      if (this.audioChunkQueue.length < 50) {
        this.audioChunkQueue.push(buffer);
      }
    }
  }

  /**
   * Envoi des chunks accumulés dès reconnexion
   */
  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.audioChunkQueue.length > 0) {
      const chunk = this.audioChunkQueue.shift();
      if (chunk) this.ws.send(chunk);
    }
  }

  /**
   * Reconnexion résiliente avec backoff exponentiel
   */
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.warn('[VibeVoice] Nombre maximum de tentatives de reconnexion atteint. Passage en mode dégradé.');
      return;
    }

    const delay = this.config.reconnectBaseDelayMs * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log(`[VibeVoice] Tentative de reconnexion ${this.reconnectAttempts}...`);
      this.connect();
    }, delay);
  }

  /**
   * Fallback HTTP : Envoi d'un blob audio WAV/PCM complet (ex: pour les notes de réunion terminées)
   */
  public async transcribeHttp(audioBlob: Blob): Promise<VibeVoiceTranscriptionResult> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    formData.append('session_id', this.sessionId);

    const res = await fetch(this.config.httpFallbackUrl, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`HTTP Transcribe error: ${res.statusText}`);
    }

    const data = await res.json();
    return {
      sessionId: data.sessionId || this.sessionId,
      segments: data.segments || [],
      text: data.text || '',
      isFinal: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Déconnexion propre
   */
  public disconnect() {
    this.isExplicitlyClosed = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.audioChunkQueue = [];
    this.notifyStatus('disconnected');
  }

  private notifyStatus(status: 'connecting' | 'connected' | 'disconnected' | 'error') {
    if (this.config.onStatusChange) {
      this.config.onStatusChange(status);
    }
  }
}
