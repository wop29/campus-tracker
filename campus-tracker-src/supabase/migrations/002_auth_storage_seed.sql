-- Attach profile creation to Supabase Auth signups
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Private storage bucket; each user can only touch files under their own user-id folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents','documents', false, 26214400, array[
  'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg','image/png'])
on conflict (id) do nothing;
create policy "own files read" on storage.objects for select using (bucket_id='documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files insert" on storage.objects for insert with check (bucket_id='documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files update" on storage.objects for update using (bucket_id='documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files delete" on storage.objects for delete using (bucket_id='documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Seed the research-candidate school list for the calling user. Names, countries and cities only:
-- no statistics are seeded, so nothing here can be wrong or stale. Idempotent. Call: select seed_my_schools();
create or replace function public.seed_my_schools() returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  insert into public.schools(name, short_name, country, location)
  select s.name, s.short, s.country, s.loc from (values
    ('Harvard Business School','HBS','United States','Boston, MA'),('Stanford GSB','GSB','United States','Stanford, CA'),
    ('Wharton','Wharton','United States','Philadelphia, PA'),('Chicago Booth','Booth','United States','Chicago, IL'),
    ('MIT Sloan','Sloan','United States','Cambridge, MA'),('Kellogg','Kellogg','United States','Evanston, IL'),
    ('Columbia Business School','CBS','United States','New York, NY'),('Berkeley Haas','Haas','United States','Berkeley, CA'),
    ('Yale SOM','SOM','United States','New Haven, CT'),('Dartmouth Tuck','Tuck','United States','Hanover, NH'),
    ('Michigan Ross','Ross','United States','Ann Arbor, MI'),('NYU Stern','Stern','United States','New York, NY'),
    ('UCLA Anderson','Anderson','United States','Los Angeles, CA'),('Cornell Johnson','Johnson','United States','Ithaca, NY'),
    ('Duke Fuqua','Fuqua','United States','Durham, NC'),('UVA Darden','Darden','United States','Charlottesville, VA'),
    ('INSEAD','INSEAD','France','Fontainebleau'),('London Business School','LBS','United Kingdom','London'),
    ('HEC Paris','HEC','France','Jouy-en-Josas'),('Cambridge Judge','Judge','United Kingdom','Cambridge'),
    ('Oxford Saïd','Saïd','United Kingdom','Oxford'),('IESE','IESE','Spain','Barcelona'),('IMD','IMD','Switzerland','Lausanne'),
    ('NUS','NUS','Singapore','Singapore'),('HKUST','HKUST','Hong Kong','Hong Kong'),('CEIBS','CEIBS','China','Shanghai')
  ) as s(name, short, country, loc)
  where not exists (select 1 from public.schools x where x.user_id = auth.uid() and x.name = s.name);
  get diagnostics n = row_count;
  return n;
end $$;
