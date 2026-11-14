import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Marcos from "./Marcos";
import "./YellowMap.css";

type Poi = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  description: string;
};

const POIS: Poi[] = [
  {
    id: "jezero",
    name: "Jezero Crater",
    lat: 18.38,
    lon: 77.58,
    description:
      "Landing site of NASA's Perseverance rover. An ancient river delta preserving clues to past microbial life.",
  },
  {
    id: "gale",
    name: "Gale Crater",
    lat: -5.4,
    lon: 137.8,
    description:
      "Explored by the Curiosity rover. Home to Mount Sharp, a layered mountain recording Mars' climate history.",
  },
  {
    id: "valles",
    name: "Valles Marineris",
    lat: -13.9,
    lon: -59.2,
    description:
      "One of the largest canyon systems in the solar system, stretching over 4,000 km across the Martian equator.",
  },
];

const MARS_TEXTURE_URL = "/mars_viking.jpg";

function latLonToVector3(lat: number, lon: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

export default function YellowMap() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [showMarcos, setShowMarcos] = useState(false);
  const selectedPoi = POIS.find((p) => p.id === selectedId) ?? null;

  const apiRef = useRef<{
    focusPoi: (id: string) => void;
    resetView: () => void;
  } | null>(null);

  useEffect(() => {
    if (showMarcos) return;
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200
    );
    camera.position.set(0, 0, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.35;
    controls.maxDistance = 8;
    controls.target.set(0, 0, 0);
    controls.update();

    const cubeLoader = new THREE.CubeTextureLoader();
    const skybox = cubeLoader.load([
      "/milkywinky/px.png",
      "/milkywinky/nx.png",
      "/milkywinky/py.png",
      "/milkywinky/ny.png",
      "/milkywinky/pz.png",
      "/milkywinky/nz.png",
    ]);
    skybox.colorSpace = THREE.SRGBColorSpace;
    scene.background = skybox;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(5, 3, 5);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffe6cc, 0.25);
    fill.position.set(-4, -2, -3);
    scene.add(fill);

    const globeGeo = new THREE.SphereGeometry(1, 96, 96);
    const globeMat = new THREE.MeshStandardMaterial({
      color: 0xb8744f,
      roughness: 1,
      metalness: 0,
    });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globe);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      MARS_TEXTURE_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        globeMat.map = tex;
        globeMat.color.set(0xffffff);
        globeMat.needsUpdate = true;
        setReady(true);
      },
      undefined,
      () => setReady(true)
    );

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    const markers: THREE.Object3D[] = [];
    const markerGeo = new THREE.SphereGeometry(0.035, 20, 20);
    const haloGeo = new THREE.RingGeometry(0.05, 0.075, 64);

    for (const poi of POIS) {
      const pos = latLonToVector3(poi.lat, poi.lon, 1.015);
      const normal = pos.clone().normalize();

      const markerMat = new THREE.MeshBasicMaterial({ color: 0xe5c069 });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.copy(pos);
      marker.userData.poiId = poi.id;
      markerGroup.add(marker);
      markers.push(marker);

      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xe5c069,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(normal.clone().multiplyScalar(1.018));
      halo.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        normal
      );
      halo.userData.poiId = poi.id;
      markerGroup.add(halo);
      markers.push(halo);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const desiredCamPos = camera.position.clone();
    const desiredTarget = new THREE.Vector3(0, 0, 0);
    let animating = false;
    let hasSavedView = false;
    const savedCamPos = new THREE.Vector3();
    const savedTarget = new THREE.Vector3();

    const setFocusByPoi = (id: string) => {
      const poi = POIS.find((p) => p.id === id);
      if (!poi) return;
      if (!hasSavedView) {
        savedCamPos.copy(camera.position);
        savedTarget.copy(controls.target);
        hasSavedView = true;
      }
      const dir = latLonToVector3(poi.lat, poi.lon, 1).normalize();
      desiredCamPos.copy(dir.multiplyScalar(1.85));
      desiredTarget.set(0, 0, 0);
      animating = true;
    };

    const resetView = () => {
      if (hasSavedView) {
        desiredCamPos.copy(savedCamPos);
        desiredTarget.copy(savedTarget);
      } else {
        desiredCamPos.set(0, 0, 3.2);
        desiredTarget.set(0, 0, 0);
      }
      hasSavedView = false;
      animating = true;
    };

    apiRef.current = { focusPoi: setFocusByPoi, resetView };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    let pointerDownPos = { x: 0, y: 0 };

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 4) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(markers, false);
      if (hits.length > 0) {
        const id = hits[0].object.userData.poiId as string | undefined;
        if (id) {
          setSelectedId(id);
          setFocusByPoi(id);
        }
      }
    };

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);

      if (animating) {
        camera.position.lerp(desiredCamPos, 0.08);
        controls.target.lerp(desiredTarget, 0.08);
        if (
          camera.position.distanceTo(desiredCamPos) < 0.002 &&
          controls.target.distanceTo(desiredTarget) < 0.002
        ) {
          camera.position.copy(desiredCamPos);
          controls.target.copy(desiredTarget);
          animating = false;
        }
      }

      controls.update();

      const t = performance.now() * 0.003;
      for (const m of markers) {
        if ((m as THREE.Mesh).geometry instanceof THREE.RingGeometry) {
          const s = 1 + Math.sin(t) * 0.08;
          m.scale.setScalar(s);
          const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = 0.55 + Math.sin(t) * 0.25;
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerdown", onPointerDown);
      apiRef.current = null;
      controls.dispose();
      renderer.dispose();
      globeGeo.dispose();
      globeMat.dispose();
      markerGeo.dispose();
      haloGeo.dispose();
      markers.forEach((m) => {
        const mat = (m as THREE.Mesh).material as THREE.Material;
        mat.dispose();
      });
      if (globeMat.map) globeMat.map.dispose();
      skybox.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [showMarcos]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    apiRef.current?.focusPoi(id);
  };

  const handleBack = () => {
    setSelectedId(null);
    apiRef.current?.resetView();
  };

  const handleForward = () => {
    setShowMarcos(true);
  };

  if (showMarcos) {
    return <Marcos />;
  }

  return (
    <div className="mars-map">
      <div className="mars-canvas" ref={mountRef} />
      {!ready && <div className="mars-loading" />}

      <div className="mars-overlay">
        {selectedPoi && (
          <div className="mars-detail" role="dialog" aria-label="Location details">
            <div className="mars-detail-head">
              <h2>{selectedPoi.name}</h2>
            </div>
            <p className="mars-coords">
              {Math.abs(selectedPoi.lat).toFixed(2)}°{" "}
              {selectedPoi.lat >= 0 ? "N" : "S"},{" "}
              {Math.abs(selectedPoi.lon).toFixed(2)}°{" "}
              {selectedPoi.lon >= 0 ? "E" : "W"}
            </p>
            <div className="mars-actions">
              <button type="button" className="mars-back" onClick={handleBack}>
                Back
              </button>
              <button type="button" className="mars-forward" onClick={handleForward}>
                Forward
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
