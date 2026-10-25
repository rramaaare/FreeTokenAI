'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Alert, PageHeader } from '@/components/admin/ui';

type Kind = 'chat' | 'image' | 'video';

type Provider = {
  id: string;
  slug: string;
  name: string;
  base_url: string;
  is_active: boolean;
  has_key: boolean;
  key_masked: string | null;
  verified_at: string | null;
  capabilities: Kind[];
};

type ModelRow = {
  id: string;
  provider_id: string | null;
  kind: Kind;
  kinds: Kind[];
  model_id: string;
  label: string;
  cost: number;
  is_active: boolean;
  is_default: boolean;
};

const KIND_LABEL: Record<Kind, string> = { chat: 'Chat', image: 'Gambar', video: 'Video' };
const KINDS: Kind[] = ['chat', 'image', 'video'];

// Notifikasi hilang sendiri: sukses lebih cepat, error diberi waktu lebih lama.
const NOTICE_MS = 5_000;
const ERROR_MS = 8_000;
const PREVIEW_LIMIT = 5;

const inputCls =
  'w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-primary';

export default function AdminModelsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Provider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  const load = useCallback(async () => {
    try {
      const [pRes, mRes] = await Promise.all([
        fetch('/api/v1/admin/providers', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/v1/admin/models', { credentials: 'include', cache: 'no-store' }),
      ]);
      if (!pRes.ok || !mRes.ok) throw new Error('Gagal memuat data (perlu login super_admin).');
      setProviders((await pRes.json()).providers ?? []);
      setModels((await mRes.json()).models ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-dismiss notifikasi.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), ERROR_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  const orphanModels = models.filter((m) => !m.provider_id);
  const deleteCount = deleteTarget
    ? models.filter((m) => m.provider_id === deleteTarget.id).length
    : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Provider & Model AI"
        description="Tambah provider — semua model ditarik otomatis. Ceklis Chat/Gambar/Video diatur per model."
        icon={<Sparkles size={22} className="text-primary" />}
        action={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            <Plus size={16} />
            Tambah Provider
          </button>
        }
      />

      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}

      <div className="space-y-4">
        {providers.length === 0 && (
          <div className="text-center py-16 text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700">
            <Building2 size={44} className="mx-auto mb-3 text-neutral-300" />
            <p>Belum ada provider. Klik &ldquo;Tambah Provider&rdquo; lalu tempel API key-nya.</p>
          </div>
        )}
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            models={models.filter((m) => m.provider_id === p.id)}
            expanded={!!expanded[p.id]}
            onToggle={() => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            setNotice={setNotice}
            onEdit={() => setEditTarget(p)}
            onDelete={() => setDeleteTarget(p)}
            onChanged={load}
          />
        ))}

        {orphanModels.length > 0 && (
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Model tanpa provider</p>
            <ModelTable
              rows={orphanModels}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              setNotice={setNotice}
              onChanged={load}
            />
          </div>
        )}
      </div>

      {addOpen && (
        <AddProviderModal
          onClose={() => setAddOpen(false)}
          onDone={async (msg) => {
            setAddOpen(false);
            setNotice(msg);
            await load();
          }}
        />
      )}

      {editTarget && (
        <EditProviderModal
          provider={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={async (msg) => {
            setEditTarget(null);
            setNotice(msg);
            await load();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteProviderModal
          provider={deleteTarget}
          modelCount={deleteCount}
          onClose={() => setDeleteTarget(null)}
          onDone={async (msg) => {
            setDeleteTarget(null);
            setNotice(msg);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal dasar: overlay + Esc + klik backdrop untuk menutup.
// ---------------------------------------------------------------------------
function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-neutral-900/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${width} max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800`}
      >
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-4 dark:border-neutral-700">
          {icon}
          <h2 className="font-semibold text-neutral-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="ml-auto rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 px-5 py-4 dark:border-neutral-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function ModalError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Tambah provider (popup)
// ---------------------------------------------------------------------------
function AddProviderModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim() || !apiKey.trim()) {
      setErr('Nama provider dan API key wajib diisi.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/v1/admin/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          slug: slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          name: name.trim(),
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      onDone(data.discover_note ?? 'Provider tersimpan.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal menyimpan provider');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Tambah Provider"
      icon={<KeyRound size={18} className="text-primary" />}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Simpan &amp; Ambil Semua Model
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          Nama provider
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenRouter" className={inputCls} />
        </label>
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          Slug (opsional — huruf/angka)
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="otomatis dari nama" className={inputCls} />
        </label>
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          API key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="tempel API key…"
            className={inputCls}
          />
        </label>
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          Base URL (opsional — custom/proxy)
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://… (auto untuk Groq/Gemini/Vio)" className={inputCls} />
        </label>
      </div>
      <ModalError message={err} />
      <p className="text-xs text-neutral-400">
        Key divalidasi dulu ke server provider; kalau valid, disimpan terenkripsi AES-256 dan <strong>semua model</strong> dari
        key itu ditarik otomatis. Ceklis Chat/Gambar/Video diatur per model setelah tersimpan.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit provider (popup)
// ---------------------------------------------------------------------------
function EditProviderModal({
  provider,
  onClose,
  onDone,
}: {
  provider: Provider;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.base_url);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) {
      setErr('Nama provider wajib diisi.');
      return;
    }
    if (apiKey.trim() && apiKey.trim().length < 8) {
      setErr('API key minimal 8 karakter.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        base_url: baseUrl.trim(),
      };
      if (apiKey.trim()) body.api_key = apiKey.trim();

      const res = await fetch(`/api/v1/admin/providers/${provider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      onDone('Provider diperbarui.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal mengubah provider');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Edit Provider"
      icon={<Pencil size={18} className="text-primary" />}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Simpan Perubahan
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          Nama provider
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          Slug (tidak bisa diubah)
          <input value={provider.slug} readOnly className={`${inputCls} cursor-not-allowed opacity-60`} />
        </label>
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400 md:col-span-2">
          Base URL (opsional — custom/proxy)
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" className={inputCls} />
        </label>
        <label className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400 md:col-span-2">
          API key baru (opsional)
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider.has_key ? 'Kosongkan jika tidak ingin mengganti key' : 'Belum ada key — isi di sini'}
            className={inputCls}
          />
        </label>
      </div>
      <ModalError message={err} />
      <p className="text-xs text-neutral-400">
        Kalau API key diisi, key akan diuji ulang ke provider sebelum disimpan. Nama dan Base URL bisa diubah tanpa mengganti key.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Hapus provider (popup konfirmasi)
// ---------------------------------------------------------------------------
function DeleteProviderModal({
  provider,
  modelCount,
  onClose,
  onDone,
}: {
  provider: Provider;
  modelCount: number;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/v1/admin/providers/${provider.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      onDone(
        `Provider "${provider.name}" dihapus${modelCount ? ` beserta ${modelCount} model.` : '.'}`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal menghapus provider');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Hapus Provider"
      icon={<Trash2 size={18} className="text-red-500" />}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Hapus Provider
          </button>
        </>
      }
    >
      <p className="text-sm text-neutral-700 dark:text-neutral-200">
        Yakin ingin menghapus <strong>{provider.name}</strong>
        {modelCount > 0 ? (
          <> beserta <strong>{modelCount} model</strong> di dalamnya?</>
        ) : (
          '?'
        )}
      </p>
      <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
        Model yang ikut terhapus langsung hilang dari pilihan user. Tindakan ini tidak bisa dibatalkan.
      </p>
      <ModalError message={err} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Kartu provider: status key, aksi cepat, preview 5 model, menu ⋮
// ---------------------------------------------------------------------------
function ProviderCard({
  provider,
  models,
  expanded,
  onToggle,
  busy,
  setBusy,
  setError,
  setNotice,
  onEdit,
  onDelete,
  onChanged,
}: {
  provider: Provider;
  models: ModelRow[];
  expanded: boolean;
  onToggle: () => void;
  busy: string;
  setBusy: (v: string) => void;
  setError: (v: string) => void;
  setNotice: (v: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocPointer(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocPointer);
    return () => document.removeEventListener('mousedown', onDocPointer);
  }, [menuOpen]);

  async function patchProvider(body: Record<string, unknown>, successMsg?: string) {
    setBusy(`p-${provider.id}`);
    setError('');
    try {
      const res = await fetch(`/api/v1/admin/providers/${provider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      if (successMsg) setNotice(successMsg);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengubah provider');
    } finally {
      setBusy('');
    }
  }

  async function discover() {
    setBusy(`d-${provider.id}`);
    setError('');
    try {
      const res = await fetch(`/api/v1/admin/providers/${provider.id}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      setNotice(data.message ?? 'Model diperbarui.');
      await onChanged();
      setShowAll(false);
      setExpandedState(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menarik model');
    } finally {
      setBusy('');
    }
  }

  function setExpandedState(v: boolean) {
    if (v !== expanded) onToggle();
  }

  function openAll() {
    setShowAll(true);
    setExpandedState(true);
  }

  const visibleModels = showAll ? models : models.slice(0, PREVIEW_LIMIT);

  return (
    <div className={`bg-white dark:bg-neutral-800 rounded-xl border transition ${expanded ? 'border-primary/40' : 'border-neutral-200 dark:border-neutral-700'}`}>
      {/* header kartu */}
      <div className="flex items-center gap-3 p-4 flex-wrap">
        <button type="button" onClick={onToggle} aria-label={expanded ? 'Tutup' : 'Buka'} className="text-neutral-400 hover:text-primary transition">
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 size={17} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 dark:text-white truncate">
            {provider.name}
            <span className="ml-2 text-xs font-normal text-neutral-400">({provider.slug})</span>
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{provider.base_url || '—'}</p>
        </div>

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <span className="text-xs text-neutral-400">{models.length} model</span>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              provider.has_key
                ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            }`}
          >
            {provider.has_key ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {provider.has_key ? provider.key_masked ?? 'Terkunci' : 'Belum ada key'}
          </span>

          <button
            type="button"
            onClick={() => void discover()}
            disabled={busy !== ''}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 hover:border-primary/50 transition disabled:opacity-50"
          >
            {busy === `d-${provider.id}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Ambil Model
          </button>
          <button
            type="button"
            onClick={() =>
              void patchProvider(
                { is_active: !provider.is_active },
                provider.is_active ? 'Provider dinonaktifkan.' : 'Provider diaktifkan.',
              )
            }
            disabled={busy !== ''}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
              provider.is_active
                ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300'
            }`}
          >
            {provider.is_active ? 'Aktif' : 'Nonaktif'}
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`Menu ${provider.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 transition hover:border-primary/50 hover:text-primary dark:border-neutral-700 dark:text-neutral-300"
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  <Pencil size={14} /> Edit provider
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 size={14} /> Hapus provider
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* preview singkat saat kartu tertutup */}
      {!expanded && models.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          {models.slice(0, PREVIEW_LIMIT).map((m) => (
            <span
              key={m.id}
              className="max-w-[12rem] truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
            >
              {m.label}
            </span>
          ))}
          {models.length > PREVIEW_LIMIT && (
            <>
              <span className="text-[11px] text-neutral-400">+{models.length - PREVIEW_LIMIT} model lain</span>
              <button
                type="button"
                onClick={openAll}
                className="ml-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
              >
                Lihat semua
              </button>
            </>
          )}
        </div>
      )}

      {/* isi kartu: tabel model (maks 5, bisa lihat semua) */}
      {expanded && (
        <div className="border-t border-neutral-100 dark:border-neutral-700 p-4">
          <ModelTable
            rows={visibleModels}
            providerId={provider.id}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            setNotice={setNotice}
            onChanged={onChanged}
          />
          {models.length > PREVIEW_LIMIT && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-neutral-400">
                Menampilkan {visibleModels.length} dari {models.length} model
              </span>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-primary/50 dark:border-neutral-700 dark:text-neutral-300"
              >
                {showAll ? 'Tampilkan 5 saja' : `Lihat semua (${models.length})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabel model dalam kartu provider (+ form tambah tunggal & tempel banyak)
// ---------------------------------------------------------------------------
function ModelTable({
  rows,
  providerId,
  busy,
  setBusy,
  setError,
  setNotice,
  onChanged,
}: {
  rows: ModelRow[];
  providerId?: string;
  busy: string;
  setBusy: (v: string) => void;
  setError: (v: string) => void;
  setNotice: (v: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'' | 'single' | 'bulk'>('');
  const [draft, setDraft] = useState({ model_id: '', label: '' });
  const [draftKinds, setDraftKinds] = useState<Kind[]>([]);
  const [bulk, setBulk] = useState('');

  async function patchModel(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/v1/admin/models/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengubah model');
    } finally {
      setBusy('');
    }
  }

  async function removeModel(id: string) {
    if (!confirm('Hapus model ini dari katalog?')) return;
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/v1/admin/models/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Gagal menghapus model');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus model');
    } finally {
      setBusy('');
    }
  }

  async function addModels(list: { model_id: string; label?: string }[], kinds: Kind[]) {
    if (!list.length) return;
    setBusy('add');
    setError('');
    try {
      const res = await fetch('/api/v1/admin/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kinds, provider_id: providerId ?? null, models: list }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      const added = data.added ?? 0;
      const skipped = data.skipped ?? 0;
      setNotice(`${added} model ditambahkan${skipped ? `, ${skipped} dilewati (sudah ada)` : ''}.`);
      setMode('');
      setDraft({ model_id: '', label: '' });
      setDraftKinds([]);
      setBulk('');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menambah model');
    } finally {
      setBusy('');
    }
  }

  // Ceklis murni per model — bebas untuk Chat / Gambar / Video.
  const kindOptions = KINDS;
  const chosenKinds = (() => {
    const picked = draftKinds.filter((k) => kindOptions.includes(k));
    return picked.length ? picked : kindOptions.slice(0, 1);
  })();

  function toggleDraftKind(k: Kind) {
    if (chosenKinds.includes(k)) {
      if (chosenKinds.length === 1) return; // minimal satu
      setDraftKinds(chosenKinds.filter((x) => x !== k));
    } else {
      setDraftKinds([...chosenKinds, k]);
    }
  }

  const compactInputCls =
    'rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-primary';

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400 py-2">Belum ada model — klik &ldquo;Ambil Model&rdquo; atau tambah manual di bawah.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700 text-left text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                <th className="px-2 py-2">Model</th>
                <th className="px-2 py-2">Kegunaan</th>
                <th className="px-2 py-2 text-center">Default</th>
                <th className="px-2 py-2 text-center">Aktif</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-neutral-100 dark:border-neutral-700/60 last:border-0">
                  <td className="px-2 py-2">
                    <p className="font-medium text-neutral-900 dark:text-white">{m.label}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">{m.model_id}</p>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {KINDS.map((k) => {
                        const on = m.kinds.includes(k);
                        return (
                          <button
                            key={k}
                            type="button"
                            disabled={busy === m.id || (on && m.kinds.length === 1)}
                            onClick={() => {
                              const next = on ? m.kinds.filter((x) => x !== k) : [...m.kinds, k];
                              if (next.length) void patchModel(m.id, { kinds: next });
                            }}
                            title={`Ceklis ${KIND_LABEL[k]}`}
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition disabled:cursor-not-allowed ${
                              on
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-neutral-200 text-neutral-400 dark:border-neutral-700'
                            }`}
                          >
                            {KIND_LABEL[k]}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="radio"
                      name={`default-${m.kind}`}
                      checked={m.is_default}
                      onChange={() => void patchModel(m.id, { is_default: true })}
                      title="Jadikan default"
                      className="accent-primary"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => void patchModel(m.id, { is_active: !m.is_active })}
                      disabled={busy === m.id}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        m.is_active ? 'bg-primary' : 'bg-neutral-300 dark:bg-neutral-600'
                      }`}
                      aria-label={m.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    >
                      <span
                        className="inline-block h-4 w-4 rounded-full bg-white transition"
                        style={{ transform: m.is_active ? 'translateX(18px)' : 'translateX(2px)' }}
                      />
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void removeModel(m.id)}
                      disabled={busy === m.id}
                      aria-label={`Hapus ${m.label}`}
                      className="rounded-md p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30 disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* aksi tambah */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          onClick={() => setMode(mode === 'single' ? '' : 'single')}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:border-primary/50 transition"
        >
          <Plus size={13} /> Tambah 1 Model
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === 'bulk' ? '' : 'bulk')}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:border-primary/50 transition"
        >
          Tempel Banyak
        </button>
        {mode && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-neutral-400">Kegunaan:</span>
            {KINDS.map((k) => {
              const on = chosenKinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleDraftKind(k)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-neutral-200 text-neutral-400 dark:border-neutral-700'
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mode === 'single' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end bg-neutral-50 dark:bg-neutral-900 rounded-lg p-3">
          <label className="text-xs text-neutral-500 space-y-1">
            Model ID
            <input value={draft.model_id} onChange={(e) => setDraft({ ...draft, model_id: e.target.value })} placeholder="org/nama-model" className={`${compactInputCls} w-full`} />
          </label>
          <label className="text-xs text-neutral-500 space-y-1">
            Label (opsional)
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="nama tampilan" className={`${compactInputCls} w-full`} />
          </label>
          <button
            type="button"
            onClick={() =>
              void addModels([{ model_id: draft.model_id.trim(), label: draft.label.trim() || undefined }], chosenKinds)
            }
            disabled={busy !== '' || !draft.model_id.trim()}
            className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            {busy === 'add' ? 'Menyimpan…' : 'Simpan'}
          </button>
          <p className="text-[11px] text-neutral-400">Hanya untuk model yang tidak terambil otomatis.</p>
        </div>
      )}

      {mode === 'bulk' && (
        <div className="bg-neutral-50 dark:bg-neutral-900 rounded-lg p-3 space-y-2">
          <p className="text-xs text-neutral-500">Satu model ID per baris (untuk daftar manual):</p>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={5}
            placeholder={'model-id-1\nmodel-id-2\nmodel-id-3'}
            className={`${compactInputCls} w-full font-mono`}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                void addModels(
                  bulk
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((id) => ({ model_id: id })),
                  chosenKinds,
                )
              }
              disabled={busy !== '' || !bulk.trim()}
              className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
            >
              {busy === 'add' ? 'Menyimpan…' : 'Tambahkan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
