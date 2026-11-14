/** Single source of truth for the 30-second UI-only composition scale. */
export const TIMELINE_SECONDS = 30;
export const PX_PER_SECOND = 26;
export const TRACK_LABEL_PX = 88;
export const timelineX = (seconds: number) => TRACK_LABEL_PX + seconds * PX_PER_SECOND;
