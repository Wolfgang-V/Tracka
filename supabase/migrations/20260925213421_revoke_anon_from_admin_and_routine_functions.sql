-- Supabase grants execute to anon and authenticated directly, not only via
-- PUBLIC, so both roles have to be named explicitly.
revoke all on function admin_list_users()                 from public, anon;
revoke all on function admin_suspend_user(uuid, boolean)  from public, anon;
revoke all on function admin_delete_user(uuid)            from public, anon;
revoke all on function create_routine(text, jsonb, jsonb) from public, anon;

grant execute on function admin_list_users()                 to authenticated;
grant execute on function admin_suspend_user(uuid, boolean)  to authenticated;
grant execute on function admin_delete_user(uuid)            to authenticated;
grant execute on function create_routine(text, jsonb, jsonb) to authenticated;;
