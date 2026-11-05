-- =============================================================================
-- 0500 — Evidências em arquivo (fotos e vídeos)
-- Os arquivos ficam no armazenamento (Supabase Storage em produção, disco local
-- em desenvolvimento) sob o prefixo "<empresa>/<atividade>/". O banco guarda só
-- o caminho e os metadados; o acesso é sempre por link temporário gerado pela API
-- depois da checagem de permissão (RLS em activity_evidences).
-- =============================================================================

alter table public.activity_evidences
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  add column if not exists original_name text check (original_name is null or char_length(original_name) <= 255);

-- O caminho do arquivo precisa estar dentro da pasta da própria empresa e atividade
alter table public.activity_evidences
  add constraint activity_evidences_storage_path_scope check (
    storage_path is null
    or storage_path like (company_id::text || '/' || activity_id::text || '/%')
  );

alter table public.activity_evidences
  add constraint activity_evidences_file_mime check (
    kind <> 'arquivo' or mime_type ~ '^(image|video)/'
  );
