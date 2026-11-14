import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "../App.css";
import Loading from "./Loading";
import { POIS, type Poi } from "../data/pois";

export type { Poi };

const MARS_TEXTURE_URL = "/mars_viking_8k.png";

function createSunTextures() {
  const coronaCanvas = document.createElement("canvas");
  coronaCanvas.width = 512;
  coronaCanvas.height = 512;
  const cctx = coronaCanvas.getContext("2d")!;
  const cGrad = cctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  cGrad.addColorStop(0.0, "rgba(255, 238, 195, 0.95)");
  cGrad.addColorStop(0.12, "rgba(255, 220, 160, 0.9)");
  cGrad.addColorStop(0.28, "rgba(255, 200, 95, 0.7)");
  cGrad.addColorStop(0.5, "rgba(255, 130, 35, 0.35)");
  cGrad.addColorStop(0.75, "rgba(255, 70, 10, 0.12)");
  cGrad.addColorStop(1.0, "rgba(0, 0, 0, 0)");
  cctx.fillStyle = cGrad;
  cctx.fillRect(0, 0, 512, 512);

  const coronaTex = new THREE.CanvasTexture(coronaCanvas);
  coronaTex.colorSpace = THREE.SRGBColorSpace;

  const haloCanvas = document.createElement("canvas");
  haloCanvas.width = 512;
  haloCanvas.height = 512;
  const hctx = haloCanvas.getContext("2d")!;
  const hGrad = hctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  hGrad.addColorStop(0.0, "rgba(255, 220, 150, 0.55)");
  hGrad.addColorStop(0.3, "rgba(255, 160, 70, 0.22)");
  hGrad.addColorStop(0.65, "rgba(255, 90, 20, 0.07)");
  hGrad.addColorStop(1.0, "rgba(0, 0, 0, 0)");
  hctx.fillStyle = hGrad;
  hctx.fillRect(0, 0, 512, 512);

  const haloTex = new THREE.CanvasTexture(haloCanvas);
  haloTex.colorSpace = THREE.SRGBColorSpace;

  const raysCanvas = document.createElement("canvas");
  raysCanvas.width = 512;
  raysCanvas.height = 512;
  const rctx = raysCanvas.getContext("2d")!;
  const cx = 256;
  const cy = 256;

  rctx.save();
  rctx.translate(cx, cy);
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    rctx.rotate(angle);
    const rGrad = rctx.createLinearGradient(0, 0, 256, 0);
    rGrad.addColorStop(0.0, "rgba(255, 250, 220, 0.5)");
    rGrad.addColorStop(0.2, "rgba(255, 195, 100, 0.25)");
    rGrad.addColorStop(0.6, "rgba(255, 125, 40, 0.07)");
    rGrad.addColorStop(1.0, "rgba(0, 0, 0, 0)");

    rctx.fillStyle = rGrad;
    const halfWidth = i % 2 === 0 ? 3.5 : 2.0;
    rctx.beginPath();
    rctx.moveTo(0, 0);
    rctx.lineTo(256, -halfWidth);
    rctx.lineTo(256, halfWidth);
    rctx.closePath();
    rctx.fill();

    rctx.beginPath();
    rctx.moveTo(0, 0);
    rctx.lineTo(-256, -halfWidth);
    rctx.lineTo(-256, halfWidth);
    rctx.closePath();
    rctx.fill();

    rctx.rotate(-angle);
  }
  rctx.restore();

  const raysTex = new THREE.CanvasTexture(raysCanvas);
  raysTex.colorSpace = THREE.SRGBColorSpace;

  return { coronaTex, haloTex, raysTex };
}

function latLonToVector3(lat: number, lon: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

export type GlobalMapHandle = {
  focusPoi: (id: string) => void;
  resetView: () => void;
};

type GlobalMapProps = {
  onPoiSelect?: (poi: Poi) => void;
  onPoiDeselect?: () => void;
};

const GlobalMap = forwardRef<GlobalMapHandle, GlobalMapProps>(function GlobalMap(
  { onPoiSelect, onPoiDeselect },
  ref
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const onPoiSelectRef = useRef(onPoiSelect);
  const onPoiDeselectRef = useRef(onPoiDeselect);
  onPoiSelectRef.current = onPoiSelect;
  onPoiDeselectRef.current = onPoiDeselect;

  const apiRef = useRef<GlobalMapHandle | null>(null);

  useImperativeHandle(ref, () => ({
    focusPoi: (id: string) => apiRef.current?.focusPoi(id),
    resetView: () => {
      setSelectedId(null);
      apiRef.current?.resetView();
    },
  }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      400
    );
    camera.position.set(0, 0, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
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
      "/skyblock/px.png",
      "/skyblock/nx.png",
      "/skyblock/py.png",
      "/skyblock/ny.png",
      "/skyblock/pz.png",
      "/skyblock/nz.png",
    ]);
    skybox.colorSpace = THREE.SRGBColorSpace;
    scene.background = skybox;

    const sunPos = new THREE.Vector3(18, 10, 14);
    const sunDistance = sunPos.length();
    const rearSunPos = new THREE.Vector3();
    const cameraDirection = new THREE.Vector3();

    const ambient = new THREE.AmbientLight(0xdbe3f0, 0.22);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0x283245, 0x111319, 0.35);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff7ea, 2.5);
    sun.position.copy(sunPos);
    sun.target.position.set(0, 0, 0);
    scene.add(sun);
    scene.add(sun.target);

    // Visible Sun celestial body in space
    const sunGroup = new THREE.Group();
    sunGroup.position.copy(sunPos);
    scene.add(sunGroup);

    const { coronaTex, haloTex, raysTex } = createSunTextures();

    const coronaMat = new THREE.SpriteMaterial({
      map: coronaTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const coronaSprite = new THREE.Sprite(coronaMat);
    coronaSprite.scale.set(6.8, 6.8, 1);
    sunGroup.add(coronaSprite);

    const haloMat = new THREE.SpriteMaterial({
      map: haloTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const haloSprite = new THREE.Sprite(haloMat);
    haloSprite.scale.set(16, 16, 1);
    sunGroup.add(haloSprite);

    

    

    const globeGeo = new THREE.SphereGeometry(1, 96, 96);
    const globeMat = new THREE.MeshLambertMaterial({ color: 0x8a3a22 });
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

      const markerMat = new THREE.MeshBasicMaterial({ color: 0xec733c });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.copy(pos);
      marker.userData.poiId = poi.id;
      markerGroup.add(marker);
      markers.push(marker);

      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xec733c,
        side: THREE.DoubleSide,
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
          const poi = POIS.find((p) => p.id === id);
          setSelectedId(id);
          setFocusByPoi(id);
          if (poi) onPoiSelectRef.current?.(poi);
        }
      } else {
        setSelectedId(null);
        resetView();
        onPoiDeselectRef.current?.();
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

      const cameraDistance = camera.position.distanceTo(controls.target);
      camera.getWorldDirection(cameraDirection);
      rearSunPos
        .copy(camera.position)
        .addScaledVector(cameraDirection, -sunDistance);
      const sunPositionBlend = THREE.MathUtils.smoothstep(
        cameraDistance,
        2.2,
        3.2
      );
      sun.position.copy(rearSunPos).lerp(sunPos, sunPositionBlend);
      sunGroup.position.copy(sun.position);

      const t = performance.now() * 0.003;
      for (const m of markers) {
        if ((m as THREE.Mesh).geometry instanceof THREE.RingGeometry) {
          const s = 1 + Math.sin(t) * 0.08;
          m.scale.setScalar(s);
        }
      }

      
      const sunPulse = 1 + Math.sin(t * 0.8) * 0.025;
      coronaSprite.scale.set(6.8 * sunPulse, 6.8 * sunPulse, 1);

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
      
      coronaTex.dispose();
      coronaMat.dispose();
      haloTex.dispose();
      haloMat.dispose();
      raysTex.dispose();
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
  }, []);

  return (
    <div className="mars-map">
      <div className="mars-canvas" ref={mountRef} />
      {!ready && <Loading title="Cargando Marte" />}
    </div>
  );
});

export default GlobalMap;
