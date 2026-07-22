import { CalendarDays, GraduationCap, Handshake, LayoutDashboard, Trophy, UploadCloud, Users } from 'lucide-react';
import type { Candidate, Competition, ExaminationPage, ExaminationSession } from './types';

export const initialSessions: ExaminationSession[] = [
  { id: 'aysbc', code: 'AYSBC', name: 'Huy hi?u c?c Nh? khoa h?c tr? Ch?u ?', parent: 'AYSBC', organizer: 'SCS v? META Knowledge', time: '', candidates: 0, national: '', international: '', phase: 'Ch?a c?p nh?t', note: '' },
  { id: 'imo', code: 'SIMO', name: 'International Maths Olympiad', parent: 'SCO - IMO', organizer: 'SCO', time: '', candidates: 0, national: '', international: '', phase: 'Ch?a c?p nh?t', note: '' },
  { id: 'ieo', code: 'SIEO', name: 'International English Olympiad', parent: 'SCO - IEO', organizer: 'SCO', time: '', candidates: 0, national: '', international: '', phase: 'Ch?a c?p nh?t', note: '' },
  { id: 'iso', code: 'SISO', name: 'International Science Olympiad', parent: 'SCO - ISO', organizer: 'SCO', time: '', candidates: 0, national: '', international: '', phase: 'Ch?a c?p nh?t', note: '' },
  { id: 'fimo', code: 'FIMO', name: 'FermatTech International Mathematics Olympiad', parent: 'FIMO', organizer: 'FermatTech', time: '', candidates: 0, national: '', international: '', phase: 'Ch?a c?p nh?t', note: '' },
  { id: 'fieo', code: 'FIEO', name: 'FermatTech International English Olympiad', parent: 'FIEO - Ti?ng Anh', organizer: 'FermatTech', time: '', candidates: 0, national: '', international: '', phase: 'Ch?a c?p nh?t', note: '' },
];

export const initialCandidates: Candidate[] = [];
export const initialCompetitions = (): Competition[] => initialSessions.map(({ id, code, name, organizer, parent }) => ({ id, code, name, organizer, parent }));
export const navigationItems: { id: Exclude<ExaminationPage, 'competition-detail' | 'candidate-detail'>; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'T?ng quan', icon: LayoutDashboard },
  { id: 'competitions', label: 'Cu?c thi', icon: Trophy },
  { id: 'sessions', label: 'K? t? ch?c', icon: CalendarDays },
  { id: 'candidates', label: 'Th? sinh', icon: Users },
  { id: 'partners', label: '??i t?c', icon: Handshake },
  { id: 'classes', label: 'L?p ?n t?p', icon: GraduationCap },
  { id: 'import', label: 'Nh?p d? li?u', icon: UploadCloud },
];
