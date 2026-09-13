begin;

-- Review-event notifications and admin timelines frequently traverse these
-- relations. Cover the foreign keys flagged by the database advisor without
-- broad, speculative indexing of unrelated platform tables.
create index if not exists application_review_events_review_task_idx
  on public.application_review_events (review_task_id)
  where review_task_id is not null;

create index if not exists application_review_events_reviewer_idx
  on public.application_review_events (reviewer_user_id)
  where reviewer_user_id is not null;

commit;
