-- ============================================================
-- 019 — a buffer may not be longer than the service it follows
--
-- The salon's rule, 2026-08-18: cleanup time must not leave a stylist
-- idle for hours. A 30 minute trim with a 90 minute buffer is not a
-- careful salon, it is a typo — and it is an expensive one, because
-- availability reserves the buffer, so every mistyped minute is a
-- minute the salon cannot sell and nobody is told about.
--
-- The constraint cannot catch every version of this. buffer_minutes is
-- nullable, meaning "use the salon's default_buffer_minutes", and a
-- check constraint sees only the row it is on — it cannot know what
-- that default is. So a house default of 30 minutes still applies in
-- full to a 15 minute service.
--
-- That gap is acceptable: the default is one number, set deliberately,
-- by someone thinking about it. The mistake this guards against is the
-- per-service field, which is twenty-four numbers typed one at a time.
-- ============================================================

alter table public.services
  add constraint services_buffer_not_longer_than_service
  check (
    buffer_minutes   is null
    or duration_minutes is null
    or buffer_minutes <= duration_minutes
  );

comment on constraint services_buffer_not_longer_than_service on public.services is
  'Cleanup time may not exceed the service it follows. Availability reserves the buffer, so an oversized one silently destroys sellable time.';
