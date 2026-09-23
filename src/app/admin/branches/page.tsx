"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { 
  Building2, 
  MapPin, 
  Clock, 
  Trash2, 
  Edit, 
  Plus, 
  X, 
  Loader2,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Dynamic import of Leaflet map component to prevent SSR window reference error
const BranchMap = dynamic(() => import("@/components/BranchMap"), {
  ssr: false,
  loading: () => (
    <div className="h-64 bg-surface-2 border border-line rounded-lg animate-pulse flex items-center justify-center text-label text-muted">
      Memuat Peta Interaktif...
    </div>
  ),
});

interface Branch {
  _id?: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusMeter: number;
  workHours: {
    start: string;
    end: string;
  };
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Form states
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(-6.200000); // Default Jakarta coordinates
  const [lng, setLng] = useState(106.816666);
  const [radiusMeter, setRadiusMeter] = useState(15);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/branches");
      const data = await res.json();
      if (data.success) {
        setBranches(data.data);
      }
    } catch (err) {
      console.error("Gagal memuat cabang:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBranches();
  }, [fetchBranches]);

  const handleOpenForm = (branch?: Branch) => {
    if (branch) {
      setSelectedBranchId(branch._id || null);
      setName(branch.name);
      setAddress(branch.address);
      setLat(branch.lat);
      setLng(branch.lng);
      setRadiusMeter(branch.radiusMeter);
      setStartTime(branch.workHours.start);
      setEndTime(branch.workHours.end);
    } else {
      setSelectedBranchId(null);
      setName("");
      setAddress("");
      setLat(-6.200000);
      setLng(106.816666);
      setRadiusMeter(15);
      setStartTime("09:00");
      setEndTime("17:00");
    }
    setErrorMessage("");
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/v1/branches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: selectedBranchId,
          name,
          address,
          lat,
          lng,
          radiusMeter,
          workHours: {
            start: startTime,
            end: endTime,
          },
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchBranches();
        setFormOpen(false);
      } else {
        setErrorMessage(data.error?.message || "Gagal menyimpan cabang");
      }
    } catch (err) {
      setErrorMessage("Terjadi kesalahan koneksi server");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBranch = async (id: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus cabang kantor ini?")) return;

    try {
      const response = await fetch(`/api/v1/branches/${id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        fetchBranches();
      }
    } catch (err) {
      console.error("Gagal menghapus cabang:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-title font-semibold text-foreground dark:text-foreground">Master Data Cabang Kantor</h1>
          <p className="text-label text-muted dark:text-muted mt-1">Konfigurasi lokasi penempatan cabang kantor dan area geofence absensi</p>
        </div>
        <button
          onClick={() => handleOpenForm()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground border border-line text-body font-semibold cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-2 active:scale-[0.98] transition-all"
        >
          <Plus className="w-4 h-4" />
          Tambah Cabang
        </button>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-muted dark:text-muted">
          <Loader2 className="w-8 h-8 animate-spin text-foreground" />
        </div>
      ) : branches.length === 0 ? (
        <div className="h-48 border border-dashed border-line rounded-xl flex flex-col items-center justify-center text-center p-6 text-muted">
          <Building2 className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-body font-medium">Belum ada cabang terdaftar</p>
          <p className="text-label mt-1">Tambahkan cabang kantor baru untuk memulai penempatan lokasi absensi karyawan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {branches.map((branch) => (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              key={branch._id}
              className="bg-white border border-line/60 dark:border-white/6 rounded-xl p-5 hover:border-white/12 hover:bg-surface transition-all duration-300 flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <span className="px-2 py-0.5 rounded bg-surface-2 dark:bg-white/10 text-muted dark:text-muted border border-line font-semibold text-caption">
                      Radius: {branch.radiusMeter}m
                    </span>
                    <h3 className="text-body-lg font-semibold text-foreground dark:text-foreground mt-1">{branch.name}</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleOpenForm(branch)}
                      className="p-1.5 rounded hover:bg-white/4 text-muted dark:text-muted hover:text-foreground transition-all cursor-pointer"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteBranch(branch._id!)}
                      className="p-1.5 rounded hover:bg-danger-soft text-muted dark:text-muted hover:text-danger transition-all cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 text-label text-muted">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" />
                    <span className="text-foreground">{branch.address}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-muted shrink-0" />
                    <span className="text-foreground">Operasional: {branch.workHours.start} - {branch.workHours.end} WIB</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-line text-label text-muted font-mono">
                Koordinat: {branch.lat.toFixed(6)}, {branch.lng.toFixed(6)}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Slide-over Form Panel */}
      <AnimatePresence>
        {formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-end font-sans">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseForm}
              className="absolute inset-0 bg-black"
            />

            {/* Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-lg h-full bg-surface border-l border-line shadow-[var(--shadow-pop)] relative z-10 p-6 flex flex-col justify-between overflow-y-auto"
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <h2 className="text-body-lg font-semibold text-foreground dark:text-foreground">
                    {selectedBranchId ? "Edit Cabang Kantor" : "Tambah Cabang Kantor Baru"}
                  </h2>
                  <button
                    onClick={handleCloseForm}
                    className="p-1 rounded bg-surface border border-line text-muted dark:text-muted hover:text-foreground cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {errorMessage && (
                  <div className="p-3 rounded-lg bg-danger-soft border border-danger/20 text-danger text-label flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <form id="branch-form" onSubmit={handleSubmit} className="space-y-4 text-label">
                  <div className="space-y-1">
                    <label className="text-foreground font-semibold">Nama Cabang</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Kantor Pusat Jakarta"
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-muted text-label"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-foreground font-semibold">Alamat Kantor</label>
                    <textarea
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="e.g. Jl. Sudirman No. 12, Jakarta Selatan"
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-muted text-label"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold">Jam Masuk Operasional</label>
                      <input
                        type="time"
                        required
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-foreground font-semibold">Jam Pulang Operasional</label>
                      <input
                        type="time"
                        required
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-foreground font-semibold">Radius Area Absen (Meter)</label>
                    <input
                      type="number"
                      required
                      min={10}
                      max={1000}
                      value={radiusMeter}
                      onChange={(e) => setRadiusMeter(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
                      className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all text-label"
                    />
                  </div>

                  {/* Interaktive Leaflet Map */}
                  <BranchMap
                    lat={lat}
                    lng={lng}
                    radius={radiusMeter}
                    onChange={(nLat, nLng) => {
                      setLat(nLat);
                      setLng(nLng);
                    }}
                  />
                </form>
              </div>

              <div className="border-t border-line pt-4 mt-6 flex items-center justify-end gap-3 bg-surface relative z-20">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="px-4 py-2 rounded-lg border border-line text-label font-semibold text-muted dark:text-muted hover:text-foreground hover:bg-surface cursor-pointer transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="branch-form"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground border border-line text-label font-semibold cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-2 disabled:opacity-50 active:scale-[0.98] transition-all flex items-center gap-1.5"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Simpan Cabang
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
