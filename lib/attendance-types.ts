export interface ChurchEvent {
  id: string;
  church_id: string;
  name: string;
  service_type: 'sunday_service' | 'bible_study' | 'prayer_meeting' | 'youth_service';
  event_date: string;
  start_time: string;
  location: string | null;
  status: 'upcoming' | 'active' | 'completed';
  attending_count: number;
  created_at: string;
}

export interface AttendanceLog {
  id: string;
  member_id: string;
  event_id: string;
  attendance_status: AttendanceStatus;
  check_in_time: string;
  notes: string | null;
}

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

export type AttendanceFlagType = 'missed_3_sundays' | 'inactive_30_days';
export type AttendanceFlagStatus = 'open' | 'followed_up' | 'resolved';

export interface AttendanceFlag {
  id: string;
  church_id: string;
  member_id: string;
  flag_type: AttendanceFlagType;
  status: AttendanceFlagStatus;
  notes: string | null;
  created_at: string;
  members?: {
    full_name: string;
    phone_number: string;
  };
}
