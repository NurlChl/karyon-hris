"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Package, Loader2, ClipboardCheck, X, FileText, CheckCircle2, ShieldAlert 
} from "lucide-react";

interface InventoryAsset {
  _id: string;
  code: string;
  name: string;
  category: "laptop" | "phone" | "vehicle" | "other";
  condition: "good" | "damaged" | "lost";
}

interface InventoryAssignment {
  _id: string;
  inventoryId: InventoryAsset;
  handoverDate: string;
  signatureUrl?: string;
  status: "pending_handover" | "active" | "returned";
}

export default function InventoryEmployeePage() {
  const [assignments, setAssignments] = useState<InventoryAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAsg, setSelectedAsg] = useState<InventoryAssignment | null>(null);

  // Canvas ref for signature
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signMethod, setSignMethod] = useState<"draw" | "upload">("draw");
  const [uploadedFileBase64, setUploadedFileBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedFileBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const fetchMyInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/inventory/self");
      const data = await res.json();
      if (data.success) {
        setAssignments(data.data || []);
      }
    } catch (err) {
      console.error("Gagal memuat inventaris pribadi:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyInventory();
  }, []);

  // Canvas drawing functions
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSubmitSignature = async () => {
    if (!selectedAsg) return;

    let signatureData = "";
    if (signMethod === "draw") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      signatureData = canvas.toDataURL("image/png");
    } else {
      if (!uploadedFileBase64) {
        alert("Silakan pilih dan unggah berkas BAST terlebih dahulu");
        return;
      }
      signatureData = uploadedFileBase64;
    }
    setSubmitting(true);

    try {
      const res = await fetch("/api/v1/inventory/self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: selectedAsg._id,
          signatureData
        })
      });
      const data = await res.json();
      if (data.success) {
        setSelectedAsg(null);
        fetchMyInventory();
      } else {
        alert(data.message || "Gagal menandatangani BAST");
      }
    } catch (err) {
      console.error(err);
      alert("Terjadi kesalahan koneksi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground dark:text-foreground transition-colors duration-200 p-6 md:p-12 font-sans relative overflow-hidden">
      <div className="max-w-4xl mx-auto space-y-8 relative z-10">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-6">
          <div>
            <h1 className="text-display-sm md:text-display text-heading">
              Inventaris & Aset Saya
            </h1>
            <p className="text-label text-muted dark:text-muted mt-1">
              Daftar aset fasilitas kantor yang sedang Anda gunakan. Lakukan penandatanganan digital BAST untuk aset baru.
            </p>
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-foreground" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="h-48 border border-dashed border-line rounded-xl flex flex-col items-center justify-center text-center p-6 text-muted bg-surface">
            <Package className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-body font-medium">Tidak ada aset inventaris yang ditugaskan untuk Anda saat ini.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {assignments.map(asg => {
              const item = asg.inventoryId;
              const isPending = asg.status === "pending_handover";
              return (
                <div 
                  key={asg._id}
                  className="bg-surface border border-line/60 dark:border-white/6 rounded-2xl p-6 flex flex-col justify-between space-y-4 hover:border-line-strong dark:hover:border-white/12 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="p-2.5 rounded-lg bg-surface-2 border border-line text-foreground">
                        <Package className="w-5 h-5" />
                      </div>
                      <span className={`px-2 py-0.5 rounded text-caption font-semibold border ${
                        asg.status === "active"
                          ? "bg-success-soft text-success dark:text-success border-success/20"
                          : "bg-warning-soft text-warning dark:text-warning border-warning/20"
                      }`}>
                        {asg.status === "active" ? "Aktif (Diterima)" : "Menunggu BAST"}
                      </span>
                    </div>

                    <div>
                      <span className="text-caption font-mono font-semibold text-muted uppercase tracking-wider">{item.code}</span>
                      <h3 className="text-body-lg font-semibold text-foreground dark:text-foreground mt-0.5">{item.name}</h3>
                      <p className="text-label text-muted dark:text-muted capitalize">Kategori: {item.category}</p>
                    </div>

                    <div className="border-t border-line pt-3 flex items-center justify-between text-label text-muted">
                      <span>Tanggal Penyerahan:</span>
                      <span className="font-semibold text-foreground">
                        {new Date(asg.handoverDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                      </span>
                    </div>
                  </div>

                  {isPending ? (
                    <button
                      onClick={() => setSelectedAsg(asg)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-label font-semibold text-primary-foreground border border-line-strong dark:border-white hover:bg-surface-2 dark:hover:bg-surface-2 cursor-pointer transition-all"
                    >
                      <FileText className="w-4 h-4" />
                      Tanda Tangan BAST Digital
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 justify-center py-2 text-caption font-semibold text-success dark:text-success bg-success-soft rounded-lg border border-success/15">
                      <CheckCircle2 className="w-4 h-4" />
                      Sudah Diserahterimakan
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Signature Digital Canvas Modal */}
        {selectedAsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <div className="w-full max-w-md bg-surface border border-line rounded-xl shadow-[var(--shadow-pop)] p-6 flex flex-col">
              <div className="flex justify-between items-center pb-4 border-b border-line">
                <div>
                  <h3 className="text-label font-semibold text-foreground dark:text-foreground uppercase">Tanda Tangan Elektronik (BAST)</h3>
                  <p className="text-label text-muted mt-0.5">Konfirmasi penerimaan barang: {selectedAsg.inventoryId.name}</p>
                </div>
                <button
                  onClick={() => setSelectedAsg(null)}
                  className="p-1 rounded bg-surface-2 border border-line text-muted dark:text-muted hover:text-foreground cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="py-4 space-y-3">
                <div className="flex gap-2 p-1 bg-surface-2 border border-line rounded-lg w-fit">
                  <button
                    type="button"
                    onClick={() => setSignMethod("draw")}
                    className={`px-3 py-1 rounded text-caption font-semibold cursor-pointer transition-all ${ signMethod === "draw" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground dark:hover:text-foreground" }`}
                  >
                    Tulis Tanda Tangan
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignMethod("upload")}
                    className={`px-3 py-1 rounded text-caption font-semibold cursor-pointer transition-all ${ signMethod === "upload" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground dark:hover:text-foreground" }`}
                  >
                    Unggah Berkas BAST
                  </button>
                </div>

                <div className="text-label text-muted dark:text-muted leading-relaxed bg-surface-2 p-2.5 rounded border border-line">
                  {signMethod === "draw" 
                    ? "Dengan menandatangani di bawah ini, saya menyatakan telah menerima aset dengan baik dan bertanggung jawab atas pemeliharaannya."
                    : "Silakan unggah pindaian (scan) / foto berkas BAST fisik yang sudah ditandatangani secara basah."
                  }
                </div>

                {signMethod === "draw" ? (
                  <div className="border border-line rounded-lg bg-white overflow-hidden relative">
                    <canvas
                      ref={canvasRef}
                      width={380}
                      height={180}
                      className="w-full h-44 cursor-crosshair bg-white"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />
                    <div className="absolute bottom-2 right-2 text-caption text-subtle select-none pointer-events-none">
                      Gunakan Mouse / Layar Sentuh
                    </div>
                  </div>
                ) : (
                  <div className="border border-dashed border-line rounded-lg p-6 bg-surface-2/50 dark:bg-surface-2 flex flex-col items-center justify-center gap-3">
                    <input
                      type="file"
                      id="bast-file-upload"
                      accept="image/*,application/pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <label
                      htmlFor="bast-file-upload"
                      className="px-4 py-2 bg-primary text-label font-semibold text-primary-foreground rounded-lg cursor-pointer hover:bg-surface-2 dark:hover:bg-surface-2 transition-all border border-line"
                    >
                      Pilih Berkas PDF / Gambar
                    </label>
                    {fileName ? (
                      <div className="text-caption text-success dark:text-success font-semibold truncate max-w-xs">
                        Terpilih: {fileName}
                      </div>
                    ) : (
                      <div className="text-caption text-subtle">Format yang diterima: PDF, PNG, JPG (Maks 5MB)</div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-4 flex gap-3">
                <button
                  onClick={signMethod === "draw" ? clearCanvas : () => { setUploadedFileBase64(""); setFileName(""); }}
                  className="flex-1 py-2 rounded-lg border border-line text-label font-semibold text-foreground dark:text-muted hover:bg-surface-2 transition-all cursor-pointer text-center"
                >
                  {signMethod === "draw" ? "Bersihkan" : "Hapus Berkas"}
                </button>
                <button
                  onClick={handleSubmitSignature}
                  disabled={submitting}
                  className="flex-1 py-2 rounded-lg bg-primary text-label font-semibold text-primary-foreground border border-line-strong dark:border-white hover:bg-surface-2 dark:hover:bg-surface-2 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Konfirmasi & Simpan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
