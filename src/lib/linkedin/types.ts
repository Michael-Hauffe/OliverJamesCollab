export type YM = { year: number; month: number | null } | null;
export type Image = { url: string; width: number | null; height: number | null } | null;

export type ProfileData = {
  public_identifier: string | null;
  profile_url: string;
  name: { first: string | null; last: string | null; full: string };
  headline: string | null;
  location: string | null;
  about: string | null;
  profile_image: Image;
  background_image: Image;
  experience: {
    title: string | null;
    company: { name: string | null; linkedin_url: string | null };
    employment_type: string | null;
    location: string | null;
    start_date: YM;
    end_date: YM;
    is_current: boolean;
    description: string | null;
  }[];
  education: {
    school: string | null;
    degree: string | null;
    field_of_study: string | null;
    start_date: YM;
    end_date: YM;
    description: string | null;
    grade: string | null;
  }[];
  skills: { name: string; endorsement_count: number | null }[];
  certifications: {
    name: string | null;
    issuer: string | null;
    issued_at: YM;
    expires_at: YM;
    credential_id: string | null;
    credential_url: string | null;
  }[];
  languages: { name: string; proficiency: string | null }[];
};

export type ProfilePayload = {
  data: ProfileData;
  meta: {
    source: string;
    completeness: number;
    successful_sections: string[];
    failed_sections: string[];
    warnings: string[];
    cached: boolean;
    fetched_at: string;
  };
};

export type ScrapeErrorCode =
  | "missing_cookie"
  | "session_required"
  | "invalid_cookie"
  | "invalid_url"
  | "profile_not_found"
  | "linkedin_session_expired"
  | "linkedin_rate_limited"
  | "linkedin_challenge"
  | "linkedin_timeout"
  | "linkedin_schema_changed"
  | "linkedin_upstream_error"
  | "internal_error";

export type Result<T> = { ok: true; value: T } | { ok: false; code: ScrapeErrorCode; message: string };
