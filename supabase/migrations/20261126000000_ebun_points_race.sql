-- 30 Days of SPF with Ebun Derma: no 25-day minimum. The finish line is
-- all 30 days, and the rewards go to the top 12 by points (10 per day both
-- routines are completed), whether or not they finish all 30.
--
-- The leaderboard already ranks this way: challenge_ranking orders by
-- days_completed (points = days x 10), ties going to whoever got there
-- first. So only the target and the copy change.
--
--   target_days 25 -> 30: "completed" status and the full-challenge award
--   now need all 30 days (half award at 15). Nobody is near 25 yet (the
--   challenge started yesterday), so no status needs recounting.
--
-- Ship order: either order works. The current app shows "goal 30" and,
-- for anyone who joins late or misses a day, a "too late to complete"
-- notice that doesn't fit a points race; the app update that ships with
-- this hides that for challenges whose target is their full length.

update challenges set
  target_days = 30,
  description = 'For the next 30 days, we''re challenging you to stay consistent with your skincare routine and make sunscreen a daily habit.'
    || E'\n\n' || 'Your goal is to complete both your morning and night skincare routines every day and log them on Tracka+.'
    || E'\n\n' || 'Every day you complete both routines earns 10 points. The 12 participants with the most points at the end win the rewards.'
    || E'\n\n' || 'Missed a day? Don''t give up. Pick up where you left off and keep going.',
  how_it_works = jsonb_build_array(
    jsonb_build_object('title', 'Follow your routines',
      'body', 'Complete your morning and night skincare routines every day. Remember, sunscreen is an essential part of your morning routine.'),
    jsonb_build_object('title', 'Track your progress',
      'body', 'Mark your morning and night routines as complete on Tracka+. Your challenge progress updates automatically.'),
    jsonb_build_object('title', 'Collect points',
      'body', 'Each day you complete BOTH routines earns 10 points. The top 12 on the leaderboard when the challenge ends win.')
  ),
  rewards = 'A sunscreen from Ebun Derma plus additional goodies for the top 12 participants on the Tracka+ leaderboard (most points).'
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e01';

update ad_placements set
  body = 'Complete both routines each day to earn points. Top 12 win an Ebun Derma sunscreen plus goodies.'
where id = 'e8d0a5f1-3c2b-4d7e-9a61-2f5b8c4d0e14';
