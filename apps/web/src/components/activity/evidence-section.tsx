import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, ExternalLink, FileText, Link2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { api, errorMessage, upload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Activity, Evidence } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { invalidateActivityQueries } from './activity-form';

/** Limite exibido ao usuário; a API é quem valida de fato (UPLOAD_MAX_MB). */
const MAX_MB = 50;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm';

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function EvidenceItem({ e, canRemove, onRemove }: { e: Evidence; canRemove: boolean; onRemove: () => void }) {
  const meta = (
    <p className="text-xs text-muted-foreground">
      {e.createdByName} · {formatDateTime(e.createdAt)}
      {e.sizeBytes ? ` · ${formatSize(e.sizeBytes)}` : ''}
    </p>
  );
  const remove = canRemove && (
    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-danger" onClick={onRemove} aria-label="Remover evidência">
      <Trash2 />
    </Button>
  );

  if (e.kind === 'arquivo') {
    const isVideo = e.mimeType?.startsWith('video/');
    return (
      <li className="overflow-hidden rounded-lg border">
        {e.fileUrl ? (
          isVideo ? (
            <video src={e.fileUrl} controls preload="metadata" playsInline className="max-h-80 w-full bg-black" />
          ) : (
            <a href={e.fileUrl} target="_blank" rel="noreferrer noopener" aria-label="Abrir imagem em tamanho real">
              <img src={e.fileUrl} alt={e.description || e.originalName || 'Evidência'} loading="lazy" className="max-h-80 w-full bg-surface-muted object-contain" />
            </a>
          )
        ) : (
          <p className="p-3 text-sm text-muted-foreground">Arquivo indisponível no momento.</p>
        )}
        <div className="flex items-start justify-between gap-2 p-3">
          <div className="min-w-0">
            {e.description && <p className="text-sm">{e.description}</p>}
            {meta}
          </div>
          {remove}
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 text-sm">
      {e.url ? <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        {e.url ? (
          <a href={e.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-accent-ink hover:underline">
            {e.url} <ExternalLink className="size-3" />
          </a>
        ) : (
          <p>{e.description}</p>
        )}
        {meta}
      </div>
      {remove}
    </li>
  );
}

export function EvidenceSection({ companyId, activity }: { companyId: string; activity: Activity }) {
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const base = `/companies/${companyId}/activities/${activity.id}`;
  const canManage = can(companyId, 'activities.manage');
  const refresh = () => invalidateActivityQueries(qc, companyId);

  const addLink = useMutation({
    mutationFn: () => api.post(`${base}/evidences`, { kind: 'link', url: link.trim() }),
    onSuccess: () => {
      toast.success('Evidência registrada');
      setLink('');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const sendFile = useMutation({
    mutationFn: (file: File) => upload<Evidence>(`${base}/evidences/upload`, file, {}, setProgress),
    onSuccess: () => {
      toast.success('Arquivo enviado');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setProgress(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`${base}/evidences/${id}`),
    onSuccess: () => {
      toast.success('Evidência removida');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onPick = (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`O arquivo tem ${formatSize(file.size)}. O limite é ${MAX_MB} MB — grave um trecho menor ou envie o link do Story.`);
      return;
    }
    sendFile.mutate(file);
  };

  const evidences = activity.evidences ?? [];
  const open = activity.status !== 'cancelada';

  return (
    <div className="flex flex-col gap-3">
      {!!evidences.length && (
        <ul className="flex flex-col gap-3">
          {evidences.map((e) => (
            <EvidenceItem
              key={e.id}
              e={e}
              canRemove={canManage || e.createdBy === user?.id}
              onRemove={() => window.confirm('Remover esta evidência?') && remove.mutate(e.id)}
            />
          ))}
        </ul>
      )}
      {!evidences.length && <p className="text-sm text-muted-foreground">Nenhuma evidência ainda. Envie uma foto, um vídeo ou o link do conteúdo publicado.</p>}

      {open && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={sendFile.isPending} className="w-full sm:w-fit">
            {!sendFile.isPending && <Camera />} {sendFile.isPending ? 'Enviando…' : 'Enviar foto ou vídeo'}
          </Button>
          {progress !== null && (
            <div className="flex items-center gap-3 text-sm" aria-live="polite">
              <Progress value={progress * 100} label="Progresso do envio" />
              <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{Math.round(progress * 100)}%</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Fotos (JPG, PNG, WEBP, HEIC) ou vídeos (MP4, MOV, WEBM) de até {MAX_MB} MB.</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) addLink.mutate();
            }}
          >
            <Input
              type="url"
              inputMode="url"
              placeholder="Ou cole o link do Story/post publicado"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              aria-label="Link da evidência"
            />
            <Button type="submit" variant="secondary" loading={addLink.isPending}>
              Adicionar
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
