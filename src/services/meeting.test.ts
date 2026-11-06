import test from 'node:test';
import assert from 'node:assert/strict';
import { MeetingService, formatTime, MeetingSession } from './meeting';

test('formatTime correctly formats seconds into mm:ss and hh:mm:ss', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(45), '00:45');
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(3600), '01:00:00');
  assert.equal(formatTime(3665), '01:01:05');
});

test('MeetingService creates a new session with default speakers', () => {
  const session = MeetingService.createSession('Test Meeting');
  assert.equal(session.title, 'Test Meeting');
  assert.equal(session.status, 'idle');
  assert.ok(session.speakers.length >= 2);
  assert.equal(session.utterances.length, 0);
  assert.equal(session.notes, null);
});

test('MeetingService adds utterances and updates duration', () => {
  const session = MeetingService.createSession('Standup');
  const utterance = {
    id: 'u1',
    speakerId: session.speakers[0].id,
    speakerName: session.speakers[0].name,
    text: 'Good morning everyone, let us discuss sprint tasks.',
    timestamp: 1000,
    startTime: 2,
    endTime: 8,
    lang: 'en' as const,
  };

  const updated = MeetingService.addUtterance(session, utterance);
  assert.equal(updated.utterances.length, 1);
  assert.equal(updated.utterances[0].text, utterance.text);
  assert.equal(updated.durationSeconds, 8);
});

test('MeetingService sample demo session contains realistic dialogue', () => {
  const sample = MeetingService.getSampleMeeting();
  assert.ok(sample.speakers.length >= 3);
  assert.ok(sample.utterances.length >= 4);
  assert.ok(sample.title.length > 0);
  // Ensure speaker attribution
  const speakerIds = new Set(sample.speakers.map((s) => s.id));
  for (const u of sample.utterances) {
    assert.ok(speakerIds.has(u.speakerId), `Utterance has valid speakerId: ${u.speakerId}`);
  }
});

test('MeetingService fallback note generator extracts summary, actions and decisions', async () => {
  const sample = MeetingService.getSampleMeeting();
  const notes = await MeetingService.fallbackGenerateNotes(sample);

  assert.ok(notes.summary.length > 0, 'Summary is generated');
  assert.ok(notes.keyPoints.length > 0, 'Key points extracted');
  assert.ok(notes.actionItems.length > 0, 'Action items detected');
  assert.ok(notes.decisions.length > 0, 'Decisions detected');
  assert.ok(notes.tags.length > 0, 'Tags extracted');
  assert.ok(notes.generatedAt > 0);
});

test('MeetingService Markdown and TXT exports generate readable content', () => {
  const sample = MeetingService.getSampleMeeting();
  const md = MeetingService.exportMarkdown(sample);
  const txt = MeetingService.exportTxt(sample);

  assert.ok(md.includes('# ' + sample.title), 'Markdown contains title header');
  assert.ok(md.includes('Transcription'), 'Markdown includes transcript section');
  assert.ok(txt.includes('RÉUNION : ' + sample.title), 'TXT contains header');
  assert.ok(txt.includes('TRANSCRIPTION :'), 'TXT contains transcript section');
});
