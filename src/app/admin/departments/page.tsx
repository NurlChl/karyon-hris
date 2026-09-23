"use client";

import React, { useState, useEffect } from "react";
import { ClipboardList, Briefcase, Plus, Trash2, Edit, X, Loader2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SearchSelect from "@/components/SearchSelect";

import { Select } from "@/components/ui";
/**
 * A reference the API may return either populated or as a bare id, depending on
 * the endpoint. The form reads `_id` off it and the table reads `name`, so both
 * shapes have to be spelled out rather than collapsed into one.
 */
type Ref = { _id: string; name: string; employeeId?: string } | string | null;

interface MasterItem {
  _id: string;
  name: string;
  headId?: Ref;
  divisionId?: Ref;
  branchId?: Ref;
  description?: string;
  jobdesk?: string;
  requirements?: string;
  location?: string;
  type?: string;
  status?: "active" | "inactive";
}

/** Reads a populated reference, tolerating the bare-id form. */
function refName(ref: Ref | undefined): string {
  return typeof ref === "object" && ref !== null ? ref.name : "";
}

/** Reads the id of a reference in either form. */
function refId(ref: Ref | undefined): string {
  if (!ref) return "";
  return typeof ref === "string" ? ref : ref._id;
}

export default function DepartmentsPage() {
  const [activeTab, setActiveTab] = useState<"division" | "position">("division");
  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Data lists
  const [employees, setEmployees] = useState<Array<{ _id: string; name: string; employeeId?: string }>>([]);
  const [divisions, setDivisions] = useState<Array<{ _id: string; name: string }>>([]);
  const [branches, setBranches] = useState<Array<{ _id: string; name: string }>>([]);

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [headId, setHeadId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [divisionBranchId, setDivisionBranchId] = useState("");
  
  // Vacancy detail states
  const [description, setDescription] = useState("");
  const [jobdesk, setJobdesk] = useState("");
  const [requirements, setRequirements] = useState("");
  const [location, setLocation] = useState("Jakarta");
  const [type, setType] = useState("Full-Time");
  const [status, setStatus] = useState("active");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchEmployees = async () => {
    try {
      const res = await fetch("/api/v1/employees");
      const data = await res.json();
      if (data.success) setEmployees(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchBranchesList = async () => {
    try {
      const res = await fetch("/api/v1/branches");
      const data = await res.json();
      if (data.success) setBranches(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDivisionsList = async () => {
    try {
      const res = await fetch("/api/v1/divisions");
      const data = await res.json();
      if (data.success) setDivisions(data.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchItems = async () => {
    setLoading(true);
    setItems([]);
    try {
      const endpoint = activeTab === "division" ? "/api/v1/divisions" : "/api/v1/positions";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch (err) {
      console.error("Gagal memuat data master:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchEmployees();
    fetchDivisionsList();
    fetchBranchesList();
  }, [activeTab]);

  const handleOpenForm = (item?: MasterItem) => {
    if (item) {
      setSelectedId(item._id);
      setName(item.name);
      setHeadId(refId(item.headId));
      setDivisionId(refId(item.divisionId));
      setDivisionBranchId(refId(item.branchId));
      setDescription(item.description || "");
      setJobdesk(item.jobdesk || "");
      setRequirements(item.requirements || "");
      setLocation(item.location || "Jakarta");
      setType(item.type || "Full-Time");
      setStatus(item.status || "active");
    } else {
      setSelectedId(null);
      setName("");
      setHeadId("");
      setDivisionId(divisions[0]?._id || "");
      setDivisionBranchId(branches[0]?._id || "");
      setDescription("");
      setJobdesk("");
      setRequirements("");
      setLocation("Jakarta");
      setType("Full-Time");
      setStatus("active");
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

    const endpoint = activeTab === "division" ? "/api/v1/divisions" : "/api/v1/positions";
    const payload = activeTab === "division"
      ? { id: selectedId, name, headId: headId || null, branchId: divisionBranchId || null }
      : { 
          id: selectedId, 
          name, 
          divisionId: divisionId || null,
          description,
          jobdesk,
          requirements,
          location,
          type,
          status
        };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        fetchItems();
        setFormOpen(false);
      } else {
        setErrorMessage(data.error?.message || "Gagal menyimpan data");
      }
    } catch (err) {
      setErrorMessage("Terjadi kesalahan koneksi server");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    const label = activeTab === "division" ? "divisi" : "jabatan";
    if (!confirm(`Apakah Anda yakin ingin menghapus ${label} ini?`)) return;

    const endpoint = activeTab === "division" ? `/api/v1/divisions/${id}` : `/api/v1/positions/${id}`;

    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
      });
      const data = await response.json();
      if (data.success) {
        fetchItems();
      }
    } catch (err) {
      console.error("Gagal menghapus item:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <h1 className="text-title font-semibold text-foreground dark:text-foreground">Divisi & Jabatan</h1>
          <p className="text-label text-muted dark:text-muted mt-1">Kelola departemen divisi kerja dan penamaan jenjang jabatan karyawan</p>
        </div>
        <button
          onClick={() => handleOpenForm()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground border border-line text-body font-semibold cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-2 active:scale-[0.98] transition-all"
        >
          <Plus className="w-4 h-4" />
          Tambah {activeTab === "division" ? "Divisi" : "Jabatan"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-surface-2 border border-line rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("division")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-label font-semibold cursor-pointer transition-all ${ activeTab === "division" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground" }`}
        >
          <ClipboardList className="w-3.5 h-3.5" />
          Divisi / Departemen
        </button>
        <button
          onClick={() => setActiveTab("position")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-label font-semibold cursor-pointer transition-all ${ activeTab === "position" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground" }`}
        >
          <Briefcase className="w-3.5 h-3.5" />
          Jabatan Kerja
        </button>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-muted dark:text-muted">
          <Loader2 className="w-8 h-8 animate-spin text-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="h-48 border border-dashed border-line rounded-xl flex flex-col items-center justify-center text-center p-6 text-muted">
          {activeTab === "division" ? <ClipboardList className="w-8 h-8 mb-2 opacity-50" /> : <Briefcase className="w-8 h-8 mb-2 opacity-50" />}
          <p className="text-body font-medium">Belum ada {activeTab === "division" ? "divisi" : "jabatan"} terdaftar</p>
          <p className="text-label mt-1">Tambahkan data master baru untuk melengkapi data jabatan operasional karyawan.</p>
        </div>
      ) : (
        <div className="bg-surface border border-line/60 dark:border-white/6 rounded-xl overflow-hidden">
          <table className="w-full text-left text-label border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-muted dark:text-muted">
                <th className="p-4 font-semibold">Nama {activeTab === "division" ? "Divisi / Departemen" : "Jabatan Kerja"}</th>
                {activeTab === "division" ? (
                  <>
                    <th className="p-4 font-semibold">Cabang</th>
                    <th className="p-4 font-semibold">Ketua Divisi</th>
                  </>
                ) : (
                  <th className="p-4 font-semibold">Divisi Terkait</th>
                )}
                <th className="p-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item._id} className="border-b border-line hover:bg-surface-2/50 dark:hover:bg-white/1 transition-all">
                  <td className="p-4 font-semibold text-foreground dark:text-foreground text-body">{item.name}</td>
                  {activeTab === "division" ? (
                    <>
                      <td className="p-4 text-muted dark:text-muted font-medium">
                        {refName(item.branchId) || "-"}
                      </td>
                      <td className="p-4 text-muted dark:text-muted font-medium">
                        {typeof item.headId === "object" && item.headId
                          ? `${item.headId.name} (${item.headId.employeeId ?? "-"})`
                          : "-"}
                      </td>
                    </>
                  ) : (
                    <td className="p-4 text-muted dark:text-muted font-medium">
                      {refName(item.divisionId) || "-"}
                    </td>
                  )}
                  <td className="p-4 text-right flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleOpenForm(item)}
                      className="p-1.5 rounded hover:bg-white/4 text-muted dark:text-muted hover:text-foreground transition-all cursor-pointer"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteItem(item._id)}
                      className="p-1.5 rounded hover:bg-danger-soft text-muted dark:text-muted hover:text-danger transition-all cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Overlay Form Modal */}
      <AnimatePresence>
        {formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center font-sans">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseForm}
              className="absolute inset-0 bg-black"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface border border-line shadow-[var(--shadow-pop)] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative z-10 p-6"
            >
              <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
                <h3 className="text-body-lg font-semibold text-foreground dark:text-foreground">
                  {selectedId ? `Edit ${activeTab === "division" ? "Divisi" : "Jabatan"}` : `Tambah ${activeTab === "division" ? "Divisi" : "Jabatan"} Baru`}
                </h3>
                <button
                  onClick={handleCloseForm}
                  className="p-1 rounded bg-surface border border-line text-muted dark:text-muted hover:text-foreground cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-lg bg-danger-soft border border-danger/20 text-danger text-label flex items-center gap-2 mb-4">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4 text-label">
                <div className="space-y-1">
                  <label className="text-foreground font-semibold">Nama {activeTab === "division" ? "Divisi" : "Jabatan"}</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={activeTab === "division" ? "e.g. Finance & Accounting" : "e.g. Senior Software Engineer"}
                    className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-subtle text-label"
                  />
                </div>

                {activeTab === "division" ? (
                  <>
                    <SearchSelect
                      label="Hubungkan ke Cabang Kantor"
                      value={divisionBranchId}
                      onChange={setDivisionBranchId}
                      options={branches.map((b) => ({
                        label: b.name,
                        value: b._id,
                      }))}
                      placeholder="Pilih Cabang Kantor..."
                    />

                    <SearchSelect
                      label="Ketua / Manager Divisi"
                      value={headId}
                      onChange={setHeadId}
                      options={employees.map((emp) => ({
                        label: `${emp.name} (${emp.employeeId})`,
                        value: emp._id,
                      }))}
                      placeholder="Pilih Ketua Divisi (Opsional)..."
                    />
                  </>
                ) : (
                  <>
                    <SearchSelect
                      label="Hubungkan ke Divisi"
                      value={divisionId}
                      onChange={setDivisionId}
                      options={divisions.map((div) => ({
                        label: div.name,
                        value: div._id,
                      }))}
                      placeholder="Pilih Divisi Kerja..."
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-foreground font-semibold">Tipe Pekerjaan</label>
                        <Select
                          value={type}
                          onChange={(e) => setType(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-label"
                        >
                          <option value="Full-Time">Full-Time</option>
                          <option value="Part-Time">Part-Time</option>
                          <option value="Contract">Contract</option>
                          <option value="Internship">Internship</option>
                          <option value="Freelance">Freelance</option>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-foreground font-semibold">Status Lowongan Loker</label>
                        <Select
                          value={status}
                          onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                          className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-label"
                        >
                          <option value="active">Aktif (Buka Lowongan)</option>
                          <option value="inactive">Nonaktif (Tutup Lowongan)</option>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-foreground font-semibold">Lokasi Penempatan Kerja</label>
                      <input
                        type="text"
                        required
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. Jakarta, Remote, Hybrid"
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-subtle text-label"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-foreground font-semibold">Deskripsi Lowongan</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Deskripsikan penawaran/informasi umum mengenai lowongan ini..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-subtle text-label resize-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-foreground font-semibold">Tanggung Jawab Pekerjaan (Jobdesk)</label>
                      <textarea
                        value={jobdesk}
                        onChange={(e) => setJobdesk(e.target.value)}
                        placeholder="Sebutkan tanggung jawab pekerjaan (satu per baris)..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-subtle text-label resize-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-foreground font-semibold">Kebutuhan / Persyaratan (Requirements)</label>
                      <textarea
                        value={requirements}
                        onChange={(e) => setRequirements(e.target.value)}
                        placeholder="Sebutkan persyaratan pelamar (satu per baris)..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-foreground dark:text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-subtle text-label resize-none"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-line mt-6">
                  <button
                    type="button"
                    onClick={handleCloseForm}
                    className="px-4 py-2 rounded-lg border border-line text-label font-semibold text-muted dark:text-muted hover:text-foreground hover:bg-surface cursor-pointer transition-all"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground border border-line text-label font-semibold cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-2 disabled:opacity-50 active:scale-[0.98] transition-all flex items-center gap-1.5"
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Simpan
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
