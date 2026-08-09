"use client";

/**
 * The WebGL hero. Client-only, loaded exclusively through `SceneLoader`'s
 * dynamic `ssr: false` import — nothing else in the app may import this module,
 * or `three` lands in the initial payload for every visitor including the ones
 * who will never render it.
 *
 * WHAT IT IS
 * Three depth layers of the same idea: activity resolving into structure.
 *   far     — a drifting dust field in the deep navy tone, sunk into fog.
 *   subject — 91 nodes wired into a fixed grid of 162 edges. They begin as a
 *             loose cloud and, as the hero scrolls, settle onto an ordered,
 *             gently bowed surface. The connections never change; only the
 *             positions do. The structure was always there.
 *   near    — a handful of large, very faint discs in front of the focal plane.
 *             Out-of-focus foreground, which is the cheapest honest depth of
 *             field available: no post pass, no second render target, just
 *             geometry that was never meant to be sharp. They drift aside as
 *             the composition resolves, so the view clears as it organises.
 * The three layers translate at different rates against a dollying camera,
 * which is where the parallax comes from. Linear fog dissolves the far layer
 * into the page background.
 *
 * Nothing here spins, flashes, blooms or flares. The idle motion is a slow
 * breathing of the scattered cloud plus a drift of the dust, so the scene is
 * alive at first paint rather than waiting to be scrolled at.
 *
 * WHAT IT COSTS
 * ~285 points, 162 line segments, six draw calls. The per-frame CPU work is
 * about 1,200 float writes into two buffer attributes. This is deliberately far
 * inside the budget of a mid-range laptop: a marketing page that drops frames
 * has failed at the only thing it was for.
 *
 * WHAT IT PROMISES
 *   - pixel ratio capped at 2, re-evaluated on resize
 *   - rAF stopped when off-screen (IntersectionObserver) or the tab is hidden
 *   - every geometry, material, texture and the renderer disposed on unmount,
 *     with an explicit `forceContextLoss` so the context is returned rather
 *     than left for the GC to maybe collect
 *   - a lost context reports upward instead of leaving a dead black rectangle
 */

import { useCallback, useEffect, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";

import useScrollProgress from "@/hooks/useScrollProgress";
import {
  BOKEH_COUNT,
  CAMERA_Y_END,
  CAMERA_Y_START,
  CAMERA_Z_FAR,
  CAMERA_Z_NEAR,
  FOG_FAR,
  FOG_NEAR,
  GEOMETRY,
  NODE_COUNT,
  easeInOutCubic,
} from "./HeroSceneFallback";

/* ------------------------------------------------------------------ *
 * Colour — read from CSS custom properties, never hardcoded
 * ------------------------------------------------------------------ */

const HSL_TRIPLET = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/;

/**
 * The app stores design tokens as bare `H S% L%` channels so that Tailwind can
 * wrap them in `hsl(var(--token))`. Read raw they are not a valid CSS colour,
 * so they have to be parsed by hand.
 *
 * @returns {boolean} whether the token was found and understood
 */
function applyToken(styles, name, target) {
  const raw = styles.getPropertyValue(name).trim();
  if (!raw) return false;

  const parts = HSL_TRIPLET.exec(raw);
  if (parts) {
    target.setHSL(
      Number(parts[1]) / 360,
      Number(parts[2]) / 100,
      Number(parts[3]) / 100,
    );
    return true;
  }

  // Tolerate the token being switched to a plain CSS colour later. Better to
  // keep working than to insist on one syntax.
  try {
    target.set(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pulls the palette off `:root`. Every fallback is itself derived from
 * something already in the document — a computed `color`, the body background,
 * a darkened primary — so no hex ever appears in this file. The palette can be
 * rewritten from under us and the scene follows.
 */
function readPalette(hostEl) {
  const primary = new Color();
  const deep = new Color();
  const background = new Color();

  const rootStyles = getComputedStyle(document.documentElement);

  if (!applyToken(rootStyles, "--primary", primary)) {
    // The host carries `text-primary`, so its computed colour *is* the token,
    // already resolved by the browser.
    primary.set(getComputedStyle(hostEl).color);
  }

  if (!applyToken(rootStyles, "--sidebar", deep)) {
    // A darker, slightly desaturated relative of the brand colour.
    deep.copy(primary).offsetHSL(0, -0.1, -0.28);
  }

  if (!applyToken(rootStyles, "--background", background)) {
    background.set(getComputedStyle(document.body).backgroundColor);
  }

  return { primary, deep, background };
}

/* ------------------------------------------------------------------ *
 * Sprites
 * ------------------------------------------------------------------ */

/** A soft round dot baked into a texture. Square points look like a demo. */
function makeSprite(stops) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([offset, alpha]) => {
    gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const mix = (a, b, t) => a + (b - a) * t;

// The resolve finishes before the hero has fully scrolled away, so the
// organised state is actually seen rather than glimpsed on the way out.
const RESOLVE_AT = 0.7;

/**
 * @param {Object} props
 * @param {{ current: HTMLElement | null }} [props.targetRef]
 *        Element whose scroll position drives the animation. Defaults to this
 *        component's own container.
 * @param {() => void} [props.onReady]        first frame has been painted
 * @param {() => void} [props.onUnavailable]  WebGL could not start, or was lost
 */
export default function HeroScene({ targetRef = null, onReady, onUnavailable }) {
  const hostRef = useRef(null);

  // The rAF loop reads scroll through a ref rather than a prop. Re-rendering
  // React sixty times a second to hand a float to a canvas would be pure waste,
  // and the hook's subscription mode exists precisely to avoid it.
  const scrollRef = useRef(0);
  const handleProgress = useCallback((value) => {
    scrollRef.current = value;
  }, []);

  useScrollProgress(targetRef ?? hostRef, { onProgress: handleProgress, mode: "cover" });

  // Latest callbacks without making them effect dependencies — the effect owns
  // a GPU context and must not tear it down because a parent re-rendered.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    /* --- renderer ------------------------------------------------- */

    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

    let renderer;
    try {
      renderer = new WebGLRenderer({
        alpha: true, // the page background is the backdrop; we composite onto it
        antialias: pixelRatio() < 1.75, // pointless once the device is already dense
        // This is a decoration. There is no case for waking a discrete GPU.
        powerPreference: "low-power",
      });
    } catch {
      onUnavailableRef.current?.();
      return undefined;
    }
    if (!renderer.getContext()) {
      onUnavailableRef.current?.();
      return undefined;
    }

    renderer.setPixelRatio(pixelRatio());
    renderer.setClearAlpha(0);

    const canvas = renderer.domElement;
    canvas.className = "block h-full w-full";
    host.appendChild(canvas);

    /* --- palette -------------------------------------------------- */

    const palette = readPalette(host);

    /* --- scene ---------------------------------------------------- */

    const scene = new Scene();
    // Linear fog toward the page background. The far layer does not fade out,
    // it recedes into the page — which is what makes the depth read as real.
    scene.fog = new Fog(palette.background, FOG_NEAR, FOG_FAR);

    const camera = new PerspectiveCamera(45, 1, 0.1, 40);
    camera.position.set(0, CAMERA_Y_START, CAMERA_Z_FAR);

    const dotSprite = makeSprite([
      [0, 1],
      [0.42, 1],
      [0.62, 0.34],
      [1, 0],
    ]);
    const bokehSprite = makeSprite([
      [0, 0.55],
      [0.55, 0.32],
      [1, 0],
    ]);

    const disposables = [dotSprite, bokehSprite];
    const track = (thing) => {
      disposables.push(thing);
      return thing;
    };

    /* far layer -----------------------------------------------------*/

    const dustGroup = new Group();
    const dustGeometry = track(new BufferGeometry());
    dustGeometry.setAttribute("position", new BufferAttribute(GEOMETRY.dust.slice(), 3));
    const dustMaterial = track(
      new PointsMaterial({
        map: dotSprite,
        color: palette.deep,
        size: 0.09,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    const dust = new Points(dustGeometry, dustMaterial);
    dust.renderOrder = 0;
    dustGroup.add(dust);
    scene.add(dustGroup);

    /* subject layer -------------------------------------------------*/

    const latticeGroup = new Group();

    const nodePositions = new Float32Array(NODE_COUNT * 3);
    const nodeGeometry = track(new BufferGeometry());
    const nodeAttribute = new BufferAttribute(nodePositions, 3);
    nodeAttribute.setUsage(DynamicDrawUsage); // rewritten every frame
    nodeGeometry.setAttribute("position", nodeAttribute);

    const nodeMaterial = track(
      new PointsMaterial({
        map: dotSprite,
        color: palette.primary,
        size: 0.075,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    const nodes = new Points(nodeGeometry, nodeMaterial);
    nodes.renderOrder = 1;
    latticeGroup.add(nodes);

    const edgeIndices = GEOMETRY.edges;
    const edgePositions = new Float32Array(edgeIndices.length * 3);
    const edgeGeometry = track(new BufferGeometry());
    const edgeAttribute = new BufferAttribute(edgePositions, 3);
    edgeAttribute.setUsage(DynamicDrawUsage);
    edgeGeometry.setAttribute("position", edgeAttribute);

    const edgeMaterial = track(
      new LineBasicMaterial({
        color: palette.primary,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    const edges = new LineSegments(edgeGeometry, edgeMaterial);
    edges.renderOrder = 1;
    latticeGroup.add(edges);

    scene.add(latticeGroup);

    /* near layer ----------------------------------------------------*/

    // `PointsMaterial` carries one size for the whole cloud, so the nine discs
    // are split across three small Points objects to get real size variety.
    // Three extra draw calls for foreground that actually looks like foreground.
    const bokehGroup = new Group();
    const bokehSizes = [0.42, 0.62, 0.86];
    const bokehBuckets = [[], [], []];
    for (let i = 0; i < BOKEH_COUNT; i += 1) {
      const bucket = Math.min(2, Math.floor((GEOMETRY.bokehSize[i] - 0.32) / 0.16));
      bokehBuckets[bucket].push(
        GEOMETRY.bokeh[i * 3],
        GEOMETRY.bokeh[i * 3 + 1],
        GEOMETRY.bokeh[i * 3 + 2],
      );
    }

    const bokehMaterials = bokehBuckets.map((coords, index) => {
      const material = track(
        new PointsMaterial({
          map: bokehSprite,
          color: palette.primary,
          size: bokehSizes[index],
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          fog: false, // it is in front of the camera's focal plane; fog would be wrong
        }),
      );
      if (coords.length === 0) return material;

      const geometry = track(new BufferGeometry());
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(coords), 3));
      const points = new Points(geometry, material);
      points.renderOrder = 2;
      bokehGroup.add(points);
      return material;
    });

    scene.add(bokehGroup);

    /* --- theme changes -------------------------------------------- */

    // The palette is switched by toggling a class on <html>. Re-read rather
    // than leave the scene in last season's colours.
    const applyPalette = () => {
      const next = readPalette(host);
      palette.primary.copy(next.primary);
      palette.deep.copy(next.deep);
      palette.background.copy(next.background);
      nodeMaterial.color.copy(next.primary);
      edgeMaterial.color.copy(next.primary);
      dustMaterial.color.copy(next.deep);
      bokehMaterials.forEach((material) => material.color.copy(next.primary));
      scene.fog.color.copy(next.background);
    };
    const themeObserver = new MutationObserver(applyPalette);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    /* --- sizing --------------------------------------------------- */

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setPixelRatio(pixelRatio()); // the window may have moved displays
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    /* --- animation ------------------------------------------------ */

    const { settled, scattered, phase } = GEOMETRY;

    let frame = null;
    let lastTime = 0;
    let elapsed = 0;
    let smoothed = 0;
    let onScreen = false;
    let firstFramePainted = false;

    const draw = (dt) => {
      elapsed += dt;

      // Frame-rate independent exponential damping. The scene follows the
      // scroll rather than being nailed to it, which is what stops a trackpad
      // flick from looking like a jump cut.
      smoothed += (scrollRef.current - smoothed) * (1 - Math.exp(-dt * 6));

      const parallax = smoothed;
      const resolve = easeInOutCubic(clamp01(smoothed / RESOLVE_AT));

      // Scattered nodes churn; settled nodes are calm. The resolve is also a
      // settling-down, not just a rearrangement.
      const breath = 0.085 * (1 - resolve * 0.82);

      for (let i = 0; i < NODE_COUNT; i += 1) {
        const o = i * 3;
        const wobble = elapsed * 0.5 + phase[i];
        nodePositions[o] = mix(scattered[o], settled[o], resolve) + Math.sin(wobble) * breath;
        nodePositions[o + 1] =
          mix(scattered[o + 1], settled[o + 1], resolve) + Math.cos(wobble * 0.83) * breath;
        nodePositions[o + 2] =
          mix(scattered[o + 2], settled[o + 2], resolve) + Math.sin(wobble * 0.61) * breath;
      }
      nodeAttribute.needsUpdate = true;

      for (let i = 0; i < edgeIndices.length; i += 1) {
        const source = edgeIndices[i] * 3;
        const target = i * 3;
        edgePositions[target] = nodePositions[source];
        edgePositions[target + 1] = nodePositions[source + 1];
        edgePositions[target + 2] = nodePositions[source + 2];
      }
      edgeAttribute.needsUpdate = true;

      // Three layers, three rates. This is the parallax.
      dustGroup.position.z = -1.6 * parallax;
      dustGroup.position.y = 0.4 * parallax;
      dustGroup.rotation.y = elapsed * 0.01;

      latticeGroup.position.y = -0.18 * parallax;
      // A slow oscillation, not a rotation: a flat lattice spun about Y goes
      // edge-on and disappears, which looks like a bug.
      latticeGroup.rotation.y = Math.sin(elapsed * 0.08) * 0.09;
      latticeGroup.rotation.x = Math.sin(elapsed * 0.061) * 0.045;

      bokehGroup.position.z = -1.8 * parallax;
      bokehGroup.position.y = -0.7 * parallax;
      bokehGroup.position.x = Math.sin(elapsed * 0.05) * 0.15;
      // The foreground clutter clears as the structure emerges.
      const bokehOpacity = mix(0.13, 0.03, resolve);
      bokehMaterials.forEach((material) => {
        material.opacity = bokehOpacity;
      });

      // Edges strengthen as the lattice finds its shape.
      edgeMaterial.opacity = mix(0.1, 0.26, resolve);

      camera.position.z = mix(CAMERA_Z_FAR, CAMERA_Z_NEAR, resolve);
      camera.position.y = mix(CAMERA_Y_START, CAMERA_Y_END, parallax);
      camera.lookAt(0, mix(0.08, -0.06, parallax), 0);

      renderer.render(scene, camera);

      if (!firstFramePainted) {
        firstFramePainted = true;
        onReadyRef.current?.();
      }
    };

    const tick = (time) => {
      frame = window.requestAnimationFrame(tick);
      // Clamped so a long pause (or a slow first frame) cannot teleport the
      // animation forward when the loop resumes.
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60;
      lastTime = time;
      draw(dt);
    };

    const start = () => {
      if (frame !== null) return;
      lastTime = 0; // resume from where we stopped, do not fast-forward
      frame = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };

    const sync = () => {
      if (onScreen && document.visibilityState !== "hidden") start();
      else stop();
    };

    // Nothing renders until the canvas is actually on screen, and it stops
    // again the moment it leaves. A hero that keeps burning a GPU while the
    // visitor reads the pricing section is a battery bug.
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        sync();
      },
      { rootMargin: "120px", threshold: 0 },
    );
    intersectionObserver.observe(host);

    document.addEventListener("visibilitychange", sync);

    /* --- context loss --------------------------------------------- */

    const handleContextLost = (event) => {
      // Without preventDefault the context is never restorable and the browser
      // simply leaves a dead rectangle.
      event.preventDefault();
      stop();
      onUnavailableRef.current?.();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);

    /* --- teardown ------------------------------------------------- */

    return () => {
      stop();
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("webglcontextlost", handleContextLost);

      scene.clear();
      disposables.forEach((thing) => thing.dispose());

      renderer.dispose();
      // `dispose()` alone releases three's caches but leaves the GL context to
      // the garbage collector. Browsers cap live contexts at around sixteen, so
      // on a client-side route change a marketing page can genuinely exhaust
      // them. Hand it back explicitly.
      renderer.forceContextLoss();
      if (canvas.parentNode === host) host.removeChild(canvas);
    };
  }, []);

  return <div ref={hostRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />;
}
