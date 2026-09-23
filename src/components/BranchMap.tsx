"use client";

import React, { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client-api";
import { Button, Input } from "@/components/ui";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface BranchMapProps {
  lat: number;
  lng: number;
  radius: number;
  onChange: (lat: number, lng: number) => void;
}

export default function BranchMap({ lat, lng, radius, onChange }: BranchMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ label: string; lat: number; lng: number }>>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  async function search() {
    if (query.trim().length < 3 || busy) return;
    setBusy(true); setMessage(""); setResults([]);
    try {
      const response = await api.get<{ places: typeof results; message?: string }>(`/api/v1/branches/search?q=${encodeURIComponent(query.trim())}`);
      setResults(response.data?.places ?? []);
      setMessage(response.data?.message ?? (response.data?.places.length ? "Pilih hasil, lalu geser pin untuk ketelitian." : "Lokasi tidak ditemukan. Coba nama kota/alamat lain atau koordinat."));
    } catch (err) { setMessage(errorMessage(err)); } finally { setBusy(false); }
  }

  useEffect(() => {
    // Fix leaflet marker icon URLs
    // Leaflet derives icon URLs from a private field that breaks under a
    // bundler; removing it forces the explicit CDN URLs set below to be used.
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
    });

    if (mapRef.current && !leafletMap.current) {
      // Initialize map
      leafletMap.current = L.map(mapRef.current).setView([lat, lng], 16);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(leafletMap.current);

      // Create marker
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(leafletMap.current);

      // Create radius circle
      circleRef.current = L.circle([lat, lng], {
        radius: radius,
        color: "#3b82f6",
        fillColor: "#3b82f6",
        fillOpacity: 0.15,
      }).addTo(leafletMap.current);

      // Handle marker drag end
      markerRef.current.on("dragend", () => {
        const position = markerRef.current!.getLatLng();
        onChangeRef.current(position.lat, position.lng);
        circleRef.current!.setLatLng(position);
      });

      // Handle map click
      leafletMap.current.on("click", (e) => {
        const position = e.latlng;
        markerRef.current!.setLatLng(position);
        circleRef.current!.setLatLng(position);
        onChangeRef.current(position.lat, position.lng);
      });
    }

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  // Update map marker and circle position when lat/lng changes from external source
  useEffect(() => {
    if (leafletMap.current && markerRef.current && circleRef.current) {
      const position = L.latLng(lat, lng);
      markerRef.current.setLatLng(position);
      circleRef.current.setLatLng(position);
      leafletMap.current.setView(position);
    }
  }, [lat, lng]);

  // Update circle radius when radius value changes
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius(radius);
    }
  }, [radius]);

  return (
    <div className="space-y-1">
      <label htmlFor="branch-place-search" className="text-label font-semibold">Cari alamat / cabang / koordinat</label>
      <div className="flex gap-2"><Input id="branch-place-search" value={query} maxLength={160} disabled={busy} placeholder="Contoh: Bandung atau -6.9175, 107.6191" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /><Button type="button" disabled={query.trim().length < 3} loading={busy} onClick={() => void search()}>Cari</Button></div>
      <p className="text-caption text-muted">Pencarian dilakukan saat menekan Cari, bukan otomatis. Jika geocoding diaktifkan, teks alamat dikirim ke penyedia; jangan masukkan informasi pribadi/rahasia.</p>
      {message && <p role="status" className="text-body-sm text-muted">{message}</p>}
      {!!results.length && <ul className="border border-line rounded-lg max-h-48 overflow-y-auto">{results.map((result, index) => <li key={index}><button type="button" className="text-left w-full p-3 text-body-sm hover:bg-surface-2" onClick={() => { onChangeRef.current(result.lat, result.lng); leafletMap.current?.setView([result.lat, result.lng], 17); setResults([]); }}>{result.label}</button></li>)}</ul>}
      <label className="text-label text-subtle font-semibold">Titik Lokasi & Radius Absen</label>
      <div 
        ref={mapRef} 
        className="w-full h-64 rounded-lg border border-white/8 relative z-10"
        style={{ minHeight: "250px" }}
      />
      <p className="text-label text-muted italic mt-1">
        Geser pin atau klik peta untuk menyesuaikan titik. Koordinat hanya tersimpan setelah tombol Simpan cabang ditekan. Data peta/alamat: OpenStreetMap contributors (ODbL).
      </p>
    </div>
  );
}
