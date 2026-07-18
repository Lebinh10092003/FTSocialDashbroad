import type { UserRole } from '../../types';

export type ExaminationPage = 'overview' | 'competitions' | 'sessions' | 'candidates' | 'classes' | 'import' | 'competition-detail' | 'session-detail' | 'candidate-detail';
export type DraftDate = { day: string; month: string; year: string; planned: boolean; unknown: boolean };
export type ExaminationSession = { id: string; competitionId?: string; code: string; name: string; parent: string; organizer: string; time: string; candidates: number; national: string; nationalDate?: string; international: string; internationalDate?: string; phase: string; note: string };
export type Candidate = { code: string; name: string; school: string; className: string; city: string; contests: string; achievement: string; updated: string; email: string; parent: string; phone: string; identity: string; address: string };
export type Competition = { id: string; code: string; name: string; organizer: string; parent: string };
export interface ExaminationModuleProps { onBackToWorkspace: () => void; onAccountClick: () => void; userName?: string | null; userEmail?: string | null; idToken?: string | null; userRole: UserRole; isGuest: boolean; }
export type CreateStep = 'choice' | 'competition' | 'ask' | 'session';