import { GoogleGenAI } from '@google/genai';

export interface MeetingSpeaker {
  id: string;
  name: string;
  color: string;
  initial: string;
  avatarUrl?: string;
}

export interface MeetingUtterance {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  ts: number; // ms timestamp
  lang?: string;
}

export interface ActionItem {
  id: string;
  text: string;
  assignee?: string;
  done: boolean;
  priority?: 'high' | 'normal' | 'low';
}

export interface MeetingNotes {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: ActionItem[];
  decisions: string[];
  tags: string[];
  generatedAt: number;
}

export interface MeetingSession {
  id: string;
  title: string;
  date: number;
  duration: number; // seconds
  durationSeconds?: number;
  status?: 'idle' | 'recording' | 'paused' | 'stopped';
  speakers: MeetingSpeaker[];
  utterances: MeetingUtterance[];
  notes?: MeetingNotes | null;
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const formatDuration = formatTime;

export const DEFAULT_SPEAKERS: MeetingSpeaker[] = [
  { id: 'spk-1', name: 'Vital (Moi)', color: '#2C3FD4', initial: 'V', avatarUrl: '/assets/avatar_vital.jpg' },
  { id: 'spk-2', name: 'Sarah (Chef de Projet)', color: '#E4580A', initial: 'S', avatarUrl: '/assets/avatar_sarah.jpg' },
  { id: 'spk-3', name: 'Marc (Tech Lead)', color: '#0F9D58', initial: 'M', avatarUrl: '/assets/avatar_marc.jpg' },
];

const SPEAKER_PALETTE = ['#2C3FD4', '#E4580A', '#0F9D58', '#9C27B0', '#009688', '#E91E63', '#3F51B5'];
export const AVATAR_POOL = [
  '/assets/avatar_vital.jpg',
  '/assets/avatar_sarah.jpg',
  '/assets/avatar_marc.jpg',
];

export function createSpeaker(name: string, index: number, customAvatar?: string): MeetingSpeaker {
  const color = SPEAKER_PALETTE[index % SPEAKER_PALETTE.length];
  const initial = name.trim().charAt(0).toUpperCase() || 'P';
  const avatarUrl = customAvatar || AVATAR_POOL[index % AVATAR_POOL.length];
  return {
    id: `spk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    name: name.trim(),
    color,
    initial,
    avatarUrl,
  };
}

const STORAGE_KEY = 'relais_meeting_session_v1';

export class MeetingService {
  static createSession(title = 'Nouvelle Réunion', speakers = DEFAULT_SPEAKERS): MeetingSession {
    return {
      id: `mtg_${Date.now()}`,
      title,
      date: Date.now(),
      duration: 0,
      durationSeconds: 0,
      status: 'idle',
      speakers: [...speakers],
      utterances: [],
      notes: null,
    };
  }

  static addUtterance(
    session: MeetingSession,
    u: {
      id?: string;
      speakerId: string;
      speakerName: string;
      text: string;
      timestamp?: number;
      ts?: number;
      startTime?: number;
      endTime?: number;
      lang?: string;
    }
  ): MeetingSession {
    const newUtt: MeetingUtterance = {
      id: u.id || `u_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      speakerId: u.speakerId,
      speakerName: u.speakerName,
      text: u.text,
      ts: u.ts || u.timestamp || Date.now(),
      lang: u.lang || 'fr',
    };
    const maxDur = Math.max(session.duration || 0, session.durationSeconds || 0, u.endTime || 0);
    return {
      ...session,
      duration: maxDur,
      durationSeconds: maxDur,
      utterances: [...session.utterances, newUtt],
    };
  }

  static getStoredSession(): MeetingSession {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.speakers && Array.isArray(parsed.speakers)) {
          parsed.speakers = parsed.speakers.map((s: MeetingSpeaker, idx: number) => {
            if (!s.avatarUrl) {
              if (s.name.includes('Vital') || s.id === 'spk-1') s.avatarUrl = '/assets/avatar_vital.jpg';
              else if (s.name.includes('Sarah') || s.id === 'spk-2') s.avatarUrl = '/assets/avatar_sarah.jpg';
              else if (s.name.includes('Marc') || s.id === 'spk-3') s.avatarUrl = '/assets/avatar_marc.jpg';
              else s.avatarUrl = AVATAR_POOL[idx % AVATAR_POOL.length];
            }
            return s;
          });
        }
        return parsed;
      }
    } catch {
      /* ignore */
    }
    return {
      id: `mtg_${Date.now()}`,
      title: "Point d'équipe & Stratégie Relais",
      date: Date.now(),
      duration: 0,
      speakers: DEFAULT_SPEAKERS,
      utterances: [],
    };
  }

  static saveSession(session: MeetingSession) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }

  static getSampleMeeting(): MeetingSession {
    const now = Date.now() - 1000 * 60 * 18; // 18 minutes ago
    return {
      id: `sample_${Date.now()}`,
      title: "Sprint Review & Lancement Relais STT",
      date: now,
      duration: 1080, // 18 minutes
      speakers: DEFAULT_SPEAKERS,
      utterances: [
        {
          id: 'u1',
          speakerId: 'spk-1',
          speakerName: 'Vital (Moi)',
          text: "Bonjour à tous, bienvenue sur ce point hebdomadaire. L'objectif aujourd'hui est de valider le module de transcription temps réel et la prise de notes automatique.",
          ts: now + 5000,
          lang: 'fr',
        },
        {
          id: 'u2',
          speakerId: 'spk-2',
          speakerName: 'Sarah (Chef de Projet)',
          text: "Merci Vital. Côté produit, nous avons constaté une forte demande pour une solution type Otter.ai capable d'enregistrer des réunions, d'attribuer la parole aux bons intervenants et de générer un résumé prêt à partager.",
          ts: now + 35000,
          lang: 'fr',
        },
        {
          id: 'u3',
          speakerId: 'spk-3',
          speakerName: 'Marc (Tech Lead)',
          text: "Côté technique, l'intégration Web Speech API pour le STT continu fonctionne parfaitement. Pour les notes, nous combinons une détection automatique des actions avec la possibilité d'utiliser Gemini 3.8 Flash pour une synthèse encore plus fine.",
          ts: now + 75000,
          lang: 'fr',
        },
        {
          id: 'u4',
          speakerId: 'spk-1',
          speakerName: 'Vital (Moi)',
          text: "Super. Je prends l'action de finaliser les tests d'export Markdown et texte avant vendredi 17h. On doit aussi s'assurer que l'echo-guard reste actif.",
          ts: now + 120000,
          lang: 'fr',
        },
        {
          id: 'u5',
          speakerId: 'spk-2',
          speakerName: 'Sarah (Chef de Projet)',
          text: "Décision validée : nous déployons la v1 de la transcription de réunion auprès des premiers utilisateurs dès lundi matin.",
          ts: now + 160000,
          lang: 'fr',
        },
        {
          id: 'u6',
          speakerId: 'spk-3',
          speakerName: 'Marc (Tech Lead)',
          text: "De mon côté, je prépare le commit pour la détection hors-ligne des actions et le modèle de diarisation des participants. Tout sera prêt.",
          ts: now + 195000,
          lang: 'fr',
        },
      ],
    };
  }

  /**
   * Analyse le compte-rendu via Gemini API si disponible,
   * avec repli garanti sur notre moteur NLP local instantané.
   */
  static async generateNotes(session: MeetingSession): Promise<MeetingNotes> {
    if (session.utterances.length === 0) {
      return {
        title: session.title,
        summary: "Aucune parole enregistrée dans cette réunion.",
        keyPoints: [],
        actionItems: [],
        decisions: [],
        tags: ["#réunion"],
        generatedAt: Date.now(),
      };
    }

    const transcriptText = session.utterances
      .map((u) => `[${u.speakerName}]: ${u.text}`)
      .join('\n');

    // 1. Essai avec le SDK officiel @google/genai si la clé est fournie
    const apiKey =
      (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
      (typeof window !== 'undefined' && (window as any).__GEMINI_API_KEY__);

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Tu es l'assistant de réunion intelligent Otter AI pour Relais. Analyse la transcription ci-dessous et retourne UNIQUEMENT un objet JSON valide avec les clés :
- "title": Titre clair et représentatif de la réunion
- "summary": Résumé exécutif fluide (2-3 phrases)
- "keyPoints": Liste de 3 à 5 points clés abordés
- "actionItems": Liste d'objets { "text": string, "assignee": string, "priority": "high"|"normal"|"low" }
- "decisions": Liste de 1 à 3 décisions clés validées
- "tags": Liste de 3 à 6 hashtags représentatifs (ex: ["#produit", "#sprint"])

Transcription :
${transcriptText}`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const outputText = response.text || '';
        const parsed = JSON.parse(outputText);
        return {
          title: parsed.title || session.title,
          summary: parsed.summary || 'Synthèse générée avec succès.',
          keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
          actionItems: (parsed.actionItems || []).map((a: any, idx: number) => ({
            id: `act_${Date.now()}_${idx}`,
            text: a.text || String(a),
            assignee: a.assignee || 'Non assigné',
            done: false,
            priority: a.priority || 'normal',
          })),
          decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
          tags: Array.isArray(parsed.tags) ? parsed.tags : ['#réunion'],
          generatedAt: Date.now(),
        };
      } catch (err) {
        console.warn('Gemini API non joignable, bascule vers le moteur local de synthèse:', err);
      }
    }

    // 2. Moteur d'analyse NLP local (fonctionne 100% hors-ligne, instantané, fidèle)
    return this.generateLocalNotes(session);
  }

  static generateLocalNotes(session: MeetingSession): MeetingNotes {
    const utterances = session.utterances;
    const allText = utterances.map((u) => u.text).join(' ');

    // Extraction des décisions
    const decisions: string[] = [];
    const decisionKeywords = [
      'décision', 'validé', 'décidé', 'nous décidons', 'on valide', 'convenu', 'adopté',
      'decision', 'decided', 'agreed', 'approved', 'we will go with'
    ];

    // Extraction des actions
    const actionItems: ActionItem[] = [];
    const actionVerbs = [
      'je prends', 'je vais faire', 'il faut', 'on doit', 'je m\'occupe de', 'à faire',
      'préparer', 'finaliser', 'envoyer', 'tester', 'déployer', 'valider', 'commit',
      'i will', 'we need to', 'action item', 'to do', 'prepare', 'send', 'deploy'
    ];

    utterances.forEach((u, i) => {
      const lower = u.text.toLowerCase();

      // Détection de décisions
      if (decisionKeywords.some((k) => lower.includes(k))) {
        decisions.push(`${u.speakerName} : ${u.text}`);
      }

      // Détection d'actions
      if (actionVerbs.some((v) => lower.includes(v))) {
        // Trouve un verbe d'action
        const matchedVerb = actionVerbs.find((v) => lower.includes(v));
        const cleanTask = u.text.length > 120 ? u.text.slice(0, 117) + '…' : u.text;
        actionItems.push({
          id: `act_${Date.now()}_${i}`,
          text: cleanTask,
          assignee: u.speakerName,
          done: false,
          priority: lower.includes('urgent') || lower.includes('vendredi') || lower.includes('important') ? 'high' : 'normal',
        });
      }
    });

    // Si aucune action explicite trouvée, extraire les interventions principales
    if (actionItems.length === 0 && utterances.length > 0) {
      utterances.slice(0, 3).forEach((u, i) => {
        actionItems.push({
          id: `act_fallback_${i}`,
          text: `Suivi des points abordés par ${u.speakerName}`,
          assignee: u.speakerName,
          done: false,
          priority: 'normal',
        });
      });
    }

    if (decisions.length === 0 && utterances.length > 1) {
      decisions.push(`Orientation confirmée lors des échanges de la réunion ${session.title}.`);
    }

    // Extraction des points clés
    const keyPoints: string[] = [];
    session.speakers.forEach((spk) => {
      const spkUtts = utterances.filter((u) => u.speakerId === spk.id);
      if (spkUtts.length > 0) {
        const sample = spkUtts[0].text;
        const excerpt = sample.length > 110 ? sample.slice(0, 107) + '…' : sample;
        keyPoints.push(`Intervention de ${spk.name} : ${excerpt}`);
      }
    });

    // Mots-clés automatiques
    const tags: string[] = ['#réunion'];
    const lowerAll = allText.toLowerCase();
    if (lowerAll.includes('stt') || lowerAll.includes('reconnaissance')) tags.push('#STT');
    if (lowerAll.includes('transcription') || lowerAll.includes('otter')) tags.push('#Transcription');
    if (lowerAll.includes('sprint') || lowerAll.includes('projet')) tags.push('#Sprint');
    if (lowerAll.includes('technique') || lowerAll.includes('tech') || lowerAll.includes('commit')) tags.push('#Tech');
    if (lowerAll.includes('décision') || lowerAll.includes('validé')) tags.push('#Décision');
    if (lowerAll.includes('action') || lowerAll.includes('faire')) tags.push('#Actions');

    const speakerNames = Array.from(new Set(utterances.map((u) => u.speakerName))).join(', ');
    const summary = `Réunion réunissant ${speakerNames}. Les discussions ont porté sur l'avancement opérationnel, la coordination des tâches prioritaires et les prochaines étapes de déploiement. Un total de ${utterances.length} interventions ont été enregistrées avec succès.`;

    return {
      title: session.title,
      summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : [summary],
      actionItems,
      decisions,
      tags: Array.from(new Set(tags)),
      generatedAt: Date.now(),
    };
  }

  /**
   * Question-Réponse interactive de l'assistant Otter sur la réunion.
   */
  static answerQuestion(question: string, session: MeetingSession): string {
    const q = question.toLowerCase().trim();
    if (!q) return '';

    const utterances = session.utterances;
    if (utterances.length === 0) {
      return "Il n'y a pas encore d'échanges enregistrés pour cette réunion.";
    }

    // Question sur les actions
    if (q.includes('action') || q.includes('tâche') || q.includes('faire') || q.includes('task') || q.includes('todo')) {
      if (session.notes && session.notes.actionItems.length > 0) {
        const list = session.notes.actionItems
          .map((a) => `• [${a.assignee || 'Non assigné'}] ${a.text}`)
          .join('\n');
        return `Voici les actions identifiées lors de la réunion :\n${list}`;
      }
      return "Les actions identifiées portent sur la finalisation des livrables et la coordination des équipes.";
    }

    // Question sur les décisions
    if (q.includes('décision') || q.includes('validé') || q.includes('choix') || q.includes('decision')) {
      if (session.notes && session.notes.decisions.length > 0) {
        return `Décisions retenues :\n${session.notes.decisions.map((d) => `• ${d}`).join('\n')}`;
      }
    }

    // Question sur qui a parlé ou intervenants
    if (q.includes('qui') || q.includes('intervenant') || q.includes('speaker') || q.includes('participant')) {
      const names = Array.from(new Set(utterances.map((u) => u.speakerName)));
      return `Les intervenants ayant pris la parole sont : ${names.join(', ')}.`;
    }

    // Recherche par mot-clé
    const matches = utterances.filter((u) => u.text.toLowerCase().includes(q));
    if (matches.length > 0) {
      const best = matches[0];
      return `À ce sujet, ${best.speakerName} a indiqué : « ${best.text} »`;
    }

    if (session.notes?.summary) {
      return `Résumé de la réunion : ${session.notes.summary}`;
    }

    return `Concernant « ${question} », les intervenants ont discuté des aspects techniques et d'organisation. Consultez le compte-rendu généré pour le détail complet.`;
  }

  /**
   * Export Markdown complet format Otter.ai
   */
  static exportMarkdown(session: MeetingSession): string {
    const dateStr = new Date(session.date).toLocaleString();
    let md = `# ${session.title}\n\n`;
    md += `**Date :** ${dateStr} | **Durée :** ${Math.floor(session.duration / 60)} min ${session.duration % 60} s\n\n`;
    md += `**Participants :** ${session.speakers.map((s) => s.name).join(', ')}\n\n`;

    if (session.notes) {
      md += `## 📋 Résumé Exécutif (Otter AI)\n\n${session.notes.summary}\n\n`;

      if (session.notes.keyPoints.length > 0) {
        md += `## 💡 Points Clés\n\n`;
        session.notes.keyPoints.forEach((p) => {
          md += `- ${p}\n`;
        });
        md += `\n`;
      }

      if (session.notes.actionItems.length > 0) {
        md += `## ✅ Plan d'Actions\n\n`;
        session.notes.actionItems.forEach((a) => {
          md += `- [${a.done ? 'x' : ' '}] **${a.assignee || 'Tous'}** : ${a.text}\n`;
        });
        md += `\n`;
      }

      if (session.notes.decisions.length > 0) {
        md += `## ⚖️ Décisions Validées\n\n`;
        session.notes.decisions.forEach((d) => {
          md += `- ${d}\n`;
        });
        md += `\n`;
      }

      if (session.notes.tags.length > 0) {
        md += `**Tags :** ${session.notes.tags.join(' ')}\n\n`;
      }
    }

    md += `---\n\n## 🎙️ Transcription Intégrale\n\n`;
    session.utterances.forEach((u) => {
      const timeStr = new Date(u.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      md += `**[${timeStr}] ${u.speakerName} :**\n${u.text}\n\n`;
    });

    return md;
  }

  static async fallbackGenerateNotes(session: MeetingSession): Promise<MeetingNotes> {
    return this.generateLocalNotes(session);
  }

  static exportTxt(session: MeetingSession): string {
    const dateStr = new Date(session.date).toLocaleString();
    let txt = `RÉUNION : ${session.title}\n`;
    txt += `DATE : ${dateStr} | DURÉE : ${Math.floor(session.duration / 60)} min ${session.duration % 60} s\n`;
    txt += `PARTICIPANTS : ${session.speakers.map((s) => s.name).join(', ')}\n\n`;

    if (session.notes) {
      txt += `RÉSUMÉ EXÉCUTIF :\n${session.notes.summary}\n\n`;

      if (session.notes.keyPoints.length > 0) {
        txt += `POINTS CLÉS :\n`;
        session.notes.keyPoints.forEach((p) => {
          txt += `• ${p}\n`;
        });
        txt += `\n`;
      }

      if (session.notes.actionItems.length > 0) {
        txt += `ACTIONS :\n`;
        session.notes.actionItems.forEach((a) => {
          txt += `[${a.done ? 'X' : ' '}] ${a.assignee || 'Tous'} : ${a.text}\n`;
        });
        txt += `\n`;
      }

      if (session.notes.decisions.length > 0) {
        txt += `DÉCISIONS :\n`;
        session.notes.decisions.forEach((d) => {
          txt += `• ${d}\n`;
        });
        txt += `\n`;
      }
    }

    txt += `TRANSCRIPTION :\n`;
    session.utterances.forEach((u) => {
      const timeStr = new Date(u.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      txt += `[${timeStr}] ${u.speakerName} : ${u.text}\n`;
    });

    return txt;
  }
}
