# Moving to a new Supabase project

Use this when you change hosts, change Supabase projects, or want a clean copy of your data. The app has a built-in backup (Settings > Data backup) and a restore (Settings > Restore from a backup).

## What moves and what does not

| Moves with backup and restore | Does not move |
|---|---|
| All your records: profile, schools, applications, requirements, essays and every essay version, stories, recommenders, recommendations, tasks, deadlines, interviews, scholarships, expenses, decisions, AI assessments and conversations, saved comparisons | **Uploaded files in Storage** (the `documents` bucket). The backup keeps the document records and their storage paths, but not the files. Copy them separately (step 5). |
| Primary keys, so links between records stay valid | Activity log, notifications and XP history. They are rebuilt by the app, so they are skipped. |
| Soft-deleted records | Your login. Create an account in the new project. |

Restoring is a **merge**: rows whose ID already exists are skipped, nothing is overwritten and nothing is deleted. There is no "replace all" mode.

## Steps

### 1. Back up the old project
Sign in to the old deployment, go to Settings > Data backup > Download full backup (JSON). The file contains personal information. Keep it private. Maximum accepted size on restore is 25 MB.

### 2. Create the new Supabase project and run the migrations
In the new project's SQL editor run every file in `supabase/migrations/` in numeric order (001 to 018 at the time of writing). The importer needs the same schema as the backup was made with, or newer.

### 3. Point the app at the new project
Update `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. These are **build-time** values: rebuild or redeploy (Vercel: redeploy; Docker: `docker compose build --no-cache`). Set the new Site URL and Redirect URL (`<url>/auth/callback`) in the new project's Auth settings. See [DEPLOY.md](./DEPLOY.md).

### 4. Create an account and restore
1. Open the app and sign up in the new project. Confirm your email if the project requires it.
2. Go to Settings > Restore from a backup, choose the JSON file, check the preview (backup date, rows per table), tick the confirmation and import.
3. Read the result table: rows added, skipped and failed per table. Reload the page.

What the importer does for you:
- Validates the file first (the app marker, format version, a fixed list of table names, row counts and size) and refuses anything else. Nothing from the file is executed.
- Rewrites `user_id` on every row to the account you are signed in with. Primary keys are kept.
- Inserts tables in foreign-key order, using your own session, so Row Level Security applies to every write.
- Works around the database triggers: it removes the 17 default requirements that are auto-created for each restored application, and the auto-created first version of each restored essay, before inserting the backup's own rows. Applications saved as Ready are inserted as Preparing and moved to Ready after their requirements are back. `updated_at` is set by a trigger, so it changes on rows that were updated during restore (Ready applications and essays that were copies of others).
- Running the same file again skips everything.

Things to know:
- A new account gets the default school list the first time you open the app. Restored schools are added next to it, so you may see duplicate names. Delete the extra copies you do not want.
- A unique-constraint conflict (for example, the account already has an applicant profile) is counted as skipped, not failed.
- Restoring can trigger XP awards, because the gamification triggers run on inserted rows. XP history itself is not restored.
- Restoring a backup into a project where **another account already holds the same record IDs** (for example two accounts in the same project importing the same file) will not work: those rows are skipped and rows that depend on them fail. Restore into a project that does not already contain them, which is the normal "new project" case.

### 5. Copy the Storage bucket (files)
The importer cannot move files. Options:
The importer rewrites the leading user-id folder in each restored `document_versions.storage_path` to your new user id, so the records point at `<new user id>/<same path as before>`. Storage policies require the first folder to equal the signed-in user's id, so copy the files to that location:
- **Supabase dashboard**: Storage > `documents`. Download the files from the old project's `<old user id>/` folder and upload them to the new project under `<new user id>/` keeping the sub-paths. Practical for a handful of files.
- **Script**: use the Storage API or the Supabase CLI to list objects under the old id and copy them to the new project under the new id (this repo does not ship a copy script, and none was run).

If you only need the records and can re-upload the files, skip this step.

### 6. Verify
From a checkout of this repo:

```bash
npm test                       # unit tests
npm run test:db                # migrations + RLS + triggers in an in-memory Postgres
npm run test:import            # backup then restore across two databases
node scripts/check-queries.mjs # every table/column/rpc the code uses exists in the migrations
```

These run against an in-memory Postgres, not your Supabase project. Then check by hand in the app: Schools, Applications (stages, especially Ready), an essay's version history, Finance totals.

## What is verified

`npm run test:import` builds a realistic backup in one database using the same code as the Settings export, restores it as a different user in a fresh database with the real migrations, and checks row counts, no duplicated requirements or essay versions, Ready stage restored, ownership, foreign keys, Row Level Security isolation, and that a second run skips everything. The browser-side executor (Supabase client calls) is a thin wrapper and was **not** exercised against a real Supabase or PostgREST. Try it with a small backup first.
