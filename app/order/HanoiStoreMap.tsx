"use client";

import "leaflet/dist/leaflet.css";
import { CheckCircle2, Navigation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import styles from "./HanoiStoreMap.module.css";

type HanoiMapStore = {
  id: string;
  name: string;
  kind: string;
  address: string;
  coordinates: string;
};

type HanoiStoreMapProps = {
  stores: readonly HanoiMapStore[];
  onSelect: (storeId: string) => void;
};

function parseCoordinates(coordinates: string): [number, number] {
  const [latitude, longitude] = coordinates.split(",").map((value) => Number(value.trim()));
  return [latitude, longitude];
}

export default function HanoiStoreMap({ stores, onSelect }: HanoiStoreMapProps) {
  const mapRootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const L = await import("leaflet");
      if (disposed || !mapRootRef.current || mapRef.current) return;

      const map = L.map(mapRootRef.current, {
        attributionControl: false,
        zoomControl: false,
        minZoom: 10,
        maxZoom: 18,
        scrollWheelZoom: false,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
      }).addTo(map);

      L.control.zoom({ position: "topright" }).addTo(map);

      stores.filter((store) => store.coordinates).forEach((store) => {
        const position = parseCoordinates(store.coordinates);
        const official = store.kind.toLocaleLowerCase("vi-VN").includes("chính thống");

        const marker = L.circleMarker(position, {
          radius: official ? 8 : 7,
          color: "#ffffff",
          weight: 3,
          fillColor: official ? "#13853a" : "#f0672b",
          fillOpacity: 1,
          opacity: 1,
          className: official ? styles.officialMarker : styles.partnerMarker,
        }).addTo(map);

        marker.bindTooltip(store.name, {
          direction: "top",
          offset: [0, -7],
          opacity: 0.96,
        });
        marker.on("click", () => onSelectRef.current(store.id));
      });

      // Keep the first view focused on the dense central/western Hanoi network.
      // Outlying points remain available by panning the real map.
      map.setView([21.0185, 105.8015], 13);

      requestAnimationFrame(() => map.invalidateSize());
      setReady(true);
    })();

    return () => {
      disposed = true;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [stores]);

  return (
    <section className={styles.mapShell} aria-label="Bản đồ thật các điểm bán Tào Phớ 88 tại Hà Nội">
      <div ref={mapRootRef} className={styles.mapCanvas} />
      {!ready && <div className={styles.loading}>Đang tải bản đồ Hà Nội…</div>}

      <div className={styles.networkBadge}>
        <CheckCircle2 size={14} />
        <strong>{stores.length} điểm đã xác minh</strong>
      </div>

      <div className={styles.deliveryBadge}>
        <Navigation size={13} fill="currentColor" />
        <span>Chạm một điểm để xem chi tiết</span>
      </div>

      <span className={styles.mapCredit} aria-label="Nguồn bản đồ OpenStreetMap và CARTO">
        © OSM · CARTO
      </span>
    </section>
  );
}
