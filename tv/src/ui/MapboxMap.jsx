import 'mapbox-gl/dist/mapbox-gl.css';
import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';
import { xc } from '../tokens.js';

/**
 * Live Mapbox map for the Location chapter, display-only. Loaded lazily and only when the box is
 * online with a token; reports `onFail` (no tiles within 12 s, style error) so the chapter can
 * fall back to the offline schematic.
 */
export default function MapboxMap({ token, site, places, poi, is3d, cam, onFail }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef([]);
  const bounds = useRef(null);

  useEffect(() => {
    mapboxgl.accessToken = token;
    let failed = false;
    const fail = (why) => { if (!failed) { failed = true; onFail?.(why); } };
    const center = site ? [site.lng, site.lat] : [places[0].lng, places[0].lat];
    let map;
    try {
      map = new mapboxgl.Map({ container: el.current, style: 'mapbox://styles/mapbox/streets-v12', center, zoom: 13.5, interactive: false, attributionControl: false, fadeDuration: 0 });
    } catch (e) {
      fail(String(e?.message ?? e));
      return undefined;
    }
    mapRef.current = map;
    const timer = setTimeout(() => { if (!map.loaded()) fail('timeout'); }, 12_000);
    map.on('error', (e) => { if (!map.loaded()) fail(e?.error?.message ?? 'map error'); });

    const b = new mapboxgl.LngLatBounds();
    const pin = (cls, color, label) => {
      const d = document.createElement('div');
      d.className = `mb-pin ${cls}`;
      d.style.background = color;
      d.innerHTML = `<span>${label}</span>`;
      return d;
    };
    if (site) {
      new mapboxgl.Marker({ element: pin('site', xc.gold, '&#9679;') }).setLngLat([site.lng, site.lat]).addTo(map);
      b.extend([site.lng, site.lat]);
    }
    markers.current = places.map((p, i) => {
      const d = pin(p.upcoming ? 'upcoming' : '', p.color, String(i + 1));
      if (p.upcoming) { d.style.color = p.color; d.style.borderColor = p.color; }
      b.extend([p.lng, p.lat]);
      return { el: d, marker: new mapboxgl.Marker({ element: d }).setLngLat([p.lng, p.lat]).addTo(map) };
    });
    bounds.current = b;

    map.on('load', () => {
      clearTimeout(timer);
      map.addSource('link', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'link', type: 'line', source: 'link', layout: { 'line-cap': 'round' }, paint: { 'line-color': xc.gold, 'line-width': 4, 'line-opacity': 0.85, 'line-dasharray': [1.6, 1.4] } });
      const labelLayer = (map.getStyle().layers || []).find((l) => l.type === 'symbol' && l.layout && l.layout['text-field']);
      map.addLayer({
        id: '3d-buildings', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14,
        layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': '#d9cfc2', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'min_height'], 'fill-extrusion-opacity': 0.85 },
      }, labelLayer?.id);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 120, maxZoom: 15, duration: 0 });
    });
    return () => { clearTimeout(timer); map.remove(); mapRef.current = null; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selected landmark: highlight, draw the line from the site, and frame both unless a camera is streaming.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m, i) => m.el.classList.toggle('on', i === poi));
    const p = poi != null ? places[poi] : null;
    const apply = () => {
      map.getSource('link')?.setData(site && p
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: [[site.lng, site.lat], [p.lng, p.lat]] } }
        : { type: 'FeatureCollection', features: [] });
      if (cam) return;
      if (p && site) map.fitBounds(new mapboxgl.LngLatBounds([site.lng, site.lat], [site.lng, site.lat]).extend([p.lng, p.lat]), { padding: 160, maxZoom: 15.4, duration: 700 });
      else if (bounds.current && !bounds.current.isEmpty()) map.fitBounds(bounds.current, { padding: 120, maxZoom: 15, duration: 600 });
    };
    if (map.loaded()) apply(); else map.once('load', apply);
  }, [poi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cam || !Number.isFinite(Number(cam.lng)) || !Number.isFinite(Number(cam.lat))) return;
    map.easeTo({ center: [Number(cam.lng), Number(cam.lat)], zoom: Number(cam.zoom) || map.getZoom(), bearing: Number(cam.bearing) || 0, pitch: Number(cam.pitch) || 0, duration: 120, easing: (t) => t });
  }, [cam]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => { if (map.getLayer('3d-buildings')) map.setLayoutProperty('3d-buildings', 'visibility', is3d ? 'visible' : 'none'); };
    if (map.loaded()) apply(); else map.once('load', apply);
  }, [is3d]);

  return <div ref={el} className="loc-mapbox" />;
}
