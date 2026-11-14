import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MARS_PALETTE, type HoverInfo, type TerrainData } from '../terrain'

export type CameraMode = 'perspective' | 'top'

type Props = {
  data: TerrainData
  exaggeration: number
  autoRotate: boolean
  wireframe: boolean
  cameraMode: CameraMode
  resetSignal: number
  onHover: (info: HoverInfo | null) => void
  onError: (message: string) => void
}

type SceneApi = {
  setExaggeration: (value: number) => void
  setAutoRotate: (value: boolean) => void
  setWireframe: (value: boolean) => void
  applyCameraMode: (mode: CameraMode) => void
  reset: () => void
}

type HeightSample = { elevation: number; y: number }

const BASE_EXAGGERATION = 3.5
const CAMERA_FOV = 42

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

const palette = MARS_PALETTE.map((hex) => new THREE.Color(hex))

function samplePalette(
  t: number,
  target: { r: number; g: number; b: number },
): void {
  const scaled = clamp01(t) * (palette.length - 1)
  const i0 = Math.floor(scaled)
  const i1 = Math.min(i0 + 1, palette.length - 1)
  const f = scaled - i0
  const a = palette[i0]
  const b = palette[i1]
  target.r = a.r + (b.r - a.r) * f
  target.g = a.g + (b.g - a.g) * f
  target.b = a.b + (b.b - a.b) * f
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export default function TerrainViewer({
  data,
  exaggeration,
  autoRotate,
  wireframe,
  cameraMode,
  resetSignal,
  onHover,
  onError,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<SceneApi | null>(null)
  const exaggerationRef = useRef(exaggeration)
  const cameraModeRef = useRef(cameraMode)
  const onHoverRef = useRef(onHover)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onHoverRef.current = onHover
    onErrorRef.current = onError
    exaggerationRef.current = exaggeration
    cameraModeRef.current = cameraMode
  })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const { meta, heights } = data
    const widthKm = meta.widthMeters / 1000
    const heightKm = meta.heightMeters / 1000
    const midElevation = (meta.minElevation + meta.maxElevation) / 2
    const elevationSpan = meta.maxElevation - meta.minElevation || 1
    const qToMeters = elevationSpan / (meta.nodata - 1)
    const count = meta.width * meta.height
    const spacingX = widthKm / (meta.width - 1)
    const spacingZ = heightKm / (meta.height - 1)

    // Altura relativa (km) de cada vértice, centrada en la elevación media.
    const baseHeights = new Float32Array(count)
    for (let i = 0; i < count; i += 1) {
      const q = heights[i]
      if (q === meta.nodata) {
        baseHeights[i] = 0
        continue
      }
      const elevation = meta.minElevation + q * qToMeters
      baseHeights[i] = (elevation - midElevation) / 1000
    }

    // Color por elevación + micro-sombreado del relieve.
    const colorArray = new Float32Array(count * 4)
    const color = { r: 0, g: 0, b: 0 }
    const light = new THREE.Vector3(-0.55, 0.78, 0.4).normalize()
    const colorRange = meta.colorMax - meta.colorMin || 1

    for (let row = 0; row < meta.height; row += 1) {
      for (let col = 0; col < meta.width; col += 1) {
        const i = row * meta.width + col
        const offset = i * 4
        const q = heights[i]

        if (q === meta.nodata) {
          // Fuera de la huella del DEM: alpha 0 + alphaTest = no se dibuja.
          colorArray[offset + 3] = 0
          continue
        }

        const elevation = meta.minElevation + q * qToMeters
        const t = clamp01((elevation - meta.colorMin) / colorRange)
        samplePalette(Math.pow(t, 0.68), color)

        const left = col > 0 ? heights[i - 1] : q
        const right = col < meta.width - 1 ? heights[i + 1] : q
        const up = row > 0 ? heights[i - meta.width] : q
        const down = row < meta.height - 1 ? heights[i + meta.width] : q
        const slopeX = (((right - left) * qToMeters) / (2 * spacingX * 1000)) * BASE_EXAGGERATION
        const slopeZ = (((down - up) * qToMeters) / (2 * spacingZ * 1000)) * BASE_EXAGGERATION
        const invLength = 1 / Math.sqrt(slopeX * slopeX + 1 + slopeZ * slopeZ)
        const shade = (-slopeX * light.x + light.y - slopeZ * light.z) * invLength
        const lightFactor = 0.9 + 0.28 * Math.max(0, shade)

        colorArray[offset] = color.r * lightFactor
        colorArray[offset + 1] = color.g * lightFactor
        colorArray[offset + 2] = color.b * lightFactor
        colorArray[offset + 3] = 1
      }
    }

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
    } catch {
      onErrorRef.current('Tu navegador no pudo iniciar WebGL.')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.18
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.cursor = 'crosshair'
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 600)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.autoRotateSpeed = 0.55
    controls.minDistance = 2.5
    controls.maxDistance = Math.max(widthKm, heightKm) * 4.5
    controls.minPolarAngle = 0.04
    controls.maxPolarAngle = Math.PI * 0.494

    const geometry = new THREE.PlaneGeometry(
      widthKm,
      heightKm,
      meta.width - 1,
      meta.height - 1,
    )
    geometry.rotateX(-Math.PI / 2)

    const positions = geometry.attributes.position as THREE.BufferAttribute
    const positionArray = positions.array as Float32Array
    for (let i = 0; i < count; i += 1) {
      positionArray[i * 3 + 1] = baseHeights[i] * BASE_EXAGGERATION
    }
    positions.needsUpdate = true
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 4))
    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      alphaTest: 0.5,
      roughness: 0.94,
      metalness: 0.02,
      side: THREE.DoubleSide,
    })
    const terrain = new THREE.Mesh(geometry, material)
    scene.add(terrain)

    scene.add(new THREE.HemisphereLight(0xffc7a0, 0x1c0805, 1.1))

    const sun = new THREE.DirectionalLight(0xffe2bd, 2.3)
    sun.position.set(-widthKm * 0.75, widthKm * 1.25, -heightKm * 0.4)
    scene.add(sun)

    const fill = new THREE.DirectionalLight(0xff8a52, 1.15)
    fill.position.set(widthKm * 0.8, widthKm * 0.45, heightKm * 0.9)
    scene.add(fill)

    const starCount = 1800
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i += 1) {
      const direction = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize()
      const radius = 150 + Math.random() * 90
      starPositions[i * 3] = direction.x * radius
      starPositions[i * 3 + 1] = Math.abs(direction.y) * radius * 0.9 - radius * 0.1
      starPositions[i * 3 + 2] = direction.z * radius
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(starPositions, 3),
    )
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffd8c2,
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    })
    const stars = new THREE.Points(starGeometry, starMaterial)
    scene.add(stars)

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc79f,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.23, 48), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    scene.add(ring)

    const terrainBox = new THREE.Box3(
      new THREE.Vector3(-widthKm / 2 - 1, -12, -heightKm / 2 - 1),
      new THREE.Vector3(widthKm / 2 + 1, 12, heightKm / 2 + 1),
    )

    const maxDimension = Math.max(widthKm, heightKm)
    const presets: Record<CameraMode, { position: THREE.Vector3; target: THREE.Vector3 }> = {
      perspective: {
        position: new THREE.Vector3(
          maxDimension * 0.72,
          maxDimension * 0.66,
          maxDimension * 0.98,
        ),
        target: new THREE.Vector3(0, 0.15, 0),
      },
      top: {
        position: new THREE.Vector3(0, maxDimension * 1.62, maxDimension * 0.04),
        target: new THREE.Vector3(0, 0, 0),
      },
    }

    type Flight = {
      fromPosition: THREE.Vector3
      toPosition: THREE.Vector3
      fromTarget: THREE.Vector3
      toTarget: THREE.Vector3
      t: number
    }
    let flight: Flight | null = null

    const moveCamera = (mode: CameraMode, instant = false) => {
      const preset = presets[mode]
      if (instant) {
        camera.position.copy(preset.position)
        controls.target.copy(preset.target)
        controls.update()
        return
      }
      flight = {
        fromPosition: camera.position.clone(),
        toPosition: preset.position.clone(),
        fromTarget: controls.target.clone(),
        toTarget: preset.target.clone(),
        t: 0,
      }
    }

    moveCamera('perspective', true)

    const cancelFlight = () => {
      flight = null
    }
    controls.addEventListener('start', cancelFlight)

    // Muestreo bilineal del heightmap. Devuelve null fuera del DEM.
    const sampleAt = (
      x: number,
      z: number,
      exValue: number,
      out: HeightSample,
    ): HeightSample | null => {
      if (x < -widthKm / 2 || x > widthKm / 2) return null
      if (z < -heightKm / 2 || z > heightKm / 2) return null
      const u = ((x + widthKm / 2) / widthKm) * (meta.width - 1)
      const v = ((z + heightKm / 2) / heightKm) * (meta.height - 1)
      const col0 = Math.floor(u)
      const row0 = Math.floor(v)
      const col1 = Math.min(col0 + 1, meta.width - 1)
      const row1 = Math.min(row0 + 1, meta.height - 1)
      const fx = u - col0
      const fy = v - row0
      const i00 = row0 * meta.width + col0
      const i10 = row0 * meta.width + col1
      const i01 = row1 * meta.width + col0
      const i11 = row1 * meta.width + col1

      if (
        heights[i00] === meta.nodata ||
        heights[i10] === meta.nodata ||
        heights[i01] === meta.nodata ||
        heights[i11] === meta.nodata
      ) {
        return null
      }

      const base =
        (baseHeights[i00] * (1 - fx) + baseHeights[i10] * fx) * (1 - fy) +
        (baseHeights[i01] * (1 - fx) + baseHeights[i11] * fx) * fy
      const q =
        (heights[i00] * (1 - fx) + heights[i10] * fx) * (1 - fy) +
        (heights[i01] * (1 - fx) + heights[i11] * fx) * fy

      out.elevation = meta.minElevation + q * qToMeters
      out.y = base * exValue
      return out
    }

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const rayA = new THREE.Vector3()
    const rayC = new THREE.Vector3()
    const hitPoint = new THREE.Vector3()
    const sample = { elevation: 0, y: 0 }
    const midSample = { elevation: 0, y: 0 }

    let hoverFrame = 0
    let pointerInside = false
    let lastClientX = 0
    let lastClientY = 0

    const updateHover = () => {
      hoverFrame = 0
      if (!pointerInside) return
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      pointer.x = ((lastClientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((lastClientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const ray = raycaster.ray

      const entry = ray.intersectBox(terrainBox, rayA)
      if (!entry) {
        ring.visible = false
        onHoverRef.current(null)
        return
      }

      const tStart = ray.origin.distanceTo(entry)
      const marchLength = Math.max(40, camera.position.distanceTo(entry) + 12)
      const steps = 320
      let previousT = tStart

      for (let step = 1; step <= steps; step += 1) {
        const t = tStart + (marchLength * step) / steps
        ray.at(t, rayC)
        const current = sampleAt(rayC.x, rayC.z, exaggerationRef.current, sample)
        if (current && rayC.y <= current.y) {
          let lo = previousT
          let hi = t
          let hit = current
          for (let iteration = 0; iteration < 12; iteration += 1) {
            const midT = (lo + hi) / 2
            ray.at(midT, rayA)
            const refined = sampleAt(
              rayA.x,
              rayA.z,
              exaggerationRef.current,
              midSample,
            )
            if (refined && rayA.y <= refined.y) {
              hi = midT
              hit = refined
            } else {
              lo = midT
            }
          }

          ray.at(hi, hitPoint)
          const u = ((hitPoint.x + widthKm / 2) / widthKm) * (meta.width - 1)
          const v = ((hitPoint.z + heightKm / 2) / heightKm) * (meta.height - 1)
          const lon =
            meta.bounds.lonMin +
            (u / (meta.width - 1)) * (meta.bounds.lonMax - meta.bounds.lonMin)
          const lat =
            meta.bounds.latMax -
            (v / (meta.height - 1)) * (meta.bounds.latMax - meta.bounds.latMin)

          ring.position.set(hitPoint.x, hit.y + 0.03, hitPoint.z)
          ring.visible = true
          onHoverRef.current({ elevation: hit.elevation, lat, lon })
          return
        }
        previousT = t
      }

      ring.visible = false
      onHoverRef.current(null)
    }

    const onPointerMove = (event: PointerEvent) => {
      pointerInside = true
      lastClientX = event.clientX
      lastClientY = event.clientY
      if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover)
    }

    const onPointerLeave = () => {
      pointerInside = false
      ring.visible = false
      onHoverRef.current(null)
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)

    const resize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      if (width === 0 || height === 0) return
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    renderer.setAnimationLoop(() => {
      if (flight) {
        flight.t = Math.min(1, flight.t + 0.045)
        const eased = easeInOutCubic(flight.t)
        camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased)
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased)
        if (flight.t >= 1) flight = null
      }
      controls.update()
      const distance = camera.position.distanceTo(controls.target)
      ring.scale.setScalar(Math.max(0.55, distance / 34))
      stars.rotation.y += 0.00012
      renderer.render(scene, camera)
    })

    apiRef.current = {
      setExaggeration: (value: number) => {
        exaggerationRef.current = value
        terrain.scale.y = value / BASE_EXAGGERATION
      },
      setAutoRotate: (value: boolean) => {
        controls.autoRotate = value
      },
      setWireframe: (value: boolean) => {
        material.wireframe = value
      },
      applyCameraMode: (mode: CameraMode) => {
        moveCamera(mode)
      },
      reset: () => {
        moveCamera(cameraModeRef.current)
      },
    }

    return () => {
      controls.removeEventListener('start', cancelFlight)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      if (hoverFrame) cancelAnimationFrame(hoverFrame)
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      geometry.dispose()
      material.dispose()
      starGeometry.dispose()
      starMaterial.dispose()
      ring.geometry.dispose()
      ringMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
      apiRef.current = null
    }
  }, [data])

  useEffect(() => {
    apiRef.current?.setExaggeration(exaggeration)
  }, [exaggeration])

  useEffect(() => {
    apiRef.current?.setAutoRotate(autoRotate)
  }, [autoRotate])

  useEffect(() => {
    apiRef.current?.setWireframe(wireframe)
  }, [wireframe])

  useEffect(() => {
    apiRef.current?.applyCameraMode(cameraMode)
  }, [cameraMode])

  useEffect(() => {
    if (resetSignal > 0) apiRef.current?.reset()
  }, [resetSignal])

  return (
    <div
      className="stage"
      ref={mountRef}
      role="img"
      aria-label="Modelo 3D del relieve del cráter Jezero"
    />
  )
}
