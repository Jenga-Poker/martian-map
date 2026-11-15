import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MARS_PALETTE, type HoverInfo } from '../utils/terrain'
import type { TerrainModel } from '../utils/terrainModel'
import { renderRouteOnObject, type DemPixel } from '../utils/pathy'

export type CameraMode = 'perspective' | 'top'

export type AstronautPosition = {
  lat: number
  lon: number
  elevation: number
}

type Props = {
  model: TerrainModel
  exaggeration: number
  autoRotate: boolean
  wireframe: boolean
  cameraMode: CameraMode
  resetSignal: number
  onHover: (info: HoverInfo | null) => void
  onError: (message: string) => void
  astronaut: AstronautPosition | null
  onAstronautSelect?: (position: AstronautPosition) => void
  routes?: DemPixel[][]
  routeColors?: Array<number | string>
  selectedRouteIndex?: number | null
  focusTarget?: { lat: number; lon: number } | null
}

type SceneApi = {
  setExaggeration: (value: number) => void
  setAutoRotate: (value: boolean) => void
  setWireframe: (value: boolean) => void
  applyCameraMode: (mode: CameraMode) => void
  reset: () => void
  setAstronaut: (position: AstronautPosition | null) => void
  setRoutes: (
    routes: DemPixel[][],
    colors?: Array<number | string>,
    selectedIndex?: number | null,
  ) => void
  focusOn: (lat: number, lon: number) => void
}

const BASE_EXAGGERATION = 3.5
const CAMERA_FOV = 42
const REFERENCE_ELEVATION_SPAN = 1000 // meters, used to keep vertical exaggeration consistent across terrains

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
  model,
  exaggeration,
  autoRotate,
  wireframe,
  cameraMode,
  resetSignal,
  onHover,
  onError,
  astronaut,
  onAstronautSelect,
  routes,
  routeColors,
  selectedRouteIndex,
  focusTarget,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<SceneApi | null>(null)
  const exaggerationRef = useRef(exaggeration)
  const cameraModeRef = useRef(cameraMode)
  const onHoverRef = useRef(onHover)
  const onErrorRef = useRef(onError)
  const onAstronautSelectRef = useRef(onAstronautSelect)
  const astronautRef = useRef(astronaut)
  const routesRef = useRef<DemPixel[][]>(routes ?? [])
  const routeColorsRef = useRef<Array<number | string> | undefined>(routeColors)
  const selectedRouteIndexRef = useRef<number | null>(selectedRouteIndex ?? null)

  useEffect(() => {
    onHoverRef.current = onHover
    onErrorRef.current = onError
    exaggerationRef.current = exaggeration
    cameraModeRef.current = cameraMode
    onAstronautSelectRef.current = onAstronautSelect
    astronautRef.current = astronaut
    routesRef.current = routes ?? []
    routeColorsRef.current = routeColors
    selectedRouteIndexRef.current = selectedRouteIndex ?? null
  })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const { meta, heights, widthKm, heightKm, qToMeters, baseHeights } = model
    const count = meta.width * meta.height
    const spacingX = widthKm / (meta.width - 1)
    const spacingZ = heightKm / (meta.height - 1)
    const spanFactor = REFERENCE_ELEVATION_SPAN / (model.elevationSpan || REFERENCE_ELEVATION_SPAN)
    const effectiveExaggeration = (value: number) => value / spanFactor

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
        const slopeX =
          (((right - left) * qToMeters) / (2 * spacingX * 1000)) *
          BASE_EXAGGERATION
        const slopeZ =
          (((down - up) * qToMeters) / (2 * spacingZ * 1000)) *
          BASE_EXAGGERATION
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
    renderer.toneMappingExposure = 1
    renderer.setClearColor(0x090202, 1)
    renderer.domElement.style.cursor = 'crosshair'
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const maxDimension = Math.max(widthKm, heightKm)
    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      1,
      Math.max(0.05, maxDimension / 10000),
      Math.max(600, maxDimension * 12),
    )
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.autoRotateSpeed = 0.55
    controls.minDistance = Math.max(2.5, maxDimension * 0.01)
    controls.maxDistance = maxDimension * 6
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
    const initialExaggeration = effectiveExaggeration(exaggerationRef.current)
    for (let i = 0; i < count; i += 1) {
      positionArray[i * 3 + 1] = baseHeights[i] * initialExaggeration
    }
    positions.needsUpdate = true
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 4))
    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      alphaTest: 0,
      roughness: 0.94,
      metalness: 0.02,
      side: THREE.DoubleSide,
    })
    const terrain = new THREE.Mesh(geometry, material)
    scene.add(terrain)

    scene.add(new THREE.HemisphereLight(0xfef5eb, 0x090202, 1.1))

    const sun = new THREE.DirectionalLight(0xfef5eb, 2.3)
    sun.position.set(-widthKm * 0.75, widthKm * 1.25, -heightKm * 0.4)
    scene.add(sun)

    const fill = new THREE.DirectionalLight(0xd56738, 1.15)
    fill.position.set(widthKm * 0.8, widthKm * 0.45, heightKm * 0.9)
    scene.add(fill)

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xec733c,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.23, 48), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    scene.add(ring)

    const marker = new THREE.Group()
    marker.visible = false
    const markerColor = new THREE.Color(0xffffff)
    const markerMat = new THREE.MeshStandardMaterial({
      color: markerColor,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.15,
      roughness: 0.35,
      metalness: 0.05,
    })
    const markerPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.42, 16),
      markerMat,
    )
    markerPole.position.y = 0.21
    const markerHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 20),
      markerMat,
    )
    markerHead.position.y = 0.48
    const markerBase = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.22, 32),
      new THREE.MeshBasicMaterial({ color: markerColor, side: THREE.DoubleSide }),
    )
    markerBase.rotation.x = -Math.PI / 2
    markerBase.position.y = 0.02
    marker.add(markerBase, markerPole, markerHead)
    scene.add(marker)

    const routeGroup = new THREE.Group()
    routeGroup.name = 'routes'
    scene.add(routeGroup)

    const defaultRouteColors = [0xff0000, 0xffff00, 0x00ff00, 0x38bdf8, 0xe879f9]
    const drawRoutes = (
      paths: DemPixel[][],
      colors?: Array<number | string>,
      selectedIndex: number | null = null,
    ) => {
      while (routeGroup.children.length > 0) {
        const child = routeGroup.children[0]
        routeGroup.remove(child)
        const anyChild = child as any
        anyChild.geometry?.dispose?.()
        anyChild.material?.dispose?.()
      }
      const baseRadius = Math.max(0.004, Math.max(model.widthKm, model.heightKm) * 0.0007)
      paths.forEach((path, index) => {
        const color = colors?.[index] ?? defaultRouteColors[index % defaultRouteColors.length]
        const isSelected = selectedIndex === index
        const dimmed = selectedIndex != null && !isSelected
        renderRouteOnObject(routeGroup, model, path, {
          exaggeration: effectiveExaggeration(exaggerationRef.current),
          color,
          yOffset: (isSelected ? 0.02 : 0.012) + index * 0.002,
          opacity: dimmed ? 0.25 : 1,
          radius: isSelected ? baseRadius * 1.8 : baseRadius,
          name: `route-line-${index}`,
        })
      })
    }

    const pickTerrain = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const ray = raycaster.ray
      const entry = ray.intersectBox(terrainBox, rayA)
      if (!entry) return null
      const tStart = ray.origin.distanceTo(entry)
      const marchLength = Math.max(maxDimension * 0.02, camera.position.distanceTo(entry) + maxDimension * 0.02)
      const steps = 320
      let previousT = tStart
      for (let step = 1; step <= steps; step += 1) {
        const t = tStart + (marchLength * step) / steps
        ray.at(t, rayC)
        const current = model.sampleAt(rayC.x, rayC.z, effectiveExaggeration(exaggerationRef.current), sample)
        if (current && rayC.y <= current.y) {
          let lo = previousT
          let hi = t
          let hit = current
          for (let iteration = 0; iteration < 12; iteration += 1) {
            const midT = (lo + hi) / 2
            ray.at(midT, rayA)
            const refined = model.sampleAt(rayA.x, rayA.z, effectiveExaggeration(exaggerationRef.current), midSample)
            if (refined && rayA.y <= refined.y) {
              hi = midT
              hit = refined
            } else {
              lo = midT
            }
          }
          ray.at(hi, hitPoint)
          const { lat, lon } = model.worldToGeo(hitPoint.x, hitPoint.z)
          return { x: hitPoint.x, z: hitPoint.z, y: hit.y, elevation: hit.elevation, lat, lon }
        }
        previousT = t
      }
      return null
    }

    const updateMarker = (pos: AstronautPosition | null) => {
      if (!pos) {
        marker.visible = false
        return
      }
      const { x, z } = model.geoToWorld(pos)
      const sampled = model.sampleAt(x, z, effectiveExaggeration(exaggerationRef.current), sample)
      if (!sampled) {
        marker.visible = false
        return
      }
      marker.position.set(x, sampled.y, z)
      marker.visible = true
    }
    updateMarker(astronautRef.current)
    drawRoutes(routesRef.current, routeColorsRef.current)

    const boxPad = Math.max(1, maxDimension * 0.02)
    const boxY = Math.max(12, maxDimension * 0.25)
    const terrainBox = new THREE.Box3(
      new THREE.Vector3(-widthKm / 2 - boxPad, -boxY, -heightKm / 2 - boxPad),
      new THREE.Vector3(widthKm / 2 + boxPad, boxY, heightKm / 2 + boxPad),
    )
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
      const marchLength = Math.max(maxDimension * 0.02, camera.position.distanceTo(entry) + maxDimension * 0.02)
      const steps = 320
      let previousT = tStart

      for (let step = 1; step <= steps; step += 1) {
        const t = tStart + (marchLength * step) / steps
        ray.at(t, rayC)
        const current = model.sampleAt(
          rayC.x,
          rayC.z,
          effectiveExaggeration(exaggerationRef.current),
          sample,
        )
        if (current && rayC.y <= current.y) {
          let lo = previousT
          let hi = t
          let hit = current
          for (let iteration = 0; iteration < 12; iteration += 1) {
            const midT = (lo + hi) / 2
            ray.at(midT, rayA)
            const refined = model.sampleAt(
              rayA.x,
              rayA.z,
              effectiveExaggeration(exaggerationRef.current),
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
          const { lat, lon } = model.worldToGeo(hitPoint.x, hitPoint.z)

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

    let downX = 0
    let downY = 0
    const onPointerDown = (event: PointerEvent) => {
      downX = event.clientX
      downY = event.clientY
    }
    const onClick = (event: MouseEvent) => {
      if (astronautRef.current) return
      if (!onAstronautSelectRef.current) return
      const dx = event.clientX - downX
      const dy = event.clientY - downY
      if (dx * dx + dy * dy > 36) return
      const hit = pickTerrain(event.clientX, event.clientY)
      if (hit) {
        onAstronautSelectRef.current({
          lat: hit.lat,
          lon: hit.lon,
          elevation: hit.elevation,
        })
      }
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('click', onClick)

    const resize = () => {
      const { clientWidth, clientHeight } = mount
      if (clientWidth === 0 || clientHeight === 0) return
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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
      marker.scale.setScalar(Math.max(0.6, distance / 28))
      renderer.render(scene, camera)
    })

    apiRef.current = {
      setExaggeration: (value: number) => {
        exaggerationRef.current = value
        terrain.scale.y = effectiveExaggeration(value) / initialExaggeration
        updateMarker(astronautRef.current)
        drawRoutes(routesRef.current, routeColorsRef.current, selectedRouteIndexRef.current)
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
      setAstronaut: (position: AstronautPosition | null) => {
        astronautRef.current = position
        updateMarker(position)
      },
      setRoutes: (
        paths: DemPixel[][],
        colors?: Array<number | string>,
        selectedIndex: number | null = null,
      ) => {
        routesRef.current = paths
        routeColorsRef.current = colors
        selectedRouteIndexRef.current = selectedIndex
        drawRoutes(paths, colors, selectedIndex)
      },
      focusOn: (lat: number, lon: number) => {
        const { x, z } = model.geoToWorld({ lat, lon })
        const sampled = model.sampleAt(x, z, effectiveExaggeration(exaggerationRef.current), sample)
        const ty = sampled ? sampled.y : 0
        const dist = Math.max(maxDimension * 0.25, 8)
        const toPos = new THREE.Vector3(x + dist * 0.6, ty + dist * 0.5, z + dist * 0.6)
        const toTarget = new THREE.Vector3(x, ty, z)
        flight = {
          fromPosition: camera.position.clone(),
          toPosition: toPos,
          fromTarget: controls.target.clone(),
          toTarget,
          t: 0,
        }
      },
    }

    return () => {
      controls.removeEventListener('start', cancelFlight)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('click', onClick)
      if (hoverFrame) cancelAnimationFrame(hoverFrame)
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      geometry.dispose()
      material.dispose()
      ring.geometry.dispose()
      ringMaterial.dispose()
      markerPole.geometry.dispose()
      markerHead.geometry.dispose()
      markerBase.geometry.dispose()
      markerMat.dispose()
      ;(markerBase.material as THREE.Material).dispose()
      while (routeGroup.children.length > 0) {
        const child = routeGroup.children[0]
        routeGroup.remove(child)
        const anyChild = child as any
        anyChild.geometry?.dispose?.()
        anyChild.material?.dispose?.()
      }
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
      apiRef.current = null
    }
  }, [model])

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

  useEffect(() => {
    apiRef.current?.setAstronaut(astronaut)
  }, [astronaut])

  useEffect(() => {
    apiRef.current?.setRoutes(routes ?? [], routeColors, selectedRouteIndex ?? null)
  }, [routes, routeColors, selectedRouteIndex])

  useEffect(() => {
    if (focusTarget) {
      apiRef.current?.focusOn(focusTarget.lat, focusTarget.lon)
    }
  }, [focusTarget])

  return (
    <div
      className="stage"
      ref={mountRef}
      role="img"
      aria-label="3D model of Martian terrain"
    />
  )
}
