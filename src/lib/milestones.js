// Streak lengths worth celebrating. Kept apart from shareImage.js so the
// app can check for a milestone without loading the image generator,
// which is only fetched when someone actually shares.
export const MILESTONES = [7, 14, 30, 60, 90, 100, 180, 365]

export function isMilestoneStreak(streak) {
  return MILESTONES.includes(streak)
}
