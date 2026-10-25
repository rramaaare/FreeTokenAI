'use client';

import { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Store,
  Plus,
  Search,
  Trash2,
  KeyRound,
  Edit,
  AlertCircle,
  Loader2,
  X,
  UserCheck,
  Power,
  Wallet,
} from 'lucide-react';
import { Alert, PageHeader } from '@/components/admin/ui';

type UserItem = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  role: 'customer' | 'kasir' | 'super_admin';
  cafe_id: string | null;
  cafe_name: string | null;
  created_at: string;
  has_password: boolean;
  is_active: boolean;
  token_balance: number | null;
};

type Cafe = {
  id: string;
  name: string;
  token_balance?: number;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Filters
  const [selectedRole, setSelectedRole] = useState<'all' | 'super_admin' | 'kasir' | 'customer'>('all');
  const [search, setSearch] = useState('');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form fields for Add
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone_number: '',
    role: 'kasir' as 'super_admin' | 'kasir' | 'customer',
    cafe_id: '',
    password: '',
  });
  // Input manual cafe baru saat menambah kasir
  const [cafeMode, setCafeMode] = useState<'select' | 'manual'>('select');
  const [manualCafeName, setManualCafeName] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [initialBalanceNote, setInitialBalanceNote] = useState('');

  // Form fields for Edit / Reset Password
  // Modal saldo token workspace customer
  const [workspaceBalanceUser, setWorkspaceBalanceUser] = useState<UserItem | null>(null);
  const [workspaceBalanceSubmitting, setWorkspaceBalanceSubmitting] = useState(false);
  const [workspaceBalanceForm, setWorkspaceBalanceForm] = useState({ amount: '', note: '' });

  // Form fields for Edit / Reset Password
  const [editFormData, setEditFormData] = useState({
    name: '',
    email: '',
    phone_number: '',
    role: 'kasir' as 'super_admin' | 'kasir' | 'customer',
    cafe_id: '',
    newPassword: '',
  });

  useEffect(() => {
    loadData();
  }, [selectedRole]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const roleParam = selectedRole !== 'all' ? `?role=${selectedRole}` : '';
      const [resUsers, resCafes] = await Promise.all([
        fetch(`/api/v1/admin/users${roleParam}`, { credentials: 'include', cache: 'no-store' }),
        fetch('/api/v1/admin/cafes', { credentials: 'include', cache: 'no-store' }),
      ]);

      if (!resUsers.ok) {
        const d = await resUsers.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? `HTTP ${resUsers.status}`);
      }
      const dataUsers = await resUsers.json();
      setUsers(dataUsers.users || []);

      if (resCafes.ok) {
        const dataCafes = await resCafes.json();
        setCafes(dataCafes.cafes || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data pengguna');
    } finally {
      setLoading(false);
    }
  }

  function showNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 5000);
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Kasir boleh pakai cafe yang sudah ada (dropdown) atau ketik nama cafe baru.
      let cafeId = formData.cafe_id;
      if (formData.role === 'kasir' && cafeMode === 'manual') {
        const cafeName = manualCafeName.trim();
        if (cafeName.length < 2) throw new Error('Nama cafe manual wajib 2–150 karakter.');
        const cafeRes = await fetch('/api/v1/admin/cafes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: cafeName }),
        });
        const cafeData = await cafeRes.json().catch(() => null);
        if (!cafeRes.ok) throw new Error(cafeData?.error?.message ?? 'Gagal membuat cafe baru.');
        cafeId = cafeData.cafe.id;
      }

      const res = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone_number: formData.phone_number,
          role: formData.role,
          cafe_id: formData.role === 'kasir' ? cafeId : null,
          password: formData.password,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal membuat pengguna');

      // Top-up saldo cafe jika diisi admin (berlaku cafe baru & existing).
      if (formData.role === 'kasir' && Number(initialBalance) > 0 && cafeId) {
        try {
          await fetch(`/api/v1/admin/cafes/${cafeId}/balance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              mode: 'topup',
              amount: Number(initialBalance),
              note: initialBalanceNote.trim() || undefined,
            }),
          });
        } catch {
          // Jangan gagalkan pembuatan akun.
        }
      }

      showNotice(
        cafeMode === 'manual' && formData.role === 'kasir'
          ? `Cafe "${manualCafeName.trim()}" dan akun ${data.user.name || data.user.email} berhasil dibuat.`
          : `Pengguna ${data.user.name || data.user.email} berhasil dibuat.`,
      );
      setIsAddModalOpen(false);
      setFormData({
        name: '',
        email: '',
        phone_number: '',
        role: 'kasir',
        cafe_id: '',
        password: '',
      });
      setCafeMode('select');
      setManualCafeName('');
      setInitialBalance('');
      setInitialBalanceNote('');
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan data');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    setError('');

    try {
      const payload: Record<string, any> = {
        name: editFormData.name,
        email: editFormData.email,
        phone_number: editFormData.phone_number,
        role: editFormData.role,
        cafe_id: editFormData.role === 'kasir' ? editFormData.cafe_id : null,
      };

      if (editFormData.newPassword) {
        payload.password = editFormData.newPassword;
      }

      const res = await fetch(`/api/v1/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal memperbarui pengguna');

      showNotice('Data pengguna berhasil diperbarui.');
      setEditingUser(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memperbarui');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteUser() {
    if (!deletingUser) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(`/api/v1/admin/users/${deletingUser.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal menghapus pengguna');

      showNotice('Pengguna berhasil dihapus.');
      setDeletingUser(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(u: UserItem) {
    try {
      const res = await fetch(`/api/v1/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal mengubah status');
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_active: !u.is_active } : x)));
      showNotice(`Akun ${u.name || u.email} ${!u.is_active ? 'diaktifkan' : 'dinonaktifkan'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengubah status');
    }
  }

  function openWorkspaceBalanceModal(u: UserItem) {
    setWorkspaceBalanceUser(u);
    setWorkspaceBalanceForm({ amount: '', note: '' });
  }

  async function handleSaveWorkspaceBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceBalanceUser) return;
    setWorkspaceBalanceSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/admin/users/${workspaceBalanceUser.id}/workspace-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount: Number(workspaceBalanceForm.amount),
          note: workspaceBalanceForm.note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal menambah saldo');
      setUsers((prev) =>
        prev.map((x) =>
          x.id === workspaceBalanceUser.id ? { ...x, token_balance: data.token_balance } : x,
        ),
      );
      showNotice(
        `Saldo token ${workspaceBalanceUser.name || workspaceBalanceUser.email} sekarang ${data.token_balance} Token.`,
      );
      setWorkspaceBalanceUser(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menambah saldo');
    } finally {
      setWorkspaceBalanceSubmitting(false);
    }
  }

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.phone_number && u.phone_number.includes(q)) ||
      (u.cafe_name && u.cafe_name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Kafe, Kasir & Pengguna"
        description="Kelola hak akses akun Super Admin, Kasir Restoran/Cafe, dan Customer"
        icon={<Users size={22} className="text-primary" />}
        action={
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover"
          >
            <Plus size={16} />
            Tambah Kasir / Admin
          </button>
        }
      />

      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-neutral-800 p-3 rounded-xl border border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              { id: 'all', label: 'Semua' },
              { id: 'super_admin', label: 'Super Admin' },
              { id: 'kasir', label: 'Kasir' },
              { id: 'customer', label: 'Customer' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedRole(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                selectedRole === tab.id
                  ? 'bg-primary text-white'
                  : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${selectedRole === tab.id ? 'bg-white/20' : 'bg-neutral-100 dark:bg-neutral-700'}`}>
                {tab.id === 'all' ? users.length : users.filter((u) => u.role === tab.id).length}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Cari nama, email, cafe..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-neutral-400 text-sm gap-2">
            <Loader2 size={24} className="animate-spin text-primary" />
            <span>Memuat data pengguna...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center text-neutral-400 text-sm">
            Tidak ada pengguna yang cocok dengan kriteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400 text-xs uppercase border-b border-neutral-200 dark:border-neutral-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Pengguna</th>
                  <th className="px-4 py-3 font-semibold">Kontak</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Penugasan Cafe</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Password Akses</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-700/30 transition">
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-neutral-900 dark:text-white">{u.name || 'Tanpa Nama'}</div>
                      <div className="text-xs text-neutral-400 font-mono">ID: {u.id.slice(0, 8)}...</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-neutral-800 dark:text-neutral-200 text-xs">{u.email || '-'}</div>
                      <div className="text-neutral-500 text-xs">{u.phone_number || '-'}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      {u.role === 'super_admin' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                          <Shield size={12} />
                          Super Admin
                        </span>
                      )}
                      {u.role === 'kasir' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          <Store size={12} />
                          Kasir
                        </span>
                      )}
                      {u.role === 'customer' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <UserCheck size={12} />
                          Customer
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {u.cafe_name ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-800 dark:text-neutral-200 font-medium">
                          <Store size={14} className="text-primary" />
                          {u.cafe_name}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">
                          {u.role === 'super_admin' ? 'Semua Cafe (Global)' : '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => handleToggleActive(u)}
                        title={u.is_active ? 'Nonaktifkan akun' : 'Aktifkan akun'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                          u.is_active
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'
                        }`}
                      >
                        <Power size={11} />
                        {u.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
                    <td className="px-4 py-3.5">
                      {u.has_password ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <KeyRound size={12} /> Aktif
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">Belum di-set</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        {u.role === 'customer' && (
                          <button
                            onClick={() => openWorkspaceBalanceModal(u)}
                            title={`Saldo Token: ${u.token_balance ?? 0}`}
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-primary hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                          >
                            <Wallet size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingUser(u);
                            setEditFormData({
                              name: u.name || '',
                              email: u.email || '',
                              phone_number: u.phone_number || '',
                              role: u.role,
                              cafe_id: u.cafe_id || '',
                              newPassword: '',
                            });
                          }}
                          title="Edit / Reset Password"
                          className="p-1.5 rounded-lg text-neutral-500 hover:text-primary hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => setDeletingUser(u)}
                          title="Hapus Pengguna"
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL TAMBAH USER */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl max-w-md w-full border border-neutral-200 dark:border-neutral-700 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
              <h2 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <Plus size={18} className="text-primary" />
                Tambah Pengguna / Kasir Baru
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-5 space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Role Akun
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                >
                  <option value="kasir">Kasir (Terikat ke Cafe)</option>
                  <option value="super_admin">Super Admin (Akses Penuh)</option>
                  <option value="customer">Customer (Pengguna AI Biasa)</option>
                </select>
              </div>

              {formData.role === 'kasir' && (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      Nama Cafe / Toko <span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 p-0.5">
                      {(
                        [
                          { id: 'select', label: 'Pilih' },
                          { id: 'manual', label: 'Ketik Manual' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setCafeMode(m.id)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                            cafeMode === m.id
                              ? 'bg-white dark:bg-neutral-700 text-primary shadow-sm'
                              : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {cafeMode === 'select' ? (
                    <select
                      value={formData.cafe_id}
                      onChange={(e) => setFormData({ ...formData, cafe_id: e.target.value })}
                      required
                      className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                    >
                      <option value="">-- Pilih Cafe --</option>
                      {cafes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="cth. Kopi Senja"
                        maxLength={150}
                        value={manualCafeName}
                        onChange={(e) => setManualCafeName(e.target.value)}
                        required
                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                      />
                      <p className="mt-1 text-[11px] text-neutral-400">
                        Cafe baru akan dibuat otomatis dan kasir langsung terhubung ke sana.
                      </p>
                    </>
                  )}
                <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-3">
                  <p className="text-xs text-neutral-600 dark:text-neutral-300">
                    Saldo sekarang:{' '}
                    <strong>
                      {(cafeMode === 'manual'
                        ? 0
                        : cafes.find((c) => c.id === formData.cafe_id)?.token_balance ?? 0
                      ).toLocaleString('id-ID')}
                    </strong>{' '}
                    token
                    {Number(initialBalance) > 0 && (
                      <>
                        {' '}→{' '}
                        <strong>
                          {(
                            (cafeMode === 'manual'
                              ? 0
                              : cafes.find((c) => c.id === formData.cafe_id)?.token_balance ?? 0) +
                            Number(initialBalance)
                          ).toLocaleString('id-ID')}
                        </strong>
                      </>
                    )}
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                      Jumlah top-up
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={initialBalance}
                      onChange={(e) =>
                        setInitialBalance(e.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      placeholder="0"
                      className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                    />
                    <p className="mt-1 text-[11px] text-neutral-400">Ketik angka 1–100.000.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                      Catatan (opsional)
                    </label>
                    <input
                      type="text"
                      value={initialBalanceNote}
                      onChange={(e) => setInitialBalanceNote(e.target.value)}
                      placeholder="Contoh: transfer bank BCA"
                      className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                    />
                  </div>
                </div>
                </div>
              )}


              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Budi Santoso"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="kasir@restoran.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Nomor WhatsApp / HP
                  </label>
                  <input
                    type="text"
                    placeholder="08123456789"
                    value={formData.phone_number}
                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                  />
                </div>
              </div>

              {(formData.role === 'kasir' || formData.role === 'super_admin') && (
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Password Akun <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    placeholder="Minimal 8 karakter"
                    required
                    minLength={8}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                  />
                </div>
              )}

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-200 dark:border-neutral-700">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition flex items-center gap-2"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  Simpan Akun
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EDIT / RESET PASSWORD */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl max-w-md w-full border border-neutral-200 dark:border-neutral-700 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
              <h2 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <Edit size={18} className="text-primary" />
                Edit Pengguna & Password
              </h2>
              <button
                onClick={() => setEditingUser(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="p-5 space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Role Akun
                </label>
                <select
                  value={editFormData.role}
                  onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value as any })}
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                >
                  <option value="kasir">Kasir</option>
                  <option value="super_admin">Super Admin</option>
                  <option value="customer">Customer</option>
                </select>
              </div>

              {editFormData.role === 'kasir' && (
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Penugasan Cafe
                  </label>
                  <select
                    value={editFormData.cafe_id}
                    onChange={(e) => setEditFormData({ ...editFormData, cafe_id: e.target.value })}
                    required
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                  >
                    <option value="">-- Pilih Cafe --</option>
                    {cafes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editFormData.email}
                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Nomor WhatsApp / HP
                  </label>
                  <input
                    type="text"
                    value={editFormData.phone_number}
                    onChange={(e) => setEditFormData({ ...editFormData, phone_number: e.target.value })}
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <label className="block text-xs font-semibold text-amber-900 dark:text-amber-300 mb-1 flex items-center gap-1.5">
                  <KeyRound size={14} />
                  Reset Password Baru (Opsional)
                </label>
                <input
                  type="password"
                  placeholder="Kosongkan bila tidak ingin mengubah password"
                  value={editFormData.newPassword}
                  onChange={(e) => setEditFormData({ ...editFormData, newPassword: e.target.value })}
                  className="w-full rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-neutral-900 px-3 py-2 text-xs text-neutral-900 dark:text-white outline-none focus:border-primary"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-200 dark:border-neutral-700">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition flex items-center gap-2"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  Perbarui Akun
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL AKSES & LIMIT */}

      {/* MODAL SALDO TOKEN CUSTOMER */}
      {workspaceBalanceUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl max-w-md w-full border border-neutral-200 dark:border-neutral-700 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
              <h2 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <Wallet size={18} className="text-primary" />
                Top-Up Saldo Token
              </h2>
              <button
                onClick={() => setWorkspaceBalanceUser(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveWorkspaceBalance} className="p-5 space-y-4 text-sm">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Pengguna:{' '}
                <strong className="text-neutral-900 dark:text-white">
                  {workspaceBalanceUser.name || workspaceBalanceUser.email}
                </strong>
                {' · '}Saldo saat ini:{' '}
                <strong className="text-neutral-900 dark:text-white">
                  {workspaceBalanceUser.token_balance ?? 0}
                </strong>{' '}
                Token
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Saldo masuk langsung ke akun yang sedang dipakai pengguna. Mereka tidak perlu logout.
              </p>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Jumlah Top-Up <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={workspaceBalanceForm.amount}
                  onChange={(e) =>
                    setWorkspaceBalanceForm((f) => ({ ...f, amount: e.target.value.replace(/\D/g, '').slice(0, 6) }))
                  }
                  placeholder="0"
                  required
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                />
                <p className="mt-1 text-[11px] text-neutral-400">Ketik angka 1–100.000.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Catatan (opsional)
                </label>
                <input
                  type="text"
                  value={workspaceBalanceForm.note}
                  onChange={(e) => setWorkspaceBalanceForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Opsional"
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-200 dark:border-neutral-700">
                <button
                  type="button"
                  onClick={() => setWorkspaceBalanceUser(null)}
                  className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={workspaceBalanceSubmitting}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition flex items-center gap-2"
                >
                  {workspaceBalanceSubmitting && <Loader2 size={16} className="animate-spin" />}
                  Tambah Saldo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI HAPUS */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl max-w-sm w-full border border-neutral-200 dark:border-neutral-700 shadow-xl p-5 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="p-2.5 rounded-full bg-red-100 dark:bg-red-950/50">
                <AlertCircle size={22} />
              </div>
              <h3 className="font-bold text-neutral-900 dark:text-white text-base">Hapus Pengguna?</h3>
            </div>

            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Apakah Anda yakin ingin menghapus akun{' '}
              <strong className="text-neutral-900 dark:text-white">
                {deletingUser.name || deletingUser.email || deletingUser.phone_number}
              </strong>
              ? Tindakan ini tidak dapat dibatalkan.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition text-sm"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition text-sm flex items-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

