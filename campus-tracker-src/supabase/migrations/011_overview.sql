-- Overview module: store the score breakdown of each rules-engine recommendation so "View reasoning" can show it.
alter table public.ai_recommendations add column if not exists score_breakdown jsonb not null default '{}';
