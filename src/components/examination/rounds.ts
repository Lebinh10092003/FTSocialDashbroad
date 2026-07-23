import type { ExaminationSession, SessionRound } from './types';

export function sessionRounds(session: ExaminationSession): SessionRound[] {
  const configured = (session.rounds || []).filter(round => String(round.name || '').trim());
  if (configured.length) return configured;
  const hasLegacyRounds = Boolean(session.national || session.nationalDate || session.international || session.internationalDate);
  if (!hasLegacyRounds) return [];
  return [
    { id: 'legacy-national', name: 'Vòng Chung kết Quốc gia', label: session.national || '', date: session.nationalDate || '' },
    { id: 'legacy-international', name: 'Vòng Chung kết Quốc tế', label: session.international || '', date: session.internationalDate || '' },
  ];
}