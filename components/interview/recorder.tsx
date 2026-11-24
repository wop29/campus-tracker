'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui';

/** Local-only practice recorder. Audio never leaves the browser and nothing is stored or uploaded. */
export function Recorder() {
  const [state, setState] = useState<'idle' | 'recording' | 'denied' | 'unsupported' | 'error'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => { stop(); rec.current?.state === 'recording' && rec.current.stop(); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const start = async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
    try {
      if (url) { URL.revokeObjectURL(url); setUrl(null); }
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = s; chunks.current = [];
      const r = new MediaRecorder(s); rec.current = r;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => { setUrl(URL.createObjectURL(new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }))); stop(); setState('idle'); };
      r.start(); setState('recording');
    } catch (e) { stop(); setState((e as DOMException).name === 'NotAllowedError' || (e as DOMException).name === 'SecurityError' ? 'denied' : 'error'); }
  };
  return (
    <div className="rounded-md border border-dashed p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'recording' ? <Button size="sm" variant="danger" onClick={() => rec.current?.stop()}><Square size={12} /> Stop recording</Button> : <Button size="sm" variant="secondary" onClick={() => void start()}><Mic size={12} /> Record practice audio</Button>}
        {url && state !== 'recording' && <><audio controls src={url} className="h-8" /><Button size="sm" variant="ghost" onClick={() => setUrl(null)}>Discard</Button></>}
      </div>
      <p className="mt-1.5 text-xs text-secondary">Optional. Recording stays in your browser only. It is not uploaded or saved, and it is gone when you discard it or leave this page. The AI evaluates your typed answer, not the audio.</p>
      {state === 'denied' && <p className="mt-1 text-xs text-danger">Microphone permission was denied. Allow it in your browser settings to record, or just type your answer.</p>}
      {state === 'unsupported' && <p className="mt-1 text-xs text-danger">This browser does not support audio recording.</p>}
      {state === 'error' && <p className="mt-1 text-xs text-danger">Could not start the microphone. Check that one is connected.</p>}
    </div>
  );
}
