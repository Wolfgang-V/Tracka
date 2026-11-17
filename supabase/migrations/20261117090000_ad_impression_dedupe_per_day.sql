-- Reviewer: an impression at 23:50 and a click at 00:05 put the click on
-- the new day with no impression behind it (the impression re-sent with the
-- click was swallowed by the 30-minute window, which straddles midnight).
-- That day then reads one clicker, nobody reached.
--
-- Impression dedupe now also requires the same Lagos day, so every person
-- who clicks on a day has an impression that day — clickers ⊆ reach per day,
-- as ad_campaign_report assumes. Costs at most one extra impression row per
-- person per day. Everything else in record_ad_event is unchanged.
-- (The console separately caps CTR at 100% and shows "—" with no reach, for
-- rows recorded before this.)

create or replace function record_ad_event(p_placement_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign ad_campaigns%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_window interval;
begin
  if auth.uid() is null then
    return;
  end if;
  if p_event not in ('impression', 'click', 'challenge_join', 'guide_complete') then
    raise exception 'Unknown ad event';
  end if;

  select c.* into v_campaign
  from ad_placements p join ad_campaigns c on c.id = p.campaign_id
  where p.id = p_placement_id;
  if not found then
    return;
  end if;

  if p_event in ('impression', 'click') then
    if v_campaign.status <> 'active' or v_today not between v_campaign.starts_on and v_campaign.ends_on then
      return;
    end if;
  elsif v_today > v_campaign.ends_on + 7 then
    return;
  end if;

  v_window := case p_event
    when 'impression' then interval '30 minutes'
    when 'click' then interval '1 minute'
    else interval '100 years'   -- conversions: once per person per ad
  end;

  if exists (
    select 1 from ad_events e
    where e.user_id = auth.uid()
      and e.placement_id = p_placement_id
      and e.event = p_event
      and e.created_at > now() - v_window
      and (p_event <> 'impression' or e.local_date = v_today)
  ) then
    return;
  end if;

  insert into ad_events (placement_id, campaign_id, user_id, event, local_date)
  values (p_placement_id, v_campaign.id, auth.uid(), p_event, v_today);
end;
$$;

revoke all on function record_ad_event(uuid, text) from public, anon;
grant execute on function record_ad_event(uuid, text) to authenticated;
