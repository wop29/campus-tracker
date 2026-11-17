'use client';
import { useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Badge, Button, ConfirmButton, EmptyState, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { filterTasks, isOverdue, taskCompletedAt, TaskSchema, zodFieldErrors, type FieldErrors, type Task, type TaskFilter } from '@/lib/applications';
import { fmtDate, titleCase } from '@/lib/utils';
import { useAction } from './data';

type Form = { title: string; description: string; application_id: string; due_date: string; estimated_minutes: string; priority: string };
const blank = (app = ''): Form => ({ title: '', description: '', application_id: app, due_date: '', estimated_minutes: '', priority: '3' });

/** Task list used on the application page (fixedApplicationId set) and on the global tasks view. */
export function TasksPanel({ tasks, apps, fixedApplicationId, reload }: { tasks: Task[]; apps: { id: string; label: string }[]; fixedApplicationId?: string; reload: () => void }) {
  const [filter, setFilter] = useState<TaskFilter>({ status: 'open', applicationId: '' });
  const [editing, setEditing] = useState<Task | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(blank(fixedApplicationId));
  const [errs, setErrs] = useState<FieldErrors>({});
  const { busy, run } = useAction();
  const sb = supabaseBrowser();
  const label = (id: string | null) => apps.find((a) => a.id === id)?.label ?? 'General task';
  const shown = filterTasks(tasks, fixedApplicationId ? { ...filter, applicationId: '' } : filter);

  function openNew() { setEditing(null); setF(blank(fixedApplicationId)); setErrs({}); setOpen(true); }
  function openEdit(t: Task) { setEditing(t); setF({ title: t.title, description: t.description ?? '', application_id: t.application_id ?? '', due_date: t.due_date ?? '', estimated_minutes: t.estimated_minutes == null ? '' : String(t.estimated_minutes), priority: String(t.priority) }); setErrs({}); setOpen(true); }
  async function save() {
    const p = TaskSchema.safeParse(f);
    if (!p.success) { setErrs(zodFieldErrors(p.error)); return; }
    setErrs({});
    const ok = await run(async () => {
      if (editing) await must(sb.from('application_tasks').update({ ...p.data, application_id: fixedApplicationId ?? p.data.application_id }).eq('id', editing.id));
      else await must(sb.from('application_tasks').insert({ ...p.data, application_id: fixedApplicationId ?? p.data.application_id, source: 'manual' }));
    }, editing ? 'Task updated' : 'Task added');
    if (ok) { setOpen(false); reload(); }
  }
  async function setStatus(t: Task, status: Task['status']) {
    if (await run(async () => { await must(sb.from('application_tasks').update({ status, completed_at: taskCompletedAt(status, t.completed_at) }).eq('id', t.id)); })) reload();
  }
  async function remove(t: Task) { if (await run(async () => { await must(sb.from('application_tasks').delete().eq('id', t.id)); }, 'Task deleted')) reload(); }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Task status" className="w-40" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as TaskFilter['status'] })}>
          <option value="open">Open</option><option value="overdue">Overdue</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="all">All</option>
        </Select>
        {!fixedApplicationId && (
          <Select aria-label="Task application" className="w-52" value={filter.applicationId} onChange={(e) => setFilter({ ...filter, applicationId: e.target.value })}>
            <option value="">All applications</option><option value="none">General tasks only</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        )}
        <div className="flex-1" />
        <Button onClick={openNew}><Plus size={14} /> New task</Button>
      </div>
      {!shown.length ? <EmptyState title={tasks.length ? 'No tasks match this filter' : 'No tasks yet'} hint="Tasks are separate from the application stage. Add one for anything you need to do." /> : (
        <ul className="divide-y rounded-lg border bg-white">
          {shown.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <button aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Complete ${t.title}`} disabled={busy} onClick={() => void setStatus(t, t.status === 'done' ? 'todo' : 'done')}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${t.status === 'done' ? 'border-success bg-success text-white' : 'hover:border-success'}`}>{t.status === 'done' && <Check size={12} />}</button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${t.status === 'done' ? 'text-secondary line-through' : ''}`}>{t.title}</p>
                <p className="text-xs text-secondary">
                  {!fixedApplicationId && <>{label(t.application_id)} · </>}Priority {t.priority}{t.due_date ? ` · Due ${fmtDate(t.due_date)}` : ''}{t.estimated_minutes ? ` · ${t.estimated_minutes} min` : ''}
                </p>
                {t.description && <p className="mt-0.5 text-xs text-secondary">{t.description}</p>}
              </div>
              {isOverdue(t) && <Badge tone="danger">Overdue</Badge>}
              <Select aria-label={`Status of ${t.title}`} className="w-32 !py-1 text-xs" value={t.status} disabled={busy} onChange={(e) => void setStatus(t, e.target.value as Task['status'])}>
                {(['todo', 'in_progress', 'done'] as const).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
              <Button size="sm" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => openEdit(t)}><Pencil size={14} /></Button>
              <ConfirmButton size="sm" variant="ghost" aria-label={`Delete ${t.title}`} message="Delete this task?" onConfirm={() => void remove(t)}><Trash2 size={14} /></ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit task' : 'New task'}>
        <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Title" error={errs.title}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
          <Field label="Description" error={errs.description}><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          {!fixedApplicationId && (
            <Field label="Application" hint="Leave as general for a task not tied to one application."><Select value={f.application_id} onChange={(e) => setF({ ...f, application_id: e.target.value })}><option value="">General task</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></Field>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Due date" error={errs.due_date}><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
            <Field label="Estimated minutes" error={errs.estimated_minutes}><Input inputMode="numeric" value={f.estimated_minutes} onChange={(e) => setF({ ...f, estimated_minutes: e.target.value })} /></Field>
            <Field label="Priority" error={errs.priority}><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save task'}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
