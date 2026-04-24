/**
 * Strava API Types
 * Based on Strava API v3 documentation
 */

export interface StravaAthlete {
  id: number;
  username: string;
  resource_state: number;
  firstname: string;
  lastname: string;
  bio: string;
  city: string;
  state: string;
  country: string;
  sex: string;
  premium: boolean;
  summit: boolean;
  created_at: string;
  updated_at: string;
  badge_type_id: number;
  weight: number;
  profile_medium: string;
  profile: string;
  friend: null | string;
  follower: null | string;
}

export interface StravaTokenResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete: StravaAthlete;
}

export interface StravaActivity {
  id: number;
  resource_state: number;
  external_id: string;
  upload_id: number;
  athlete: {
    id: number;
    resource_state: number;
  };
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  type: ActivityType;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  timezone: string;
  utc_offset: number;
  achievement_count: number;
  kudos_count: number;
  comment_count: number;
  athlete_count: number;
  photo_count: number;
  map: {
    id: string;
    summary_polyline: string;
    resource_state: number;
  };
  trainer: boolean;
  commute: boolean;
  manual: boolean;
  private: boolean;
  visibility: string;
  flagged: boolean;
  gear_id: string;
  average_speed: number;
  max_speed: number;
  average_watts?: number;
  kilojoules?: number;
  device_watts?: boolean;
  has_heartrate: boolean;
  average_heartrate?: number;
  max_heartrate?: number;
  heartrate_opt_out: boolean;
  display_hide_heartrate_option: boolean;
  elev_high?: number;
  elev_low?: number;
  pr_count: number;
  total_photo_count: number;
  has_kudoed: boolean;
}

export type ActivityType =
  | 'Run'
  | 'Ride'
  | 'Swim'
  | 'Hike'
  | 'Walk'
  | 'AlpineSki'
  | 'BackcountrySki'
  | 'Canoeing'
  | 'Crossfit'
  | 'EBikeRide'
  | 'Elliptical'
  | 'Golf'
  | 'Handcycle'
  | 'IceSkate'
  | 'InlineSkate'
  | 'Kayaking'
  | 'Kitesurf'
  | 'NordicSki'
  | 'RockClimbing'
  | 'RollerSki'
  | 'Rowing'
  | 'Sail'
  | 'Skateboard'
  | 'Snowboard'
  | 'Snowshoe'
  | 'Soccer'
  | 'StairStepper'
  | 'StandUpPaddling'
  | 'Surfing'
  | 'VirtualRide'
  | 'VirtualRun'
  | 'WeightTraining'
  | 'Wheelchair'
  | 'Windsurf'
  | 'Workout'
  | 'Yoga';

export interface StravaStats {
  biggest_ride_distance: number;
  biggest_climb_elevation_gain: number;
  recent_ride_totals: ActivityTotals;
  recent_run_totals: ActivityTotals;
  recent_swim_totals: ActivityTotals;
  ytd_ride_totals: ActivityTotals;
  ytd_run_totals: ActivityTotals;
  ytd_swim_totals: ActivityTotals;
  all_ride_totals: ActivityTotals;
  all_run_totals: ActivityTotals;
  all_swim_totals: ActivityTotals;
}

export interface ActivityTotals {
  count: number;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  elevation_gain: number;
  achievement_count?: number;
}

export interface StravaSegment {
  id: number;
  name: string;
  activity_type: string;
  distance: number;
  average_grade: number;
  maximum_grade: number;
  elevation_high: number;
  elevation_low: number;
  climb_category: number;
  city: string;
  state: string;
  country: string;
}

export interface StravaSegmentEffort {
  id: number;
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  start_date_local: string;
  distance: number;
  pr_rank: number | null;
  segment: StravaSegment;
  achievements?: Array<{
    type: string;
    type_id: number;
    rank?: number;
  }>;
}

// Strava best effort entry (present on DetailedActivity when type === 'Run').
// `name` uses Strava's labels: '400m', '1/2 mile', '1K', '1 mile', '2 mile',
// '5K', '10K', '15K', '10 mile', '20K', 'Half-Marathon', '30K', 'Marathon'.
export interface StravaBestEffort {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  start_date: string;
  start_date_local: string;
  pr_rank: number | null;
}

export interface StravaDetailedActivity extends StravaActivity {
  segment_efforts?: StravaSegmentEffort[];
  best_efforts?: StravaBestEffort[];
  calories?: number;
  description?: string;
  device_name?: string;
  embed_token?: string;
  suffer_score?: number;
  average_cadence?: number;
  average_temp?: number;
  weighted_average_watts?: number;
  max_watts?: number;
  laps?: StravaLap[];
  photos?: {
    primary?: {
      urls?: Record<string, string>;
    } | null;
    count?: number;
  };
}

export interface StravaLap {
  id: number;
  activity: { id: number };
  athlete: { id: number };
  average_cadence?: number;
  average_speed: number;
  distance: number;
  elapsed_time: number;
  start_index: number;
  end_index: number;
  lap_index: number;
  max_speed: number;
  moving_time: number;
  name: string;
  pace_zone?: number;
  split: number;
  start_date: string;
  start_date_local: string;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
}

export type StravaStreamType =
  | 'time'
  | 'distance'
  | 'latlng'
  | 'altitude'
  | 'velocity_smooth'
  | 'heartrate'
  | 'cadence'
  | 'watts'
  | 'temp'
  | 'moving'
  | 'grade_smooth';

export interface StravaStream<T = number> {
  type: StravaStreamType;
  data: T[];
  series_type: 'distance' | 'time';
  original_size: number;
  resolution: 'low' | 'medium' | 'high';
}

export interface StravaSummaryAthlete {
  id: number;
  firstname: string;
  lastname: string;
  profile?: string;
  profile_medium?: string;
  resource_state?: number;
}

export interface StravaComment {
  id: number;
  activity_id: number;
  text: string;
  created_at: string;
  athlete: StravaSummaryAthlete;
}

export interface StravaPhoto {
  id: number | null;
  unique_id: string;
  urls: Record<string, string>;
  source: number;
  activity_id: number;
  activity_name?: string;
  post_id?: number | null;
  resource_state: number;
  caption?: string | null;
  type?: string;
  uploaded_at?: string;
  created_at?: string;
  created_at_local?: string;
  sizes?: Record<string, [number, number]>;
  default_photo?: boolean;
  location?: [number, number] | null;
}

export type StravaStreamSet = Partial<{
  time: StravaStream<number>;
  distance: StravaStream<number>;
  latlng: StravaStream<[number, number]>;
  altitude: StravaStream<number>;
  velocity_smooth: StravaStream<number>;
  heartrate: StravaStream<number>;
  cadence: StravaStream<number>;
  watts: StravaStream<number>;
  temp: StravaStream<number>;
  moving: StravaStream<boolean>;
  grade_smooth: StravaStream<number>;
}>;
