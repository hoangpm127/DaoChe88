"use client";

import "leaflet/dist/leaflet.css";
import { LocateFixed, MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import styles from "./HanoiLocationPicker.module.css";

type HanoiLocationPickerProps = {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
  label?: string;
  disabled?: boolean;
};

export const HANOI_CENTER = { latitude: 21.028511, longitude: 105.804817 } as const;
export const HANOI_BOUNDS = {
  south: 20.5,
  west: 105.2,
  north: 21.5,
  east: 106.2,
} as const;

const validCoordinate = (value: number | null, min: number, max: number) =>
  value !== null && Number.isFinite(value) && value >= min && value <= max;

export function isHanoiCoordinate(latitude: number | null, longitude: number | null) {
  return validCoordinate(latitude, HANOI_BOUNDS.south, HANOI_BOUNDS.north)
    && validCoordinate(longitude, HANOI_BOUNDS.west, HANOI_BOUNDS.east);
}

export default function HanoiLocationPicker({ latitude, longitude, onChange, label = "Vị trí trên bản đồ Hà Nội", disabled = false }: HanoiLocationPickerProps) {
  const mapId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const placeMarkerRef = useRef<((latitude: number, longitude: number, notify: boolean) => void) | null>(null);
  const onChangeRef = useRef(onChange);
  const initialCoordinatesRef = useRef({ latitude, longitude, valid: isHanoiCoordinate(latitude, longitude) });
  const [ready, setReady] = useState(false);
  const hasCoordinates = isHanoiCoordinate(latitude, longitude);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      const initial = initialCoordinatesRef.current;

      const map = L.map(container, {
        minZoom: 9,
        maxZoom: 19,
        maxBounds: [[HANOI_BOUNDS.south, HANOI_BOUNDS.west], [HANOI_BOUNDS.north, HANOI_BOUNDS.east]],
        maxBoundsViscosity: 1,
      }).setView(
        initial.valid ? [initial.latitude!, initial.longitude!] : [HANOI_CENTER.latitude, HANOI_CENTER.longitude],
        initial.valid ? 16 : 11,
      );

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const markerIcon = L.divIcon({
        className: styles.markerIcon,
        html: "<span></span>",
        iconAnchor: [18, 36],
        iconSize: [36, 36],
      });

      const placeMarker = (nextLatitude: number, nextLongitude: number, notify: boolean) => {
        if (!isHanoiCoordinate(nextLatitude, nextLongitude)) return;
        if (!markerRef.current) {
          const marker = L.marker([nextLatitude, nextLongitude], {
            draggable: !disabled,
            icon: markerIcon,
            keyboard: true,
            title: "Kéo để chỉnh vị trí",
          }).addTo(map);
          marker.on("dragend", () => {
            const point = marker.getLatLng();
            onChangeRef.current(Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6)));
          });
          markerRef.current = marker;
        } else {
          markerRef.current.setLatLng([nextLatitude, nextLongitude]);
        }
        if (notify) onChangeRef.current(Number(nextLatitude.toFixed(6)), Number(nextLongitude.toFixed(6)));
      };
      placeMarkerRef.current = placeMarker;

      if (initial.valid) placeMarker(initial.latitude!, initial.longitude!, false);
      if (!disabled) {
        map.on("click", (event) => placeMarker(event.latlng.lat, event.latlng.lng, true));
      }

      mapRef.current = map;
      setReady(true);
      requestAnimationFrame(() => map.invalidateSize());
    })();

    return () => {
      cancelled = true;
      placeMarkerRef.current = null;
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [disabled]);

  useEffect(() => {
    if (!ready || !mapRef.current || !hasCoordinates) return;
    const point: [number, number] = [latitude!, longitude!];
    if (markerRef.current) markerRef.current.setLatLng(point);
    else placeMarkerRef.current?.(point[0], point[1], false);
    mapRef.current.panInside(point, { padding: [36, 36] });
  }, [hasCoordinates, latitude, longitude, ready]);

  const resetView = () => {
    mapRef.current?.setView([HANOI_CENTER.latitude, HANOI_CENTER.longitude], 11);
  };

  return (
    <section className={styles.picker} aria-labelledby={`${mapId}-label`}>
      <div className={styles.heading}>
        <div>
          <strong id={`${mapId}-label`}><MapPin size={16} /> {label}</strong>
          <small>{disabled ? "Vị trí chỉ có thể xem." : "Chạm bản đồ để đặt ghim, sau đó kéo ghim tới đúng cửa."}</small>
        </div>
        <button type="button" onClick={resetView} aria-label="Đưa bản đồ về trung tâm Hà Nội">
          <LocateFixed size={16} /> Hà Nội
        </button>
      </div>
      <div className={styles.mapFrame}>
        <div ref={containerRef} className={styles.map} aria-label={label} />
        {!hasCoordinates && <div className={styles.emptyHint}><MapPin size={24} /><span>Chọn một điểm trên bản đồ</span></div>}
      </div>
      <div className={hasCoordinates ? styles.coordinates : styles.coordinatesEmpty} aria-live="polite">
        {hasCoordinates
          ? `Đã ghim: ${latitude!.toFixed(6)}, ${longitude!.toFixed(6)}`
          : "Chưa có tọa độ — cần ghim vị trí trước khi lưu."}
      </div>
    </section>
  );
}
