"use client";

import React, { useState, useEffect } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { 
  Package, Search, Plus, Edit, Loader2, ClipboardCheck, ArrowUpRight, 
  Trash2, ShieldAlert, X, UserPlus, CheckCircle, RefreshCcw 
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SearchSelect from "@/components/SearchSelect";
import { generateCode39Svg } from "@/lib/barcode";
import { Select } from "@/components/ui";
interface Employee {
  _id: string;
  name: string;
  NIK: string;
}

interface InventoryAsset {
  _id: string;
  code: string;
  name: string;
  category: string;
  condition: "good" | "damaged" | "lost";
  assignment?: {
    _id: string;
    employeeId?: {
      _id: string;
      name: string;
      NIK: string;
      divisionId?: { name: string };
      positionId?: { name: string };
    };
    handoverDate: string;
    signatureUrl?: string;
    status: "pending_handover" | "active" | "returned";
  };
}

export default function InventoryAdminPage() {
  const [assets, setAssets] = useState<InventoryAsset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("");

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<InventoryAsset | null>(null);
  const [signatureModalUrl, setSignatureModalUrl] = useState<string | null>(null);

  // Audit fields
  const [auditAsset, setAuditAsset] = useState<InventoryAsset | null>(null);
  const [auditCondition, setAuditCondition] = useState<"good" | "damaged" | "lost">("good");
  const [auditNotes, setAuditNotes] = useState("");
  const [scanInputCode, setScanInputCode] = useState("");
  const [scanError, setScanError] = useState("");

  // Form fields
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<string>("laptop");
  const [formCondition, setFormCondition] = useState<"good" | "damaged" | "lost">("good");
  const [assignEmployeeId, setAssignEmployeeId] = useState("");

  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [categories, setCategories] = useState<string[]>(["laptop", "phone", "vehicle", "other"]);

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/v1/settings/categories");
      const data = await res.json();
      if (data.success && data.data) {
        setCategories(data.data);
        if (data.data.length > 0 && !selectedAsset) {
          setFormCategory(data.data[0]);
        }
      }
    } catch (err) {
      console.error("Gagal memuat kategori settings:", err);
    }
  };

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (categoryFilter) params.set("category", categoryFilter);
      const res = await fetch(`/api/v1/inventory?${params}`);
      const data = await res.json();
      if (data.success) {
        setAssets(data.data || []);
        setTotal(data.meta?.total ?? 0);
      }
    } catch (err) {
      console.error("Gagal memuat aset:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await fetch("/api/v1/employees");
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data || []);
      }
    } catch (err) {
      console.error("Gagal memuat karyawan:", err);
    }
  };

  useEffect(() => {
    fetchEmployees();
    fetchCategories();
  }, []);

  // Assets reload from the server whenever the page or filters change; search
  // waits for a pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => void fetchAssets(), searchQuery ? 350 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, searchQuery, categoryFilter]);

  const handleOpenForm = (asset: InventoryAsset | null = null) => {
    setErrorMsg("");
    setSuccessMsg("");
    if (asset) {
      setSelectedAsset(asset);
      setFormCode(asset.code);
      setFormName(asset.name);
      setFormCategory(asset.category);
      setFormCondition(asset.condition);
    } else {
      setSelectedAsset(null);
      setFormCode("");
      setFormName("");
      setFormCategory("laptop");
      setFormCondition("good");
    }
    setIsFormOpen(true);
  };

  const handleOpenAssign = (asset: InventoryAsset) => {
    setErrorMsg("");
    setSuccessMsg("");
    setSelectedAsset(asset);
    setAssignEmployeeId(asset.assignment?.employeeId?._id || "");
    setIsAssignOpen(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/v1/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedAsset?._id,
          code: formCode,
          name: formName,
          category: formCategory,
          condition: formCondition
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(selectedAsset ? "Aset berhasil diperbarui!" : "Aset baru berhasil ditambahkan!");
        fetchAssets();
        setTimeout(() => setIsFormOpen(false), 800);
      } else {
        setErrorMsg(data.message || "Gagal menyimpan data aset");
      }
    } catch (err) {
      setErrorMsg("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/v1/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedAsset._id,
          employeeId: assignEmployeeId
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("Aset berhasil ditugaskan!");
        fetchAssets();
        setTimeout(() => setIsAssignOpen(false), 800);
      } else {
        setErrorMsg(data.message || "Gagal menugaskan aset");
      }
    } catch (err) {
      setErrorMsg("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnAsset = async (asset: InventoryAsset) => {
    if (!confirm(`Konfirmasi pengembalian aset ${asset.name}?`)) return;
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/v1/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: asset._id,
          action: "return"
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchAssets();
      } else {
        alert(data.message || "Gagal mengembalikan aset");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const playBeep = () => {
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error(e);
    }
  };

  const handleScanSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setScanError("");
    const code = scanInputCode.trim();
    if (!code) return;

    // Looked up on the server: the asset may be on a page that is not loaded.
    let found: InventoryAsset | undefined;
    try {
      const res = await fetch(`/api/v1/inventory?code=${encodeURIComponent(code)}&limit=1`);
      const data = await res.json();
      found = data.success ? (data.data?.[0] as InventoryAsset | undefined) : undefined;
    } catch {
      found = undefined;
    }
    if (found) {
      playBeep();
      setAuditAsset(found);
      setAuditCondition(found.condition);
      setScanError("");
    } else {
      setScanError(`Aset dengan kode "${code}" tidak terdaftar`);
      setAuditAsset(null);
    }
  };

  const handleSaveAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auditAsset) return;
    setSubmitting(true);
    setScanError("");

    try {
      const res = await fetch("/api/v1/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryId: auditAsset._id,
          condition: auditCondition,
          notes: auditNotes
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("Laporan audit berhasil disimpan!");
        fetchAssets();
        setTimeout(() => {
          setIsAuditOpen(false);
          setAuditAsset(null);
          setAuditNotes("");
          setScanInputCode("");
          setSuccessMsg("");
        }, 1000);
      } else {
        setScanError(data.message || "Gagal menyimpan laporan audit");
      }
    } catch (err) {
      setScanError("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredAssets = assets;

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex items-center justify-between border-b border-line pb-6">
        <div>
          <h1 className="text-title font-semibold text-foreground dark:text-foreground flex items-center gap-2">
            <Package className="w-5 h-5 text-foreground" />
            Manajemen Inventaris & Aset GA
          </h1>
          <p className="text-label text-muted dark:text-muted mt-1">
            Kelola master inventaris kantor, serah terima BAST digital, dan pemantauan kepemilikan barang karyawan.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setScanInputCode("");
              setScanError("");
              setAuditAsset(null);
              setAuditNotes("");
              setIsAuditOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-success dark:bg-success text-label font-semibold text-white cursor-pointer hover:bg-success transition-all border border-success"
          >
            <RefreshCcw className="w-4 h-4" />
            Pindai & Audit Fisik
          </button>
          <button
            onClick={() => handleOpenForm(null)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-label font-semibold text-primary-foreground cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-2 transition-all border border-line-strong dark:border-white"
          >
            <Plus className="w-4 h-4" />
            Tambah Aset Baru
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-surface border border-line/60 dark:border-white/6 p-4 rounded-xl">
        <div>
          <label className="text-caption font-semibold text-foreground uppercase tracking-wider block mb-1.5">Cari Kode / Nama</label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Cari MacBook, AST-LAP-001..."
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-surface-2 border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-white text-label placeholder:text-subtle"
            />
            <Search className="w-3.5 h-3.5 text-subtle absolute left-3 top-3" />
          </div>
        </div>
        <div>
          <label className="text-caption font-semibold text-foreground uppercase tracking-wider block mb-1.5">Saring Kategori</label>
          <Select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-white text-label"
          >
            <option value="">Semua Kategori</option>
            {categories.map(cat => (
              <option key={cat} value={cat} className="capitalize">{cat}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Main List Table */}
      {loading ? (
        <div className="h-64 flex items-center justify-center text-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-foreground" />
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="h-48 border border-dashed border-line rounded-xl flex flex-col items-center justify-center text-center p-6 text-muted">
          <Package className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-body font-medium">Belum ada aset terdaftar</p>
        </div>
      ) : (
        <div className="bg-surface border border-line/60 dark:border-white/6 rounded-xl overflow-hidden">
          <table className="w-full text-left text-label border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2/50 dark:bg-surface-2 text-foreground dark:text-muted">
                <th className="p-4 font-semibold">Kode Aset</th>
                <th className="p-4 font-semibold">Nama Barang</th>
                <th className="p-4 font-semibold">Kategori</th>
                <th className="p-4 font-semibold">Kondisi</th>
                <th className="p-4 font-semibold">Pemegang Aktif</th>
                <th className="p-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => {
                const isAssigned = asset.assignment && (asset.assignment.status === "active" || asset.assignment.status === "pending_handover");
                return (
                  <tr key={asset._id} className="border-b border-line hover:bg-surface-2/50 dark:hover:bg-white/1 transition-all">
                    <td className="p-4 font-mono font-semibold text-foreground dark:text-muted">
                      <div>{asset.code}</div>
                      <div 
                        className="h-5 w-28 mt-1 opacity-80"
                        dangerouslySetInnerHTML={{ __html: generateCode39Svg(asset.code).svg }}
                      />
                    </td>
                    <td className="p-4 font-semibold text-foreground dark:text-foreground">{asset.name}</td>
                    <td className="p-4 capitalize text-foreground">{asset.category}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-sm font-semibold border ${
                        asset.condition === "good"
                          ? "bg-success-soft text-success dark:text-success border-success/20"
                          : asset.condition === "damaged"
                          ? "bg-warning-soft text-warning dark:text-warning border-warning/20"
                          : "bg-danger-soft text-danger dark:text-danger border-danger/20"
                      }`}>
                        {asset.condition === "good" ? "Baik" : asset.condition === "damaged" ? "Rusak" : "Hilang"}
                      </span>
                    </td>
                    <td className="p-4">
                      {isAssigned ? (
                        <div className="space-y-1">
                          <div className="font-semibold text-foreground dark:text-foreground">
                            {asset.assignment?.employeeId?.name || "Karyawan"}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-caption uppercase font-semibold text-muted dark:text-muted">
                            <span>{asset.assignment?.employeeId?.NIK}</span>
                            <span>&bull;</span>
                            <span className={`px-1.5 py-0.2 rounded border ${
                              asset.assignment?.status === "active" 
                                ? "bg-success-soft text-success dark:text-success border-success/20" 
                                : "bg-warning-soft text-warning dark:text-warning border-warning/20 animate-pulse"
                            }`}>
                              {asset.assignment?.status === "active" ? "Aktif" : "Menunggu BAST"}
                            </span>
                            {asset.assignment?.signatureUrl && (
                              <button 
                                onClick={() => setSignatureModalUrl(asset.assignment?.signatureUrl || null)}
                                className="text-foreground underline hover:opacity-80 ml-1.5 cursor-pointer"
                              >
                                Lihat TTD
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-subtle font-medium">Belum Ditugaskan</span>
                      )}
                    </td>
                    <td className="p-4 text-right flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenForm(asset)}
                        className="p-1.5 rounded hover:bg-surface-2 dark:hover:bg-white/4 text-muted dark:text-muted hover:text-foreground transition-all cursor-pointer"
                        title="Edit Info Aset"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleOpenAssign(asset)}
                        disabled={asset.condition === "lost"}
                        className="p-1.5 rounded hover:bg-surface-2 dark:hover:bg-white/4 text-muted dark:text-muted hover:text-foreground transition-all cursor-pointer disabled:opacity-30"
                        title="Tugaskan Aset"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                      {isAssigned && (
                        <button
                          onClick={() => handleReturnAsset(asset)}
                          className="p-1.5 rounded hover:bg-surface-2 dark:hover:bg-white/4 text-danger hover:text-danger transition-all cursor-pointer"
                          title="Kembalikan Aset (Return)"
                        >
                          <RefreshCcw className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / limit))}
          total={total}
          limit={limit}
          onPage={setPage}
          onLimit={(l) => {
            setLimit(l);
            setPage(1);
          }}
        />
      )}

      {/* Asset Form Drawer Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg h-full bg-surface border-l border-line relative z-10 shadow-[var(--shadow-pop)] p-6 flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-line mb-6">
                <h3 className="text-body font-semibold text-foreground dark:text-foreground uppercase">
                  {selectedAsset ? "Edit Detail Inventaris" : "Tambah Inventaris Aset Baru"}
                </h3>
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="p-1 rounded bg-surface-2 border border-line text-muted dark:text-muted hover:text-foreground cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {errorMsg && (
                <div className="mb-4 p-3 rounded bg-danger-soft border border-danger/20 text-danger text-label flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="mb-4 p-3 rounded bg-success-soft border border-success/20 text-success text-label flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>{successMsg}</span>
                </div>
              )}

              <form onSubmit={handleSaveAsset} className="space-y-4 text-label">
                <div>
                  <label className="block text-caption font-semibold text-foreground dark:text-muted uppercase tracking-wider mb-1.5">Kode Aset (Unique)</label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    disabled={!!selectedAsset}
                    placeholder="AST-LAP-001, AST-MBL-012"
                    className="w-full px-3 py-2 rounded-lg bg-surface-2 dark:bg-surface border border-line dark:border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-white text-label disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-caption font-semibold text-foreground dark:text-muted uppercase tracking-wider mb-1.5">Nama Barang / Spesifikasi</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="MacBook Pro M2 16GB, Honda Vario B 1234 XYZ"
                    className="w-full px-3 py-2 rounded-lg bg-surface-2 dark:bg-surface border border-line dark:border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-white text-label"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex-1 w-full">
                    <SearchSelect
                      label="Kategori Aset"
                      value={formCategory}
                      onChange={setFormCategory}
                      options={categories.map(cat => ({ label: cat.toUpperCase(), value: cat }))}
                      placeholder="Pilih kategori..."
                    />
                  </div>
                  <div>
                    <label className="block text-caption font-semibold text-foreground dark:text-muted uppercase tracking-wider mb-1.5">Kondisi Aset</label>
                    <Select
                      value={formCondition}
                      onChange={(e) => setFormCondition(e.target.value as "good" | "damaged" | "lost")}
                      className="w-full px-3 py-2 rounded-lg bg-surface-2 dark:bg-surface border border-line dark:border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-white text-label"
                    >
                      <option value="good">Baik</option>
                      <option value="damaged">Rusak</option>
                      <option value="lost">Hilang</option>
                    </Select>
                  </div>
                </div>
              </form>
            </div>

            <div className="border-t border-line pt-4 mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-4 py-2 rounded-lg border border-line text-label font-semibold text-foreground dark:text-muted hover:bg-surface-2 transition-all"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveAsset}
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-primary text-label font-semibold text-primary-foreground border border-line-strong dark:border-white hover:bg-surface-2 dark:hover:bg-surface-2 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {selectedAsset ? "Simpan Perubahan" : "Tambah Aset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Asset Modal */}
      {isAssignOpen && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-surface border border-line rounded-xl shadow-[var(--shadow-pop)] p-6 flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-line">
              <h3 className="text-body font-semibold text-foreground dark:text-foreground uppercase">Tugaskan Aset Inventaris</h3>
              <button
                onClick={() => setIsAssignOpen(false)}
                className="p-1 rounded bg-surface-2 border border-line text-muted dark:text-muted hover:text-foreground transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-label">
              <div className="p-3 bg-surface-2 rounded-lg border border-line space-y-1">
                <div className="font-semibold text-foreground dark:text-foreground">Aset: {selectedAsset.name}</div>
                <div className="text-label text-muted dark:text-muted">Kode: {selectedAsset.code} &bull; Kategori: {selectedAsset.category}</div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded bg-danger-soft border border-danger/20 text-danger text-label flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3 rounded bg-success-soft border border-success/20 text-success text-label flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>{successMsg}</span>
                </div>
              )}

              <SearchSelect
                label="Pilih Karyawan Penerima"
                value={assignEmployeeId}
                onChange={setAssignEmployeeId}
                options={employees.map(emp => ({
                  label: `${emp.name} (${emp.NIK})`,
                  value: emp._id
                }))}
                placeholder="Pilih karyawan..."
              />
            </div>

            <div className="border-t border-line pt-4 flex justify-end gap-3">
              <button
                onClick={() => setIsAssignOpen(false)}
                className="px-4 py-2 rounded-lg border border-line text-label font-semibold text-foreground dark:text-muted hover:bg-surface-2 transition-all"
              >
                Batal
              </button>
              <button
                onClick={handleAssignAsset}
                disabled={submitting || !assignEmployeeId}
                className="px-4 py-2 rounded-lg bg-primary text-label font-semibold text-primary-foreground border border-line-strong dark:border-white hover:bg-surface-2 dark:hover:bg-surface-2 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Tugaskan Aset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signature Viewer Modal */}
      {signatureModalUrl && (
        <div className="fixed inset-0 z-55 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm bg-surface border border-line rounded-xl shadow-[var(--shadow-pop)] p-6 flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-line">
              <h3 className="text-label font-semibold text-foreground dark:text-foreground uppercase">Tanda Tangan Serah Terima (BAST)</h3>
              <button
                onClick={() => setSignatureModalUrl(null)}
                className="p-1 rounded bg-surface-2 border border-line text-muted dark:text-muted hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="py-6 flex justify-center">
              <div className="border border-line rounded-lg bg-surface-2 p-2 overflow-hidden flex items-center justify-center">
                <img 
                  src={signatureModalUrl} 
                  alt="Tanda Tangan Digital BAST" 
                  className="max-h-48 object-contain scale-[1.05] dark:invert" 
                />
              </div>
            </div>
            <button
              onClick={() => setSignatureModalUrl(null)}
              className="w-full py-2 rounded-lg border border-line text-label font-semibold text-foreground dark:text-muted hover:bg-surface-2 cursor-pointer transition-all"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
      {/* Monthly Physical Audit Scan Modal */}
      {isAuditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md bg-surface border border-line rounded-xl shadow-[var(--shadow-pop)] p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center pb-4 border-b border-line">
              <h3 className="text-body font-semibold text-foreground dark:text-foreground uppercase">Audit Fisik Bulanan Inventaris</h3>
              <button
                onClick={() => {
                  setIsAuditOpen(false);
                  setAuditAsset(null);
                }}
                className="p-1 rounded bg-surface-2 border border-line text-muted dark:text-muted hover:text-foreground transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleScanSearch} className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  required
                  value={scanInputCode}
                  onChange={(e) => setScanInputCode(e.target.value)}
                  placeholder="Scan barcode / Ketik kode aset..."
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-label placeholder:text-subtle"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-label font-semibold text-primary-foreground rounded-lg hover:bg-surface-2 dark:hover:bg-surface-2 transition-all border border-line cursor-pointer"
              >
                Temukan
              </button>
            </form>

            {scanError && (
              <div className="p-3 rounded bg-danger-soft border border-danger/20 text-danger text-label flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{scanError}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded bg-success-soft border border-success/20 text-success text-label flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Simulated Live Scanner Feed */}
            {!auditAsset && !successMsg && (
              <div className="relative border border-line rounded-lg overflow-hidden h-40 bg-surface-2 flex flex-col items-center justify-center text-white/60">
                <div className="absolute inset-x-0 h-[2px] bg-danger top-1/2 -translate-y-1/2 animate-[pulse_1.5s_infinite] shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                <div className="border border-success/40 w-64 h-24 rounded flex items-center justify-center border-dashed relative">
                  <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-success" />
                  <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-success" />
                  <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-success" />
                  <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-success" />
                  <span className="text-caption uppercase tracking-widest font-mono text-success">Menunggu Barcode...</span>
                </div>
                <span className="text-caption text-subtle mt-2 font-sans text-center px-4">Gunakan scanner barcode USB/wireless atau ketikkan kode di atas</span>
              </div>
            )}

            {/* Audit Form when asset is detected */}
            {auditAsset && (
              <form onSubmit={handleSaveAudit} className="space-y-4 text-label">
                <div className="p-3 bg-surface-2 rounded-lg border border-line space-y-1.5">
                  <div className="font-semibold text-foreground dark:text-foreground">Aset: {auditAsset.name}</div>
                  <div className="text-label text-muted dark:text-muted">Kode: {auditAsset.code} &bull; Kategori: {auditAsset.category}</div>
                  <div className="text-label text-muted dark:text-muted">Kondisi Saat Ini: <span className="capitalize font-semibold">{auditAsset.condition}</span></div>
                </div>

                <div>
                  <label className="block text-caption font-semibold text-foreground dark:text-muted uppercase tracking-wider mb-1.5">Kondisi Hasil Pemeriksaan</label>
                  <Select
                    value={auditCondition}
                    onChange={(e) => setAuditCondition(e.target.value as "good" | "damaged" | "lost")}
                    className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-label"
                  >
                    <option value="good">Baik</option>
                    <option value="damaged">Rusak</option>
                    <option value="lost">Hilang</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-caption font-semibold text-foreground dark:text-muted uppercase tracking-wider mb-1.5">Catatan Pemeriksa (Auditor)</label>
                  <textarea
                    rows={3}
                    value={auditNotes}
                    onChange={(e) => setAuditNotes(e.target.value)}
                    placeholder="Contoh: Layar lecet ringan, adaptor hilang..."
                    className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-label"
                  />
                </div>

                <div className="border-t border-line pt-4 flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setAuditAsset(null)}
                    className="px-4 py-2 rounded-lg border border-line text-label font-semibold text-foreground dark:text-muted hover:bg-surface-2 transition-all cursor-pointer"
                  >
                    Reset Pindai
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-success hover:bg-success text-label font-semibold text-white rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Simpan Laporan Audit
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
